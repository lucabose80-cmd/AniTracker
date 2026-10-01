import { NextResponse } from "next/server";


export const dynamic = 'force-dynamic';

const GET_RECENT_RELEASES = `
  query($greater: Int, $lesser: Int) {
    Page(page: 1, perPage: 50) {
      airingSchedules(airingAt_greater: $greater, airingAt_lesser: $lesser, sort: TIME_DESC) {
        mediaId
        episode
        media {
          title {
            romaji
            english
            native
          }
        }
      }
    }
  }
`;

const GET_MEDIA_STATUS_BATCH = `
  query($ids: [Int]) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids) {
        id
        status
        title {
          romaji
          english
        }
        coverImage {
          large
        }
      }
    }
  }
`;

export async function GET(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer anitracker123` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ─── PART 1: Neue Folgen/Kapitel ─────────────────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GET_RECENT_RELEASES,
        variables: { greater: oneHourAgo, lesser: now },
      }),
    });

    const json = await response.json();
    const schedules = json.data?.Page?.airingSchedules || [];

    const customSchedules: any[] = [];
    const overridesSnap = await adminDb.collection("calendar_overrides").get();
    
    overridesSnap.docs.forEach(doc => {
      const over = doc.data();
      if (over.weeklyDay !== undefined && over.weeklyTime !== undefined) {
        const date = new Date();
        const currentDay = date.getDay();
        const currentHour = date.getHours();
        const currentMinute = date.getMinutes();
        const [targetHour, targetMinute] = over.weeklyTime.split(':').map(Number);
        
        if (currentDay === over.weeklyDay) {
          const currentTimeMin = currentHour * 60 + currentMinute;
          const targetTimeMin = targetHour * 60 + targetMinute;
          
          if (currentTimeMin >= targetTimeMin && currentTimeMin < targetTimeMin + 60) {
            const freqWeeks = over.releaseFrequency || 1;
            const lastInc = over.lastIncrementedAt || 0;
            const threshold = (freqWeeks * 7 * 24 * 3600) - 3600;
            
            if (now - lastInc >= threshold) {
              const newEps = (over.manualAvailableEps || 0) + 1;
              adminDb.collection("calendar_overrides").doc(doc.id).update({
                manualAvailableEps: newEps,
                lastIncrementedAt: now
              });
              customSchedules.push({ mediaId: doc.id, episode: newEps, type: "MANGA" });
            }
          }
        }
      }
    });

    if (customSchedules.length > 0) {
      const customIds = customSchedules.map(s => parseInt(s.mediaId, 10));
      const mediaRes = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($in: [Int]) { Page { media(id_in: $in) { id title { romaji english native } } } }`,
          variables: { in: customIds }
        }),
      }).then(r => r.json());
      
      const mediaList = mediaRes.data?.Page?.media || [];
      customSchedules.forEach(cs => {
        const m = mediaList.find((x: any) => x.id.toString() === cs.mediaId);
        if (m) { cs.media = m; schedules.push(cs); }
      });
    }

    let notificationsSent = 0;

    if (schedules.length > 0) {
      for (const schedule of schedules) {
        const workIdStr = schedule.mediaId.toString();
        const querySnap = await adminDb.collection("user_works").where("work_id", "==", workIdStr).get();
        if (querySnap.empty) continue;
        
        const userIds = [...new Set(querySnap.docs.map((d: any) => d.data().user_id))];
        if (userIds.length === 0) continue;
        
        const tokensToNotify: string[] = [];
        
        // Fetch users in chunks of 10 to avoid limits, though here we just fetch them individually since there might be few
        for (const uid of userIds) {
          const userDoc = await adminDb.collection("users").doc(uid as string).get();
          if (userDoc.exists) {
            const userData = userDoc.data()!;
            const settings = userData.notification_settings || { releases: true };
            const tokens = userData.fcm_tokens || [];
            if (settings.releases && tokens.length > 0) {
              tokensToNotify.push(...tokens);
            }
          }
        }
        
        if (tokensToNotify.length > 0) {
          const payload = {
            notification: {
              title: schedule.type === "MANGA" ? "Neues Kapitel verfügbar!" : "Neue Folge verfügbar!",
              body: `${schedule.type === "MANGA" ? "Kapitel" : "Episode"} ${schedule.episode} von ${schedule.media.title.english || schedule.media.title.native || schedule.media.title.romaji} ist jetzt online.`,
            },
            data: { link: `/work/${schedule.mediaId}`, type: "releases" },
            webpush: {
              headers: { Urgency: "high" },
              notification: { icon: "https://anitracker-delta.vercel.app/weebcheck-192x192.png" },
              fcmOptions: { link: `/work/${schedule.mediaId}` }
            },
            tokens: tokensToNotify,
          };
          try {
            await adminMessaging.sendEachForMulticast(payload);
            notificationsSent++;
          } catch (pushErr) {
            console.error("FCM Send Error:", pushErr);
          }
        }
      }
    }

    // ─── PART 2: Wunschlisten-Check ──────────────────────────────────────────
    let wishlistNotificationsSent = 0;
    let wishlistMoved = 0;

    try {
      const planningSnap = await adminDb.collection("user_works")
        .where("status", "==", "PLANNING")
        .get();

      if (planningSnap.size > 0) {
        const planningWorkIds = [...new Set(planningSnap.docs.map(d => parseInt(d.data().work_id, 10)).filter(Boolean))] as number[];

        // Batch-fetch AniList status
        const aniListStatusMap: Record<string, any> = {};
        for (let i = 0; i < planningWorkIds.length; i += 50) {
          const chunk = planningWorkIds.slice(i, i + 50);
          try {
            const res = await fetch("https://graphql.anilist.co", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: GET_MEDIA_STATUS_BATCH, variables: { ids: chunk } }),
            });
            const data = await res.json();
            (data.data?.Page?.media || []).forEach((m: any) => {
              aniListStatusMap[m.id.toString()] = m;
            });
          } catch (e) {
            console.error("AniList batch check failed", e);
          }
        }

        for (const docSnap of planningSnap.docs) {
          const uWork = docSnap.data();
          const aniListInfo = aniListStatusMap[uWork.work_id];
          if (!aniListInfo) continue;

          if (uWork.added_status !== "NOT_YET_RELEASED") continue; // Nur Werke beachten, die bei Hinzufügen noch nicht raus waren

          if (aniListInfo.status === "RELEASING" || aniListInfo.status === "FINISHED") {
            const userId = uWork.user_id;
            const workId = uWork.work_id;
            const title = aniListInfo.title?.english || aniListInfo.title?.romaji || "Ein Werk";

            // 1. Move to CURRENT
            await adminDb.collection("user_works").doc(docSnap.id).update({ status: "CURRENT" });
            wishlistMoved++;

            // 2. Create feed activity
            await adminDb.collection("activity_feed").add({
              user_id: userId,
              type: "TOP9_UPDATE",
              work_id: workId,
              text: `${title} aus der Wunschliste ist jetzt erschienen und wurde zu 'Aktiv' verschoben!`,
              timestamp: new Date(),
            });

            // 3. FCM Push
            const userDoc = await adminDb.collection("users").doc(userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data()!;
              const tokens = userData.fcm_tokens || [];
              const settings = userData.notification_settings || { releases: true };
              
              if (settings.releases && tokens.length > 0) {
                const payload = {
                  notification: {
                    title: "🎉 Wunschliste – Jetzt verfügbar!",
                    body: `${title} ist jetzt erschienen und wurde in deine Aktiv-Liste verschoben!`,
                  },
                  data: { link: `/work/${workId}`, type: "releases" },
                  webpush: {
                    headers: { Urgency: "high" },
                    notification: { icon: "https://anitracker-delta.vercel.app/weebcheck-192x192.png" },
                    fcmOptions: { link: `/work/${workId}` }
                  },
                  tokens,
                };
                try {
                  await adminMessaging.sendEachForMulticast(payload);
                  wishlistNotificationsSent++;
                } catch (pushErr) {
                  console.error("FCM Wishlist Send Error:", pushErr);
                }
              }
            }
          }
        }
      }
    } catch (wishlistErr: any) {
      console.error("Wishlist check error:", wishlistErr);
    }

    return NextResponse.json({ 
      success: true,
      notificationsSent,
      wishlistMoved,
      wishlistNotificationsSent,
    });
  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ 
      error: error?.message || "Unknown error", 
      stack: error?.stack,
      name: error?.name,
      raw: String(error)
    }, { status: 500 });
  }
}
