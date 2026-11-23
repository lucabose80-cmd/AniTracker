/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { getAllUserWorks, updateEpisodeProgress } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import {
  CalendarOverride,
  computeWorkReleaseInfo,
  formatPauseStatusLabel,
  getCalendarOverrides,
} from "@/lib/db/calendar";
import {
  getPausedWorksMap,
  unpauseWork,
  WorkPauseRecord,
} from "@/lib/db/pauses";
import { WorkSettingsModal } from "@/components/ui/WorkSettingsModal";
import { useAppStore } from "@/lib/store";
import {
  Calendar as CalendarIcon,
  Clock,
  Tv,
  Edit2,
  ChevronDown,
  PauseCircle,
  PlayCircle,
  SlidersHorizontal,
  Check,
} from "lucide-react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { usePathname } from "next/navigation";

// Map JS getDay() (0 = Sunday, 1 = Monday) for the UI
const DAYS = [
  { label: "Montag", short: "Mo", value: 1 },
  { label: "Dienstag", short: "Di", value: 2 },
  { label: "Mittwoch", short: "Mi", value: 3 },
  { label: "Donnerstag", short: "Do", value: 4 },
  { label: "Freitag", short: "Fr", value: 5 },
  { label: "Samstag", short: "Sa", value: 6 },
  { label: "Sonntag", short: "So", value: 0 },
];

function getUnscheduledStatusText(status?: string) {
  switch (status) {
    case "FINISHED":
      return "Staffelpause / Beendet";
    case "RELEASING":
      return "Warten auf Ankündigung";
    case "NOT_YET_RELEASED":
      return "Warten auf Ankündigung";
    case "HIATUS":
      return "Pausiert / Hiatus";
    case "CANCELLED":
      return "Abgebrochen";
    default:
      return "Warten auf Ankündigung";
  }
}

export default function CalendarPage() {
  const { contentType } = useAppStore();
  const [scheduledAnime, setScheduledAnime] = useState<any[]>([]);
  const [unscheduledAnime, setUnscheduledAnime] = useState<any[]>([]);
  const [scheduledManga, setScheduledManga] = useState<any[]>([]);
  const [unscheduledManga, setUnscheduledManga] = useState<any[]>([]);
  const [allMediaById, setAllMediaById] = useState<Record<string, any>>({});

  const [userWorkMap, setUserWorkMap] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<
    Record<string, CalendarOverride>
  >({});
  const [pausedWorksMap, setPausedWorksMap] = useState<
    Record<string, WorkPauseRecord>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [selectedDayFilter, setSelectedDayFilter] = useState<number | "ALL">(
    "ALL"
  );
  const [isUnscheduledOpen, setIsUnscheduledOpen] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});
  const [modalWork, setModalWork] = useState<any | null>(null);
  const [isSavingModal, setIsSavingModal] = useState(false);

  const loadData = async () => {
    const user = auth.currentUser;
    if (!user) {
      setIsLoggedIn(false);
      setScheduledAnime([]);
      setUnscheduledAnime([]);
      setScheduledManga([]);
      setUnscheduledManga([]);
      setAllMediaById({});
      setIsLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setIsLoading(true);
    try {
      const works = await getAllUserWorks(user.uid);
      const activeWorks = works.filter((w) => w.status === "CURRENT");
      const ids = activeWorks.map((w) => parseInt(w.work_id, 10));

      const map: Record<string, any> = {};
      activeWorks.forEach((w) => (map[w.work_id] = w));
      setUserWorkMap(map);

      if (ids.length > 0) {
        const [mediaList, overrides, pauses] = await Promise.all([
          fetchAniListBatch(ids),
          getCalendarOverrides(),
          getPausedWorksMap().catch((): Record<string, WorkPauseRecord> => ({})),
        ]);
        setGlobalOverrides(overrides);
        setPausedWorksMap(pauses);

        const mediaMap: Record<string, any> = {};
        const scheduledA: any[] = [];
        const unscheduledA: any[] = [];
        const scheduledM: any[] = [];
        const unscheduledM: any[] = [];

        mediaList.forEach((m: any) => {
          const strId = m.id.toString();
          mediaMap[strId] = m;
          const over = overrides[strId];
          const pauseInfo = pauses[strId];
          const uWork = map[strId];

          const releaseInfo = computeWorkReleaseInfo({
            media: m,
            override: over,
            pauseInfo,
            userWork: uWork,
          });

          const cloned = {
            ...m,
            releaseInfo,
          };

          if (releaseInfo.hasSchedule && releaseInfo.airingAt) {
            cloned.nextAiringEpisode = {
              ...m.nextAiringEpisode,
              airingAt: releaseInfo.airingAt,
              episode: releaseInfo.nextEpisodeNumber,
            };

            if (m.type === "ANIME") {
              scheduledA.push(cloned);
            } else if (m.type === "MANGA") {
              scheduledM.push(cloned);
            }
          } else {
            if (m.type === "ANIME") {
              unscheduledA.push(cloned);
            } else if (m.type === "MANGA") {
              unscheduledM.push(cloned);
            }
          }
        });

        scheduledA.sort(
          (a: any, b: any) =>
            a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt
        );
        scheduledM.sort(
          (a: any, b: any) =>
            a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt
        );

        unscheduledA.sort((a: any, b: any) => {
          const titleA = a.title?.english || a.title?.romaji || "";
          const titleB = b.title?.english || b.title?.romaji || "";
          return titleA.localeCompare(titleB);
        });
        unscheduledM.sort((a: any, b: any) => {
          const titleA = a.title?.english || a.title?.romaji || "";
          const titleB = b.title?.english || b.title?.romaji || "";
          return titleA.localeCompare(titleB);
        });

        setAllMediaById(mediaMap);
        setScheduledAnime(scheduledA);
        setUnscheduledAnime(unscheduledA);
        setScheduledManga(scheduledM);
        setUnscheduledManga(unscheduledM);
      } else {
        setAllMediaById({});
        setScheduledAnime([]);
        setUnscheduledAnime([]);
        setScheduledManga([]);
        setUnscheduledManga([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => loadData());
    return () => unsubscribe();
  }, [pathname]);

  const openScheduleModal = (item: any, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setModalWork(item);
  };

  const handleQuickUnpause = async (workId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsSavingModal(true);
    try {
      await unpauseWork(workId);
      await loadData();
    } catch (err) {
      console.error("Failed to unpause work:", err);
      alert("Fehler beim Aufheben der Pause.");
    } finally {
      setIsSavingModal(false);
    }
  };

  const handleQuickIncrement = async (
    e: React.MouseEvent,
    strId: string,
    currentEp: number,
    maxAllowed: number | null
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const user = auth.currentUser;
    if (!user || updatingIds[strId]) return;

    if (maxAllowed !== null && currentEp >= maxAllowed) return;
    const nextEp =
      maxAllowed !== null ? Math.min(currentEp + 1, maxAllowed) : currentEp + 1;
    if (nextEp <= currentEp) return;

    setUserWorkMap((prev) => ({
      ...prev,
      [strId]: {
        ...(prev[strId] || {
          work_id: strId,
          user_id: user.uid,
          status: "CURRENT",
        }),
        current_episode: nextEp,
      },
    }));
    setUpdatingIds((prev) => ({ ...prev, [strId]: true }));

    try {
      await updateEpisodeProgress(user.uid, strId, nextEp);
    } catch (err) {
      console.error("Fehler beim Aktualisieren des Fortschritts:", err);
      setUserWorkMap((prev) => ({
        ...prev,
        [strId]: {
          ...(prev[strId] || {}),
          current_episode: currentEp,
        },
      }));
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [strId]: false }));
    }
  };

  const scheduledForCurrentType =
    contentType === "ANIME" ? scheduledAnime : scheduledManga;
  const unscheduledForCurrentType =
    contentType === "ANIME" ? unscheduledAnime : unscheduledManga;

  // Currently paused works for the current contentType so the user can always see & unpause them in 1 click
  const pausedWorksForCurrentType = useMemo(() => {
    return Object.values(pausedWorksMap)
      .map((p) => {
        const media = allMediaById[p.work_id];
        if (!media || media.type !== contentType) return null;
        return {
          pause: p,
          media,
        };
      })
      .filter((x): x is { pause: WorkPauseRecord; media: any } => x !== null);
  }, [pausedWorksMap, allMediaById, contentType]);

  const todayDay = new Date().getDay();
  const tomorrowDay = (todayDay + 1) % 7;

  // Order days chronologically starting with TODAY
  const orderedDays = useMemo(() => {
    const startIdx = DAYS.findIndex((d) => d.value === todayDay);
    if (startIdx === -1) return DAYS;
    return [...DAYS.slice(startIdx), ...DAYS.slice(0, startIdx)];
  }, [todayDay]);

  // Count releases per weekday for the quick-filter strip
  const dayCounts = useMemo(() => {
    const counts: Record<number, number> = {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    };
    scheduledForCurrentType.forEach((item) => {
      const d = new Date(item.nextAiringEpisode.airingAt * 1000).getDay();
      counts[d] = (counts[d] || 0) + 1;
    });
    return counts;
  }, [scheduledForCurrentType]);

  const visibleDays = useMemo(() => {
    if (selectedDayFilter === "ALL") return orderedDays;
    return orderedDays.filter((d) => d.value === selectedDayFilter);
  }, [orderedDays, selectedDayFilter]);

  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-24 max-w-2xl mx-auto">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <CalendarIcon className="text-blue-500" size={20} />
            Wochenplan ({contentType === "MANGA" ? "Manga" : "Anime"})
          </h2>
          <p className="text-xs text-gray-400">
            Deine aktiven Releases, sortiert ab heute
          </p>
        </div>

        <span className="text-xs font-semibold text-gray-400 bg-[#1a1d24] border border-gray-800 px-3 py-1 rounded-full shrink-0">
          {scheduledForCurrentType.length} geplant
        </span>
      </div>

      {!isLoggedIn ? (
        <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-6 text-center text-gray-400">
          Bitte logge dich ein, um deinen Release-Kalender zu sehen.
        </div>
      ) : (
        <>
          {/* PAUSED WORKS BAR (1-Click Unpause if paused or misconfigured) */}
          {pausedWorksForCurrentType.length > 0 && (
            <div className="bg-amber-950/25 border border-amber-500/35 rounded-2xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <PauseCircle size={15} />
                  Aktuell pausierte Werke ({pausedWorksForCurrentType.length})
                </span>
                <span className="text-[11px] text-amber-200/70">
                  1-Klick zum Fortsetzen
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {pausedWorksForCurrentType.map(({ pause, media }) => {
                  const strId = media.id.toString();
                  return (
                    <div
                      key={`paused-${strId}`}
                      className="flex items-center justify-between gap-2 bg-[#14171f]/90 border border-amber-500/20 rounded-xl p-2"
                    >
                      <Link
                        href={`/work/${strId}`}
                        className="flex items-center gap-2.5 min-w-0 flex-1"
                      >
                        <img
                          src={media.coverImage?.medium || media.coverImage?.large}
                          alt="Cover"
                          className="w-8 h-11 object-cover rounded shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">
                            {media.title?.english || media.title?.romaji}
                          </p>
                          <p className="text-[11px] text-amber-300/90">
                            {formatPauseStatusLabel(pause.paused_until)}
                          </p>
                        </div>
                      </Link>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => openScheduleModal(media, e)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                          title="Einstellungen bearbeiten"
                        >
                          <SlidersHorizontal size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleQuickUnpause(strId, e)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-200 hover:text-black border border-amber-500/40 text-xs font-bold transition"
                        >
                          <PlayCircle size={13} />
                          Pause aufheben
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekday Filter Strip (Starting from Today) */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedDayFilter("ALL")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-colors ${
                selectedDayFilter === "ALL"
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-[#1a1d24] border-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              Alle Tage
            </button>

            {orderedDays.map((day) => {
              const count = dayCounts[day.value] || 0;
              const isToday = day.value === todayDay;
              const isSelected = selectedDayFilter === day.value;

              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() =>
                    setSelectedDayFilter(isSelected ? "ALL" : day.value)
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-colors ${
                    isSelected
                      ? "bg-blue-600 border-blue-500 text-white"
                      : isToday
                      ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                      : count > 0
                      ? "bg-[#1a1d24] border-gray-800 text-gray-200 hover:text-white"
                      : "bg-[#1a1d24]/50 border-gray-800/50 text-gray-500"
                  }`}
                >
                  <span>{isToday ? `Heute (${day.short})` : day.short}</span>
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-white/10 text-gray-300"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Unified Schedule List */}
          <div className="flex flex-col gap-5">
            {isLoading ? (
              <div className="text-center text-gray-500 py-8 animate-pulse">
                Lade Kalender...
              </div>
            ) : scheduledForCurrentType.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-500 bg-[#1a1d24] border border-gray-800 rounded-xl border-dashed text-center">
                <Tv
                  size={42}
                  className="mb-3 text-gray-700"
                  strokeWidth={1.2}
                />
                <p className="text-sm font-semibold text-gray-300">
                  Keine geplanten Releases für{" "}
                  {contentType === "ANIME" ? "Anime" : "Manga"}.
                </p>
                {unscheduledForCurrentType.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1.5 max-w-sm">
                    Du hast {unscheduledForCurrentType.length} aktive Werke ohne
                    festen Wochentag (siehe unten – klicke dort auf das
                    Stift-Icon, um einen Rhythmus einzustellen).
                  </p>
                )}
              </div>
            ) : (
              visibleDays.map((day) => {
                const dayList = scheduledForCurrentType.filter((item) => {
                  const date = new Date(item.nextAiringEpisode.airingAt * 1000);
                  return date.getDay() === day.value;
                });

                if (dayList.length === 0) return null;

                const isToday = todayDay === day.value;
                const isTomorrow = tomorrowDay === day.value;

                return (
                  <div
                    key={day.value}
                    className={`flex flex-col gap-2.5 rounded-2xl p-3 border ${
                      isToday
                        ? "bg-blue-950/20 border-blue-500/40"
                        : "bg-[#14171f] border-gray-800/80"
                    }`}
                  >
                    {/* Day Section Header */}
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className={`text-sm font-bold ${
                            isToday ? "text-blue-400" : "text-white"
                          }`}
                        >
                          {day.label}
                        </h3>
                        {isToday && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-600 text-white">
                            Heute
                          </span>
                        )}
                        {isTomorrow && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-gray-300">
                            Morgen
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {dayList.length}{" "}
                        {dayList.length === 1 ? "Release" : "Releases"}
                      </span>
                    </div>

                    {/* Day Releases */}
                    <div className="flex flex-col gap-2">
                      {dayList.map((item) => {
                        const date = new Date(
                          item.nextAiringEpisode.airingAt * 1000
                        );
                        const strId = item.id.toString();
                        const uWork = userWorkMap[strId];
                        const pauseInfo = pausedWorksMap[strId];
                        const rInfo = computeWorkReleaseInfo({
                          media: item,
                          override: globalOverrides[strId],
                          pauseInfo,
                          userWork: uWork,
                        });

                        const currentEp = uWork?.current_episode || 0;
                        const displayEpisode =
                          rInfo?.nextEpisodeNumber ||
                          item.nextAiringEpisode.episode;
                        const behindCount = rInfo?.behindCount ?? 0;
                        const maxAllowed = rInfo?.maxAllowedProgress ?? null;
                        const canIncrement =
                          behindCount > 0 &&
                          (maxAllowed === null || currentEp < maxAllowed);

                        const timeString = format(date, "HH:mm");
                        const dateLabel = format(date, "dd.MM.", { locale: de });
                        const countdown = formatDistanceToNow(date, {
                          addSuffix: true,
                          locale: de,
                        });

                        let displayTime = `${timeString} Uhr`;
                        if (rInfo?.isFlexible && rInfo?.flexibleRangeLabel) {
                          displayTime = rInfo.flexibleRangeLabel;
                        }

                        const isFutureWeek =
                          date.getTime() - Date.now() > 7 * 24 * 3600 * 1000;
                        const freqWeeks = rInfo?.frequencyWeeks || 1;
                        const unitShort =
                          item.type === "MANGA" ? "Kap." : "Folge";

                        return (
                          <Link
                            href={`/work/${strId}`}
                            key={strId}
                            className="flex items-center gap-3 p-2.5 bg-[#1a1d24] border border-gray-800/90 hover:border-blue-500/60 rounded-xl transition-colors group"
                          >
                            {/* Cover */}
                            <div className="relative shrink-0">
                              <img
                                src={item.coverImage.large}
                                alt="Cover"
                                className="w-12 h-16 object-cover rounded-lg bg-gray-800"
                              />
                              {behindCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full shadow">
                                  {behindCount}
                                </span>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-semibold text-sm text-white truncate group-hover:text-blue-400 transition-colors">
                                  {item.title.english || item.title.romaji}
                                </h4>
                                {freqWeeks > 1 && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    Alle {freqWeeks} Wo.
                                  </span>
                                )}
                                {pauseInfo && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    {formatPauseStatusLabel(
                                      pauseInfo.paused_until
                                    )}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center flex-wrap gap-2 text-xs">
                                <span className="font-bold text-blue-400">
                                  {item.type === "MANGA" ? "Nächstes:" : "Nächste:"}{" "}
                                  {unitShort} {displayEpisode}
                                </span>
                                <span className="text-gray-600">•</span>
                                <span className="inline-flex items-center gap-1 text-gray-300 font-medium">
                                  <Clock size={11} className="text-gray-400" />
                                  {displayTime}
                                  {isFutureWeek ? ` (${dateLabel})` : ""}
                                </span>
                                <span className="text-[11px] text-gray-500">
                                  ({countdown})
                                </span>
                              </div>

                              <span className="text-[11px] text-gray-400">
                                Dein Stand: {unitShort} {currentEp}
                                {behindCount > 0
                                  ? ` (${behindCount} offen)`
                                  : ""}
                              </span>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {canIncrement ? (
                                <button
                                  type="button"
                                  disabled={!!updatingIds[strId]}
                                  onClick={(e) =>
                                    handleQuickIncrement(
                                      e,
                                      strId,
                                      currentEp,
                                      maxAllowed
                                    )
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                                  title={`${unitShort} ${
                                    currentEp + 1
                                  } als gesehen markieren`}
                                >
                                  + {item.type === "MANGA" ? "Kap" : "Ep"}{" "}
                                  {currentEp + 1}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300/90 border border-emerald-500/20 text-[11px] font-semibold whitespace-nowrap">
                                  <Check size={12} />
                                  Aktuell
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => openScheduleModal(item, e)}
                                className="text-gray-400 hover:text-white transition p-1.5 rounded-lg bg-white/5 hover:bg-gray-800 border border-white/5"
                                title="Release-Zeit, Rhythmus oder Pause einstellen"
                              >
                                <Edit2 size={14} />
                              </button>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Unscheduled Active Works Section */}
          {unscheduledForCurrentType.length > 0 && (
            <div className="border border-gray-800 rounded-2xl bg-[#1a1d24]/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsUnscheduledOpen(!isUnscheduledOpen)}
                className="w-full flex items-center justify-between p-3.5 text-left font-bold text-xs sm:text-sm text-gray-300 hover:text-white hover:bg-gray-800/40 transition-colors"
              >
                <span>
                  Aktive Werke ohne festen Termin (
                  {unscheduledForCurrentType.length})
                </span>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform duration-200 ${
                    isUnscheduledOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isUnscheduledOpen && (
                <div className="p-3.5 pt-1 border-t border-gray-800/60 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {unscheduledForCurrentType.map((work: any) => {
                    const strId = work.id.toString();
                    const pauseInfo = pausedWorksMap[strId];
                    const statusText = pauseInfo
                      ? formatPauseStatusLabel(pauseInfo.paused_until)
                      : getUnscheduledStatusText(work.status);
                    return (
                      <Link
                        key={strId}
                        href={`/work/${strId}`}
                        className="flex items-center gap-2.5 p-2 bg-[#14161b] border border-gray-800 hover:border-blue-500/60 rounded-xl transition-colors group"
                      >
                        <img
                          src={
                            work.coverImage?.medium || work.coverImage?.large
                          }
                          alt={
                            work.title?.english ||
                            work.title?.romaji ||
                            "Cover"
                          }
                          className="w-9 h-12 object-cover rounded-lg shrink-0"
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold text-gray-200 truncate group-hover:text-blue-400 transition-colors">
                            {work.title?.english || work.title?.romaji}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {statusText}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => openScheduleModal(work, e)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-blue-600/30 text-gray-400 hover:text-blue-300 transition shrink-0"
                          title="Termin oder Rhythmus festlegen"
                        >
                          <Edit2 size={13} />
                        </button>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* UNIFIED WORK SETTINGS & RELEASE MODAL */}
      {modalWork && (
        <WorkSettingsModal
          isOpen={Boolean(modalWork)}
          onClose={() => setModalWork(null)}
          workId={modalWork.id.toString()}
          work={modalWork}
          override={globalOverrides[modalWork.id.toString()]}
          pauseInfo={pausedWorksMap[modalWork.id.toString()] || null}
          userWork={{
            inLibrary: Boolean(userWorkMap[modalWork.id.toString()]),
            synchro_offset_episodes:
              userWorkMap[modalWork.id.toString()]?.synchro_offset_episodes,
            manual_available_eps:
              userWorkMap[modalWork.id.toString()]?.manual_available_eps,
          }}
          initialTab="SCHEDULE"
          onSaved={async () => {
            await loadData();
          }}
        />
      )}
    </div>
  );
}

