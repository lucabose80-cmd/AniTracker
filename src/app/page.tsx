"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calendar, ChevronRight, Plus, Check } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { de } from "date-fns/locale";
import { auth } from "@/lib/firebase";
import { fetchAniListBatch } from "@/lib/anilist";
import { getAllUserWorks, updateEpisodeProgress } from "@/lib/db/works";
import {
  CalendarOverride,
  computeWorkReleaseInfo,
  getCalendarOverrides,
} from "@/lib/db/calendar";
import { getPausedWorksMap, WorkPauseRecord } from "@/lib/db/pauses";
import { UserWork } from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import { useAppStore } from "@/lib/store";
import { toast } from "@/lib/ui-feedback";
import WhatsAppReviewFeed from "@/components/ui/WhatsAppReviewFeed";

interface CalendarStripItem {
  work_id: string;
  title: string;
  cover?: string;
  media_type: "ANIME" | "MANGA";
  airingAt: number;
  airingLabel: string;
  airingEpisode?: number;
  currentEp: number;
  nextUserEpisode: number;
  behindCount: number;
  maxAllowedProgress: number | null;
  isPaused?: boolean;
  pauseLabel?: string;
  isStaggeredDubEnding?: boolean;
}

function formatAiringLabel(
  airingAtSec: number,
  isFlexible?: boolean,
  flexibleRangeLabel?: string
): string {
  const date = new Date(airingAtSec * 1000);
  if (isFlexible && flexibleRangeLabel) {
    if (isToday(date)) return `Heute (${flexibleRangeLabel})`;
    return flexibleRangeLabel;
  }
  const timeStr = format(date, "HH:mm");
  if (isToday(date)) return `Heute ${timeStr}`;
  if (isTomorrow(date)) return `Morgen ${timeStr}`;
  return format(date, "EEE HH:mm", { locale: de });
}

function HomeContent() {
  const searchParams = useSearchParams();
  const highlightActivityId = searchParams.get("activity_id");
  const isOnline = useAppStore((s) => s.isOnline);
  const reloadTrigger = useAppStore((s) => s.reloadTrigger);

  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(
    undefined
  );
  const [authLoaded, setAuthLoaded] = useState(false);
  const [userWorks, setUserWorks] = useState<UserWork[]>([]);
  const [userAniListDetails, setUserAniListDetails] = useState<
    Record<string, AniListMedia>
  >({});
  const [calendarOverrides, setCalendarOverrides] = useState<
    Record<string, CalendarOverride>
  >({});
  const [pausedWorksMap, setPausedWorksMap] = useState<
    Record<string, WorkPauseRecord>
  >({});
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [justIncrementedIds, setJustIncrementedIds] = useState<Set<string>>(
    new Set()
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const loadUserHomeData = useCallback(async (uid: string) => {
    setIsLoadingCalendar(true);
    try {
      const [works, overrides, pauses] = await Promise.all([
        getAllUserWorks(uid),
        getCalendarOverrides(),
        getPausedWorksMap().catch(() => ({})),
      ]);
      setUserWorks(works);
      setCalendarOverrides(overrides);
      setPausedWorksMap(pauses);
      setNowMs(Date.now());

      const idsToFetch = works
        .map((w) => parseInt(w.work_id, 10))
        .filter((id) => !Number.isNaN(id) && id > 0);

      if (idsToFetch.length > 0) {
        const mediaList = await fetchAniListBatch(idsToFetch);
        const map: Record<string, AniListMedia> = {};
        mediaList.forEach((m) => {
          map[m.id.toString()] = m;
        });
        setUserAniListDetails(map);
      } else {
        setUserAniListDetails({});
      }
    } catch (err) {
      console.error("Failed to load home user data:", err);
    } finally {
      setIsLoadingCalendar(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setAuthLoaded(true);
      if (!user) {
        setCurrentUserUid(undefined);
        setUserWorks([]);
        setUserAniListDetails({});
        setCalendarOverrides({});
        setPausedWorksMap({});
        return;
      }

      setCurrentUserUid(user.uid);
      loadUserHomeData(user.uid);
    });

    return () => unsubscribe();
  }, [loadUserHomeData]);

  useEffect(() => {
    if (reloadTrigger <= 0 || !currentUserUid) return;
    const timer = window.setTimeout(() => {
      loadUserHomeData(currentUserUid);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadTrigger, currentUserUid, loadUserHomeData]);

  const upcomingCalendarItems = useMemo<CalendarStripItem[]>(() => {
    const nowSec = Math.floor(nowMs / 1000);
    const maxWindowSec = nowSec + 7 * 24 * 3600;

    return userWorks
      .filter((w) => w.status === "CURRENT")
      .map((w) => {
        const media = userAniListDetails[w.work_id];
        if (!media) return null;

        const over = calendarOverrides[w.work_id];
        const pauseInfo = pausedWorksMap[w.work_id];
        const releaseInfo = computeWorkReleaseInfo({
          media,
          override: over,
          pauseInfo,
          userWork: w,
          nowMs,
        });

        if (
          !releaseInfo.hasSchedule ||
          !releaseInfo.airingAt ||
          releaseInfo.airingAt > maxWindowSec
        ) {
          return null;
        }

        const mediaType: "ANIME" | "MANGA" =
          media.type === "MANGA" ? "MANGA" : "ANIME";
        const currentEp = Number(w.current_episode) || 0;

        return {
          work_id: w.work_id,
          title: getAniListTitle(media, `Werk #${w.work_id}`),
          cover:
            media.coverImage?.large ||
            media.coverImage?.extraLarge ||
            undefined,
          media_type: mediaType,
          airingAt: releaseInfo.airingAt,
          airingLabel: formatAiringLabel(
            releaseInfo.airingAt,
            releaseInfo.isFlexible,
            releaseInfo.flexibleRangeLabel
          ),
          airingEpisode: releaseInfo.nextEpisodeNumber,
          currentEp,
          nextUserEpisode: currentEp + 1,
          behindCount: releaseInfo.behindCount,
          maxAllowedProgress: releaseInfo.maxAllowedProgress,
          isPaused: releaseInfo.isPaused,
          pauseLabel: releaseInfo.pauseLabel,
          isStaggeredDubEnding: releaseInfo.isStaggeredDubEnding,
        } as CalendarStripItem;
      })
      .filter((item): item is CalendarStripItem => item !== null)
      .sort((a, b) => a.airingAt - b.airingAt);
  }, [userWorks, userAniListDetails, calendarOverrides, pausedWorksMap, nowMs]);

  const handleQuickIncrement = async (
    workId: string,
    nextEp: number,
    maxAllowed: number | null
  ) => {
    if (!currentUserUid) return;
    if (maxAllowed !== null && nextEp > maxAllowed) return;
    if (!isOnline) {
      toast.error(
        "Keine Internetverbindung. Fortschritt konnte nicht gespeichert werden."
      );
      return;
    }

    const previousEp =
      userWorks.find((w) => w.work_id === workId)?.current_episode ?? 0;

    // Optimistic update
    setUserWorks((prev) =>
      prev.map((w) =>
        w.work_id === workId ? { ...w, current_episode: nextEp } : w
      )
    );
    setJustIncrementedIds((prev) => new Set(prev).add(workId));
    window.setTimeout(() => {
      setJustIncrementedIds((prev) => {
        const next = new Set(prev);
        next.delete(workId);
        return next;
      });
    }, 1500);

    try {
      await updateEpisodeProgress(currentUserUid, workId, nextEp);
    } catch (err) {
      console.error("Failed to quick-increment episode:", err);
      // Roll back optimistic state on error
      setUserWorks((prev) =>
        prev.map((w) =>
          w.work_id === workId ? { ...w, current_episode: previousEp } : w
        )
      );
      toast.error("Fortschritt konnte nicht gespeichert werden.");
    }
  };

  const handleProgressUpdatedFromFeed = (workId: string, newEp: number) => {
    setUserWorks((prev) =>
      prev.map((w) =>
        w.work_id === workId ? { ...w, current_episode: newEp } : w
      )
    );
  };

  const pausedActiveCount = useMemo(() => {
    return userWorks.filter(
      (w) => w.status === "CURRENT" && Boolean(pausedWorksMap[w.work_id])
    ).length;
  }, [userWorks, pausedWorksMap]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-5 pb-4 max-w-3xl mx-auto w-full">
      {/* TOP SECTION: HEUTE & DEMNÄCHST IM KALENDER */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent-text" />
              Heute &amp; Demnächst im Kalender
            </h2>
            {pausedActiveCount > 0 && (
              <Link
                href="/calendar"
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25 transition"
              >
                {pausedActiveCount} auf Pause
              </Link>
            )}
          </div>
          <Link
            href="/calendar"
            className="text-xs font-bold text-accent-text hover:text-accent-light flex items-center gap-0.5 transition-colors shrink-0"
          >
            Alle im Kalender
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {!authLoaded || isLoadingCalendar ? (
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="w-56 h-24 rounded-2xl bg-surface border border-white/5 animate-pulse shrink-0"
              />
            ))}
          </div>
        ) : !currentUserUid ? (
          <div className="bg-surface border border-white/10 rounded-2xl p-3.5 text-xs text-gray-400 flex items-center justify-between gap-3">
            <span>
              Melde dich an, um deine heutigen Releases aus dem Kalender zu sehen.
            </span>
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-bold shrink-0 transition"
            >
              Anmelden
            </Link>
          </div>
        ) : upcomingCalendarItems.length === 0 ? (
          <div className="bg-surface/70 border border-white/10 rounded-2xl p-3.5 text-xs text-gray-400 flex items-center justify-between gap-3">
            <span>Keine anstehenden Releases in den nächsten 7 Tagen.</span>
            <Link
              href="/calendar"
              className="text-accent-text font-semibold hover:underline shrink-0"
            >
              Kalender öffnen →
            </Link>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 snap-x scrollbar-hide">
            {upcomingCalendarItems.map((item) => {
              const unitShort = item.media_type === "MANGA" ? "Kap" : "Ep";
              const wasJustIncremented = justIncrementedIds.has(item.work_id);
              const canIncrement =
                item.behindCount > 0 &&
                (item.maxAllowedProgress === null ||
                  item.currentEp < item.maxAllowedProgress);

              return (
                <div
                  key={item.work_id}
                  className="snap-start shrink-0 w-64 bg-surface border border-white/10 rounded-2xl p-2.5 flex items-center gap-3 shadow-sm"
                >
                  <Link href={`/work/${item.work_id}`} className="shrink-0">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt={item.title}
                        className="w-12 h-16 rounded-xl object-cover bg-gray-800"
                      />
                    ) : (
                      <div className="w-12 h-16 rounded-xl bg-gray-800" />
                    )}
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <Link
                      href={`/work/${item.work_id}`}
                      className="text-xs font-bold text-white hover:text-accent-light truncate transition-colors"
                    >
                      {item.title}
                    </Link>

                    <div className="flex items-center gap-1.5 text-[11px] text-gray-300 flex-wrap">
                      <span className="text-accent-text font-semibold">
                        {item.airingLabel}
                      </span>
                      {item.airingEpisode && (
                        <span className="text-gray-400">
                          • {unitShort}. {item.airingEpisode}
                        </span>
                      )}
                      {item.isStaggeredDubEnding && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          Dub
                        </span>
                      )}
                    </div>

                    {wasJustIncremented ? (
                      <span className="mt-0.5 self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-accent text-white">
                        <Check className="w-3 h-3" />
                        Gespeichert
                      </span>
                    ) : canIncrement ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickIncrement(
                            item.work_id,
                            item.nextUserEpisode,
                            item.maxAllowedProgress
                          )
                        }
                        className="mt-0.5 self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors bg-accent-soft hover:bg-accent-soft-hover text-accent-light border border-accent-border"
                      >
                        <Plus className="w-3 h-3" />
                        {unitShort} {item.nextUserEpisode}
                      </button>
                    ) : (
                      <span className="mt-0.5 self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-accent-soft text-accent-light/90 border border-accent-border">
                        <Check className="w-3 h-3" />
                        Aktuell ({unitShort} {item.currentEp})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* WHATSAPP-STYLE REVIEW COMPOSER & FEED */}
      <WhatsAppReviewFeed
        currentUserUid={currentUserUid}
        userWorks={userWorks}
        userAniListDetails={userAniListDetails}
        calendarOverrides={calendarOverrides}
        pausedWorksMap={pausedWorksMap}
        highlightActivityId={highlightActivityId}
        onProgressUpdated={handleProgressUpdatedFromFeed}
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4 px-4 pt-5 max-w-3xl mx-auto w-full">
          <div className="h-24 rounded-2xl bg-surface animate-pulse border border-white/5" />
          <div className="h-44 rounded-2xl bg-surface animate-pulse border border-white/5" />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
