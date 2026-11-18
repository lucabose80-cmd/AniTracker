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
  resetScheduleOverride,
  setCalendarOverride,
} from "@/lib/db/calendar";
import {
  getPausedWorksMap,
  pauseWorkForWeeks,
  pauseWorkIndefinitely,
  pauseWorkUntil,
  unpauseWork,
  WorkPauseRecord,
} from "@/lib/db/pauses";
import { useAppStore } from "@/lib/store";
import {
  Calendar as CalendarIcon,
  Clock,
  Tv,
  Edit2,
  X,
  ChevronDown,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  SlidersHorizontal,
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

type ScheduleEditorMode = "WEEKLY" | "FLEXIBLE" | "EXACT" | "ANILIST";

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

  // Comprehensive Schedule & Pause Modal State
  const [modalWork, setModalWork] = useState<any | null>(null);
  const [editorMode, setEditorMode] = useState<ScheduleEditorMode>("WEEKLY");
  const [editorDay, setEditorDay] = useState<number>(1);
  const [editorTime, setEditorTime] = useState<string>("18:00");
  const [editorFreqWeeks, setEditorFreqWeeks] = useState<number>(1);
  const [editorStartDate, setEditorStartDate] = useState<string>("");
  const [editorFlexMinDay, setEditorFlexMinDay] = useState<number>(4);
  const [editorFlexMaxDay, setEditorFlexMaxDay] = useState<number>(0);
  const [editorExactDateTime, setEditorExactDateTime] = useState<string>("");
  const [editorAvailableEps, setEditorAvailableEps] = useState<number | "">("");
  const [customPauseDate, setCustomPauseDate] = useState<string>("");
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
    const strId = item.id.toString();
    const over = globalOverrides[strId];
    const uWork = userWorkMap[strId];

    // Determine initial editor mode
    let initialMode: ScheduleEditorMode = "WEEKLY";
    if (over?.rhythmType === "flexible") {
      initialMode = "FLEXIBLE";
    } else if (typeof over?.airingAt === "number" && over.airingAt > 0 && over.weeklyDay === undefined) {
      initialMode = "EXACT";
    } else if (over?.weeklyDay !== undefined) {
      initialMode = "WEEKLY";
    } else if (item.nextAiringEpisode?.airingAt) {
      initialMode = "WEEKLY";
    }

    const baseAiringSec =
      over?.airingAt ||
      item.releaseInfo?.airingAt ||
      item.nextAiringEpisode?.airingAt ||
      Math.floor(Date.now() / 1000) + 3600;
    const baseDate = new Date(baseAiringSec * 1000);

    setEditorMode(initialMode);
    setEditorDay(
      over?.weeklyDay !== undefined ? over.weeklyDay : baseDate.getDay()
    );
    setEditorTime(over?.weeklyTime || format(baseDate, "HH:mm"));
    setEditorFreqWeeks(Math.max(1, Number(over?.releaseFrequency) || 1));
    setEditorStartDate(over?.startDate || "");
    setEditorFlexMinDay(over?.flexibleDayRange?.minDay ?? 4);
    setEditorFlexMaxDay(over?.flexibleDayRange?.maxDay ?? 0);

    const localIso = new Date(
      baseDate.getTime() - baseDate.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 16);
    setEditorExactDateTime(localIso);

    const avail =
      over?.manualAvailableEps ??
      uWork?.manual_available_eps ??
      (item.releaseInfo?.availableEpisodes || "");
    setEditorAvailableEps(avail !== "" && avail !== undefined ? Number(avail) : "");
    setCustomPauseDate("");
    setModalWork(item);
  };

  const handleSaveScheduleModal = async () => {
    if (!modalWork || isSavingModal) return;
    const strId = modalWork.id.toString();
    setIsSavingModal(true);
    try {
      const availNum =
        editorAvailableEps === "" ? (null as any) : Number(editorAvailableEps);

      if (editorMode === "ANILIST") {
        await resetScheduleOverride(strId);
        if (editorAvailableEps !== "") {
          await setCalendarOverride(
            strId,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            Number(editorAvailableEps)
          );
        }
      } else if (editorMode === "EXACT") {
        const parsed = new Date(editorExactDateTime);
        const unixSec = Math.floor(parsed.getTime() / 1000);
        if (Number.isNaN(unixSec) || unixSec <= 0) {
          alert("Bitte ein gültiges Datum & Uhrzeit wählen.");
          setIsSavingModal(false);
          return;
        }
        await setCalendarOverride(
          strId,
          unixSec,
          null as any,
          null as any,
          undefined,
          editorFreqWeeks,
          availNum,
          undefined,
          editorStartDate || (null as any),
          "strict",
          null as any
        );
      } else if (editorMode === "FLEXIBLE") {
        await setCalendarOverride(
          strId,
          null as any,
          editorFlexMinDay,
          editorTime || "18:00",
          undefined,
          editorFreqWeeks,
          availNum,
          undefined,
          editorStartDate || (null as any),
          "flexible",
          { minDay: editorFlexMinDay, maxDay: editorFlexMaxDay }
        );
      } else {
        // WEEKLY / multi-week strict schedule
        await setCalendarOverride(
          strId,
          null as any,
          editorDay,
          editorTime || "18:00",
          undefined,
          editorFreqWeeks,
          availNum,
          undefined,
          editorStartDate || (null as any),
          "strict",
          null as any
        );
      }

      setModalWork(null);
      await loadData();
    } catch (err) {
      console.error("Failed to save schedule override:", err);
      alert("Fehler beim Speichern des Release-Rhythmus.");
    } finally {
      setIsSavingModal(false);
    }
  };

  const handleQuickPause = async (
    workId: string,
    mode: "1W" | "2W" | "4W" | "INDEFINITE" | "CUSTOM"
  ) => {
    const user = auth.currentUser;
    if (!user) return;
    setIsSavingModal(true);
    try {
      if (mode === "1W") {
        await pauseWorkForWeeks(workId, user.uid, 1);
      } else if (mode === "2W") {
        await pauseWorkForWeeks(workId, user.uid, 2);
      } else if (mode === "4W") {
        await pauseWorkForWeeks(workId, user.uid, 4);
      } else if (mode === "INDEFINITE") {
        await pauseWorkIndefinitely(workId, user.uid);
      } else if (mode === "CUSTOM") {
        if (!customPauseDate) {
          alert("Bitte ein Datum auswählen.");
          setIsSavingModal(false);
          return;
        }
        const untilDate = new Date(customPauseDate);
        untilDate.setHours(23, 59, 59, 999);
        await pauseWorkUntil(workId, user.uid, untilDate.toISOString());
      }
      await loadData();
    } catch (err) {
      console.error("Failed to pause work:", err);
      alert("Fehler beim Pausieren.");
    } finally {
      setIsSavingModal(false);
    }
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

  const handleResetToDefault = async (workId: string) => {
    setIsSavingModal(true);
    try {
      await Promise.all([
        resetScheduleOverride(workId),
        unpauseWork(workId).catch(() => {}),
      ]);
      setModalWork(null);
      await loadData();
    } catch (err) {
      console.error("Failed to reset schedule:", err);
    } finally {
      setIsSavingModal(false);
    }
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
                        const rInfo = item.releaseInfo;
                        const pauseInfo = pausedWorksMap[strId];

                        const currentEp = uWork?.current_episode || 0;
                        const displayEpisode =
                          rInfo?.nextEpisodeNumber ||
                          item.nextAiringEpisode.episode;
                        const behindCount = rInfo?.behindCount ?? 0;

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
                              {(behindCount > 0 ||
                                isToday ||
                                date.getTime() <= Date.now()) && (
                                <button
                                  type="button"
                                  disabled={!!updatingIds[strId]}
                                  onClick={(e) =>
                                    handleQuickIncrement(e, strId, currentEp)
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                                  title={`${unitShort} ${
                                    currentEp + 1
                                  } als gesehen markieren`}
                                >
                                  + {item.type === "MANGA" ? "Kap" : "Ep"}{" "}
                                  {currentEp + 1}
                                </button>
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

      {/* BULLET-PROOF RELEASE & PAUSE SETTINGS MODAL */}
      {modalWork && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setModalWork(null)}
        >
          <div
            className="w-full sm:max-w-md bg-[#161922] border border-gray-800 rounded-t-3xl sm:rounded-2xl p-4 pb-8 sm:pb-5 max-h-[90vh] overflow-y-auto flex flex-col gap-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={
                    modalWork.coverImage?.medium || modalWork.coverImage?.large
                  }
                  alt="Cover"
                  className="w-10 h-14 object-cover rounded-lg shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    {modalWork.title?.english || modalWork.title?.romaji}
                  </h3>
                  <p className="text-xs text-gray-400">
                    Release-Rhythmus, Timer &amp; Pause verwalten
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalWork(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {/* QUICK PAUSE & UNPAUSE SECTION */}
            {(() => {
              const strId = modalWork.id.toString();
              const activePause = pausedWorksMap[strId];
              return (
                <div className="bg-[#10131a] border border-gray-800 rounded-xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <PauseCircle size={14} />
                      Werk pausieren / Pause korrigieren
                    </span>
                    {activePause && (
                      <span className="text-[11px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/30">
                        {formatPauseStatusLabel(activePause.paused_until)}
                      </span>
                    )}
                  </div>

                  {activePause && (
                    <button
                      type="button"
                      disabled={isSavingModal}
                      onClick={() => handleQuickUnpause(strId)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                    >
                      <PlayCircle size={15} />
                      Pause sofort aufheben (Werk läuft normal weiter)
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isSavingModal}
                      onClick={() => handleQuickPause(strId, "1W")}
                      className="py-1.5 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      1 Woche Pause
                    </button>
                    <button
                      type="button"
                      disabled={isSavingModal}
                      onClick={() => handleQuickPause(strId, "2W")}
                      className="py-1.5 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      2 Wochen Pause
                    </button>
                    <button
                      type="button"
                      disabled={isSavingModal}
                      onClick={() => handleQuickPause(strId, "4W")}
                      className="py-1.5 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      4 Wochen Pause
                    </button>
                    <button
                      type="button"
                      disabled={isSavingModal}
                      onClick={() => handleQuickPause(strId, "INDEFINITE")}
                      className="py-1.5 px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-semibold transition"
                    >
                      Hiatus / Unbestimmt
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 pt-0.5">
                    <input
                      type="date"
                      value={customPauseDate}
                      onChange={(e) => setCustomPauseDate(e.target.value)}
                      className="flex-1 bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      disabled={!customPauseDate || isSavingModal}
                      onClick={() => handleQuickPause(strId, "CUSTOM")}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-bold transition shrink-0"
                    >
                      Pausieren bis Datum
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* SCHEDULE MODE TABS */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-300">
                Release-Modus auswählen
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-[#10131a] p-1.5 rounded-xl border border-gray-800">
                {(
                  [
                    {
                      id: "WEEKLY",
                      label: "Fester Tag & Takt",
                      desc: "Jede / Alle X Wochen",
                    },
                    {
                      id: "FLEXIBLE",
                      label: "Ungefähr (Manga)",
                      desc: "Zeitfenster z.B. Do–So",
                    },
                    {
                      id: "EXACT",
                      label: "Genauer Timer",
                      desc: "Exaktes Startdatum & Uhrzeit",
                    },
                    {
                      id: "ANILIST",
                      label: "AniList Standard",
                      desc: "Automatisch von AniList",
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setEditorMode(tab.id)}
                    className={`flex flex-col items-start p-2 rounded-lg text-left transition border ${
                      editorMode === tab.id
                        ? "bg-blue-600/25 border-blue-500 text-white"
                        : "bg-transparent border-transparent text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <span className="text-xs font-bold">{tab.label}</span>
                    <span className="text-[10px] text-gray-400">
                      {tab.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* MODE-SPECIFIC CONFIGURATION */}
            {editorMode === "WEEKLY" && (
              <div className="bg-[#10131a] border border-gray-800 rounded-xl p-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Wochentag
                    </label>
                    <select
                      value={editorDay}
                      onChange={(e) => setEditorDay(Number(e.target.value))}
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      {DAYS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Uhrzeit
                    </label>
                    <input
                      type="time"
                      value={editorTime}
                      onChange={(e) => setEditorTime(e.target.value)}
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Abstand (Alle X Wochen)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={editorFreqWeeks}
                        onChange={(e) =>
                          setEditorFreqWeeks(
                            Math.max(
                              1,
                              Math.min(52, parseInt(e.target.value, 10) || 1)
                            )
                          )
                        }
                        className="w-16 bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs font-bold text-white text-center focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-xs text-gray-400">
                        {editorFreqWeeks === 1
                          ? "Wöchentlich"
                          : `Alle ${editorFreqWeeks} Wochen`}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Nächster/Erster Release (Anker)
                    </label>
                    <input
                      type="date"
                      value={editorStartDate}
                      onChange={(e) => setEditorStartDate(e.target.value)}
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {editorMode === "FLEXIBLE" && (
              <div className="bg-[#10131a] border border-gray-800 rounded-xl p-3 flex flex-col gap-3">
                <p className="text-[11px] text-gray-400">
                  Perfekt für Mangas, die keinen sekundengenauen Release haben
                  (z. B. zwischen Donnerstag und Sonntag).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Frühestens ab
                    </label>
                    <select
                      value={editorFlexMinDay}
                      onChange={(e) =>
                        setEditorFlexMinDay(Number(e.target.value))
                      }
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      {DAYS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Spätestens bis
                    </label>
                    <select
                      value={editorFlexMaxDay}
                      onChange={(e) =>
                        setEditorFlexMaxDay(Number(e.target.value))
                      }
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      {DAYS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Abstand (Alle X Wochen)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={52}
                      value={editorFreqWeeks}
                      onChange={(e) =>
                        setEditorFreqWeeks(
                          Math.max(
                            1,
                            Math.min(52, parseInt(e.target.value, 10) || 1)
                          )
                        )
                      }
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Startwoche / Anker (Optional)
                    </label>
                    <input
                      type="date"
                      value={editorStartDate}
                      onChange={(e) => setEditorStartDate(e.target.value)}
                      className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {editorMode === "EXACT" && (
              <div className="bg-[#10131a] border border-gray-800 rounded-xl p-3 flex flex-col gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                    Exakter nächster Release (Datum &amp; Uhrzeit)
                  </label>
                  <input
                    type="datetime-local"
                    value={editorExactDateTime}
                    onChange={(e) => setEditorExactDateTime(e.target.value)}
                    className="w-full bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                    Danach automatisch weiterzählen im Abstand von (Wochen)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={editorFreqWeeks}
                    onChange={(e) =>
                      setEditorFreqWeeks(
                        Math.max(
                          1,
                          Math.min(52, parseInt(e.target.value, 10) || 1)
                        )
                      )
                    }
                    className="w-24 bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {/* Bisher erschienene Kapitel / Folgen */}
            <div className="bg-[#10131a] border border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-gray-300">
                  Bisher erschienen (
                  {modalWork.type === "MANGA" ? "Kapitel" : "Folgen"})
                </span>
                <span className="text-[10px] text-gray-500">
                  Bestimmt die nächste erwartete Nummer im Kalender
                </span>
              </div>
              <input
                type="number"
                min={0}
                placeholder="Auto"
                value={editorAvailableEps}
                onChange={(e) =>
                  setEditorAvailableEps(
                    e.target.value === "" ? "" : parseInt(e.target.value, 10)
                  )
                }
                className="w-20 bg-[#161922] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white text-center focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* FOOTER ACTIONS (incl. 1-click Reset on misconfiguration) */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={isSavingModal}
                onClick={() =>
                  handleResetToDefault(modalWork.id.toString())
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-gray-300 hover:text-rose-300 border border-white/10 text-xs font-semibold transition"
                title="Alle manuellen Kalender- & Pause-Einstellungen für dieses Werk zurücksetzen"
              >
                <RotateCcw size={13} />
                Auf Standard zurücksetzen
              </button>

              <button
                type="button"
                disabled={isSavingModal}
                onClick={handleSaveScheduleModal}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-lg"
              >
                {isSavingModal ? "Speichert..." : "Speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

