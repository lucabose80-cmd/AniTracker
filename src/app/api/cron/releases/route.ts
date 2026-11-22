import { NextResponse } from "next/server";


export const dynamic = 'force-dynamic';

const DEFAULT_ICON_URL = "https://anitracker-delta.vercel.app/anipulse-192x192.png";

function resolveCoverIcon(coverImage?: { large?: string | null; medium?: string | null } | null): string {
  const candidate = coverImage?.large || coverImage?.medium;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.startsWith("https://")) return trimmed;
    if (trimmed.startsWith("http://")) return trimmed.replace(/^http:\/\//, "https://");
  }
  return DEFAULT_ICON_URL;
}

const GET_RECENT_RELEASES = `
  query($greater: Int, $lesser: Int) {
    Page(page: 1, perPage: 50) {
      airingSchedules(airingAt_greater: $greater, airingAt_lesser: $lesser, sort: TIME_DESC) {
        mediaId
        episode
        media {
          type
          status
          episodes
          chapters
          title {
            romaji
            english
            native
          }
          coverImage {
            large
            medium
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
        type
        status
        episodes
        chapters
        nextAiringEpisode {
          episode
          airingAt
        }
        title {
          romaji
          english
          native
        }
        coverImage {
          large
          medium
        }
      }
    }
  }
`;

async function fetchAniListMediaBatch(ids: number[]): Promise<Record<string, any>> {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const mediaMap: Record<string, any> = {};
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: GET_MEDIA_STATUS_BATCH, variables: { ids: chunk } }),
      });
      if (res.ok) {
        const data = await res.json();
        (data.data?.Page?.media || []).forEach((m: any) => {
          if (m?.id) mediaMap[m.id.toString()] = m;
        });
      } else {
        console.warn("AniList batch media non-OK status:", res.status);
      }
    } catch (e) {
      console.error("AniList batch media fetch failed:", e);
    }
  }
  return mediaMap;
}

function resolveEffectiveMax(over: any, media: any): number | null {
  if (over?.manualMaxEpisode != null && Number(over.manualMaxEpisode) > 0) {
    return Number(over.manualMaxEpisode);
  }
  if (media?.type === "MANGA" && Number(media?.chapters) > 0) {
    return Number(media.chapters);
  }
  if (media?.type !== "MANGA" && Number(media?.episodes) > 0) {
    return Number(media.episodes);
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer anitracker123` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Sync app version to Firestore so clients can detect updates
    try {
      const { CURRENT_APP_VERSION } = await import('@/lib/version');
      const versionRef = adminDb.collection('app_config').doc('version');
      const versionSnap = await versionRef.get();
      if (!versionSnap.exists || versionSnap.data()?.version !== CURRENT_APP_VERSION) {
        await versionRef.set({ version: CURRENT_APP_VERSION });
        console.log('App version synced to Firestore:', CURRENT_APP_VERSION);
      }
    } catch (vErr) {
      console.error('Version sync error:', vErr);
    }

    // ─── PART 1: Neue Folgen/Kapitel ─────────────────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    // Use a 4-hour lookback window so even if a cron run is delayed, no release is ever missed.
    // Deterministic notification IDs (`release_${uid}_${mediaId}_${episode}`) guarantee zero duplicate alerts.
    const lookbackStart = now - 4 * 3600;

    let schedules: any[] = [];
    try {
      const response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: GET_RECENT_RELEASES,
          variables: { greater: lookbackStart, lesser: now },
        }),
      });
      if (response.ok) {
        const json = await response.json();
        schedules = json.data?.Page?.airingSchedules || [];
      } else {
        console.warn("AniList recent releases non-OK status:", response.status);
      }
    } catch (aniErr) {
      console.error("AniList recent releases fetch error:", aniErr);
    }

    const [overridesSnap, pausesSnap] = await Promise.all([
      adminDb.collection("calendar_overrides").get(),
      adminDb.collection("work_pauses").get(),
    ]);

    const nowIso = new Date().toISOString();
    const pausedWorkIds = new Set<string>();
    for (const pDoc of pausesSnap.docs) {
      const pData = pDoc.data();
      if (pData?.paused && typeof pData.paused_until === "string") {
        if (pData.paused_until > nowIso) {
          pausedWorkIds.add(pData.work_id || pDoc.id);
        } else {
          // Pause has expired -> automatically clear the expired pause document so it unpauses cleanly
          await pDoc.ref.delete().catch(() => {});
        }
      }
    }

    const overridesByWorkId: Record<string, any> = {};
    const overrideWorkNumericIds: number[] = [];
    for (const doc of overridesSnap.docs) {
      overridesByWorkId[doc.id] = doc.data();
      const parsed = parseInt(doc.id, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        overrideWorkNumericIds.push(parsed);
      }
    }

    // Batch-fetch AniList metadata for all calendar_overrides BEFORE incrementing so we never
    // increment past a finished work's total episodes/chapters or notify on finished/cancelled works.
    const overrideMediaMap =
      overrideWorkNumericIds.length > 0
        ? await fetchAniListMediaBatch(overrideWorkNumericIds)
        : {};

    // Filter AniList schedules for paused, cancelled, or out-of-range episodes
    const activeSchedules = schedules.filter((s: any) => {
      const wid = String(s.mediaId);
      if (pausedWorkIds.has(wid)) return false;
      if (s.media?.status === "CANCELLED") return false;
      const effectiveMax = resolveEffectiveMax(overridesByWorkId[wid], s.media);
      if (effectiveMax !== null && Number(s.episode) > effectiveMax) return false;
      return true;
    });
    schedules.length = 0;
    schedules.push(...activeSchedules);

    const scheduleDeletePatch = {
      airingAt: FieldValue.delete(),
      weeklyDay: FieldValue.delete(),
      weeklyTime: FieldValue.delete(),
      releaseFrequency: FieldValue.delete(),
      lastIncrementedAt: FieldValue.delete(),
      rhythmType: FieldValue.delete(),
      flexibleDayRange: FieldValue.delete(),
    };

    let healedOverrides = 0;

    for (const doc of overridesSnap.docs) {
      const workId = doc.id;
      const over = doc.data();
      const media = overrideMediaMap[workId];
      const effectiveMax = resolveEffectiveMax(over, media);
      const currentAvail =
        over.manualAvailableEps != null ? Number(over.manualAvailableEps) : null;
      const hasRecurringSchedule =
        over.weeklyDay !== undefined ||
        over.airingAt !== undefined ||
        over.flexibleDayRange !== undefined;

      // Guard 1: Work is cancelled -> clear stale schedule, never increment
      if (media?.status === "CANCELLED") {
        if (hasRecurringSchedule) {
          await doc.ref.update(scheduleDeletePatch).catch(() => {});
          healedOverrides++;
        }
        continue;
      }

      // Guard 2: Work has reached or exceeded its total episodes/chapters -> self-heal & stop forever
      if (effectiveMax !== null && currentAvail !== null && currentAvail >= effectiveMax) {
        const healPatch: Record<string, any> = {};
        if (currentAvail > effectiveMax) {
          healPatch.manualAvailableEps = effectiveMax;
        }
        if (hasRecurringSchedule) {
          Object.assign(healPatch, scheduleDeletePatch);
        }
        if (Object.keys(healPatch).length > 0) {
          await doc.ref.update(healPatch).catch(() => {});
          healedOverrides++;
        }
        continue;
      }

      // Guard 3: Finished work with no known remaining episodes (e.g. no manualAvailableEps < effectiveMax)
      if (media?.status === "FINISHED" && (effectiveMax === null || currentAvail === null)) {
        if (hasRecurringSchedule) {
          await doc.ref.update(scheduleDeletePatch).catch(() => {});
          healedOverrides++;
        }
        continue;
      }

      // Guard 4: Work hasn't started yet or is paused -> skip without clearing schedule
      if (media?.status === "NOT_YET_RELEASED" || pausedWorkIds.has(workId)) {
        continue;
      }

      const freqWeeks = Math.max(1, Number(over.releaseFrequency) || 1);
      const lastInc = Number(over.lastIncrementedAt) || 0;
      const threshold = freqWeeks * 7 * 24 * 3600 - 4 * 3600;

      // If startDate is in the future, do not auto-increment yet
      if (typeof over.startDate === "string" && over.startDate) {
        const startSec = Math.floor(new Date(over.startDate).getTime() / 1000);
        if (!Number.isNaN(startSec) && now < startSec) {
          continue;
        }
      }

      const targetDay =
        over.rhythmType === "flexible" && over.flexibleDayRange?.minDay !== undefined
          ? Number(over.flexibleDayRange.minDay)
          : over.weeklyDay !== undefined
          ? Number(over.weeklyDay)
          : undefined;
      const targetTimeStr = over.weeklyTime || "18:00";

      let shouldTriggerNow = false;

      if (typeof over.airingAt === "number" && over.airingAt > 0) {
        if (over.airingAt >= lookbackStart && over.airingAt <= now && now - lastInc >= 3600) {
          shouldTriggerNow = true;
        }
      }

      if (!shouldTriggerNow && targetDay !== undefined && !Number.isNaN(targetDay)) {
        // Convert to Europe/Berlin timezone so German release times match Vercel's UTC clock
        const berlinDate = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })
        );
        const currentDay = berlinDate.getDay();
        const currentHour = berlinDate.getHours();
        const currentMinute = berlinDate.getMinutes();
        const [rawH, rawM] = targetTimeStr.split(":").map(Number);
        const targetHour = Number.isNaN(rawH) ? 18 : rawH;
        const targetMinute = Number.isNaN(rawM) ? 0 : rawM;

        if (currentDay === targetDay) {
          const currentTimeMin = currentHour * 60 + currentMinute;
          const targetTimeMin = targetHour * 60 + targetMinute;

          // Allow a 4-hour catch-up window on the release day in case a cron execution was delayed
          if (currentTimeMin >= targetTimeMin && currentTimeMin < targetTimeMin + 240) {
            if (now - lastInc >= threshold) {
              shouldTriggerNow = true;
            }
          }
        }
      }

      if (shouldTriggerNow) {
        const newEps = (currentAvail ?? 0) + 1;
        if (effectiveMax !== null && newEps > effectiveMax) {
          continue;
        }

        const nextUpdate: Record<string, any> = {
          manualAvailableEps: newEps,
          lastIncrementedAt: now,
        };

        // If this increment reaches the final episode/chapter, automatically retire the recurring schedule
        if (effectiveMax !== null && newEps >= effectiveMax) {
          Object.assign(nextUpdate, scheduleDeletePatch);
          nextUpdate.lastIncrementedAt = now;
        } else if (typeof over.airingAt === "number" && over.airingAt > 0 && freqWeeks >= 1) {
          nextUpdate.airingAt = over.airingAt + freqWeeks * 7 * 24 * 3600;
        }

        await doc.ref.update(nextUpdate);

        if (media) {
          schedules.push({
            mediaId: doc.id,
            episode: newEps,
            type: media.type || "MANGA",
            media,
            isCustomOverride: true,
          });
        }
      }
    }

    let notificationsSent = 0;

    if (schedules.length > 0) {
      for (const schedule of schedules) {
        const workIdStr = schedule.mediaId.toString();
        const querySnap = await adminDb
          .collection("user_works")
          .where("work_id", "==", workIdStr)
          .get();
        if (querySnap.empty) continue;

        // Only notify users actively watching/reading (status === "CURRENT") who haven't watched this episode yet
        const eligibleByUser = new Map<string, number>();
        for (const d of querySnap.docs) {
          const uWork = d.data();
          if (!uWork?.user_id) continue;
          if (uWork.status !== "CURRENT") continue;

          const userManualMax =
            uWork.manual_max_episode != null && Number(uWork.manual_max_episode) > 0
              ? Number(uWork.manual_max_episode)
              : null;
          if (userManualMax !== null && Number(schedule.episode) > userManualMax) {
            continue;
          }

          const offset = schedule.isCustomOverride
            ? 0
            : Math.max(0, Number(uWork.synchro_offset_episodes) || 0);
          const targetEpisode = Number(schedule.episode) - offset;
          if (targetEpisode <= 0) continue;

          const currentEp = Number(uWork.current_episode) || 0;
          if (currentEp >= targetEpisode) continue;

          eligibleByUser.set(uWork.user_id, targetEpisode);
        }

        if (eligibleByUser.size === 0) continue;

        // Group tokens by targetEpisode so synchro-offset users get their accurate episode number
        const tokensByEpisode = new Map<number, { tokens: string[]; tokenToUserIds: Map<string, string[]> }>();

        for (const [uid, targetEpisode] of eligibleByUser.entries()) {
          const userDoc = await adminDb.collection("users").doc(uid).get();
          if (!userDoc.exists) continue;
          const userData = userDoc.data()!;
          const settings = userData.notification_settings || { releases: true };
          const tokens: string[] = Array.isArray(userData.fcm_tokens) ? userData.fcm_tokens : [];

          if (settings.releases === false) continue;

          // Create InAppNotification with deterministic ID to prevent duplicates
          const notifId = `release_${uid}_${schedule.mediaId}_${targetEpisode}`;
          const notifRef = adminDb.collection("notifications").doc(notifId);
          const notifSnap = await notifRef.get();
          if (!notifSnap.exists) {
            const workTitle =
              schedule.media?.title?.english ||
              schedule.media?.title?.native ||
              schedule.media?.title?.romaji ||
              "";
            const mediaType = schedule.type || schedule.media?.type || "ANIME";
            await notifRef.set({
              notification_id: notifId,
              user_id: uid,
              actor_id: "SYSTEM",
              actor_name: "AniPulse",
              actor_avatar: "https://anitracker-delta.vercel.app/anipulse-192x192.png",
              type: "SYSTEM",
              work_id: String(schedule.mediaId),
              work_title: workTitle,
              media_type: mediaType,
              episode_num: targetEpisode,
              text: `${mediaType === "MANGA" ? "Kapitel" : "Episode"} ${targetEpisode} von ${workTitle} ist jetzt online.`,
              timestamp: new Date().toISOString(),
              read: false,
            });

            if (tokens.length > 0) {
              let bucket = tokensByEpisode.get(targetEpisode);
              if (!bucket) {
                bucket = { tokens: [], tokenToUserIds: new Map() };
                tokensByEpisode.set(targetEpisode, bucket);
              }
              for (const tk of tokens) {
                if (!tk) continue;
                if (!bucket.tokenToUserIds.has(tk)) {
                  bucket.tokenToUserIds.set(tk, []);
                  bucket.tokens.push(tk);
                }
                bucket.tokenToUserIds.get(tk)!.push(uid);
              }
            }
          }
        }

        const workTitle =
          schedule.media?.title?.english ||
          schedule.media?.title?.native ||
          schedule.media?.title?.romaji ||
          "Werk";
        const mediaType = schedule.type || schedule.media?.type || "ANIME";
        const coverUrl = resolveCoverIcon(schedule.media?.coverImage);

        for (const [targetEpisode, bucket] of tokensByEpisode.entries()) {
          if (bucket.tokens.length === 0) continue;
          const payload = {
            notification: {
              title: mediaType === "MANGA" ? "Neues Kapitel verf\u00FCgbar!" : "Neue Folge verf\u00FCgbar!",
              body: `${mediaType === "MANGA" ? "Kapitel" : "Episode"} ${targetEpisode} von ${workTitle} ist jetzt online.`,
            },
            data: { link: `/work/${schedule.mediaId}`, type: "releases", icon: coverUrl },
            webpush: {
              headers: {
                Urgency: "high",
                TTL: "86400",
              },
              notification: {
                icon: coverUrl,
                badge: "https://anitracker-delta.vercel.app/anipulse-badge-96.png",
                requireInteraction: true,
                tag: `release-${schedule.mediaId}-${targetEpisode}`,
                renotify: true,
                silent: false,
                vibrate: [200, 100, 200],
              },
              fcmOptions: { link: `/work/${schedule.mediaId}` },
            },
            tokens: bucket.tokens,
          };
          try {
            const res = await adminMessaging.sendEachForMulticast(payload);
            notificationsSent += res.successCount;

            if (res.failureCount > 0) {
              for (let idx = 0; idx < res.responses.length; idx++) {
                const resp = res.responses[idx];
                if (
                  !resp.success &&
                  (resp.error?.code === "messaging/registration-token-not-registered" ||
                    resp.error?.code === "messaging/invalid-registration-token")
                ) {
                  const deadToken = bucket.tokens[idx];
                  const uids = bucket.tokenToUserIds.get(deadToken) || [];
                  for (const uid of uids) {
                    await adminDb
                      .collection("users")
                      .doc(uid)
                      .update({ fcm_tokens: FieldValue.arrayRemove(deadToken) })
                      .catch(() => {});
                  }
                }
              }
            }
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
        const planningWorkIds = [
          ...new Set(
            planningSnap.docs.map((d) => parseInt(d.data().work_id, 10)).filter(Boolean)
          ),
        ] as number[];

        const aniListStatusMap = await fetchAniListMediaBatch(planningWorkIds);

        for (const docSnap of planningSnap.docs) {
          const uWork = docSnap.data();
          const aniListInfo = aniListStatusMap[uWork.work_id];
          if (!aniListInfo) continue;

          // Backfill added_status if missing on legacy PLANNING entries when still unreleased
          if (!uWork.added_status && aniListInfo.status === "NOT_YET_RELEASED") {
            await adminDb.collection("user_works").doc(docSnap.id).update({
              added_status: "NOT_YET_RELEASED",
            }).catch(() => {});
            continue;
          }

          if (uWork.added_status !== "NOT_YET_RELEASED") continue; // Nur Werke beachten, die bei Hinzufügen noch nicht raus waren

          // Don't move to CURRENT before Episode 1 has actually aired
          const ep1NotYetAired =
            aniListInfo.type === "ANIME" &&
            aniListInfo.status === "RELEASING" &&
            aniListInfo.nextAiringEpisode?.episode === 1 &&
            Number(aniListInfo.nextAiringEpisode?.airingAt) > now;
          if (ep1NotYetAired) continue;

          if (aniListInfo.status === "RELEASING" || aniListInfo.status === "FINISHED") {
            const userId = uWork.user_id;
            const workId = uWork.work_id;
            const title = aniListInfo.title?.english || aniListInfo.title?.romaji || "Ein Werk";
            const nowIsoStr = new Date().toISOString();

            // 1. Move to CURRENT
            await adminDb.collection("user_works").doc(docSnap.id).update({ status: "CURRENT" });
            wishlistMoved++;

            // 2. Create feed activity & in-app notification
            const actRef = adminDb.collection("activity_feed").doc();
            await actRef.set({
              activity_id: actRef.id,
              user_id: userId,
              action_type: "TOP9_UPDATE",
              work_id: workId,
              text: `${title} aus der Wunschliste ist jetzt erschienen und wurde zu 'Aktiv' verschoben!`,
              timestamp: nowIsoStr,
            });

            const notifRef = adminDb.collection("notifications").doc(`wishlist_${userId}_${workId}`);
            const wishlistNotifSnap = await notifRef.get();
            if (!wishlistNotifSnap.exists) {
              await notifRef.set({
                notification_id: notifRef.id,
                user_id: userId,
                actor_id: "SYSTEM",
                actor_name: "AniPulse",
                actor_avatar: "https://anitracker-delta.vercel.app/anipulse-192x192.png",
                type: "SYSTEM",
                work_id: String(workId),
                work_title: title,
                text: `${title} aus der Wunschliste ist jetzt erschienen und wurde zu 'Aktiv' verschoben!`,
                timestamp: nowIsoStr,
                read: false,
              });
            }

            // 3. FCM Push
            const userDoc = await adminDb.collection("users").doc(userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data()!;
              const tokens: string[] = Array.isArray(userData.fcm_tokens) ? userData.fcm_tokens : [];
              const settings = userData.notification_settings || { releases: true };
              
              if (settings.releases !== false && tokens.length > 0) {
                const wishlistCoverUrl = resolveCoverIcon(aniListInfo.coverImage);
                const payload = {
                  notification: {
                    title: "\uD83C\uDF89 Wunschliste -> Jetzt verf\u00FCgbar!",
                    body: `${title} ist jetzt erschienen und wurde in deine Aktiv-Liste verschoben!`,
                  },
                  data: { link: `/work/${workId}`, type: "releases", icon: wishlistCoverUrl },
                  webpush: {
                    headers: { 
                      Urgency: "high",
                      TTL: "86400"
                    },
                    notification: { 
                      icon: wishlistCoverUrl,
                      badge: "https://anitracker-delta.vercel.app/anipulse-badge-96.png",
                      requireInteraction: true,
                      tag: `wishlist-${workId}`,
                      renotify: true,
                      silent: false,
                      vibrate: [200, 100, 200],
                    },
                    fcmOptions: { link: `/work/${workId}` }
                  },
                  tokens,
                };
                try {
                  const res = await adminMessaging.sendEachForMulticast(payload);
                  wishlistNotificationsSent += res.successCount;
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
      healedOverrides,
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
