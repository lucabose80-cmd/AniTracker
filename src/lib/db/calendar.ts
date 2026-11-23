import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  FieldValue,
} from "firebase/firestore";
import { AniListDate, AniListMedia } from "@/types/anilist";

export interface CalendarOverride {
  work_id: string;
  airingAt?: number; // Unix timestamp in seconds
  weeklyDay?: number; // 0-6 (0 = Sunday, 1 = Monday, etc.)
  weeklyTime?: string; // "HH:MM"
  releaseFrequency?: number; // 1..52 (weeks)
  manualMaxEpisode?: number; // Global override for missing episode counts
  manualAvailableEps?: number; // Global override for currently released chapters/episodes
  lastIncrementedAt?: number; // Unix timestamp
  startDate?: string; // YYYY-MM-DD or ISO date string
  rhythmType?: "strict" | "flexible"; // strict = exact weekday, flexible = range
  flexibleDayRange?: {
    minDay: number; // e.g. 4 (Thursday)
    maxDay: number; // e.g. 0 (Sunday)
  };
}

/**
 * Parses a "YYYY-MM-DD" date string in the user's LOCAL timezone (avoids UTC midnight shift).
 */
export function parseLocalDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (dateOnly) {
    const year = parseInt(dateOnly[1], 10);
    const month = parseInt(dateOnly[2], 10) - 1;
    const day = parseInt(dateOnly[3], 10);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function getCalendarOverrides(): Promise<
  Record<string, CalendarOverride>
> {
  if (!db) return {};

  try {
    const overridesRef = collection(db, "calendar_overrides");
    const snapshot = await getDocs(overridesRef);

    const overrides: Record<string, CalendarOverride> = {};
    snapshot.forEach((docSnap) => {
      const data = (docSnap.data() || {}) as CalendarOverride;
      overrides[data.work_id || docSnap.id] = {
        ...data,
        work_id: data.work_id || docSnap.id,
      };
    });

    return overrides;
  } catch (error) {
    console.error("Error fetching calendar overrides:", error);
    return {};
  }
}

export async function getCalendarOverrideForWork(
  work_id: string
): Promise<CalendarOverride | null> {
  if (!db || !work_id?.trim()) return null;

  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    const snap = await getDoc(overrideRef);
    if (!snap.exists()) return null;

    const data = (snap.data() || {}) as CalendarOverride;
    return {
      ...data,
      work_id: data.work_id || snap.id,
    };
  } catch (error) {
    console.error(`Error fetching calendar override for work ${work_id}:`, error);
    return null;
  }
}

export async function setCalendarOverride(
  work_id: string,
  airingAt?: number | null,
  weeklyDay?: number | null,
  weeklyTime?: string | null,
  manualMaxEpisode?: number | null,
  releaseFrequency?: number | null,
  manualAvailableEps?: number | null,
  lastIncrementedAt?: number | null,
  startDate?: string | null,
  rhythmType?: "strict" | "flexible" | null,
  flexibleDayRange?: { minDay: number; maxDay: number } | null
): Promise<void> {
  if (!db || !work_id?.trim()) return;

  const cleanId = work_id.trim();
  const overrideRef = doc(db, "calendar_overrides", cleanId);
  const data: Record<
    string,
    string | number | { minDay: number; maxDay: number } | FieldValue
  > = { work_id: cleanId };

  if (airingAt !== undefined) {
    data.airingAt = airingAt === null ? deleteField() : airingAt;
  }

  if (weeklyDay !== undefined) {
    if (weeklyDay === null) {
      data.weeklyDay = deleteField();
      data.weeklyTime = deleteField();
      data.releaseFrequency = deleteField();
      data.lastIncrementedAt = deleteField();
    } else {
      data.weeklyDay = weeklyDay;
    }
  }

  if (weeklyTime !== undefined) {
    data.weeklyTime = weeklyTime === null ? deleteField() : weeklyTime;
  }

  if (releaseFrequency !== undefined) {
    data.releaseFrequency =
      releaseFrequency === null ? deleteField() : releaseFrequency;
  }

  if (manualMaxEpisode !== undefined) {
    data.manualMaxEpisode =
      manualMaxEpisode === null ? deleteField() : manualMaxEpisode;
  }

  if (manualAvailableEps !== undefined) {
    data.manualAvailableEps =
      manualAvailableEps === null ? deleteField() : manualAvailableEps;
  }

  if (lastIncrementedAt !== undefined) {
    data.lastIncrementedAt =
      lastIncrementedAt === null ? deleteField() : lastIncrementedAt;
  }

  if (startDate !== undefined) {
    data.startDate = startDate === null ? deleteField() : startDate;
  }

  if (rhythmType !== undefined) {
    data.rhythmType = rhythmType === null ? deleteField() : rhythmType;
  }

  if (flexibleDayRange !== undefined) {
    data.flexibleDayRange =
      flexibleDayRange === null ? deleteField() : flexibleDayRange;
  }

  try {
    await setDoc(overrideRef, data, { merge: true });
  } catch (error) {
    console.error(`Error setting calendar override for work ${work_id}:`, error);
  }
}

export async function clearManualMaxEpisode(work_id: string): Promise<void> {
  if (!db || !work_id?.trim()) return;
  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    // Always include work_id so Firestore rules pass even if the document does not exist yet
    await setDoc(
      overrideRef,
      { work_id: cleanId, manualMaxEpisode: deleteField() },
      { merge: true }
    );
  } catch (error) {
    console.error(`Error clearing manual max episode for work ${work_id}:`, error);
  }
}

export async function deleteCalendarOverride(work_id: string): Promise<void> {
  if (!db || !work_id?.trim()) return;
  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    await deleteDoc(overrideRef);
  } catch (error) {
    console.error(`Error deleting calendar override for work ${work_id}:`, error);
  }
}

/**
 * Resets only the release schedule override fields while preserving
 * manualMaxEpisode and manualAvailableEps if set.
 */
export async function resetScheduleOverride(work_id: string): Promise<void> {
  if (!db || !work_id?.trim()) return;
  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    await setDoc(
      overrideRef,
      {
        work_id: cleanId,
        airingAt: deleteField(),
        weeklyDay: deleteField(),
        weeklyTime: deleteField(),
        releaseFrequency: deleteField(),
        lastIncrementedAt: deleteField(),
        startDate: deleteField(),
        rhythmType: deleteField(),
        flexibleDayRange: deleteField(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error(`Error resetting schedule override for work ${work_id}:`, error);
  }
}

export const WEEKDAY_SHORT_NAMES: Record<number, string> = {
  1: "Mo",
  2: "Di",
  3: "Mi",
  4: "Do",
  5: "Fr",
  6: "Sa",
  0: "So",
};

export interface ComputedWorkReleaseInfo {
  hasSchedule: boolean;
  airingAt?: number; // Unix seconds of next expected release
  nextEpisodeNumber: number;
  availableEpisodes: number;
  maxAllowedProgress: number | null;
  behindCount: number;
  isPaused: boolean;
  isIndefinitePause: boolean;
  pausedUntil?: string;
  pauseLabel?: string;
  isFlexible: boolean;
  flexibleRangeLabel?: string; // e.g. "Ca. Do – So"
  frequencyWeeks: number;
  isStaggeredDubEnding: boolean;
  dubRemainingEpisodes: number;
  source: "EXACT_TIMER" | "RECURRING_CUSTOM" | "ANILIST" | "NONE";
}

function getMondayStartOfWeekMs(timestampMs: number): number {
  const d = new Date(timestampMs);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getAniListEndAnchorSec(
  endDate?: AniListDate | null,
  weeklyTimeStr?: string,
  syncOffsetSec: number = 0
): number | null {
  if (!endDate?.year) return null;
  const [rawH, rawM] = (weeklyTimeStr || "18:00").split(":").map(Number);
  const hours = Number.isNaN(rawH) ? 18 : rawH;
  const minutes = Number.isNaN(rawM) ? 0 : rawM;
  const d = new Date(
    endDate.year,
    (endDate.month || 1) - 1,
    endDate.day || 1,
    hours,
    minutes,
    0,
    0
  );
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000) + syncOffsetSec;
}

export function formatPauseStatusLabel(pausedUntilIso?: string): string {
  if (!pausedUntilIso) return "Pausiert";
  if (pausedUntilIso.startsWith("9999")) return "Pausiert (Auf unbestimmte Zeit)";
  try {
    const d = new Date(pausedUntilIso);
    const dayStr = d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
    });
    return `Pausiert bis ${dayStr}`;
  } catch {
    return "Pausiert";
  }
}

/**
 * Unified release schedule calculator across Home, Calendar, Library, Review Feed, and Work Detail.
 * Supports:
 * - Weekly & multi-week intervals (1..52 weeks) with startDate or lastIncrementedAt anchor
 * - Exact timer / date (airingAt) with automatic roll-forward if recurring is also set
 * - Approximate / flexible Manga windows (rhythmType === 'flexible', flexibleDayRange)
 * - Active pause suspension (pushes next release beyond paused_until without hiding already-aired eps)
 * - Personal Dub offset (synchro_offset_episodes + sync_offset_days), including staggered Dub endings
 *   after a show finishes Sub airing on AniList and Dub break weeks ("Aussetzen")
 */
export function computeWorkReleaseInfo(params: {
  media?: AniListMedia | null;
  override?: CalendarOverride;
  pauseInfo?: { paused: boolean; paused_until: string } | null;
  userWork?: {
    current_episode?: number;
    status?: string;
    synchro_offset_episodes?: number;
    sync_offset_days?: number;
    manual_max_episode?: number;
    manual_available_eps?: number | null;
  } | null;
  nowMs?: number;
}): ComputedWorkReleaseInfo {
  const { media, override, pauseInfo, userWork } = params;
  const nowMs = params.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();

  const isAnime = media?.type !== "MANGA";
  const currentEp = Number(userWork?.current_episode) || 0;
  const offset = isAnime
    ? Math.max(0, Number(userWork?.synchro_offset_episodes) || 0)
    : 0;
  const syncOffsetDays = isAnime ? Number(userWork?.sync_offset_days) || 0 : 0;
  const syncOffsetSec = Math.round(syncOffsetDays * 86400);
  const freqWeeks = Math.max(1, Number(override?.releaseFrequency) || 1);
  const intervalSec = freqWeeks * 7 * 86400;

  const isGlobalPaused = Boolean(
    pauseInfo?.paused && pauseInfo.paused_until && pauseInfo.paused_until > nowIso
  );
  const isUserPaused = userWork?.status === "PAUSED";
  const isPaused = isGlobalPaused || isUserPaused;
  const isIndefinitePause =
    (isGlobalPaused && Boolean(pauseInfo?.paused_until?.startsWith("9999"))) ||
    (!isGlobalPaused && isUserPaused);

  const pauseLabel = isGlobalPaused
    ? formatPauseStatusLabel(pauseInfo?.paused_until)
    : isUserPaused
    ? "Pausiert (Dein Status)"
    : undefined;

  const isFlexible = override?.rhythmType === "flexible";
  let flexibleRangeLabel: string | undefined = undefined;
  if (isFlexible && override?.flexibleDayRange) {
    const minShort = WEEKDAY_SHORT_NAMES[override.flexibleDayRange.minDay] || "Do";
    const maxShort = WEEKDAY_SHORT_NAMES[override.flexibleDayRange.maxDay] || "So";
    flexibleRangeLabel =
      minShort === maxShort ? `Ca. ${minShort}` : `Ca. ${minShort} – ${maxShort}`;
  } else if (isFlexible) {
    flexibleRangeLabel = "Ungefährer Zeitraum";
  }

  // 1. Compute total limit (max episodes / chapters)
  let totalLimit: number | null = null;
  if (override?.manualMaxEpisode != null && Number(override.manualMaxEpisode) > 0) {
    totalLimit = Number(override.manualMaxEpisode);
  } else if (
    userWork?.manual_max_episode != null &&
    Number(userWork.manual_max_episode) > 0
  ) {
    totalLimit = Number(userWork.manual_max_episode);
  } else if (media && media.type === "MANGA" && Number(media.chapters) > 0) {
    totalLimit = Number(media.chapters);
  } else if (media && media.type !== "MANGA" && Number(media.episodes) > 0) {
    totalLimit = Number(media.episodes);
  }

  // 2. Compute currently available episodes & staggered Dub state
  let availableEpisodes = 0;
  let isManualAvail = false;
  let hasKnownAvailableLimit = false;
  let isStaggeredDubEnding = false;
  let dubRemainingEpisodes = 0;
  let staggeredDubNextAiringAt: number | undefined = undefined;
  let aniListShiftedNextAiringAt: number | undefined = undefined;
  let aniListNextEpForUser: number | undefined = undefined;

  const computeStaggeredFinishedDub = (finishedTotal: number) => {
    const endAnchorSec =
      getAniListEndAnchorSec(media?.endDate, override?.weeklyTime, syncOffsetSec) ??
      (override?.lastIncrementedAt
        ? override.lastIncrementedAt + syncOffsetSec
        : null);

    if (endAnchorSec !== null) {
      const elapsedSec = nowSec - endAnchorSec;
      const weeksSinceEnd =
        elapsedSec >= 0 ? Math.floor(elapsedSec / intervalSec) : 0;
      const remainingLag = Math.max(0, offset - weeksSinceEnd);
      availableEpisodes = Math.max(0, finishedTotal - remainingLag);
      dubRemainingEpisodes = remainingLag;
      if (remainingLag > 0) {
        isStaggeredDubEnding = true;
        const nextStep = elapsedSec < 0 ? 0 : weeksSinceEnd + 1;
        staggeredDubNextAiringAt = endAnchorSec + nextStep * intervalSec;
      }
    } else {
      // No endDate available on AniList: do not trap user permanently below total
      availableEpisodes = finishedTotal;
    }
    hasKnownAvailableLimit = true;
  };

  if (override?.manualAvailableEps != null) {
    const rawManual = Math.max(0, Number(override.manualAvailableEps));
    isManualAvail = true;
    hasKnownAvailableLimit = true;
    if (
      isAnime &&
      offset > 0 &&
      media?.status === "FINISHED" &&
      totalLimit != null &&
      rawManual >= totalLimit
    ) {
      computeStaggeredFinishedDub(totalLimit);
    } else if (isAnime && offset > 0) {
      availableEpisodes = Math.max(0, rawManual - offset);
    } else {
      availableEpisodes = rawManual;
    }
  } else if (userWork?.manual_available_eps != null) {
    availableEpisodes = Math.max(0, Number(userWork.manual_available_eps));
    isManualAvail = true;
    hasKnownAvailableLimit = true;
  } else if (media?.status === "NOT_YET_RELEASED") {
    availableEpisodes = 0;
    hasKnownAvailableLimit = true;
  } else if (media?.type === "MANGA") {
    if (totalLimit != null) {
      availableEpisodes = totalLimit;
      hasKnownAvailableLimit = true;
    } else {
      availableEpisodes = currentEp;
      hasKnownAvailableLimit = false;
    }
  } else if (media?.status === "RELEASING" && media?.nextAiringEpisode?.episode) {
    const nextEpNum = Number(media.nextAiringEpisode.episode);
    const rawNextAiringAt = Number(media.nextAiringEpisode.airingAt);
    const shiftedNext =
      !Number.isNaN(rawNextAiringAt) && rawNextAiringAt > 0
        ? rawNextAiringAt + syncOffsetSec
        : 0;

    if (shiftedNext > 0) {
      if (shiftedNext <= nowSec) {
        // Stale AniList cache: the shifted episode has already aired
        const subAvailable = nextEpNum;
        availableEpisodes = Math.max(0, subAvailable - offset);
        aniListNextEpForUser = Math.max(1, nextEpNum + 1 - offset);
        let rolled = shiftedNext;
        while (rolled <= nowSec) rolled += intervalSec;
        aniListShiftedNextAiringAt = rolled;
      } else {
        // If syncOffsetDays pushes the airing date forward across a week boundary,
        // account for any still-pending Dub episode from the previous Sub week
        const pendingIntervals = Math.floor((shiftedNext - nowSec) / intervalSec);
        const subAvailable = Math.max(0, nextEpNum - 1 - pendingIntervals);
        availableEpisodes = Math.max(0, subAvailable - offset);
        aniListNextEpForUser = Math.max(1, nextEpNum - pendingIntervals - offset);
        aniListShiftedNextAiringAt = shiftedNext - pendingIntervals * intervalSec;
      }
    } else {
      availableEpisodes = Math.max(0, nextEpNum - 1 - offset);
      aniListNextEpForUser = Math.max(1, nextEpNum - offset);
    }
    hasKnownAvailableLimit = true;
  } else if (media?.status === "RELEASING") {
    availableEpisodes =
      totalLimit != null ? Math.min(currentEp, totalLimit) : currentEp;
    hasKnownAvailableLimit = totalLimit != null;
  } else if (media?.status === "FINISHED") {
    if (totalLimit != null) {
      if (isAnime && offset > 0) {
        computeStaggeredFinishedDub(totalLimit);
      } else {
        availableEpisodes = totalLimit;
        hasKnownAvailableLimit = true;
      }
    } else {
      availableEpisodes = 0;
      hasKnownAvailableLimit = false;
    }
  }

  if (totalLimit != null && hasKnownAvailableLimit) {
    availableEpisodes = Math.min(availableEpisodes, totalLimit);
  }

  const maxAllowedProgress: number | null = hasKnownAvailableLimit
    ? availableEpisodes
    : totalLimit;

  let nextEpisodeNumber = availableEpisodes + 1;
  if (isStaggeredDubEnding) {
    nextEpisodeNumber = availableEpisodes + 1;
  } else if (!isManualAvail && aniListNextEpForUser !== undefined) {
    nextEpisodeNumber = aniListNextEpForUser;
  }

  // Pausing stops future releases, but should NOT hide already-aired unwatched episodes
  const behindCount =
    userWork?.status === "COMPLETED" || userWork?.status === "DROPPED"
      ? 0
      : Math.max(0, availableEpisodes - currentEp);

  // 3. Compute next airing timestamp (Unix seconds)
  let computedAiringAt: number | undefined = undefined;
  let source: ComputedWorkReleaseInfo["source"] = "NONE";

  const effectiveTargetDay =
    isFlexible && override?.flexibleDayRange?.minDay !== undefined
      ? override.flexibleDayRange.minDay
      : override?.weeklyDay;
  const effectiveTimeStr = override?.weeklyTime || "18:00";

  // Priority A: Exact custom timer (airingAt)
  if (typeof override?.airingAt === "number" && override.airingAt > 0) {
    const baseAiringAt = override.airingAt + (isAnime ? syncOffsetSec : 0);
    if (baseAiringAt >= nowSec) {
      computedAiringAt = baseAiringAt;
      source = "EXACT_TIMER";
    } else if (effectiveTargetDay !== undefined && effectiveTargetDay >= 0) {
      let rolled = baseAiringAt;
      while (rolled < nowSec) {
        rolled += intervalSec;
      }
      computedAiringAt = rolled;
      source = "RECURRING_CUSTOM";
    } else if (override.releaseFrequency && override.releaseFrequency >= 1) {
      let rolled = baseAiringAt;
      while (rolled < nowSec) {
        rolled += intervalSec;
      }
      computedAiringAt = rolled;
      source = "EXACT_TIMER";
    }
  }

  // Priority B: Recurring weekday / flexible window
  if (
    computedAiringAt === undefined &&
    effectiveTargetDay !== undefined &&
    effectiveTargetDay >= 0 &&
    effectiveTargetDay <= 6
  ) {
    const [rawH, rawM] = effectiveTimeStr.split(":").map(Number);
    const hours = Number.isNaN(rawH) ? 18 : rawH;
    const minutes = Number.isNaN(rawM) ? 0 : rawM;

    const candidate = new Date(nowMs);
    candidate.setHours(hours, minutes, 0, 0);
    const currentDay = candidate.getDay();

    let diffDays = effectiveTargetDay - currentDay;
    if (diffDays < 0) diffDays += 7;
    if (diffDays === 0 && candidate.getTime() < nowMs) {
      diffDays += 7;
    }

    candidate.setDate(candidate.getDate() + diffDays);
    let candidateSec = Math.floor(candidate.getTime() / 1000);

    // Anchor calculation for multi-week intervals or future startDate (timezone-safe!)
    const parsedStart = parseLocalDate(override?.startDate);
    const startAnchorSec = parsedStart
      ? Math.floor(parsedStart.getTime() / 1000)
      : override?.lastIncrementedAt || 0;

    if (startAnchorSec > 0 && !Number.isNaN(startAnchorSec)) {
      if (freqWeeks > 1) {
        const startMondayMs = getMondayStartOfWeekMs(startAnchorSec * 1000);
        const compMondayMs = getMondayStartOfWeekMs(candidateSec * 1000);
        const diffWeeks = Math.round(
          (compMondayMs - startMondayMs) / (7 * 24 * 3600 * 1000)
        );

        let weeksToAdd = 0;
        if (diffWeeks < 0) {
          weeksToAdd = Math.abs(diffWeeks);
        } else {
          const remainder = diffWeeks % freqWeeks;
          if (remainder !== 0) {
            weeksToAdd = freqWeeks - remainder;
          }
        }
        candidateSec += weeksToAdd * 7 * 24 * 3600;
      } else if (startAnchorSec > candidateSec) {
        while (candidateSec < startAnchorSec) {
          candidateSec += 7 * 24 * 3600;
        }
      }
    }

    if (isAnime && syncOffsetSec !== 0) {
      candidateSec += syncOffsetSec;
      while (candidateSec < nowSec) {
        candidateSec += intervalSec;
      }
    }

    computedAiringAt = candidateSec;
    source = "RECURRING_CUSTOM";
  }

  // Priority C: AniList nextAiringEpisode fallback (shifted by personal sync_offset_days)
  if (computedAiringAt === undefined && aniListShiftedNextAiringAt !== undefined) {
    computedAiringAt = aniListShiftedNextAiringAt;
    source = "ANILIST";
  } else if (
    computedAiringAt === undefined &&
    typeof media?.nextAiringEpisode?.airingAt === "number"
  ) {
    computedAiringAt = media.nextAiringEpisode.airingAt + (isAnime ? syncOffsetSec : 0);
    source = "ANILIST";
  }

  // Priority D: Staggered Dub ending schedule (after AniList marks Sub FINISHED)
  if (computedAiringAt === undefined && staggeredDubNextAiringAt !== undefined) {
    computedAiringAt = staggeredDubNextAiringAt;
    source = "ANILIST";
  }

  // 4. If paused until a specific date (not indefinite), push the next airing date past paused_until
  if (
    computedAiringAt !== undefined &&
    isGlobalPaused &&
    !isIndefinitePause &&
    pauseInfo?.paused_until
  ) {
    const pauseUntilSec = Math.floor(
      new Date(pauseInfo.paused_until).getTime() / 1000
    );
    if (!Number.isNaN(pauseUntilSec) && pauseUntilSec > computedAiringAt) {
      while (computedAiringAt <= pauseUntilSec) {
        computedAiringAt += intervalSec;
      }
    }
  }

  const isReleaseComplete =
    media?.status === "CANCELLED" ||
    (totalLimit != null && hasKnownAvailableLimit && availableEpisodes >= totalLimit) ||
    (media?.status === "FINISHED" &&
      !isStaggeredDubEnding &&
      (totalLimit == null ||
        (hasKnownAvailableLimit && availableEpisodes >= totalLimit)));

  const hasSchedule = Boolean(
    !isReleaseComplete && computedAiringAt !== undefined && !isIndefinitePause
  );

  return {
    hasSchedule,
    airingAt: hasSchedule ? computedAiringAt : undefined,
    nextEpisodeNumber:
      totalLimit != null
        ? Math.min(nextEpisodeNumber, totalLimit)
        : nextEpisodeNumber,
    availableEpisodes,
    maxAllowedProgress,
    behindCount,
    isPaused,
    isIndefinitePause,
    pausedUntil: pauseInfo?.paused_until,
    pauseLabel,
    isFlexible,
    flexibleRangeLabel,
    frequencyWeeks: freqWeeks,
    isStaggeredDubEnding,
    dubRemainingEpisodes,
    source: hasSchedule ? source : "NONE",
  };
}
