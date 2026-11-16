"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronRight, Plus, Check } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { de } from "date-fns/locale";
import { auth } from "@/lib/firebase";
import { fetchAniListBatch } from "@/lib/anilist";
import { getAllUserWorks, updateEpisodeProgress } from "@/lib/db/works";
import { CalendarOverride, getCalendarOverrides } from "@/lib/db/calendar";
import { UserWork } from "@/types/database";
import { useAppStore } from "@/lib/store";
import WhatsAppReviewFeed from "@/components/ui/WhatsAppReviewFeed";

interface CalendarStripItem {
  work_id: string;
  title: string;
  cover?: string;
  media_type: "ANIME" | "MANGA";
  airingAt: number;
  airingLabel: string;
  airingEpisode?: number;
  nextUserEpisode: number;
}

function computeNextAiringAt(
  media: any,
  over?: CalendarOverride
): number | undefined {
  if (over?.airingAt) {
    return over.airingAt;
  }

  if (over?.weeklyDay !== undefined && over?.weeklyTime !== undefined) {
    const [hours, minutes] = over.weeklyTime.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return undefined;

    const now = new Date();
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    const currentDay = date.getDay();

    let diff = over.weeklyDay - currentDay;
    if (diff < 0) diff += 7;
    if (diff === 0 && date.getTime() < now.getTime()) {
      diff += 7;
    }

    date.setDate(date.getDate() + diff);
    let computedAiringAt = Math.floor(date.getTime() / 1000);

    const freqWeeks = over.releaseFrequency || 1;
    const anchor = over.startDate
      ? new Date(over.startDate).getTime() / 1000
      : over.lastIncrementedAt || 0;

    if (anchor > 0 && freqWeeks > 1) {
      const startD = new Date(anchor * 1000);
      const diffStart = startD.getDay() === 0 ? 6 : startD.getDay() - 1;
      startD.setDate(startD.getDate() - diffStart);
      startD.setHours(0, 0, 0, 0);

      const compD = new Date(computedAiringAt * 1000);
      const diffComp = compD.getDay() === 0 ? 6 : compD.getDay() - 1;
      compD.setDate(compD.getDate() - diffComp);
      compD.setHours(0, 0, 0, 0);

      const diffWeeks = Math.round(
        (compD.getTime() - startD.getTime()) / (7 * 24 * 3600 * 1000)
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
      computedAiringAt += weeksToAdd * 7 * 24 * 3600;
    }

    return computedAiringAt;
  }

  if (media?.nextAiringEpisode?.airingAt) {
    return media.nextAiringEpisode.airingAt;
  }

  return undefined;
}

function formatAiringLabel(airingAtSec: number): string {
  const date = new Date(airingAtSec * 1000);
  const timeStr = format(date, "HH:mm");
  if (isToday(date)) return `Heute ${timeStr}`;
  if (isTomorrow(date)) return `Morgen ${timeStr}`;
  return format(date, "EEE HH:mm", { locale: de });
}

export default function Home() {
  const isOnline = useAppStore((s) => s.isOnline);

  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(
    undefined
  );
  const [authLoaded, setAuthLoaded] = useState(false);
  const [userWorks, setUserWorks] = useState<UserWork[]>([]);
  const [userAniListDetails, setUserAniListDetails] = useState<
    Record<string, any>
  >({});
  const [calendarOverrides, setCalendarOverrides] = useState<
    Record<string, CalendarOverride>
  >({});
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [justIncrementedIds, setJustIncrementedIds] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setAuthLoaded(true);
      if (!user) {
        setCurrentUserUid(undefined);
        setUserWorks([]);
        setUserAniListDetails({});
        setCalendarOverrides({});
        return;
      }

      setCurrentUserUid(user.uid);
      setIsLoadingCalendar(true);
      try {
        const [works, overrides] = await Promise.all([
          getAllUserWorks(user.uid),
          getCalendarOverrides(),
        ]);
        setUserWorks(works);
        setCalendarOverrides(overrides);

        const idsToFetch = works
          .map((w) => parseInt(w.work_id, 10))
          .filter((id) => !Number.isNaN(id) && id > 0);

        if (idsToFetch.length > 0) {
          const mediaList = await fetchAniListBatch(idsToFetch);
          const map: Record<string, any> = {};
          mediaList.forEach((m: any) => {
            map[m.id.toString()] = m;
          });
          setUserAniListDetails(map);
        }
      } catch (err) {
        console.error("Failed to load home user data:", err);
      } finally {
        setIsLoadingCalendar(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const upcomingCalendarItems = useMemo<CalendarStripItem[]>(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const maxWindowSec = nowSec + 7 * 24 * 3600;

    return userWorks
      .filter((w) => w.status === "CURRENT")
      .map((w) => {
        const media = userAniListDetails[w.work_id];
        if (!media) return null;

        const over = calendarOverrides[w.work_id];
        const airingAt = computeNextAiringAt(media, over);
        if (!airingAt || airingAt > maxWindowSec) return null;

        const mediaType: "ANIME" | "MANGA" =
          media.type === "MANGA" ? "MANGA" : "ANIME";
        const currentEp = Number(w.current_episode) || 0;

        return {
          work_id: w.work_id,
          title:
            media.title?.english ||
            media.title?.romaji ||
            `Werk #${w.work_id}`,
          cover: media.coverImage?.large || media.coverImage?.extraLarge,
          media_type: mediaType,
          airingAt,
          airingLabel: formatAiringLabel(airingAt),
          airingEpisode: media.nextAiringEpisode?.episode,
          nextUserEpisode: currentEp + 1,
        } as CalendarStripItem;
      })
      .filter((item): item is CalendarStripItem => item !== null)
      .sort((a, b) => a.airingAt - b.airingAt);
  }, [userWorks, userAniListDetails, calendarOverrides]);

  const handleQuickIncrement = async (workId: string, nextEp: number) => {
    if (!currentUserUid) return;
    if (!isOnline) {
      alert("Keine Internetverbindung. Fortschritt konnte nicht gespeichert werden.");
      return;
    }

    // Optimistic update
    setUserWorks((prev) =>
      prev.map((w) =>
        w.work_id === workId ? { ...w, current_episode: nextEp } : w
      )
    );
    setJustIncrementedIds((prev) => new Set(prev).add(workId));
    setTimeout(() => {
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
    }
  };

  const handleProgressUpdatedFromFeed = (workId: string, newEp: number) => {
    setUserWorks((prev) =>
      prev.map((w) =>
        w.work_id === workId ? { ...w, current_episode: newEp } : w
      )
    );
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-5 pb-24 max-w-3xl mx-auto w-full">
      {/* TOP SECTION: HEUTE & DEMNÄCHST IM KALENDER */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            Heute &amp; Demnächst im Kalender
          </h2>
          <Link
            href="/calendar"
            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 transition-colors shrink-0"
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
                className="w-56 h-24 rounded-2xl bg-[#111827] border border-white/5 animate-pulse shrink-0"
              />
            ))}
          </div>
        ) : !currentUserUid ? (
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-3.5 text-xs text-gray-400 flex items-center justify-between gap-3">
            <span>
              Melde dich an, um deine heutigen Releases aus dem Kalender zu sehen.
            </span>
            <Link
              href="/profile"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold shrink-0"
            >
              Anmelden
            </Link>
          </div>
        ) : upcomingCalendarItems.length === 0 ? (
          <div className="bg-[#111827]/70 border border-white/10 rounded-2xl p-3.5 text-xs text-gray-400 flex items-center justify-between gap-3">
            <span>Keine anstehenden Releases in den nächsten 7 Tagen.</span>
            <Link
              href="/calendar"
              className="text-emerald-400 font-semibold hover:underline shrink-0"
            >
              Kalender öffnen →
            </Link>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 snap-x scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {upcomingCalendarItems.map((item) => {
              const unitShort = item.media_type === "MANGA" ? "Kap" : "Ep";
              const wasJustIncremented = justIncrementedIds.has(item.work_id);

              return (
                <div
                  key={item.work_id}
                  className="snap-start shrink-0 w-64 bg-[#111827] border border-white/10 rounded-2xl p-2.5 flex items-center gap-3 shadow-sm"
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
                      className="text-xs font-bold text-white hover:text-emerald-300 truncate transition-colors"
                    >
                      {item.title}
                    </Link>

                    <div className="flex items-center gap-1.5 text-[11px] text-gray-300">
                      <span className="text-emerald-400 font-semibold">
                        {item.airingLabel}
                      </span>
                      {item.airingEpisode && (
                        <span className="text-gray-400">
                          • {unitShort}. {item.airingEpisode}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleQuickIncrement(item.work_id, item.nextUserEpisode)
                      }
                      className={`mt-0.5 self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                        wasJustIncremented
                          ? "bg-emerald-500 text-white"
                          : "bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/30"
                      }`}
                    >
                      {wasJustIncremented ? (
                        <>
                          <Check className="w-3 h-3" />
                          Gespeichert
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          {unitShort} {item.nextUserEpisode}
                        </>
                      )}
                    </button>
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
        onProgressUpdated={handleProgressUpdatedFromFeed}
      />
    </div>
  );
}
