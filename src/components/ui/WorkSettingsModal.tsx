"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  PauseCircle,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { auth } from "@/lib/firebase";
import {
  CalendarOverride,
  clearManualMaxEpisode,
  computeWorkReleaseInfo,
  formatPauseStatusLabel,
  parseLocalDate,
  resetScheduleOverride,
  setCalendarOverride,
} from "@/lib/db/calendar";
import {
  INDEFINITE_PAUSE_UNTIL,
  WorkPauseRecord,
  getEndOfWeeksFromNow,
  pauseWorkForWeeks,
  pauseWorkIndefinitely,
  pauseWorkUntil,
  unpauseWork,
} from "@/lib/db/pauses";
import { saveUserWork } from "@/lib/db/works";
import { toast } from "@/lib/ui-feedback";
import { AniListDate, AniListMedia } from "@/types/anilist";

export type WorkSettingsTab = "LIMITS" | "SCHEDULE" | "PAUSE";
type ScheduleEditorMode = "WEEKLY" | "FLEXIBLE" | "EXACT" | "ANILIST";

const DAYS = [
  { value: 1, label: "Montag", short: "Mo" },
  { value: 2, label: "Dienstag", short: "Di" },
  { value: 3, label: "Mittwoch", short: "Mi" },
  { value: 4, label: "Donnerstag", short: "Do" },
  { value: 5, label: "Freitag", short: "Fr" },
  { value: 6, label: "Samstag", short: "Sa" },
  { value: 0, label: "Sonntag", short: "So" },
];

export interface WorkSettingsSaveResult {
  manualMaxEpisode: number | "";
  manualAvailableEps: number | "";
  synchroOffset: number | "";
  syncOffsetDays: number;
  hasCustomOverride: boolean;
  isPaused: boolean;
  pausedUntil: string;
}

export interface WorkSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workId: string;
  work: {
    id?: number;
    title?: {
      english?: string | null;
      romaji?: string | null;
      native?: string | null;
    };
    coverImage?: {
      large?: string | null;
      extraLarge?: string | null;
      medium?: string | null;
    };
    type?: string;
    status?: string;
    episodes?: number | null;
    chapters?: number | null;
    endDate?: AniListDate | null;
    nextAiringEpisode?: { episode?: number; airingAt?: number } | null;
  };
  override?: CalendarOverride;
  pauseInfo?: WorkPauseRecord | null;
  userWork?: {
    inLibrary?: boolean;
    current_episode?: number;
    status?: string;
    synchro_offset_episodes?: number;
    sync_offset_days?: number;
    manual_available_eps?: number | null;
  } | null;
  initialTab?: WorkSettingsTab;
  onSaved?: (result: WorkSettingsSaveResult) => void | Promise<void>;
}

function WeekdayPillPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (day: number) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {DAYS.map((d) => {
        const active = value === d.value;
        return (
          <button
            key={d.value}
            type="button"
            onClick={() => onChange(d.value)}
            title={d.label}
            className={`py-2 rounded-lg text-[11px] font-bold border transition ${
              active
                ? "bg-accent border-accent-border-strong text-white shadow-sm"
                : "bg-surface-control border-gray-700/80 text-gray-400 hover:text-white hover:border-gray-600"
            }`}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

function computeInitialModalState(
  workId: string,
  work: WorkSettingsModalProps["work"],
  override: CalendarOverride | undefined,
  pauseInfo: WorkPauseRecord | null | undefined,
  userWork: WorkSettingsModalProps["userWork"]
) {
  const isManga = work?.type === "MANGA";
  const rawTotal = isManga ? work?.chapters : work?.episodes;
  const aniListTotal =
    typeof rawTotal === "number" && rawTotal > 0 ? rawTotal : null;

  const manualMaxEpisode: number | "" =
    override?.manualMaxEpisode != null && Number(override.manualMaxEpisode) > 0
      ? Number(override.manualMaxEpisode)
      : "";

  const loadedMax = manualMaxEpisode !== "" ? manualMaxEpisode : aniListTotal;
  const rawAvail =
    override?.manualAvailableEps ?? userWork?.manual_available_eps ?? null;
  let manualAvailableEps: number | "" = "";
  if (rawAvail !== null && rawAvail !== undefined) {
    manualAvailableEps =
      loadedMax !== null
        ? Math.min(Math.max(0, Number(rawAvail)), loadedMax)
        : Math.max(0, Number(rawAvail));
  }

  const synchroOffset: number | "" =
    typeof userWork?.synchro_offset_episodes === "number"
      ? userWork.synchro_offset_episodes
      : 0;
  const syncOffsetDays: number =
    typeof userWork?.sync_offset_days === "number"
      ? userWork.sync_offset_days
      : 0;

  const rInfo = computeWorkReleaseInfo({
    media: {
      id: work?.id ?? (parseInt(workId, 10) || 0),
      type: (work?.type as AniListMedia["type"]) || "ANIME",
      status: work?.status,
      episodes: work?.episodes,
      chapters: work?.chapters,
      endDate: work?.endDate,
      nextAiringEpisode: work?.nextAiringEpisode
        ? {
            episode: work.nextAiringEpisode.episode ?? 1,
            airingAt: work.nextAiringEpisode.airingAt ?? 0,
          }
        : null,
    },
    override,
    pauseInfo,
  });

  let editorMode: ScheduleEditorMode = "ANILIST";
  if (override?.rhythmType === "flexible") {
    editorMode = "FLEXIBLE";
  } else if (
    typeof override?.airingAt === "number" &&
    override.airingAt > 0 &&
    override.weeklyDay === undefined
  ) {
    editorMode = "EXACT";
  } else if (override?.weeklyDay !== undefined) {
    editorMode = "WEEKLY";
  }

  const baseAiringSec =
    override?.airingAt ||
    rInfo.airingAt ||
    work?.nextAiringEpisode?.airingAt ||
    Math.floor(Date.now() / 1000) + 3600;
  const baseDate = new Date(baseAiringSec * 1000);

  const localIso = new Date(
    baseDate.getTime() - baseDate.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);

  return {
    manualMaxEpisode,
    manualAvailableEps,
    synchroOffset,
    syncOffsetDays,
    editorMode,
    editorDay:
      override?.weeklyDay !== undefined ? override.weeklyDay : baseDate.getDay(),
    editorTime: override?.weeklyTime || format(baseDate, "HH:mm"),
    editorFreqWeeks: Math.max(1, Number(override?.releaseFrequency) || 1),
    editorStartDate: override?.startDate || "",
    editorFlexMinDay: override?.flexibleDayRange?.minDay ?? 4,
    editorFlexMaxDay: override?.flexibleDayRange?.maxDay ?? 0,
    editorExactDateTime: localIso,
    localPause: pauseInfo || null,
  };
}

export function WorkSettingsModal(props: WorkSettingsModalProps) {
  if (!props.isOpen) return null;
  return (
    <WorkSettingsModalContent
      key={`${props.workId}_${props.initialTab || "LIMITS"}`}
      {...props}
    />
  );
}

function WorkSettingsModalContent({
  onClose,
  workId,
  work,
  override,
  pauseInfo,
  userWork,
  initialTab = "LIMITS",
  onSaved,
}: WorkSettingsModalProps) {
  const isManga = work?.type === "MANGA";
  const unitPlural = isManga ? "Kapitel" : "Folgen";
  const title =
    work?.title?.english ||
    work?.title?.romaji ||
    work?.title?.native ||
    `Werk #${workId}`;
  const cover =
    work?.coverImage?.large ||
    work?.coverImage?.extraLarge ||
    work?.coverImage?.medium ||
    "";

  const [initial] = useState(() =>
    computeInitialModalState(workId, work, override, pauseInfo, userWork)
  );

  const [activeTab, setActiveTab] = useState<WorkSettingsTab>(initialTab);
  const [isSaving, setIsSaving] = useState(false);

  // Tab 1: Limits & Available Count + Personal Dub Offset
  const [manualMaxEpisode, setManualMaxEpisode] = useState<number | "">(
    initial.manualMaxEpisode
  );
  const [manualAvailableEps, setManualAvailableEps] = useState<number | "">(
    initial.manualAvailableEps
  );
  const [synchroOffset, setSynchroOffset] = useState<number | "">(
    initial.synchroOffset
  );
  const [syncOffsetDays, setSyncOffsetDays] = useState<number>(
    initial.syncOffsetDays
  );

  // Tab 2: Release Schedule
  const [editorMode, setEditorMode] = useState<ScheduleEditorMode>(
    initial.editorMode
  );
  const [editorDay, setEditorDay] = useState<number>(initial.editorDay);
  const [editorTime, setEditorTime] = useState<string>(initial.editorTime);
  const [editorFreqWeeks, setEditorFreqWeeks] = useState<number>(
    initial.editorFreqWeeks
  );
  const [editorStartDate, setEditorStartDate] = useState<string>(
    initial.editorStartDate
  );
  const [editorFlexMinDay, setEditorFlexMinDay] = useState<number>(
    initial.editorFlexMinDay
  );
  const [editorFlexMaxDay, setEditorFlexMaxDay] = useState<number>(
    initial.editorFlexMaxDay
  );
  const [editorExactDateTime, setEditorExactDateTime] = useState<string>(
    initial.editorExactDateTime
  );

  // Tab 3: Pause
  const [localPause, setLocalPause] = useState<WorkPauseRecord | null>(
    initial.localPause
  );
  const [customPauseDate, setCustomPauseDate] = useState<string>("");

  const aniListTotal = useMemo(() => {
    const raw = isManga ? work?.chapters : work?.episodes;
    return typeof raw === "number" && raw > 0 ? raw : null;
  }, [isManga, work?.chapters, work?.episodes]);

  const effectiveMax = useMemo(() => {
    if (manualMaxEpisode !== "" && Number(manualMaxEpisode) > 0) {
      return Number(manualMaxEpisode);
    }
    return aniListTotal;
  }, [manualMaxEpisode, aniListTotal]);

  const isPauseActive = useMemo(() => {
    return Boolean(
      localPause?.paused &&
        localPause.paused_until &&
        localPause.paused_until > new Date().toISOString()
    );
  }, [localPause]);

  // Live preview of Dub staggered ending / schedule based on currently entered inputs
  const dubPreviewInfo = useMemo(() => {
    if (isManga || !userWork?.inLibrary) return null;
    const numericOffset =
      synchroOffset === "" ? 0 : Math.max(0, Number(synchroOffset));
    if (numericOffset <= 0 && syncOffsetDays === 0) return null;

    const previewMedia: AniListMedia = {
      id: work?.id ?? (parseInt(workId, 10) || 0),
      type: (work?.type as AniListMedia["type"]) || "ANIME",
      status: work?.status,
      episodes: work?.episodes,
      chapters: work?.chapters,
      endDate: work?.endDate,
      nextAiringEpisode: work?.nextAiringEpisode
        ? {
            episode: work.nextAiringEpisode.episode ?? 1,
            airingAt: work.nextAiringEpisode.airingAt ?? 0,
          }
        : null,
    };

    return computeWorkReleaseInfo({
      media: previewMedia,
      override: {
        ...(override || { work_id: workId }),
        ...(manualMaxEpisode !== ""
          ? { manualMaxEpisode: Number(manualMaxEpisode) }
          : {}),
        ...(manualAvailableEps !== ""
          ? { manualAvailableEps: Number(manualAvailableEps) }
          : {}),
      },
      pauseInfo: localPause,
      userWork: {
        ...userWork,
        synchro_offset_episodes: numericOffset,
        sync_offset_days: syncOffsetDays,
      },
    });
  }, [
    isManga,
    userWork,
    synchroOffset,
    syncOffsetDays,
    work,
    workId,
    override,
    manualMaxEpisode,
    manualAvailableEps,
    localPause,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSaving, onClose]);

  const isWorkFinishedOrComplete =
    work?.status === "CANCELLED" ||
    (effectiveMax !== null &&
      manualAvailableEps !== "" &&
      Number(manualAvailableEps) >= effectiveMax) ||
    (work?.status === "FINISHED" &&
      (effectiveMax === null ||
        manualAvailableEps === "" ||
        Number(manualAvailableEps) >= effectiveMax));

  const emitSaved = async (
    overrideResult?: Partial<WorkSettingsSaveResult>
  ) => {
    if (!onSaved) return;
    await onSaved({
      manualMaxEpisode,
      manualAvailableEps,
      synchroOffset,
      syncOffsetDays,
      hasCustomOverride: editorMode !== "ANILIST" && !isWorkFinishedOrComplete,
      isPaused: isPauseActive,
      pausedUntil: localPause?.paused_until || "",
      ...overrideResult,
    });
  };

  const handleDubSkipOneWeek = () => {
    if (work?.status === "FINISHED") {
      // Sub is already finished -> shift staggered Dub ending dates back by 7 days
      setSyncOffsetDays((prev) => prev + 7);
      toast.info(
        "Dub-Nachlauf um +7 Tage verschoben. Klicke auf Speichern, um es zu übernehmen."
      );
    } else {
      // Sub is still airing -> Dub falls 1 more episode behind
      setSynchroOffset((prev) => (prev === "" ? 1 : Number(prev) + 1));
      toast.info(
        "Synchro-Versatz um +1 Folge erhöht (1 Woche Dub-Pause). Klicke auf Speichern."
      );
    }
  };

  const handleSave = async () => {
    const user = auth?.currentUser;
    if (!user || isSaving) return;

    setIsSaving(true);
    try {
      if (manualMaxEpisode === "") {
        await clearManualMaxEpisode(workId);
      }

      let sanitizedAvailable: number | null =
        manualAvailableEps === ""
          ? null
          : Math.max(0, Number(manualAvailableEps));
      if (
        sanitizedAvailable !== null &&
        effectiveMax !== null &&
        sanitizedAvailable > effectiveMax
      ) {
        sanitizedAvailable = effectiveMax;
        setManualAvailableEps(effectiveMax);
      }

      const isFinishedByCount =
        effectiveMax !== null &&
        sanitizedAvailable !== null &&
        sanitizedAvailable >= effectiveMax;
      const isFinishedWorkWithoutPending =
        (work?.status === "FINISHED" || work?.status === "CANCELLED") &&
        (effectiveMax === null ||
          sanitizedAvailable === null ||
          sanitizedAvailable >= effectiveMax);

      const shouldClearSchedule =
        editorMode === "ANILIST" ||
        isFinishedByCount ||
        isFinishedWorkWithoutPending;

      const maxParam =
        manualMaxEpisode === "" ? undefined : Number(manualMaxEpisode);
      const availParam = sanitizedAvailable;

      if (shouldClearSchedule) {
        await resetScheduleOverride(workId);
        await setCalendarOverride(
          workId,
          undefined,
          undefined,
          undefined,
          maxParam,
          undefined,
          availParam
        );
      } else if (editorMode === "EXACT") {
        const parsed = new Date(editorExactDateTime);
        const unixSec = Math.floor(parsed.getTime() / 1000);
        if (Number.isNaN(unixSec) || unixSec <= 0) {
          toast.error("Bitte ein gültiges Datum & Uhrzeit wählen.");
          setIsSaving(false);
          return;
        }
        await setCalendarOverride(
          workId,
          unixSec,
          null,
          null,
          maxParam,
          editorFreqWeeks,
          availParam,
          undefined,
          editorStartDate || null,
          "strict",
          null
        );
      } else if (editorMode === "FLEXIBLE") {
        await setCalendarOverride(
          workId,
          null,
          editorFlexMinDay,
          editorTime || "18:00",
          maxParam,
          editorFreqWeeks,
          availParam,
          undefined,
          editorStartDate || null,
          "flexible",
          { minDay: editorFlexMinDay, maxDay: editorFlexMaxDay }
        );
      } else {
        await setCalendarOverride(
          workId,
          null,
          editorDay,
          editorTime || "18:00",
          maxParam,
          editorFreqWeeks,
          availParam,
          undefined,
          editorStartDate || null,
          "strict",
          null
        );
      }

      // Sync personal synchro offsets (Anime only) & clear legacy per-user manual_available_eps
      // so global calendar_overrides.manualAvailableEps is always authoritative.
      // IMPORTANT: NEVER touch current_episode here!
      const cleanSynchroOffset = isManga
        ? 0
        : synchroOffset === ""
        ? 0
        : Math.max(0, Number(synchroOffset));
      const cleanSyncDays = isManga ? 0 : Math.trunc(Number(syncOffsetDays) || 0);

      if (userWork?.inLibrary) {
        await saveUserWork(user.uid, workId, {
          synchro_offset_episodes: cleanSynchroOffset,
          sync_offset_days: cleanSyncDays,
          manual_available_eps: null,
        });
      }

      await emitSaved({
        manualAvailableEps:
          sanitizedAvailable === null ? "" : sanitizedAvailable,
        synchroOffset: cleanSynchroOffset,
        syncOffsetDays: cleanSyncDays,
        hasCustomOverride: !shouldClearSchedule,
      });
      toast.success("Einstellungen gespeichert.");
      onClose();
    } catch (err) {
      console.error("Failed to save work settings:", err);
      toast.error("Fehler beim Speichern der Einstellungen.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await Promise.all([
        resetScheduleOverride(workId),
        unpauseWork(workId).catch(() => {}),
      ]);
      setEditorMode("ANILIST");
      setEditorFreqWeeks(1);
      setEditorStartDate("");
      setLocalPause(null);
      await emitSaved({
        hasCustomOverride: false,
        isPaused: false,
        pausedUntil: "",
      });
      toast.success("Release-Takt & Pause auf AniList-Standard zurückgesetzt.");
      onClose();
    } catch (err) {
      console.error("Failed to reset schedule:", err);
      toast.error("Fehler beim Zurücksetzen.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickPause = async (
    mode: "1W" | "2W" | "4W" | "INDEFINITE" | "CUSTOM"
  ) => {
    const user = auth?.currentUser;
    if (!user || isSaving) return;
    setIsSaving(true);
    try {
      let untilIso = "";
      if (mode === "1W") {
        untilIso = getEndOfWeeksFromNow(1);
        await pauseWorkForWeeks(workId, user.uid, 1);
      } else if (mode === "2W") {
        untilIso = getEndOfWeeksFromNow(2);
        await pauseWorkForWeeks(workId, user.uid, 2);
      } else if (mode === "4W") {
        untilIso = getEndOfWeeksFromNow(4);
        await pauseWorkForWeeks(workId, user.uid, 4);
      } else if (mode === "INDEFINITE") {
        untilIso = INDEFINITE_PAUSE_UNTIL;
        await pauseWorkIndefinitely(workId, user.uid);
      } else if (mode === "CUSTOM" && customPauseDate) {
        const untilDate = parseLocalDate(customPauseDate);
        if (!untilDate) {
          toast.error("Bitte ein gültiges Datum auswählen.");
          setIsSaving(false);
          return;
        }
        untilDate.setHours(23, 59, 59, 999);
        untilIso = untilDate.toISOString();
        await pauseWorkUntil(workId, user.uid, untilIso);
      }
      if (untilIso) {
        const nextPause: WorkPauseRecord = {
          work_id: workId,
          paused: true,
          paused_until: untilIso,
          paused_by: user.uid,
        };
        setLocalPause(nextPause);
        await emitSaved({ isPaused: true, pausedUntil: untilIso });
        toast.success("Globale Pause aktiviert.");
      }
    } catch (err) {
      console.error("Failed to pause work:", err);
      toast.error("Fehler beim Pausieren.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnpause = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await unpauseWork(workId);
      setLocalPause(null);
      await emitSaved({ isPaused: false, pausedUntil: "" });
      toast.success("Pause aufgehoben.");
    } catch (err) {
      console.error("Failed to unpause work:", err);
      toast.error("Fehler beim Aufheben der Pause.");
    } finally {
      setIsSaving(false);
    }
  };

  const hasActiveSchedule =
    editorMode !== "ANILIST" && !isWorkFinishedOrComplete;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={() => !isSaving && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-800 bg-surface shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-800/80">
          {cover && (
            <img
              src={cover}
              alt=""
              className="w-8 h-11 rounded-lg object-cover bg-gray-800 shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Werk-Einstellungen
            </p>
            <h3 className="text-sm font-bold text-white truncate">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => !isSaving && onClose()}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Schließen"
          >
            <X size={17} />
          </button>
        </div>

        {/* Clean 3-Tab Switcher */}
        <div className="px-4 pt-3">
          <div className="grid grid-cols-3 gap-1 bg-surface-inset p-1 rounded-xl border border-gray-800/80">
            <button
              type="button"
              onClick={() => setActiveTab("LIMITS")}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "LIMITS"
                  ? "bg-accent text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <SlidersHorizontal size={13} />
              <span>{unitPlural}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("SCHEDULE")}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "SCHEDULE"
                  ? "bg-accent text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <CalendarClock size={13} />
              <span>Takt</span>
              {hasActiveSchedule && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeTab === "SCHEDULE" ? "bg-white" : "bg-accent-text"
                  }`}
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("PAUSE")}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "PAUSE"
                  ? "bg-amber-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <PauseCircle size={13} />
              <span>Pause</span>
              {isPauseActive && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeTab === "PAUSE" ? "bg-white" : "bg-amber-400"
                  }`}
                />
              )}
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {activeTab === "LIMITS" && (
            <>
              <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="block text-xs font-bold text-white">
                      Bisher erschienen
                    </label>
                    <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                      Global für alle · ändert nicht deinen eigenen Stand
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={effectiveMax ?? undefined}
                    placeholder="Auto"
                    value={manualAvailableEps}
                    onChange={(e) =>
                      setManualAvailableEps(
                        e.target.value === ""
                          ? ""
                          : Math.max(0, parseInt(e.target.value, 10) || 0)
                      )
                    }
                    className="w-24 bg-surface-control border border-gray-700 rounded-xl px-3 py-2 text-sm font-bold text-white text-center focus:outline-none focus:border-accent-border-strong shrink-0"
                  />
                </div>

                <div className="border-t border-gray-800/80 pt-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="block text-xs font-bold text-white">
                      Gesamt-{unitPlural}
                    </label>
                    <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                      Optional, falls AniList ({aniListTotal ?? "?"}) nicht stimmt
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    placeholder={aniListTotal ? String(aniListTotal) : "?"}
                    value={manualMaxEpisode}
                    onChange={(e) =>
                      setManualMaxEpisode(
                        e.target.value === ""
                          ? ""
                          : Math.max(1, parseInt(e.target.value, 10) || 1)
                      )
                    }
                    className="w-24 bg-surface-control border border-gray-700 rounded-xl px-3 py-2 text-sm font-bold text-white text-center focus:outline-none focus:border-accent-border-strong shrink-0"
                  />
                </div>
              </div>

              {/* Personal Dub Offset & Staggered Ending / Break-Week Support (Anime only) */}
              {!isManga && (
                <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white">
                        Dub- &amp; Synchro-Versatz
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                        Nur für dich
                      </span>
                    </div>
                    {(synchroOffset !== 0 && synchroOffset !== "") ||
                    syncOffsetDays !== 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSynchroOffset(0);
                          setSyncOffsetDays(0);
                        }}
                        className="text-[10px] font-semibold text-gray-400 hover:text-white transition"
                      >
                        Zurücksetzen
                      </button>
                    ) : null}
                  </div>

                  {!userWork?.inLibrary ? (
                    <p className="text-[11px] text-gray-400 leading-snug">
                      Füge diesen Anime zuerst deiner Bibliothek hinzu, um deinen persönlichen Dub-Versatz zu speichern.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <label className="block text-xs font-semibold text-gray-200">
                            Folgen-Versatz
                          </label>
                          <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                            Wie viele Folgen hinkt dein Dub dem Sub hinterher?
                          </p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={synchroOffset}
                          onChange={(e) =>
                            setSynchroOffset(
                              e.target.value === ""
                                ? ""
                                : Math.max(0, parseInt(e.target.value, 10) || 0)
                            )
                          }
                          className="w-20 bg-surface-control border border-gray-700 rounded-xl px-3 py-2 text-sm font-bold text-white text-center focus:outline-none focus:border-accent-border-strong shrink-0"
                        />
                      </div>

                      <div className="border-t border-gray-800/80 pt-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <label className="block text-xs font-semibold text-gray-200">
                            Tage-Versatz (optional)
                          </label>
                          <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                            Z. B. +2 wenn der Dub 2 Tage später kommt, oder +7 bei Aussetzer
                          </p>
                        </div>
                        <input
                          type="number"
                          min={-30}
                          max={365}
                          value={syncOffsetDays}
                          onChange={(e) =>
                            setSyncOffsetDays(
                              Math.max(
                                -30,
                                Math.min(365, parseInt(e.target.value, 10) || 0)
                              )
                            )
                          }
                          className="w-20 bg-surface-control border border-gray-700 rounded-xl px-3 py-2 text-sm font-bold text-white text-center focus:outline-none focus:border-accent-border-strong shrink-0"
                        />
                      </div>

                      {/* 1-Click Dub Break Week ("Aussetzen") */}
                      <div className="border-t border-gray-800/80 pt-3 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleDubSkipOneWeek}
                          className="w-full py-2 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                        >
                          <PauseCircle size={13} />
                          Dub setzt diese Woche aus (
                          {work?.status === "FINISHED"
                            ? "+7 Tage Nachlauf"
                            : "+1 Folge Versatz"}
                          )
                        </button>

                        {dubPreviewInfo?.isStaggeredDubEnding && (
                          <div className="rounded-lg border border-accent-border bg-accent-soft px-2.5 py-2 text-[11px] text-accent-soft-text leading-snug">
                            <span className="font-bold">Dub-Nachlauf aktiv:</span>{" "}
                            Sub ist beendet, noch{" "}
                            <span className="font-bold">
                              {dubPreviewInfo.dubRemainingEpisodes}
                            </span>{" "}
                            Dub-Folge
                            {dubPreviewInfo.dubRemainingEpisodes === 1 ? "" : "n"}{" "}
                            ausstehend
                            {dubPreviewInfo.airingAt
                              ? ` (nächste ca. ${format(
                                  new Date(dubPreviewInfo.airingAt * 1000),
                                  "dd.MM., HH:mm"
                                )})`
                              : ""}
                            .
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "SCHEDULE" && (
            <>
              {isWorkFinishedOrComplete && (
                <div className="rounded-xl border border-accent-border bg-accent-soft px-3 py-2 text-[11px] text-accent-soft-text">
                  Alle {unitPlural} sind bereits erschienen – ein wiederkehrender Takt wird beim Speichern automatisch deaktiviert.
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 bg-surface-inset p-1.5 rounded-xl border border-gray-800/80">
                {(
                  [
                    {
                      id: "WEEKLY",
                      label: "Fester Tag",
                      desc: "Wöchentlich / Alle X Wo.",
                    },
                    {
                      id: "FLEXIBLE",
                      label: "Zeitfenster",
                      desc: "Ungefähr z. B. Do–So",
                    },
                    {
                      id: "EXACT",
                      label: "Genauer Timer",
                      desc: "Datum & Uhrzeit",
                    },
                    {
                      id: "ANILIST",
                      label: "AniList Standard",
                      desc: "Kein eigener Takt",
                    },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setEditorMode(mode.id)}
                    className={`flex flex-col items-start p-2.5 rounded-lg text-left transition border ${
                      editorMode === mode.id
                        ? "bg-accent-soft border-accent-border-strong text-white"
                        : "bg-transparent border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="text-xs font-bold">{mode.label}</span>
                    <span className="text-[10px] text-gray-400">
                      {mode.desc}
                    </span>
                  </button>
                ))}
              </div>

              {editorMode === "WEEKLY" && (
                <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">
                      Wochentag
                    </label>
                    <WeekdayPillPicker
                      value={editorDay}
                      onChange={setEditorDay}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                        Uhrzeit
                      </label>
                      <input
                        type="time"
                        value={editorTime}
                        onChange={(e) => setEditorTime(e.target.value)}
                        className="w-full bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-border-strong"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                        Alle X Wochen
                      </label>
                      <div className="flex items-center gap-2">
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
                          className="w-16 bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs font-bold text-white text-center focus:outline-none focus:border-accent-border-strong"
                        />
                        <span className="text-[11px] text-gray-400">
                          {editorFreqWeeks === 1
                            ? "Wöchentlich"
                            : `Alle ${editorFreqWeeks} Wo.`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Startdatum (Optional)
                    </label>
                    <input
                      type="date"
                      value={editorStartDate}
                      onChange={(e) => setEditorStartDate(e.target.value)}
                      className="w-full bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-border-strong"
                    />
                  </div>
                </div>
              )}

              {editorMode === "FLEXIBLE" && (
                <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">
                      Frühestens ab
                    </label>
                    <WeekdayPillPicker
                      value={editorFlexMinDay}
                      onChange={setEditorFlexMinDay}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">
                      Spätestens bis
                    </label>
                    <WeekdayPillPicker
                      value={editorFlexMaxDay}
                      onChange={setEditorFlexMaxDay}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                        Alle X Wochen
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
                        className="w-full bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-accent-border-strong"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                        Startwoche (Optional)
                      </label>
                      <input
                        type="date"
                        value={editorStartDate}
                        onChange={(e) => setEditorStartDate(e.target.value)}
                        className="w-full bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-border-strong"
                      />
                    </div>
                  </div>
                </div>
              )}

              {editorMode === "EXACT" && (
                <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                      Nächster Release (Datum &amp; Uhrzeit)
                    </label>
                    <input
                      type="datetime-local"
                      value={editorExactDateTime}
                      onChange={(e) => setEditorExactDateTime(e.target.value)}
                      className="w-full bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-border-strong"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-semibold text-gray-400">
                      Danach wiederholen (Wochen)
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
                      className="w-20 bg-surface-control border border-gray-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white text-center focus:outline-none focus:border-accent-border-strong"
                    />
                  </div>
                </div>
              )}

              {editorMode === "ANILIST" && (
                <p className="text-xs text-gray-400 bg-surface-inset border border-gray-800/80 rounded-xl px-3.5 py-3">
                  Verwendet die automatischen Release-Zeiten von AniList (ohne eigenen Timer).
                </p>
              )}
            </>
          )}

          {activeTab === "PAUSE" && (
            <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-3">
              {isPauseActive ? (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-amber-300">
                      {formatPauseStatusLabel(localPause?.paused_until)}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Release-Benachrichtigungen &amp; automatisches Hochzählen sind für alle pausiert.
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleUnpause}
                    className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition"
                  >
                    <Play size={13} />
                    Pause für alle aufheben
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-gray-400">
                    Pausiert den globalen Release-Timer für alle Nutzer (z. B. bei Manga-Pause oder Hiatus). Für persönliche Dub-Aussetzer nutze den Tab „{unitPlural}“.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleQuickPause("1W")}
                      className="py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      1 Woche Pause
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleQuickPause("2W")}
                      className="py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      2 Wochen Pause
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleQuickPause("4W")}
                      className="py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      4 Wochen Pause
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleQuickPause("INDEFINITE")}
                      className="py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-semibold transition"
                    >
                      Hiatus (Unbegrenzt)
                    </button>
                  </div>
                  <div className="border-t border-gray-800/80 pt-3 flex items-center gap-2">
                    <input
                      type="date"
                      value={customPauseDate}
                      onChange={(e) => setCustomPauseDate(e.target.value)}
                      className="flex-1 bg-surface-control border border-gray-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      disabled={!customPauseDate || isSaving}
                      onClick={() => handleQuickPause("CUSTOM")}
                      className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-bold transition shrink-0"
                    >
                      Bis Datum
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Clean Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-800/80 bg-surface-inset">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleResetToDefault}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-rose-300 bg-white/5 hover:bg-rose-500/15 transition disabled:opacity-50"
            title="Release-Takt & Pause auf AniList-Standard zurücksetzen"
          >
            <RotateCcw size={13} />
            Zurücksetzen
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold transition shadow-md"
          >
            {isSaving ? "Speichert..." : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
