/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { getCalendarOverrides, setCalendarOverride } from "@/lib/db/calendar";
import { useAppStore } from "@/lib/store";
import { Calendar as CalendarIcon, Clock, Tv, Edit2, Check, X, ChevronDown } from "lucide-react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { usePathname } from "next/navigation";

// Map JS getDay() (0 = Sunday, 1 = Monday) for the UI
const DAYS = [
  { label: "Mo", value: 1 },
  { label: "Di", value: 2 },
  { label: "Mi", value: 3 },
  { label: "Do", value: 4 },
  { label: "Fr", value: 5 },
  { label: "Sa", value: 6 },
  { label: "So", value: 0 },
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
  const { contentType, setContentType } = useAppStore();
  const [scheduledAnime, setScheduledAnime] = useState<any[]>([]);
  const [unscheduledAnime, setUnscheduledAnime] = useState<any[]>([]);
  const [scheduledManga, setScheduledManga] = useState<any[]>([]);
  const [unscheduledManga, setUnscheduledManga] = useState<any[]>([]);

  const [userWorkMap, setUserWorkMap] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [isUnscheduledOpen, setIsUnscheduledOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDateString, setEditDateString] = useState("");

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
            // Compute next occurrence in the future
            const [hours, minutes] = over.weeklyTime.split(":").map(Number);
            const date = new Date();
            date.setHours(hours, minutes, 0, 0);
            const currentDay = date.getDay();

            let diff = over.weeklyDay - currentDay;
            if (diff < 0) diff += 7;

            // If diff is 0 (today) but the time has already passed, the next occurrence is next week
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
            // Shallow clone to inject the computed time safely
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

        // Sort by airing time so they appear in chronological order for the day
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
    // Convert unix timestamp to datetime-local string format YYYY-MM-DDTHH:mm
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

    // Refresh
    loadData();
  };

  const scheduledForCurrentType = contentType === "ANIME" ? scheduledAnime : scheduledManga;
  const unscheduledForCurrentType = contentType === "ANIME" ? unscheduledAnime : unscheduledManga;

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <CalendarIcon className="text-blue-500" />
          Release Kalender
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Zeigt nur Titel an, die in deiner Bibliothek als &quot;Aktiv&quot; markiert sind.
        </p>
      </div>

      {/* Anime / Manga switcher */}
      <div className="flex bg-[#1a1d24] p-1 rounded-xl border border-gray-800">
        <button
          type="button"
          onClick={() => setContentType("ANIME")}
          className={`flex-1 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
            contentType === "ANIME"
              ? "bg-blue-600 text-white shadow-md"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Anime ({scheduledAnime.length})
        </button>
        <button
          type="button"
          onClick={() => setContentType("MANGA")}
          className={`flex-1 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
            contentType === "MANGA"
              ? "bg-blue-600 text-white shadow-md"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Manga ({scheduledManga.length})
        </button>
      </div>

      {!isLoggedIn ? (
        <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-6 text-center text-gray-400">
          Bitte logge dich ein, um deinen Release-Kalender zu sehen.
        </div>
      ) : (
        <>
          {/* Schedule List */}
          <div className="flex flex-col gap-8">
            {isLoading ? (
              <div className="text-center text-gray-500 py-8 animate-pulse">Lade Kalender...</div>
            ) : scheduledForCurrentType.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-500 bg-[#1a1d24] border border-gray-800 rounded-xl border-dashed text-center">
                <Tv size={48} className="mb-4 text-gray-700" strokeWidth={1} />
                <p className="text-sm font-semibold text-gray-300">
                  Es erscheinen diese Woche keine neuen Folgen für {contentType === "ANIME" ? "Anime" : "Manga"}.
                </p>
                {unscheduledForCurrentType.length > 0 ? (
                  <p className="text-xs text-gray-400 mt-2 max-w-sm">
                    Hinweis: Du folgst {unscheduledForCurrentType.length} {contentType === "ANIME" ? "Anime" : "Manga"} auf &apos;Aktiv&apos;, für die noch kein Ausstrahlungstermin bekannt ist.
                  </p>
                ) : (
                  <p className="text-xs mt-2 text-gray-500">
                    Füge mehr aktuell laufende {contentType === "ANIME" ? "Anime" : "Manga"} hinzu!
                  </p>
                )}
              </div>
            ) : (
              DAYS.map((day) => {
                const dayList = scheduledForCurrentType.filter((item) => {
                  const date = new Date(item.nextAiringEpisode.airingAt * 1000);
                  return date.getDay() === day.value;
                });

                if (dayList.length === 0) return null;

                const isToday = new Date().getDay() === day.value;

                return (
                  <div
                    key={day.label}
                    className={`flex flex-col gap-4 ${
                      isToday
                        ? "bg-blue-900/10 -mx-4 px-4 py-4 rounded-xl border border-blue-900/50"
                        : ""
                    }`}
                  >
                    <h3
                      className={`text-lg font-bold pb-2 ${
                        isToday
                          ? "text-blue-400 border-b border-blue-900/50"
                          : "text-white border-b border-gray-800"
                      }`}
                    >
                      {day.label} {isToday ? "(Heute)" : ""}
                    </h3>
                    <div className="flex flex-col gap-4">
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

                        let displayTime = timeString;
                        if (item.rhythmType === "flexible" && item.flexibleDayRange) {
                          const minL = DAYS.find(
                            (d) => d.value === item.flexibleDayRange.minDay
                          )?.label;
                          const maxL = DAYS.find(
                            (d) => d.value === item.flexibleDayRange.maxDay
                          )?.label;
                          displayTime = `${minL} - ${maxL}`;
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

                        return (
                          <Link
                            href={`/work/${strId}`}
                            key={strId}
                            className="relative flex gap-4 p-3 bg-[#1a1d24] border border-gray-800 rounded-xl shadow-md hover:border-blue-500 transition-colors group overflow-hidden"
                          >
                            <div className="relative shrink-0">
                              <img
                                src={item.coverImage.large}
                                alt="Cover"
                                className="w-16 h-24 object-cover rounded-lg shadow-sm"
                              />
                              {behindCount > 0 && (
                                <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-bl-lg border-b border-l border-gray-800">
                                  {behindCount}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col justify-between flex-1 py-1">
                              <div>
                                <div className="flex justify-between items-start gap-2">
                                  <h3 className="font-bold text-sm text-gray-200 line-clamp-2 group-hover:text-blue-400 transition-colors">
                                    {item.title.english || item.title.romaji}
                                  </h3>
                                </div>
                                <p className="text-xs text-blue-400 font-semibold mt-1">
                                  {item.type === "MANGA" ? "Kapitel" : "Episode"} {displayEpisode}
                                </p>
                              </div>

                              {isEditing ? (
                                <div
                                  className="flex items-center gap-2 mt-2"
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
                              ) : (
                                <div className="flex justify-between items-end mt-3">
                                  <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-900 border border-gray-800">
                                      <Clock size={12} className="text-gray-400" />
                                      <span className="text-xs font-bold text-gray-300">
                                        {displayTime}
                                        {item.rhythmType === "flexible" ? "" : " Uhr"}
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-medium text-gray-500 bg-gray-900/50 px-2 py-1 rounded">
                                      {countdown}
                                    </span>
                                  </div>

                                  <button
                                    onClick={(e) => handleEditClick(item, e)}
                                    className="text-gray-500 hover:text-white transition p-1"
                                    title="Zeit korrigieren"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                </div>
                              )}
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
            <div className="border border-gray-800 rounded-xl bg-[#1a1d24]/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsUnscheduledOpen(!isUnscheduledOpen)}
                className="w-full flex items-center justify-between p-4 text-left font-bold text-sm text-gray-300 hover:text-white hover:bg-gray-800/40 transition-colors"
              >
                <span>
                  Werke ohne bekannten Release-Termin ({unscheduledForCurrentType.length})
                </span>
                <ChevronDown
                  size={18}
                  className={`text-gray-400 transition-transform duration-200 ${
                    isUnscheduledOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isUnscheduledOpen && (
                <div className="p-4 pt-1 border-t border-gray-800/60 flex flex-col gap-2">
                  <p className="text-xs text-gray-400 mb-2">
                    Diese Titel sind in deiner Bibliothek als &quot;Aktiv&quot; markiert, haben aktuell aber kein bekanntes Veröffentlichungsdatum.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {unscheduledForCurrentType.map((work: any) => {
                      const strId = work.id.toString();
                      const statusText = getUnscheduledStatusText(work.status);
                      return (
                        <Link
                          key={strId}
                          href={`/work/${strId}`}
                          className="flex items-center gap-3 p-2 bg-[#14161b] border border-gray-800 hover:border-blue-500/60 rounded-lg transition-colors group"
                        >
                          <img
                            src={work.coverImage?.medium || work.coverImage?.large}
                            alt={work.title?.english || work.title?.romaji || "Cover"}
                            className="w-10 h-14 object-cover rounded shrink-0 shadow-sm"
                          />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-bold text-gray-200 line-clamp-1 group-hover:text-blue-400 transition-colors">
                              {work.title?.english || work.title?.romaji}
                            </span>
                            <span className="text-[11px] text-gray-500 mt-1">
                              {statusText}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
