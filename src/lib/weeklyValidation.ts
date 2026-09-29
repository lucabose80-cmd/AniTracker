import { CalendarOverride } from '@/lib/db/calendar';
import { UserWork } from '@/types/database';

/**
 * Gets Monday 00:00 and Sunday 23:59 of the current week
 */
export function getCurrentWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

/**
 * Checks if a work had a new release this week.
 * For Anime: checks nextAiringEpisode.airingAt
 * For Manga: checks CalendarOverride schedule (weeklyDay + releaseFrequency + startDate)
 */
export function hasNewReleaseThisWeek(
  workDetails: any,
  calendarOverride?: CalendarOverride
): boolean {
  if (!workDetails) return false;

  const { start, end } = getCurrentWeekBounds();
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = Math.floor(end.getTime() / 1000);

  if (workDetails.type === 'ANIME') {
    if (workDetails.nextAiringEpisode?.airingAt) {
      const airingAt = workDetails.nextAiringEpisode.airingAt;
      const prevAiringAt = airingAt - 7 * 24 * 3600;

      if ((airingAt >= startSec && airingAt <= endSec) || 
          (prevAiringAt >= startSec && prevAiringAt <= endSec)) {
        return true;
      }
    }
    return false;
  }

  // For Manga / other
  if (calendarOverride?.weeklyDay !== undefined && calendarOverride?.releaseFrequency) {
    if (calendarOverride.releaseFrequency === 1) {
      return true; // Releases every week
    }

    if ((calendarOverride.releaseFrequency === 2 || calendarOverride.releaseFrequency === 4) && calendarOverride.startDate) {
      const startDate = new Date(calendarOverride.startDate);
      const startDay = startDate.getDay();
      const diffStart = startDate.getDate() - startDay + (startDay === 0 ? -6 : 1);
      const startMonday = new Date(startDate);
      startMonday.setDate(diffStart);
      startMonday.setHours(0, 0, 0, 0);

      const timeDiff = start.getTime() - startMonday.getTime();
      const weeksDiff = Math.round(timeDiff / (7 * 24 * 60 * 60 * 1000));
      
      return weeksDiff % calendarOverride.releaseFrequency === 0;
    }
  }

  // Default true if no explicit schedule, better to include than exclude
  return true;
}

/**
 * Checks if the user has checked in the latest released episode/chapter.
 * This means currentEpisode >= the episode that released this week.
 */
export function hasUserCheckedLatestEpisode(
  userWork: UserWork,
  workDetails: any,
  calendarOverride?: CalendarOverride
): boolean {
  if (!workDetails || !userWork) return false;

  let latestReleased = 0;

  if (workDetails.type === 'ANIME') {
    if (workDetails.nextAiringEpisode?.episode) {
      latestReleased = workDetails.nextAiringEpisode.episode - 1;
    } else {
      latestReleased = workDetails.episodes || 0;
    }
  } else {
    if (calendarOverride?.manualAvailableEps !== undefined) {
      latestReleased = calendarOverride.manualAvailableEps;
    } else if (workDetails.chapters) {
      latestReleased = workDetails.chapters;
    }
  }

  return userWork.current_episode >= latestReleased;
}

/**
 * Combined: Can this work be in the weekly ranking?
 * Both conditions must be true:
 * 1. New release this week
 * 2. User has checked in the latest episode
 */
export function isEligibleForWeeklyRanking(
  userWork: UserWork,
  workDetails: any,
  calendarOverride?: CalendarOverride
): boolean {
  return hasNewReleaseThisWeek(workDetails, calendarOverride) && 
         hasUserCheckedLatestEpisode(userWork, workDetails, calendarOverride);
}
