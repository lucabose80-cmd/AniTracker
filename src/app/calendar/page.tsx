"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { getAllUserWorks, updateEpisodeProgress } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import {
  CalendarOverride,
  ComputedWorkReleaseInfo,
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
import { UserWork } from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import { toast } from "@/lib/ui-feedback";
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

interface ScheduledCalendarEntry {
  media: AniListMedia;
  releaseInfo: ComputedWorkReleaseInfo;
  airingAt: number;
}

interface UnscheduledCalendarEntry {
  media: AniListMedia;
  releaseInfo: ComputedWorkReleaseInfo;
}

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
  const contentType = useAppStore((s) => s.contentType);
  const reloadTrigger = useAppStore((s) => s.reloadTrigger);

  const [scheduledAnime, setScheduledAnime] = useState<
    ScheduledCalendarEntry[]
  >([]);
  const [unscheduledAnime, setUnscheduledAnime] = useState<
    UnscheduledCalendarEntry[]
  >([]);
  const [scheduledManga, setScheduledManga] = useState<
    ScheduledCalendarEntry[]
  >([]);
  const [unscheduledManga, setUnscheduledManga] = useState<
    UnscheduledCalendarEntry[]
  >([]);
  const [allMediaById, setAllMediaById] = useState<
    Record<string, AniListMedia>
  >({});

  const [userWorkMap, setUserWorkMap] = useState<Record<string, UserWork>>({});
  const [globalOverrides, setGlobalOverrides] = useState<
    Record<string, CalendarOverride>
  >({});
  const [pausedWorksMap, setPausedWorksMap] = useState<
    Record<string, WorkPauseRecord>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [selectedDayFilter, setSelectedDayFilter] = useState<number | "ALL">(
    "ALL"
  );
  const [isUnscheduledOpen, setIsUnscheduledOpen] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});
  const [modalWork, setModalWork] = useState<AniListMedia | null>(null);
  const [isSavingModal, setIsSavingModal] = useState(false);

  const loadData = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setIsLoggedIn(false);
      setScheduledAnime([]);
      setUnscheduledAnime([]);
      setScheduledManga([]);
      setUnscheduledManga([]);
      setAllMediaById({});
      setUserWorkMap({});
      setGlobalOverrides({});
      setPausedWorksMap({});
      setIsLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setIsLoading(true);
    try {
      const works = await getAllUserWorks(user.uid);
      const activeWorks = works.filter((w) => w.status === "CURRENT");
      const ids = activeWorks
        .map((w) => parseInt(w.work_id, 10))
        .filter((n) => !Number.isNaN(n) && n > 0);

      const map: Record<string, UserWork> = {};
      activeWorks.forEach((w) => {
        map[w.work_id] = w;
      });
      setUserWorkMap(map);

      const freshNowMs = Date.now();
      setNowMs(freshNowMs);

      if (ids.length > 0) {
        const [mediaList, overrides, pauses] = await Promise.all([
          fetchAniListBatch(ids),
          getCalendarOverrides(),
          getPausedWorksMap().catch(
            (): Record<string, WorkPauseRecord> => ({})
          ),
        ]);
        setGlobalOverrides(overrides);
        setPausedWorksMap(pauses);

        const mediaMap: Record<string, AniListMedia> = {};
        const scheduledA: ScheduledCalendarEntry[] = [];
        const unscheduledA: UnscheduledCalendarEntry[] = [];
        const scheduledM: ScheduledCalendarEntry[] = [];
        const unscheduledM: UnscheduledCalendarEntry[] = [];

        // IMPORTANT: Keep raw AniListMedia unmodified (never overwrite nextAiringEpisode)
        // so computeWorkReleaseInfo never double-subtracts Dub offsets!
        mediaList.forEach((m) => {
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
            nowMs: freshNowMs,
          });

          if (releaseInfo.hasSchedule && releaseInfo.airingAt) {
            const entry: ScheduledCalendarEntry = {
              media: m,
              releaseInfo,
              airingAt: releaseInfo.airingAt,
            };
            if (m.type === "ANIME") {
              scheduledA.push(entry);
            } else if (m.type === "MANGA") {
              scheduledM.push(entry);
            }
          } else {
            const entry: UnscheduledCalendarEntry = {
              media: m,
              releaseInfo,
            };
            if (m.type === "ANIME") {
              unscheduledA.push(entry);
            } else if (m.type === "MANGA") {
              unscheduledM.push(entry);
            }
          }
        });

        scheduledA.sort((a, b) => a.airingAt - b.airingAt);
        scheduledM.sort((a, b) => a.airingAt - b.airingAt);

        unscheduledA.sort((a, b) =>
          getAniListTitle(a.media).localeCompare(getAniListTitle(b.media), "de")
        );
        unscheduledM.sort((a, b) =>
          getAniListTitle(a.media).localeCompare(getAniListTitle(b.media), "de")
        );

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
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      loadData();
    });
    return () => unsubscribe();
  }, [pathname, reloadTrigger, loadData]);

  const openScheduleModal = (media: AniListMedia, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setModalWork(media);
  };

  const handleQuickUnpause = async (workId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isSavingModal) return;
    setIsSavingModal(true);
    try {
      await unpauseWork(workId);
      await loadData();
      toast.success("Pause aufgehoben.");
    } catch (err) {
      console.error("Failed to unpause work:", err);
      toast.error("Fehler beim Aufheben der Pause.");
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

    const prevWork = userWorkMap[strId];
    setUserWorkMap((prev) => ({
      ...prev,
      [strId]: {
        ...(prev[strId] || ({
          work_id: strId,
          user_id: user.uid,
          status: "CURRENT",
          current_episode: currentEp,
          priority_tier: 2,
          sync_offset_days: 0,
          selected_platform: "",
          adaptationScores: { story: 0, pacing: 0 },
          classification: {
            watchMode: "SUB",
            romanceLevel: 0,
            confessionTiming: "",
            intimacyLevel: 0,
            relationshipDynamics: "",
            wholesomeLewdScale: 0,
            comedySeriousScale: 0,
            actionDialogScale: 0,
            pacingScale: 0,
          },
          evaluation: {
            plotAndStory: 0,
            castAndCharacters: 0,
            sideCharacters: 0,
            ending: 0,
            artstyleAndAnimation: 0,
            introOutro: 0,
            voiceActing: 0,
            romanceAndChemistry: 0,
            bingeFactor: 0,
            emotionalImpact: "None",
            comments: "",
            overallScore: 0,
          },
        } as UserWork)),
        current_episode: nextEp,
      },
    }));
    setUpdatingIds((prev) => ({ ...prev, [strId]: true }));

    try {
      await updateEpisodeProgress(user.uid, strId, nextEp);
    } catch (err) {
      console.error("Fehler beim Aktualisieren des Fortschritts:", err);
      toast.error("Fortschritt konnte nicht gespeichert werden.");
      if (prevWork) {
        setUserWorkMap((prev) => ({
          ...prev,
          [strId]: prevWork,
        }));
      }
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [strId]: false }));
    }
  };

  const scheduledForCurrentType =
    contentType === "ANIME" ? scheduledAnime : scheduledManga;
  const unscheduledForCurrentType =
    contentType === "ANIME" ? unscheduledAnime : unscheduledManga;

  const pausedWorksForCurrentType = useMemo(() => {
    return Object.values(pausedWorksMap)
      .map((p) => {
        const media = allMediaById[p.work_id];
        if (!media || media.type !== contentType) return null;
        return { pause: p, media };
      })
      .filter(
        (x): x is { pause: WorkPauseRecord; media: AniListMedia } => x !== null
      );
  }, [pausedWorksMap, allMediaById, contentType]);

  const todayDay = new Date(nowMs).getDay();
  const tomorrowDay = (todayDay + 1) % 7;

  const orderedDays = useMemo(() => {
    const startIdx = DAYS.findIndex((d) => d.value === todayDay);
    if (startIdx === -1) return DAYS;
    return [...DAYS.slice(startIdx), ...DAYS.slice(0, startIdx)];
  }, [todayDay]);

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
    scheduledForCurrentType.forEach((entry) => {
      const d = new Date(entry.airingAt * 1000).getDay();
      counts[d] = (counts[d] || 0) + 1;
    });
    return counts;
  }, [scheduledForCurrentType]);

  const visibleDays = useMemo(() => {
    if (selectedDayFilter === "ALL") return orderedDays;
    return orderedDays.filter((d) => d.value === selectedDayFilter);
  }, [orderedDays, selectedDayFilter]);

  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-4 max-w-2xl mx-auto">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <CalendarIcon className="text-accent-text" size={20} />
            Wochenplan ({contentType === "MANGA" ? "Manga" : "Anime"})
          </h2>
          <p className="text-xs text-gray-400">
            Deine aktiven Releases, sortiert ab heute
          </p>
        </div>

        <span className="text-xs font-semibold text-gray-400 bg-surface-elevated border border-gray-800 px-3 py-1 rounded-full shrink-0">
          {scheduledForCurrentType.length} geplant
        </span>
      </div>

      {!isLoggedIn ? (
        <div className="bg-surface-elevated border border-gray-800 rounded-xl p-6 text-center text-gray-400 flex flex-col items-center gap-3">
          <p className="text-sm">
            Bitte logge dich ein, um deinen Release-Kalender zu sehen.
          </p>
          <Link
            href="/login"
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition"
          >
            Jetzt anmelden
          </Link>
        </div>
      ) : (
        <>
          {/* PAUSED WORKS BAR */}
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
                  const cover =
                    media.coverImage?.medium || media.coverImage?.large || "";
                  return (
                    <div
                      key={`paused-${strId}`}
                      className="flex items-center justify-between gap-2 bg-surface/90 border border-amber-500/20 rounded-xl p-2"
                    >
                      <Link
                        href={`/work/${strId}`}
                        className="flex items-center gap-2.5 min-w-0 flex-1"
                      >
                        {cover ? (
                          <img
                            src={cover}
                            alt="Cover"
                            className="w-8 h-11 object-cover rounded shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-11 rounded bg-gray-800 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">
                            {getAniListTitle(media)}
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
                          disabled={isSavingModal}
                          onClick={(e) => handleQuickUnpause(strId, e)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-200 hover:text-black border border-amber-500/40 text-xs font-bold transition disabled:opacity-50"
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
                  ? "bg-accent border-accent-border-strong text-white"
                  : "bg-surface-elevated border-gray-800 text-gray-400 hover:text-white"
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
                      ? "bg-accent border-accent-border-strong text-white"
                      : isToday
                      ? "bg-accent-soft border-accent-border text-accent-light"
                      : count > 0
                      ? "bg-surface-elevated border-gray-800 text-gray-200 hover:text-white"
                      : "bg-surface-elevated/50 border-gray-800/50 text-gray-500"
                  }`}
                >
                  <span>{isToday ? `Heute (${day.short})` : day.short}</span>
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full leading-none ${
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
              <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-500 bg-surface-elevated border border-gray-800 rounded-xl border-dashed text-center">
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
                const dayList = scheduledForCurrentType.filter((entry) => {
                  const date = new Date(entry.airingAt * 1000);
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
                        ? "bg-accent-tint border-accent-border"
                        : "bg-surface border-gray-800/80"
                    }`}
                  >
                    {/* Day Section Header */}
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className={`text-sm font-bold ${
                            isToday ? "text-accent-text" : "text-white"
                          }`}
                        >
                          {day.label}
                        </h3>
                        {isToday && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent text-white">
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
                      {dayList.map((entry) => {
                        const rawMedia = entry.media;
                        const strId = rawMedia.id.toString();
                        const uWork = userWorkMap[strId];
                        const pauseInfo = pausedWorksMap[strId];
                        // Compute against RAW unmodified media (no double subtraction!)
                        const rInfo = computeWorkReleaseInfo({
                          media: rawMedia,
                          override: globalOverrides[strId],
                          pauseInfo,
                          userWork: uWork,
                          nowMs,
                        });

                        const airingAt = rInfo.airingAt || entry.airingAt;
                        const date = new Date(airingAt * 1000);
                        const currentEp = uWork?.current_episode || 0;
                        const displayEpisode = rInfo.nextEpisodeNumber;
                        const behindCount = rInfo.behindCount;
                        const maxAllowed = rInfo.maxAllowedProgress;
                        const canIncrement =
                          behindCount > 0 &&
                          (maxAllowed === null || currentEp < maxAllowed);

                        const timeString = format(date, "HH:mm");
                        const dateLabel = format(date, "dd.MM.", { locale: de });
                        const countdown = formatDistanceToNow(date, {
                          addSuffix: true,
                          locale: de,
                        });

                        const displayTime =
                          rInfo.isFlexible && rInfo.flexibleRangeLabel
                            ? rInfo.flexibleRangeLabel
                            : `${timeString} Uhr`;

                        const isFutureWeek =
                          date.getTime() - nowMs > 7 * 24 * 3600 * 1000;
                        const freqWeeks = rInfo.frequencyWeeks || 1;
                        const unitShort =
                          rawMedia.type === "MANGA" ? "Kap." : "Folge";
                        const cover =
                          rawMedia.coverImage?.large ||
                          rawMedia.coverImage?.extraLarge ||
                          rawMedia.coverImage?.medium ||
                          "";

                        return (
                          <Link
                            href={`/work/${strId}`}
                            key={strId}
                            className="flex items-center gap-3 p-2.5 bg-surface-elevated border border-gray-800/90 hover:border-accent-border-strong rounded-xl transition-colors group"
                          >
                            {/* Cover */}
                            <div className="relative shrink-0">
                              {cover ? (
                                <img
                                  src={cover}
                                  alt="Cover"
                                  className="w-12 h-16 object-cover rounded-lg bg-gray-800"
                                />
                              ) : (
                                <div className="w-12 h-16 rounded-lg bg-gray-800" />
                              )}
                              {behindCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none rounded-full shadow">
                                  {behindCount}
                                </span>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-semibold text-sm text-white truncate group-hover:text-accent-light transition-colors">
                                  {getAniListTitle(rawMedia)}
                                </h4>
                                {freqWeeks > 1 && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 leading-none rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    Alle {freqWeeks} Wo.
                                  </span>
                                )}
                                {rInfo.isStaggeredDubEnding && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 leading-none rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                    Dub-Nachlauf · noch{" "}
                                    {rInfo.dubRemainingEpisodes}
                                  </span>
                                )}
                                {pauseInfo && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 leading-none rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    {formatPauseStatusLabel(
                                      pauseInfo.paused_until
                                    )}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center flex-wrap gap-2 text-xs">
                                <span className="font-bold text-accent-text">
                                  {rawMedia.type === "MANGA"
                                    ? "Nächstes:"
                                    : "Nächste:"}{" "}
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
                                  className="px-2.5 py-1.5 rounded-lg bg-accent-soft hover:bg-accent text-accent-light hover:text-white border border-accent-border text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                                  title={`${unitShort} ${
                                    currentEp + 1
                                  } als gesehen markieren`}
                                >
                                  + {rawMedia.type === "MANGA" ? "Kap" : "Ep"}{" "}
                                  {currentEp + 1}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-soft text-accent-light/90 border border-accent-border text-[11px] font-semibold whitespace-nowrap">
                                  <Check size={12} />
                                  Aktuell
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => openScheduleModal(rawMedia, e)}
                                className="text-gray-400 hover:text-white transition p-1.5 rounded-lg bg-white/5 hover:bg-gray-800 border border-white/5"
                                title="Release-Zeit, Dub-Versatz, Rhythmus oder Pause einstellen"
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
            <div className="border border-gray-800 rounded-2xl bg-surface-elevated/60 overflow-hidden">
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
                  {unscheduledForCurrentType.map(({ media: work }) => {
                    const strId = work.id.toString();
                    const pauseInfo = pausedWorksMap[strId];
                    const statusText = pauseInfo
                      ? formatPauseStatusLabel(pauseInfo.paused_until)
                      : getUnscheduledStatusText(work.status);
                    const cover =
                      work.coverImage?.medium || work.coverImage?.large || "";
                    return (
                      <Link
                        key={strId}
                        href={`/work/${strId}`}
                        className="flex items-center gap-2.5 p-2 bg-surface border border-gray-800 hover:border-accent-border-strong rounded-xl transition-colors group"
                      >
                        {cover ? (
                          <img
                            src={cover}
                            alt={getAniListTitle(work, "Cover")}
                            className="w-9 h-12 object-cover rounded-lg shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-12 rounded-lg bg-gray-800 shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold text-gray-200 truncate group-hover:text-accent-light transition-colors">
                            {getAniListTitle(work)}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {statusText}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => openScheduleModal(work, e)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-accent-soft text-gray-400 hover:text-accent-light transition shrink-0"
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
            current_episode:
              userWorkMap[modalWork.id.toString()]?.current_episode,
            status: userWorkMap[modalWork.id.toString()]?.status,
            synchro_offset_episodes:
              userWorkMap[modalWork.id.toString()]?.synchro_offset_episodes,
            sync_offset_days:
              userWorkMap[modalWork.id.toString()]?.sync_offset_days,
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
