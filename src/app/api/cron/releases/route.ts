import { NextResponse } from "next/server";
import type { MulticastMessage } from "firebase-admin/messaging";

export const dynamic = "force-dynamic";

const DEFAULT_ICON_URL =
  "https://anitracker-delta.vercel.app/anipulse-192x192.png";
const BADGE_URL =
  "https://anitracker-delta.vercel.app/anipulse-badge-96.png";

interface CronMedia {
  id?: number;
  type?: string;
  status?: string;
  episodes?: number | null;
  chapters?: number | null;
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  nextAiringEpisode?: { episode?: number; airingAt?: number } | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  coverImage?: { large?: string | null; medium?: string | null } | null;
}

interface CronSchedule {
  mediaId: string | number;
  episode: number;
  type?: string;
  media?: CronMedia;
  isCustomOverride?: boolean;
}

function resolveCoverIcon(
  coverImage?: { large?: string | null; medium?: string | null } | null
): string {
  const candidate = coverImage?.large || coverImage?.medium;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.startsWith("https://")) return trimmed;
    if (trimmed.startsWith("http://")) {
      return trimmed.replace(/^http:\/\//, "https://");
    }
  }
  return DEFAULT_ICON_URL;
}

function resolveMediaTitle(media?: CronMedia, fallback = "Werk"): string {
  return (
    media?.title?.english ||
    media?.title?.romaji ||
    media?.title?.native ||
    fallback
  );
}

function getBerlinWeekdayAndMinutes(date: Date): {
  weekday: number; // 0=Sun..6=Sat
  minutesOfDay: number;
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute) || 0;

  return {
    weekday: dayMap[map.weekday] ?? date.getUTCDay(),
    minutesOfDay: hour * 60 + minute,
    year: Number(map.year) || date.getUTCFullYear(),
    month: Number(map.month) || date.getUTCMonth() + 1,
    day: Number(map.day) || date.getUTCDate(),
  };
}

function getMondayEpochDay(year: number, month: number, day: number): number {
  const utcMs = Date.UTC(year, month - 1, day);
  const d = new Date(utcMs);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = dow === 0 ? 6 : dow - 1;
  return Math.floor(utcMs / 86400000) - diffToMon;
}

function parseStartDateParts(
  startDate?: string
): { year: number; month: number; day: number } | null {
  if (!startDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate.trim());
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
  };
}

const GET_RECENT_RELEASES = `
  query($page: Int, $greater: Int, $lesser: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo {
        hasNextPage
      }
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
        endDate {
          year
          month
          day
        }
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

async function fetchAniListMediaBatch(
  ids: number[]
): Promise<Record<string, CronMedia>> {
  const uniqueIds = [
    ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const mediaMap: Record<string, CronMedia> = {};
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: GET_MEDIA_STATUS_BATCH,
          variables: { ids: chunk },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        ((data.data?.Page?.media || []) as CronMedia[]).forEach((m) => {
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

function resolveEffectiveMax(
  over: Record<string, unknown> | undefined,
  media: CronMedia | undefined
): number | null {
  if (over?.manualMaxEpisode != null && Number(over.manualMaxEpisode) > 0) {
    return Number(over.manualMaxEpisode);
  }
  if (media && media.type === "MANGA" && Number(media.chapters) > 0) {
    return Number(media.chapters);
  }
  if (media && media.type !== "MANGA" && Number(media.episodes) > 0) {
    return Number(media.episodes);
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const authHeader = req.headers.get("authorization");
    if (
      authHeader !== `Bearer anitracker123` &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Sync app version to Firestore so clients can detect updates
    try {
      const { CURRENT_APP_VERSION } = await import("@/lib/version");
      const versionRef = adminDb.collection("app_config").doc("version");
      const versionSnap = await versionRef.get();
      if (
        !versionSnap.exists ||
        versionSnap.data()?.version !== CURRENT_APP_VERSION
      ) {
        await versionRef.set({ version: CURRENT_APP_VERSION });
      }
    } catch (vErr) {
      console.error("Version sync error:", vErr);
    }

    // ─── PART 1: Neue Folgen/Kapitel ─────────────────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    const lookbackStart = now - 4 * 3600;

    // Fetch all pages of recent AniList airing schedules in the 4-hour lookback window (max 5 pages)
    let schedules: CronSchedule[] = [];
    try {
      for (let page = 1; page <= 5; page++) {
        const response = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: GET_RECENT_RELEASES,
            variables: { page, greater: lookbackStart, lesser: now },
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          console.warn("AniList recent releases non-OK status:", response.status);
          break;
        }
        const json = await response.json();
        const pageSchedules = (json.data?.Page?.airingSchedules || []) as CronSchedule[];
        schedules.push(...pageSchedules);
        if (!json.data?.Page?.pageInfo?.hasNextPage) break;
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
          await pDoc.ref.delete().catch(() => {});
        }
      }
    }

    const overridesByWorkId: Record<string, Record<string, unknown>> = {};
    const overrideWorkNumericIds: number[] = [];
    for (const docSnap of overridesSnap.docs) {
      overridesByWorkId[docSnap.id] = docSnap.data();
      const parsed = parseInt(docSnap.id, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        overrideWorkNumericIds.push(parsed);
      }
    }

    const overrideMediaMap =
      overrideWorkNumericIds.length > 0
        ? await fetchAniListMediaBatch(overrideWorkNumericIds)
        : {};

    // Filter AniList schedules for paused, cancelled, or out-of-range episodes
    schedules = schedules.filter((s) => {
      const wid = String(s.mediaId);
      if (pausedWorkIds.has(wid)) return false;
      if (s.media?.status === "CANCELLED") return false;
      const effectiveMax = resolveEffectiveMax(overridesByWorkId[wid], s.media);
      if (effectiveMax !== null && Number(s.episode) > effectiveMax) return false;
      return true;
    });

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
    const customTriggeredIds = new Set<string>();
    const berlinNow = getBerlinWeekdayAndMinutes(new Date());

    for (const docSnap of overridesSnap.docs) {
      const workId = docSnap.id;
      const over = docSnap.data();
      const media = overrideMediaMap[workId];
      const effectiveMax = resolveEffectiveMax(over, media);
      const currentAvail =
        over.manualAvailableEps != null ? Number(over.manualAvailableEps) : null;
      const hasRecurringSchedule =
        over.weeklyDay !== undefined ||
        over.airingAt !== undefined ||
        over.flexibleDayRange !== undefined;

      // Guard 1: Cancelled -> clear stale schedule
      if (media?.status === "CANCELLED") {
        if (hasRecurringSchedule) {
          await docSnap.ref.update(scheduleDeletePatch).catch(() => {});
          healedOverrides++;
        }
        continue;
      }

      // Guard 2: Reached or exceeded total episodes/chapters -> self-heal & stop forever
      if (
        effectiveMax !== null &&
        currentAvail !== null &&
        currentAvail >= effectiveMax
      ) {
        const healPatch: Record<string, unknown> = {};
        if (currentAvail > effectiveMax) {
          healPatch.manualAvailableEps = effectiveMax;
        }
        if (hasRecurringSchedule) {
          Object.assign(healPatch, scheduleDeletePatch);
        }
        if (Object.keys(healPatch).length > 0) {
          await docSnap.ref.update(healPatch).catch(() => {});
          healedOverrides++;
        }
        continue;
      }

      // Guard 3: Finished work with no known remaining episodes
      if (
        media?.status === "FINISHED" &&
        (effectiveMax === null || currentAvail === null)
      ) {
        if (hasRecurringSchedule) {
          await docSnap.ref.update(scheduleDeletePatch).catch(() => {});
          healedOverrides++;
        }
        continue;
      }

      // Guard 4: Not yet released or paused -> skip without clearing schedule
      if (media?.status === "NOT_YET_RELEASED" || pausedWorkIds.has(workId)) {
        continue;
      }

      const freqWeeks = Math.max(1, Number(over.releaseFrequency) || 1);
      const intervalSec = freqWeeks * 7 * 24 * 3600;
      const lastInc = Number(over.lastIncrementedAt) || 0;
      const threshold = intervalSec - 4 * 3600;

      // Respect future startDate
      const startParts = parseStartDateParts(
        typeof over.startDate === "string" ? over.startDate : undefined
      );
      if (startParts) {
        const startMidnightUtcSec = Math.floor(
          Date.UTC(startParts.year, startParts.month - 1, startParts.day) / 1000
        );
        // Subtract 2h buffer for Europe/Berlin UTC+2
        if (now < startMidnightUtcSec - 7200) {
          continue;
        }
      }

      const targetDay =
        over.rhythmType === "flexible" &&
        over.flexibleDayRange?.minDay !== undefined
          ? Number(over.flexibleDayRange.minDay)
          : over.weeklyDay !== undefined
          ? Number(over.weeklyDay)
          : undefined;
      const targetTimeStr = (over.weeklyTime as string) || "18:00";

      let shouldTriggerNow = false;
      let nextRolledAiringAt: number | undefined = undefined;

      if (typeof over.airingAt === "number" && over.airingAt > 0) {
        if (
          over.airingAt >= lookbackStart &&
          over.airingAt <= now &&
          now - lastInc >= 3600
        ) {
          shouldTriggerNow = true;
          nextRolledAiringAt = over.airingAt + intervalSec;
        } else if (over.airingAt < lookbackStart && freqWeeks >= 1) {
          // Catch up stuck exact timer cleanly without getting trapped in the past
          let rolled = over.airingAt;
          while (rolled + intervalSec <= now) {
            rolled += intervalSec;
          }
          if (rolled >= lookbackStart && rolled <= now && now - lastInc >= 3600) {
            shouldTriggerNow = true;
            nextRolledAiringAt = rolled + intervalSec;
          } else {
            // Silently roll stale timer forward to next upcoming slot
            await docSnap.ref
              .update({ airingAt: rolled + intervalSec })
              .catch(() => {});
          }
        }
      }

      if (!shouldTriggerNow && targetDay !== undefined && !Number.isNaN(targetDay)) {
        const [rawH, rawM] = targetTimeStr.split(":").map(Number);
        const targetHour = Number.isNaN(rawH) ? 18 : rawH;
        const targetMinute = Number.isNaN(rawM) ? 0 : rawM;
        const targetTimeMin = targetHour * 60 + targetMinute;

        // Calculate elapsed minutes since target release across midnight boundaries
        let elapsedMin: number | null = null;
        const prevDay = (berlinNow.weekday + 6) % 7;
        if (berlinNow.weekday === targetDay && berlinNow.minutesOfDay >= targetTimeMin) {
          elapsedMin = berlinNow.minutesOfDay - targetTimeMin;
        } else if (prevDay === targetDay) {
          elapsedMin = 1440 - targetTimeMin + berlinNow.minutesOfDay;
        }

        if (elapsedMin !== null && elapsedMin >= 0 && elapsedMin < 240) {
          // Verify multi-week parity against startDate when lastInc === 0
          let isMatchingWeek = true;
          if (freqWeeks > 1 && startParts) {
            const startMon = getMondayEpochDay(
              startParts.year,
              startParts.month,
              startParts.day
            );
            const currMon = getMondayEpochDay(
              berlinNow.year,
              berlinNow.month,
              berlinNow.day
            );
            const weeksDiff = Math.round((currMon - startMon) / 7);
            if (weeksDiff < 0 || weeksDiff % freqWeeks !== 0) {
              isMatchingWeek = false;
            }
          }

          if (isMatchingWeek && now - lastInc >= threshold) {
            shouldTriggerNow = true;
          }
        }
      }

      if (shouldTriggerNow) {
        const newEps = (currentAvail ?? 0) + 1;
        if (effectiveMax !== null && newEps > effectiveMax) {
          continue;
        }

        const nextUpdate: Record<string, unknown> = {
          manualAvailableEps: newEps,
          lastIncrementedAt: now,
        };

        if (effectiveMax !== null && newEps >= effectiveMax) {
          Object.assign(nextUpdate, scheduleDeletePatch);
          nextUpdate.lastIncrementedAt = now;
        } else if (nextRolledAiringAt !== undefined) {
          nextUpdate.airingAt = nextRolledAiringAt;
        } else if (
          typeof over.airingAt === "number" &&
          over.airingAt > 0 &&
          freqWeeks >= 1
        ) {
          nextUpdate.airingAt = over.airingAt + intervalSec;
        }

        await docSnap.ref.update(nextUpdate);

        if (media) {
          customTriggeredIds.add(workId);
          schedules.push({
            mediaId: workId,
            episode: newEps,
            type: media.type || "MANGA",
            media,
            isCustomOverride: true,
          });
        }
      }
    }

    // Deduplicate AniList schedules if a custom override also triggered for the same work
    if (customTriggeredIds.size > 0) {
      schedules = schedules.filter(
        (s) => s.isCustomOverride || !customTriggeredIds.has(String(s.mediaId))
      );
    }

    let notificationsSent = 0;

    const sendMulticastChunked = async (
      tokens: string[],
      tokenToUserIds: Map<string, string[]>,
      payloadBase: Omit<MulticastMessage, "tokens">
    ): Promise<number> => {
      let sent = 0;
      for (let i = 0; i < tokens.length; i += 500) {
        const chunk = tokens.slice(i, i + 500);
        try {
          const res = await adminMessaging.sendEachForMulticast({
            ...payloadBase,
            tokens: chunk,
          });
          sent += res.successCount;

          if (res.failureCount > 0) {
            for (let idx = 0; idx < res.responses.length; idx++) {
              const resp = res.responses[idx];
              if (
                !resp.success &&
                (resp.error?.code === "messaging/registration-token-not-registered" ||
                  resp.error?.code === "messaging/invalid-registration-token")
              ) {
                const deadToken = chunk[idx];
                const uids = tokenToUserIds.get(deadToken) || [];
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
      return sent;
    };

    if (schedules.length > 0) {
      for (const schedule of schedules) {
        const workIdStr = schedule.mediaId.toString();
        const querySnap = await adminDb
          .collection("user_works")
          .where("work_id", "==", workIdStr)
          .get();
        if (querySnap.empty) continue;

        const eligibleByUser = new Map<string, number>();
        for (const d of querySnap.docs) {
          const uWork = d.data();
          if (!uWork?.user_id || uWork.status !== "CURRENT") continue;

          const userManualMax =
            uWork.manual_max_episode != null && Number(uWork.manual_max_episode) > 0
              ? Number(uWork.manual_max_episode)
              : null;
          if (userManualMax !== null && Number(schedule.episode) > userManualMax) {
            continue;
          }

          const isAnime = (schedule.type || schedule.media?.type) !== "MANGA";
          const offset = isAnime
            ? Math.max(0, Number(uWork.synchro_offset_episodes) || 0)
            : 0;
          const targetEpisode = Number(schedule.episode) - offset;
          if (targetEpisode <= 0) continue;

          const currentEp = Number(uWork.current_episode) || 0;
          if (currentEp >= targetEpisode) continue;

          eligibleByUser.set(uWork.user_id, targetEpisode);
        }

        if (eligibleByUser.size === 0) continue;

        const workTitle = resolveMediaTitle(schedule.media, "Werk");
        const mediaType = schedule.type || schedule.media?.type || "ANIME";
        const coverUrl = resolveCoverIcon(schedule.media?.coverImage);
        const tokensByEpisode = new Map<
          number,
          { tokens: string[]; tokenToUserIds: Map<string, string[]> }
        >();

        for (const [uid, targetEpisode] of eligibleByUser.entries()) {
          const userDoc = await adminDb.collection("users").doc(uid).get();
          if (!userDoc.exists) continue;
          const userData = userDoc.data()!;
          const settings = userData.notification_settings || { releases: true };
          const tokens: string[] = Array.isArray(userData.fcm_tokens)
            ? userData.fcm_tokens
            : [];

          if (settings.releases === false) continue;

          const notifId = `release_${uid}_${schedule.mediaId}_${targetEpisode}`;
          const notifRef = adminDb.collection("notifications").doc(notifId);
          const notifSnap = await notifRef.get();
          if (!notifSnap.exists) {
            await notifRef.set({
              notification_id: notifId,
              user_id: uid,
              actor_id: "SYSTEM",
              actor_name: "AniPulse",
              actor_avatar: DEFAULT_ICON_URL,
              type: "SYSTEM",
              work_id: workIdStr,
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

        for (const [targetEpisode, bucket] of tokensByEpisode.entries()) {
          if (bucket.tokens.length === 0) continue;
          notificationsSent += await sendMulticastChunked(
            bucket.tokens,
            bucket.tokenToUserIds,
            {
              notification: {
                title:
                  mediaType === "MANGA"
                    ? "Neues Kapitel verfügbar!"
                    : "Neue Folge verfügbar!",
                body: `${mediaType === "MANGA" ? "Kapitel" : "Episode"} ${targetEpisode} von ${workTitle} ist jetzt online.`,
              },
              data: {
                link: `/work/${workIdStr}`,
                type: "releases",
                icon: coverUrl,
              },
              webpush: {
                headers: { Urgency: "high", TTL: "86400" },
                notification: {
                  icon: coverUrl,
                  badge: BADGE_URL,
                  requireInteraction: true,
                  tag: `release-${workIdStr}-${targetEpisode}`,
                  renotify: true,
                  silent: false,
                  vibrate: [200, 100, 200],
                },
                fcmOptions: { link: `/work/${workIdStr}` },
              },
            }
          );
        }
      }
    }

    // ─── PART 1B: Nachlaufende Dub-Episoden bei FINISHED Anime ───────────────
    try {
      const dubWorksSnap = await adminDb
        .collection("user_works")
        .where("status", "==", "CURRENT")
        .where("synchro_offset_episodes", ">", 0)
        .get();

      if (!dubWorksSnap.empty) {
        const dubWorkIds = [
          ...new Set(
            dubWorksSnap.docs
              .map((d) => parseInt(String(d.data().work_id), 10))
              .filter((n) => !Number.isNaN(n) && n > 0)
          ),
        ];
        const dubMediaMap = await fetchAniListMediaBatch(dubWorkIds);

        for (const d of dubWorksSnap.docs) {
          const uWork = d.data();
          const wid = String(uWork.work_id);
          if (pausedWorkIds.has(wid)) continue;
          const media = dubMediaMap[wid];
          if (!media || media.type === "MANGA" || media.status !== "FINISHED") continue;
          const totalEps = resolveEffectiveMax(overridesByWorkId[wid], media);
          if (!totalEps || !media.endDate?.year) continue;

          const offset = Math.max(0, Number(uWork.synchro_offset_episodes) || 0);
          const syncOffsetDays = Number(uWork.sync_offset_days) || 0;
          const freqWeeks = Math.max(
            1,
            Number(overridesByWorkId[wid]?.releaseFrequency) || 1
          );
          const intervalSec = freqWeeks * 7 * 86400;

          // Estimate Sub finale timestamp (18:00 CET/UTC+1 ~ 17:00 UTC) + personal sync_offset_days
          const endAnchorSec =
            Math.floor(
              Date.UTC(
                media.endDate.year,
                (media.endDate.month || 1) - 1,
                media.endDate.day || 1,
                17,
                0,
                0
              ) / 1000
            ) + Math.round(syncOffsetDays * 86400);

          for (let step = 1; step <= offset; step++) {
            const dubEpAiringAt = endAnchorSec + step * intervalSec;
            if (dubEpAiringAt >= lookbackStart && dubEpAiringAt <= now) {
              const dubEpNum = totalEps - offset + step;
              const currentEp = Number(uWork.current_episode) || 0;
              if (dubEpNum <= 0 || currentEp >= dubEpNum) continue;

              const uid = String(uWork.user_id);
              const userDoc = await adminDb.collection("users").doc(uid).get();
              if (!userDoc.exists) continue;
              const userData = userDoc.data()!;
              const settings = userData.notification_settings || { releases: true };
              if (settings.releases === false) continue;

              const notifId = `release_${uid}_${wid}_${dubEpNum}`;
              const notifRef = adminDb.collection("notifications").doc(notifId);
              const notifSnap = await notifRef.get();
              if (notifSnap.exists) continue;

              const workTitle = resolveMediaTitle(media, "Anime");
              const coverUrl = resolveCoverIcon(media.coverImage);
              await notifRef.set({
                notification_id: notifId,
                user_id: uid,
                actor_id: "SYSTEM",
                actor_name: "AniPulse",
                actor_avatar: DEFAULT_ICON_URL,
                type: "SYSTEM",
                work_id: wid,
                work_title: workTitle,
                media_type: "ANIME",
                episode_num: dubEpNum,
                text: `Episode ${dubEpNum} (Dub) von ${workTitle} ist jetzt online.`,
                timestamp: new Date().toISOString(),
                read: false,
              });

              const tokens: string[] = Array.isArray(userData.fcm_tokens)
                ? userData.fcm_tokens
                : [];
              if (tokens.length > 0) {
                const tokenMap = new Map<string, string[]>();
                tokens.forEach((tk) => tokenMap.set(tk, [uid]));
                notificationsSent += await sendMulticastChunked(tokens, tokenMap, {
                  notification: {
                    title: "Neue Dub-Folge verfügbar!",
                    body: `Episode ${dubEpNum} von ${workTitle} ist jetzt online.`,
                  },
                  data: { link: `/work/${wid}`, type: "releases", icon: coverUrl },
                  webpush: {
                    headers: { Urgency: "high", TTL: "86400" },
                    notification: {
                      icon: coverUrl,
                      badge: BADGE_URL,
                      requireInteraction: true,
                      tag: `release-${wid}-${dubEpNum}`,
                      renotify: true,
                      silent: false,
                      vibrate: [200, 100, 200],
                    },
                    fcmOptions: { link: `/work/${wid}` },
                  },
                });
              }
            }
          }
        }
      }
    } catch (dubErr) {
      console.error("Staggered Dub check error:", dubErr);
    }

    // ─── PART 2: Wunschlisten-Check ──────────────────────────────────────────
    let wishlistNotificationsSent = 0;
    let wishlistMoved = 0;

    try {
      const planningSnap = await adminDb
        .collection("user_works")
        .where("status", "==", "PLANNING")
        .get();

      if (planningSnap.size > 0) {
        const planningWorkIds = [
          ...new Set(
            planningSnap.docs
              .map((d) => parseInt(String(d.data().work_id), 10))
              .filter((n) => !Number.isNaN(n) && n > 0)
          ),
        ];

        const aniListStatusMap = await fetchAniListMediaBatch(planningWorkIds);

        for (const docSnap of planningSnap.docs) {
          const uWork = docSnap.data();
          const aniListInfo = aniListStatusMap[String(uWork.work_id)];
          if (!aniListInfo) continue;

          if (!uWork.added_status && aniListInfo.status === "NOT_YET_RELEASED") {
            await adminDb
              .collection("user_works")
              .doc(docSnap.id)
              .update({ added_status: "NOT_YET_RELEASED" })
              .catch(() => {});
            continue;
          }

          if (uWork.added_status !== "NOT_YET_RELEASED") continue;

          const ep1NotYetAired =
            aniListInfo.type === "ANIME" &&
            aniListInfo.status === "RELEASING" &&
            aniListInfo.nextAiringEpisode?.episode === 1 &&
            Number(aniListInfo.nextAiringEpisode?.airingAt) > now;
          if (ep1NotYetAired) continue;

          if (
            aniListInfo.status === "RELEASING" ||
            aniListInfo.status === "FINISHED"
          ) {
            const userId = String(uWork.user_id);
            const workId = String(uWork.work_id);
            const title = resolveMediaTitle(aniListInfo, "Ein Werk");
            const nowIsoStr = new Date().toISOString();

            await adminDb
              .collection("user_works")
              .doc(docSnap.id)
              .update({ status: "CURRENT", updated_at: Date.now() });
            wishlistMoved++;

            const actRef = adminDb.collection("activity_feed").doc();
            await actRef.set({
              activity_id: actRef.id,
              user_id: userId,
              action_type: "TOP9_UPDATE",
              work_id: workId,
              text: `${title} aus der Wunschliste ist jetzt erschienen und wurde zu 'Aktiv' verschoben!`,
              timestamp: nowIsoStr,
            });

            const notifRef = adminDb
              .collection("notifications")
              .doc(`wishlist_${userId}_${workId}`);
            const wishlistNotifSnap = await notifRef.get();
            if (!wishlistNotifSnap.exists) {
              await notifRef.set({
                notification_id: notifRef.id,
                user_id: userId,
                actor_id: "SYSTEM",
                actor_name: "AniPulse",
                actor_avatar: DEFAULT_ICON_URL,
                type: "SYSTEM",
                work_id: workId,
                work_title: title,
                text: `${title} aus der Wunschliste ist jetzt erschienen und wurde zu 'Aktiv' verschoben!`,
                timestamp: nowIsoStr,
                read: false,
              });
            }

            const userDoc = await adminDb.collection("users").doc(userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data()!;
              const tokens: string[] = Array.isArray(userData.fcm_tokens)
                ? userData.fcm_tokens
                : [];
              const settings = userData.notification_settings || {
                releases: true,
              };

              if (settings.releases !== false && tokens.length > 0) {
                const wishlistCoverUrl = resolveCoverIcon(aniListInfo.coverImage);
                const tokenMap = new Map<string, string[]>();
                tokens.forEach((tk) => tokenMap.set(tk, [userId]));
                wishlistNotificationsSent += await sendMulticastChunked(
                  tokens,
                  tokenMap,
                  {
                    notification: {
                      title: "🎉 Wunschliste -> Jetzt verfügbar!",
                      body: `${title} ist jetzt erschienen und wurde in deine Aktiv-Liste verschoben!`,
                    },
                    data: {
                      link: `/work/${workId}`,
                      type: "releases",
                      icon: wishlistCoverUrl,
                    },
                    webpush: {
                      headers: { Urgency: "high", TTL: "86400" },
                      notification: {
                        icon: wishlistCoverUrl,
                        badge: BADGE_URL,
                        requireInteraction: true,
                        tag: `wishlist-${workId}`,
                        renotify: true,
                        silent: false,
                        vibrate: [200, 100, 200],
                      },
                      fcmOptions: { link: `/work/${workId}` },
                    },
                  }
                );
              }
            }
          }
        }
      }
    } catch (wishlistErr) {
      console.error("Wishlist check error:", wishlistErr);
    }

    return NextResponse.json({
      success: true,
      healedOverrides,
      notificationsSent,
      wishlistMoved,
      wishlistNotificationsSent,
    });
  } catch (error: unknown) {
    console.error("Cron Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
