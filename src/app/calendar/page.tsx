/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { getAllUserWorks, updateEpisodeProgress } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { getCalendarOverrides, setCalendarOverride } from "@/lib/db/calendar";
import { useAppStore } from "@/lib/store";
import {
  Calendar as CalendarIcon,
  Clock,
  Tv,
  Edit2,
  Check,
  X,
  ChevronDown,
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

  const [userWorkMap, setUserWorkMap] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [selectedDayFilter, setSelectedDayFilter] = useState<number | "ALL">("ALL");
  const [isUnscheduledOpen, setIsUnscheduledOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDateString, setEditDateString] = useState("");
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    const user = auth.currentUser;
    if (!user) {
      setIsLoggedIn(false);
      setScheduledAnime([]);
      setUnscheduledAnime([]);
      setScheduledManga([]);
      setUnscheduledManga([]);
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
        const [mediaList, overrides] = await Promise.all([
          fetchAniListBatch(ids),
          getCalendarOverrides(),
        ]);
        setGlobalOverrides(overrides);

        const scheduledA: any[] = [];
        const unscheduledA: any[] = [];
        const scheduledM: any[] = [];
        const unscheduledM: any[] = [];

        mediaList.forEach((m: any) => {
          const strId = m.id.toString();
          const over = overrides[strId];

          let hasSchedule = false;
          let computedAiringAt: number | undefined = undefined;

          if (over?.airingAt) {
            computedAiringAt = over.airingAt;
            hasSchedule = true;
          } else if (over?.weeklyDay !== undefined && over?.weeklyTime !== undefined) {
            const [hours, minutes] = over.weeklyTime.split(":").map(Number);
            const date = new Date();
            date.setHours(hours, minutes, 0, 0);
            const currentDay = date.getDay();

            let diff = over.weeklyDay - currentDay;
            if (diff < 0) diff += 7;

            if (diff === 0 && date.getTime() < new Date().getTime()) {
              diff += 7;
            }

            date.setDate(date.getDate() + diff);
            computedAiringAt = Math.floor(date.getTime() / 1000);

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
            hasSchedule = true;
          } else if (m.nextAiringEpisode?.airingAt) {
            computedAiringAt = m.nextAiringEpisode.airingAt;
            hasSchedule = true;
          }

          if (hasSchedule && computedAiringAt) {
            const cloned = { ...m };

            let nextEp = m.nextAiringEpisode?.episode;
            const manualAvail = over?.manualAvailableEps ?? map[strId]?.manual_available_eps;
            let isManualEpisode = false;
            if (manualAvail !== undefined && manualAvail !== null) {
              nextEp = Number(manualAvail) + 1;
              isManualEpisode = true;
            } else if (!nextEp) {
              nextEp = (map[strId]?.current_episode ?? 0) + 1;
              isManualEpisode = true;
            }
            cloned.isManualEpisode = isManualEpisode;
            cloned.nextAiringEpisode = {
              ...m.nextAiringEpisode,
              airingAt: computedAiringAt,
              episode: nextEp,
            };
            if (over?.rhythmType) cloned.rhythmType = over.rhythmType;
            if (over?.flexibleDayRange) cloned.flexibleDayRange = over.flexibleDayRange;

            if (m.type === "ANIME") {
              scheduledA.push(cloned);
            } else if (m.type === "MANGA") {
              scheduledM.push(cloned);
            }
          } else {
            if (m.type === "ANIME") {
              unscheduledA.push(m);
            } else if (m.type === "MANGA") {
              unscheduledM.push(m);
            }
          }
        });

        scheduledA.sort(
          (a: any, b: any) => a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt
        );
        scheduledM.sort(
          (a: any, b: any) => a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt
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

        setScheduledAnime(scheduledA);
        setUnscheduledAnime(unscheduledA);
        setScheduledManga(scheduledM);
        setUnscheduledManga(unscheduledM);
      } else {
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

  const handleEditClick = (item: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(item.id.toString());
    const date = new Date(item.nextAiringEpisode.airingAt * 1000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setEditDateString(local);
  };

  const handleSaveOverride = async (workId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const newDate = new Date(editDateString);
    const newUnix = Math.floor(newDate.getTime() / 1000);

    await setCalendarOverride(workId, newUnix);
    setEditingId(null);

    loadData();
  };

  const handleQuickIncrement = async (
    e: React.MouseEvent,
    strId: string,
    currentEp: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const user = auth.currentUser;
    if (!user || updatingIds[strId]) return;

    const nextEp = currentEp + 1;

    setUserWorkMap((prev) => ({
      ...prev,
      [strId]: {
        ...(prev[strId] || { work_id: strId, user_id: user.uid, status: "CURRENT" }),
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

  const scheduledForCurrentType = contentType === "ANIME" ? scheduledAnime : scheduledManga;
  const unscheduledForCurrentType = contentType === "ANIME" ? unscheduledAnime : unscheduledManga;

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
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
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

          {/* Unified Schedule List (No Duplicate Summary Box) */}
          <div className="flex flex-col gap-5">
            {isLoading ? (
              <div className="text-center text-gray-500 py-8 animate-pulse">
                Lade Kalender...
              </div>
            ) : scheduledForCurrentType.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-500 bg-[#1a1d24] border border-gray-800 rounded-xl border-dashed text-center">
                <Tv size={42} className="mb-3 text-gray-700" strokeWidth={1.2} />
                <p className="text-sm font-semibold text-gray-300">
                  Keine geplanten Releases für{" "}
                  {contentType === "ANIME" ? "Anime" : "Manga"}.
                </p>
                {unscheduledForCurrentType.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1.5 max-w-sm">
                    Du hast {unscheduledForCurrentType.length} aktive Werke ohne
                    festen Wochentag (siehe unten).
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
                        const date = new Date(item.nextAiringEpisode.airingAt * 1000);
                        const strId = item.id.toString();
                        const uWork = userWorkMap[strId];
                        const offset = uWork?.synchro_offset_episodes || 0;

                        const currentEp = uWork?.current_episode || 0;
                        let displayEpisode = item.nextAiringEpisode.episode;
                        if (!item.isManualEpisode && offset > 0) {
                          displayEpisode -= offset;
                        }
                        if (displayEpisode < 1) displayEpisode = item.nextAiringEpisode.episode;

                        const timeString = format(date, "HH:mm");
                        const countdown = formatDistanceToNow(date, {
                          addSuffix: true,
                          locale: de,
                        });

                        let displayTime = `${timeString} Uhr`;
                        if (item.rhythmType === "flexible" && item.flexibleDayRange) {
                          const minL = DAYS.find(
                            (d) => d.value === item.flexibleDayRange.minDay
                          )?.short;
                          const maxL = DAYS.find(
                            (d) => d.value === item.flexibleDayRange.maxDay
                          )?.short;
                          displayTime = `${minL} – ${maxL}`;
                        }

                        // Calculate Behind Status
                        let episodesOut = item.nextAiringEpisode.episode - 1;
                        const override = globalOverrides[strId];
                        let totalEps = 9999;
                        if (
                          override?.manualMaxEpisode !== undefined &&
                          override?.manualMaxEpisode !== null
                        ) {
                          totalEps = override.manualMaxEpisode;
                        } else if (
                          uWork?.manual_max_episode !== undefined &&
                          uWork?.manual_max_episode !== null
                        ) {
                          totalEps = uWork.manual_max_episode;
                        }

                        if (
                          override?.manualAvailableEps !== undefined &&
                          override?.manualAvailableEps !== null
                        ) {
                          episodesOut = override.manualAvailableEps;
                        } else if (
                          (uWork as any)?.manual_available_eps !== undefined &&
                          (uWork as any)?.manual_available_eps !== null
                        ) {
                          episodesOut = Number((uWork as any).manual_available_eps);
                        } else if (item.type === "MANGA") {
                          episodesOut = totalEps !== 9999 ? totalEps : item.chapters || 0;
                        } else {
                          if (item.status === "RELEASING" && item.nextAiringEpisode) {
                            episodesOut = item.nextAiringEpisode.episode - 1;
                          } else if (item.status === "RELEASING") {
                            episodesOut = currentEp;
                          } else if (item.status === "FINISHED") {
                            episodesOut = totalEps !== 9999 ? totalEps : item.episodes || 0;
                          } else {
                            episodesOut = 0;
                          }
                        }

                        if (
                          override?.manualAvailableEps == null &&
                          (uWork as any)?.manual_available_eps == null
                        ) {
                          episodesOut = Math.max(0, episodesOut - offset);
                        }
                        const behindCount = Math.max(0, episodesOut - currentEp);

                        const isEditing = editingId === strId;
                        const unitShort = item.type === "MANGA" ? "Kap." : "Folge";

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
                              <h4 className="font-semibold text-sm text-white truncate group-hover:text-blue-400 transition-colors">
                                {item.title.english || item.title.romaji}
                              </h4>

                              <div className="flex items-center flex-wrap gap-2 text-xs">
                                <span className="font-bold text-blue-400">
                                  {unitShort} {displayEpisode}
                                </span>
                                <span className="text-gray-600">•</span>
                                <span className="inline-flex items-center gap-1 text-gray-300 font-medium">
                                  <Clock size={11} className="text-gray-400" />
                                  {displayTime}
                                </span>
                                <span className="text-[11px] text-gray-500">
                                  ({countdown})
                                </span>
                              </div>

                              <span className="text-[11px] text-gray-400">
                                Dein Stand: {unitShort} {currentEp}
                                {behindCount > 0 ? ` (${behindCount} offen)` : ""}
                              </span>

                              {isEditing && (
                                <div
                                  className="flex items-center gap-2 mt-1"
                                  onClick={(e) => e.preventDefault()}
                                >
                                  <input
                                    type="datetime-local"
                                    value={editDateString}
                                    onChange={(e) => setEditDateString(e.target.value)}
                                    className="bg-gray-900 border border-gray-700 rounded text-xs text-white p-1"
                                  />
                                  <button
                                    onClick={(e) => handleSaveOverride(strId, e)}
                                    className="bg-green-600 p-1 rounded text-white"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setEditingId(null);
                                    }}
                                    className="bg-red-600 p-1 rounded text-white"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            {!isEditing && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                {(behindCount > 0 || isToday || date.getTime() <= Date.now()) && (
                                  <button
                                    type="button"
                                    disabled={!!updatingIds[strId]}
                                    onClick={(e) =>
                                      handleQuickIncrement(e, strId, currentEp)
                                    }
                                    className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                                    title={`${unitShort} ${currentEp + 1} als gesehen markieren`}
                                  >
                                    + {item.type === "MANGA" ? "Kap" : "Ep"}{" "}
                                    {currentEp + 1}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => handleEditClick(item, e)}
                                  className="text-gray-500 hover:text-white transition p-1.5 rounded-lg hover:bg-gray-800"
                                  title="Release-Zeit anpassen"
                                >
                                  <Edit2 size={14} />
                                </button>
                              </div>
                            )}
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
                  Aktive Werke ohne festen Termin ({unscheduledForCurrentType.length})
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
                    const statusText = getUnscheduledStatusText(work.status);
                    return (
                      <Link
                        key={strId}
                        href={`/work/${strId}`}
                        className="flex items-center gap-2.5 p-2 bg-[#14161b] border border-gray-800 hover:border-blue-500/60 rounded-xl transition-colors group"
                      >
                        <img
                          src={work.coverImage?.medium || work.coverImage?.large}
                          alt={work.title?.english || work.title?.romaji || "Cover"}
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
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
