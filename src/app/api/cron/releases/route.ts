import { NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

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

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    // Hardcoded secret for cron-job.org
    if (authHeader !== `Bearer anitracker123`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check last hour
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    const fetchPromise = fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GET_RECENT_RELEASES,
        variables: { greater: oneHourAgo, lesser: now },
      }),
    });

    const response = await fetchPromise;
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
            const threshold = (freqWeeks * 7 * 24 * 3600) - 3600; // 1 hour buffer
            
            if (now - lastInc >= threshold) {
              const newEps = (over.manualAvailableEps || 0) + 1;
              adminDb.collection("calendar_overrides").doc(doc.id).update({
                manualAvailableEps: newEps,
                lastIncrementedAt: now
              });
              
              customSchedules.push({
                mediaId: doc.id,
                episode: newEps,
                type: "MANGA"
              });
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
        if (m) {
          cs.media = m;
          schedules.push(cs);
        }
      });
    }

    if (schedules.length === 0) {
      return NextResponse.json({ message: "No new releases in the last hour" });
    }

    const releasedMediaIds = schedules.map((s: any) => s.mediaId.toString());

    // Get all users who have notifications enabled for releases
    const usersSnap = await adminDb.collection("users").get();
    
    let notificationsSent = 0;
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const settings = userData.notification_settings || { releases: true };
      const tokens = userData.fcm_tokens || [];

      if (settings.releases && tokens.length > 0) {
        // Find if this user tracks any of the newly released media
        const userWorksRef = adminDb.collection("user_works");
        const querySnap = await userWorksRef.where("user_id", "==", userDoc.id).get();
        
        const userLibraryIds = querySnap.docs.map((d: any) => d.data().work_id);
        
        for (const schedule of schedules) {
          if (userLibraryIds.includes(schedule.mediaId.toString())) {
            // User tracks this anime, and a new episode just dropped!
            const payload = {
              notification: {
                title: schedule.type === "MANGA" ? "Neues Kapitel verfügbar!" : "Neue Folge verfügbar!",
                body: `${schedule.type === "MANGA" ? "Kapitel" : "Episode"} ${schedule.episode} von ${schedule.media.title.english || schedule.media.title.native || schedule.media.title.romaji} ist jetzt online.`,
              },
              data: {
                link: `/work/${schedule.mediaId}`,
                type: "releases"
              },
              webpush: {
                headers: { Urgency: "high" },
                notification: { icon: "https://anitracker-delta.vercel.app/icon-192x192.png?v=2" },
                fcmOptions: { link: `/work/${schedule.mediaId}` }
              },
              tokens,
            };

            await adminMessaging.sendEachForMulticast(payload);
            notificationsSent++;
          }
        }
      }
    }

    return NextResponse.json({ success: true, releasedMediaIds, notificationsSent });
  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
