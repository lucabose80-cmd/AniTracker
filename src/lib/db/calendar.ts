import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, deleteField } from "firebase/firestore";

export interface CalendarOverride {
  work_id: string;
  airingAt?: number; // Unix timestamp in seconds
  weeklyDay?: number; // 0-6 (0 = Sunday, 1 = Monday, etc.)
  weeklyTime?: string; // "HH:MM"
  releaseFrequency?: number; // 1, 2, or 4 (weeks)
  manualMaxEpisode?: number; // Global override for missing episode counts
  manualAvailableEps?: number; // Global override for currently released chapters
  lastIncrementedAt?: number; // Unix timestamp
  startDate?: string;           // ISO date string - when the release schedule started
  rhythmType?: 'strict' | 'flexible'; // strict = exact weekday, flexible = range
  flexibleDayRange?: {
    minDay: number;             // e.g. 4 (Thursday)
    maxDay: number;             // e.g. 0 (Sunday)
  };
}

export async function getCalendarOverrides(): Promise<Record<string, CalendarOverride>> {
  if (!db) return {};
  
  try {
    const overridesRef = collection(db, "calendar_overrides");
    const snapshot = await getDocs(overridesRef);
    
    const overrides: Record<string, CalendarOverride> = {};
    snapshot.forEach((doc) => {
      const data = (doc.data() || {}) as CalendarOverride;
      overrides[data.work_id || doc.id] = { ...data, work_id: data.work_id || doc.id };
    });
    
    return overrides;
  } catch (error) {
    console.error("Error fetching calendar overrides:", error);
    return {};
  }
}

export async function getCalendarOverrideForWork(work_id: string): Promise<CalendarOverride | null> {
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
  airingAt?: number, 
  weeklyDay?: number, 
  weeklyTime?: string, 
  manualMaxEpisode?: number,
  releaseFrequency?: number,
  manualAvailableEps?: number,
  lastIncrementedAt?: number,
  startDate?: string,
  rhythmType?: 'strict' | 'flexible',
  flexibleDayRange?: { minDay: number; maxDay: number }
): Promise<void> {
  if (!db || !work_id?.trim()) return;
  
  const cleanId = work_id.trim();
  const overrideRef = doc(db, "calendar_overrides", cleanId);
  const data: Record<string, any> = { work_id: cleanId };
  
  // If airingAt is explicitly passed as null, we delete it, otherwise we set it if defined
  if (airingAt !== undefined) {
    if ((airingAt as any) === null) {
      data.airingAt = deleteField();
    } else {
      data.airingAt = airingAt;
    }
  }

  if (weeklyDay !== undefined) {
    if ((weeklyDay as any) === null) {
      data.weeklyDay = deleteField();
      data.weeklyTime = deleteField();
      data.releaseFrequency = deleteField();
      data.lastIncrementedAt = deleteField();
    } else {
      data.weeklyDay = weeklyDay;
    }
  }
  
  if (weeklyTime !== undefined) {
    if ((weeklyTime as any) === null) {
      data.weeklyTime = deleteField();
    } else {
      data.weeklyTime = weeklyTime;
    }
  }

  if (releaseFrequency !== undefined) {
    if ((releaseFrequency as any) === null) {
      data.releaseFrequency = deleteField();
    } else {
      data.releaseFrequency = releaseFrequency;
    }
  }
  
  if (manualMaxEpisode !== undefined) {
    if ((manualMaxEpisode as any) === null) {
      data.manualMaxEpisode = deleteField();
    } else {
      data.manualMaxEpisode = manualMaxEpisode;
    }
  }

  if (manualAvailableEps !== undefined) {
    if ((manualAvailableEps as any) === null) {
      data.manualAvailableEps = deleteField();
    } else {
      data.manualAvailableEps = manualAvailableEps;
    }
  }

  if (lastIncrementedAt !== undefined) {
    if ((lastIncrementedAt as any) === null) {
      data.lastIncrementedAt = deleteField();
    } else {
      data.lastIncrementedAt = lastIncrementedAt;
    }
  }

  if (startDate !== undefined) {
    if ((startDate as any) === null) {
      data.startDate = deleteField();
    } else {
      data.startDate = startDate;
    }
  }

  if (rhythmType !== undefined) {
    if ((rhythmType as any) === null) {
      data.rhythmType = deleteField();
    } else {
      data.rhythmType = rhythmType;
    }
  }

  if (flexibleDayRange !== undefined) {
    if ((flexibleDayRange as any) === null) {
      data.flexibleDayRange = deleteField();
    } else {
      data.flexibleDayRange = flexibleDayRange;
    }
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
    await setDoc(overrideRef, { manualMaxEpisode: deleteField() }, { merge: true });
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
 * Resets only the release schedule override fields (airingAt, weeklyDay, weeklyTime,
 * releaseFrequency, startDate, rhythmType, flexibleDayRange) while preserving
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
  behindCount: number;
  isPaused: boolean;
  isIndefinitePause: boolean;
  pausedUntil?: string;
  pauseLabel?: string;
  isFlexible: boolean;
  flexibleRangeLabel?: string; // e.g. "Ca. Do – So"
  frequencyWeeks: number;
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
 * Bullet-proof, unified release schedule calculator across Home, Calendar, Library, and Work Detail.
 * Supports:
 * - Weekly & multi-week intervals (1..52 weeks) with startDate or lastIncrementedAt anchor
 * - Exact timer / date (airingAt) with automatic roll-forward if recurring is also set
 * - Approximate / flexible Manga windows (rhythmType === 'flexible', flexibleDayRange)
 * - Active pause suspension (pushes next release beyond paused_until or marks indefinite hiatus)
 */
export function computeWorkReleaseInfo(params: {
  media: any;
  override?: CalendarOverride;
  pauseInfo?: { paused: boolean; paused_until: string } | null;
  userWork?: {
    current_episode?: number;
    status?: string;
    synchro_offset_episodes?: number;
    manual_max_episode?: number;
    manual_available_eps?: number | null;
  } | null;
  nowMs?: number;
}): ComputedWorkReleaseInfo {
  const { media, override, pauseInfo, userWork } = params;
  const nowMs = params.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();

  const currentEp = Number(userWork?.current_episode) || 0;
  const offset = Number(userWork?.synchro_offset_episodes) || 0;
  const freqWeeks = Math.max(1, Number(override?.releaseFrequency) || 1);

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

  // 1. Compute currently available episodes & next episode number
  let totalEps = 9999;
  if (override?.manualMaxEpisode != null) {
    totalEps = Number(override.manualMaxEpisode);
  } else if (userWork?.manual_max_episode != null) {
    totalEps = Number(userWork.manual_max_episode);
  }

  let availableEpisodes = 0;
  let isManualAvail = false;
  if (override?.manualAvailableEps != null) {
    availableEpisodes = Number(override.manualAvailableEps);
    isManualAvail = true;
  } else if (userWork?.manual_available_eps != null) {
    availableEpisodes = Number(userWork.manual_available_eps);
    isManualAvail = true;
  } else if (media?.type === "MANGA") {
    availableEpisodes = totalEps !== 9999 ? totalEps : Number(media?.chapters) || currentEp;
  } else if (media?.status === "RELEASING" && media?.nextAiringEpisode?.episode) {
    availableEpisodes = Math.max(0, Number(media.nextAiringEpisode.episode) - 1);
  } else if (media?.status === "RELEASING") {
    availableEpisodes = currentEp;
  } else if (media?.status === "FINISHED") {
    availableEpisodes = totalEps !== 9999 ? totalEps : Number(media?.episodes) || 0;
  }

  if (!isManualAvail && offset > 0) {
    availableEpisodes = Math.max(0, availableEpisodes - offset);
  }

  let nextEpisodeNumber = availableEpisodes + 1;
  if (!isManualAvail && media?.nextAiringEpisode?.episode) {
    nextEpisodeNumber = Math.max(1, Number(media.nextAiringEpisode.episode) - offset);
  }

  const behindCount =
    isPaused ||
    userWork?.status === "COMPLETED" ||
    userWork?.status === "DROPPED"
      ? 0
      : Math.max(0, availableEpisodes - currentEp);

  // 2. Compute next airing timestamp (Unix seconds)
  let computedAiringAt: number | undefined = undefined;
  let source: ComputedWorkReleaseInfo["source"] = "NONE";

  const effectiveTargetDay =
    isFlexible && override?.flexibleDayRange?.minDay !== undefined
      ? override.flexibleDayRange.minDay
      : override?.weeklyDay;
  const effectiveTimeStr = override?.weeklyTime || "18:00";

  // Priority A: Exact custom timer (airingAt)
  if (typeof override?.airingAt === "number" && override.airingAt > 0) {
    if (override.airingAt >= nowSec) {
      computedAiringAt = override.airingAt;
      source = "EXACT_TIMER";
    } else if (effectiveTargetDay !== undefined && effectiveTargetDay >= 0) {
      // Exact timer has passed, but a recurring rhythm is also configured -> roll forward cleanly
      const stepSec = freqWeeks * 7 * 24 * 3600;
      let rolled = override.airingAt;
      while (rolled < nowSec) {
        rolled += stepSec;
      }
      computedAiringAt = rolled;
      source = "RECURRING_CUSTOM";
    } else if (override.releaseFrequency && override.releaseFrequency >= 1) {
      // Exact timer with frequency -> roll forward by releaseFrequency weeks
      const stepSec = freqWeeks * 7 * 24 * 3600;
      let rolled = override.airingAt;
      while (rolled < nowSec) {
        rolled += stepSec;
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

    // Anchor calculation for multi-week intervals or future startDate
    const startAnchorSec = override?.startDate
      ? Math.floor(new Date(override.startDate).getTime() / 1000)
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
        // Weekly schedule with a startDate in the future: jump to the first matching weekday on/after startDate
        while (candidateSec < startAnchorSec) {
          candidateSec += 7 * 24 * 3600;
        }
      }
    }

    computedAiringAt = candidateSec;
    source = "RECURRING_CUSTOM";
  }

  // Priority C: AniList nextAiringEpisode fallback
  if (
    computedAiringAt === undefined &&
    typeof media?.nextAiringEpisode?.airingAt === "number"
  ) {
    computedAiringAt = media.nextAiringEpisode.airingAt;
    source = "ANILIST";
  }

  // 3. If paused until a specific date (not indefinite), push the next airing date past paused_until
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
      const stepSec = freqWeeks * 7 * 24 * 3600;
      while (computedAiringAt <= pauseUntilSec) {
        computedAiringAt += stepSec;
      }
    }
  }

  const hasSchedule = Boolean(computedAiringAt !== undefined && !isIndefinitePause);

  return {
    hasSchedule,
    airingAt: isIndefinitePause ? undefined : computedAiringAt,
    nextEpisodeNumber,
    availableEpisodes,
    behindCount,
    isPaused,
    isIndefinitePause,
    pausedUntil: pauseInfo?.paused_until,
    pauseLabel,
    isFlexible,
    flexibleRangeLabel,
    frequencyWeeks: freqWeeks,
    source,
  };
}

