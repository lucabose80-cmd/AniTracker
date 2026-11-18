"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import Image from "next/image";
import Link from "next/link";
import {
  Library as LibraryIcon,
  Search,
  Edit2,
  X,
  Plus,
  Minus,
  ExternalLink,
  Check,
  LayoutList,
  LayoutGrid,
  SlidersHorizontal,
  ArrowUpDown,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { fetchAniListBatch } from "@/lib/anilist";
import { UserWork, UserWorkStatus } from "@/types/database";
import {
  getAllUserWorks,
  saveUserWork,
  updateEpisodeProgress,
  updateUserWorkStatus,
} from "@/lib/db/works";
import {
  CalendarOverride,
  computeWorkReleaseInfo,
  getCalendarOverrides,
} from "@/lib/db/calendar";
import { getPausedWorkIds } from "@/lib/db/pauses";

type SortOption = "RECENT" | "TITLE" | "BEHIND";
type TabStatus = "PLANNING" | "CURRENT" | "COMPLETED" | "PAUSED" | "DROPPED";

const STATUS_TABS: { key: TabStatus; label: string }[] = [
  { key: "PLANNING", label: "Planung" },
  { key: "CURRENT", label: "Aktiv" },
  { key: "COMPLETED", label: "Fertig" },
  { key: "PAUSED", label: "Pausiert" },
  { key: "DROPPED", label: "Abgebrochen" },
];

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: "RECENT", label: "Zuletzt" },
  { key: "TITLE", label: "Titel A-Z" },
  { key: "BEHIND", label: "Offene Folgen" },
];

function computeBehindCount(
  work: UserWork,
  details: any,
  globalOverride?: CalendarOverride,
  isPaused?: boolean
): number {
  const releaseInfo = computeWorkReleaseInfo({
    media: details,
    override: globalOverride,
    pauseInfo: isPaused ? { paused: true, paused_until: "9999-12-31T23:59:59.999Z" } : null,
    userWork: work,
  });
  return releaseInfo.behindCount;
}

function getTotalCount(
  work: UserWork,
  details: any,
  globalOverride?: CalendarOverride
): number | null {
  if (globalOverride?.manualMaxEpisode != null) {
    return globalOverride.manualMaxEpisode;
  }
  if (work.manual_max_episode != null) {
    return work.manual_max_episode;
  }
  if (details?.type === "MANGA") {
    return details?.chapters || null;
  }
  return details?.episodes || null;
}

function getNextReleaseTimestampMs(
  details: any,
  globalOverride?: CalendarOverride
): number | null {
  const releaseInfo = computeWorkReleaseInfo({
    media: details,
    override: globalOverride,
  });
  return releaseInfo.airingAt ? releaseInfo.airingAt * 1000 : null;
}

function formatNextReleaseLabel(
  work: UserWork,
  details: any,
  globalOverride?: CalendarOverride,
  isPaused?: boolean
): string | null {
  if (isPaused || work.status === "PAUSED") return "Pausiert";
  if (work.status === "DROPPED") return "Abgebrochen";
  if (work.status === "COMPLETED") return "Abgeschlossen";

  const releaseInfo = computeWorkReleaseInfo({
    media: details,
    override: globalOverride,
    userWork: work,
  });

  if (!releaseInfo.hasSchedule || !releaseInfo.airingAt) {
    if (details?.status === "FINISHED") return "Abgeschlossen";
    if (details?.status === "NOT_YET_RELEASED") return "Noch nicht gestartet";
    return null;
  }

  const nextMs = releaseInfo.airingAt * 1000;
  const nextDate = new Date(nextMs);
  const now = new Date();
  const timeStr = releaseInfo.isFlexible && releaseInfo.flexibleRangeLabel
    ? releaseInfo.flexibleRangeLabel
    : nextDate.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(nextDate, now)) {
    return releaseInfo.isFlexible && releaseInfo.flexibleRangeLabel
      ? `Heute (${releaseInfo.flexibleRangeLabel})`
      : `Heute ${timeStr}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(nextDate, tomorrow)) {
    return releaseInfo.isFlexible && releaseInfo.flexibleRangeLabel
      ? `Morgen (${releaseInfo.flexibleRangeLabel})`
      : `Morgen ${timeStr}`;
  }

  const datePart = nextDate.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const unitLabel = details?.type === "MANGA" ? "Nächstes Kapitel" : "Nächste Folge";
  return `${unitLabel}: ${datePart} · ${timeStr}`;
}

export default function LibraryPage() {
  const { contentType } = useAppStore();
  const reloadTrigger = useAppStore((state) => state.reloadTrigger);

  const [allWorks, setAllWorks] = useState<UserWork[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, CalendarOverride>>({});
  const [pausedWorkIds, setPausedWorkIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("RECENT");
  const [activeTab, setActiveTab] = useState<TabStatus>("CURRENT");
  const [onlyMalOpen, setOnlyMalOpen] = useState(false);
  const [viewColumns, setViewColumns] = useState<1 | 2>(1);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Quick-Edit Modal State
  const [editingWork, setEditingWork] = useState<UserWork | null>(null);
  const [editEpisode, setEditEpisode] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<UserWorkStatus>("CURRENT");
  const [editDroppedReason, setEditDroppedReason] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    try {
      const savedCols = window.localStorage.getItem("weebcheck_lib_cols");
      if (savedCols === "2") setViewColumns(2);
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const handleToggleColumns = (cols: 1 | 2) => {
    setViewColumns(cols);
    try {
      window.localStorage.setItem("weebcheck_lib_cols", String(cols));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setIsLoading(true);
        try {
          const works = await getAllUserWorks(user.uid);
          setAllWorks(works);
          getPausedWorkIds().then(setPausedWorkIds).catch(console.error);

          const allIdsToFetch = works
            .map((w: UserWork) => parseInt(w.work_id, 10))
            .filter((id) => !Number.isNaN(id));

          if (allIdsToFetch.length > 0) {
            try {
              const [mediaList, overrides] = await Promise.all([
                fetchAniListBatch(allIdsToFetch),
                getCalendarOverrides(),
              ]);

              const map: Record<string, any> = {};
              mediaList.forEach((m: any) => {
                map[m.id.toString()] = m;
              });
              setAniListDetails(map);
              setGlobalOverrides(overrides);
            } catch (e) {
              console.warn("AniList Error", e);
              const overrides = await getCalendarOverrides().catch(() => ({}));
              setGlobalOverrides(overrides);
            }
          }
        } catch (error) {
          console.error("Fehler beim Laden der Bibliothek:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        setAllWorks([]);
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, [reloadTrigger]);

  // Works matching active contentType (ANIME / MANGA)
  const contentTypeWorks = useMemo(() => {
    return allWorks.filter((w) => aniListDetails[w.work_id]?.type === contentType);
  }, [allWorks, aniListDetails, contentType]);

  // Live counts per status
  const statusCounts = useMemo(() => {
    const counts: Record<TabStatus, number> = {
      PLANNING: 0,
      CURRENT: 0,
      COMPLETED: 0,
      PAUSED: 0,
      DROPPED: 0,
    };
    contentTypeWorks.forEach((w) => {
      if (w.status in counts) {
        counts[w.status as TabStatus] += 1;
      }
    });
    return counts;
  }, [contentTypeWorks]);

  // Filtered & sorted works for active tab
  const visibleWorks = useMemo(() => {
    const queryLower = searchQuery.trim().toLowerCase();

    return contentTypeWorks
      .filter((w) => w.status === activeTab)
      .filter((w) => !onlyMalOpen || ((w.evaluation?.overallScore || 0) > 0 && !w.mal_rated))
      .filter((w) => {
        if (!queryLower) return true;
        const details = aniListDetails[w.work_id];
        const titleEnglish = details?.title?.english?.toLowerCase() || "";
        const titleRomaji = details?.title?.romaji?.toLowerCase() || "";
        const titleNative = details?.title?.native?.toLowerCase() || "";
        return (
          titleEnglish.includes(queryLower) ||
          titleRomaji.includes(queryLower) ||
          titleNative.includes(queryLower)
        );
      })
      .sort((a, b) => {
        const detA = aniListDetails[a.work_id];
        const detB = aniListDetails[b.work_id];

        if (sortBy === "TITLE") {
          const titleA = detA?.title?.english || detA?.title?.romaji || "";
          const titleB = detB?.title?.english || detB?.title?.romaji || "";
          return titleA.localeCompare(titleB, "de");
        }

        if (sortBy === "BEHIND") {
          const behindA = computeBehindCount(
            a,
            detA,
            globalOverrides[a.work_id],
            pausedWorkIds.has(a.work_id)
          );
          const behindB = computeBehindCount(
            b,
            detB,
            globalOverrides[b.work_id],
            pausedWorkIds.has(b.work_id)
          );
          if (behindB !== behindA) return behindB - behindA;
        }

        // RECENT fallback
        return parseInt(b.work_id, 10) - parseInt(a.work_id, 10);
      });
  }, [
    contentTypeWorks,
    activeTab,
    onlyMalOpen,
    searchQuery,
    sortBy,
    aniListDetails,
    globalOverrides,
    pausedWorkIds,
  ]);

  const handleQuickIncrement = async (work: UserWork) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const current = work.current_episode || 0;
    const nextEp = current + 1;

    // Optimistic UI update
    setAllWorks((prev) =>
      prev.map((w) =>
        w.work_id === work.work_id
          ? { ...w, current_episode: nextEp, auto_added: false }
          : w
      )
    );

    try {
      await updateEpisodeProgress(uid, work.work_id, nextEp);
    } catch (error) {
      console.error("Fehler beim Aktualisieren des Fortschritts:", error);
      // Revert on failure
      setAllWorks((prev) =>
        prev.map((w) =>
          w.work_id === work.work_id ? { ...w, current_episode: current } : w
        )
      );
    }
  };

  const openEditModal = (work: UserWork) => {
    setEditingWork(work);
    setEditEpisode(work.current_episode || 0);
    setEditStatus(work.status);
    setEditDroppedReason(work.dropped_reason || "");
  };

  const handleSaveQuickEdit = async () => {
    if (!editingWork) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const prevEpisode = editingWork.current_episode || 0;
    const prevStatus = editingWork.status;
    const prevDroppedReason = editingWork.dropped_reason || "";
    const sanitizedEpisode = Math.max(0, editEpisode);
    const nextDroppedReason =
      editStatus === "DROPPED" ? editDroppedReason.trim() : prevDroppedReason;

    setIsSavingEdit(true);

    // Optimistic update
    setAllWorks((prev) =>
      prev.map((w) =>
        w.work_id === editingWork.work_id
          ? {
              ...w,
              current_episode: sanitizedEpisode,
              status: editStatus,
              dropped_reason: nextDroppedReason,
              auto_added: false,
            }
          : w
      )
    );

    try {
      const promises: Promise<void>[] = [];
      if (sanitizedEpisode !== prevEpisode) {
        promises.push(updateEpisodeProgress(uid, editingWork.work_id, sanitizedEpisode));
      }
      if (editStatus !== prevStatus) {
        promises.push(updateUserWorkStatus(uid, editingWork.work_id, editStatus));
      }
      if (editStatus === "DROPPED" && nextDroppedReason !== prevDroppedReason) {
        promises.push(
          saveUserWork(uid, editingWork.work_id, { dropped_reason: nextDroppedReason })
        );
      }
      await Promise.all(promises);
      setEditingWork(null);
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      // Revert on error
      setAllWorks((prev) =>
        prev.map((w) =>
          w.work_id === editingWork.work_id
            ? {
                ...w,
                current_episode: prevEpisode,
                status: prevStatus,
                dropped_reason: prevDroppedReason,
              }
            : w
        )
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const unitPrefix = contentType === "MANGA" ? "KAP" : "EP";
  const progressBarColor = contentType === "MANGA" ? "bg-pink-500" : "bg-blue-500";
  const activeSortLabel =
    sortBy === "TITLE"
      ? "A-Z"
      : sortBy === "BEHIND"
      ? contentType === "MANGA"
        ? "Offene Kap."
        : "Offene Folgen"
      : "Zuletzt";

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-24 max-w-4xl mx-auto">
      {/* Compact Top Row: Search + Sort/Filter Button + 1/2 Column Switcher */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"
            size={15}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`${contentType === "MANGA" ? "Manga" : "Anime"} in Bibliothek suchen...`}
            className="w-full rounded-xl border border-gray-800 bg-[#1a1d24] py-2 pl-9 pr-8 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              aria-label="Suche zurücksetzen"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Sort & Filter Popover Trigger */}
        <button
          type="button"
          onClick={() => setShowFilterMenu((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold shrink-0 transition-colors ${
            showFilterMenu || sortBy !== "RECENT" || onlyMalOpen
              ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
              : "bg-[#1a1d24] border-gray-800 text-gray-300 hover:text-white"
          }`}
          title="Sortierung & Filter"
        >
          <ArrowUpDown size={14} />
          <span>{activeSortLabel}</span>
          {onlyMalOpen && (
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          )}
        </button>

        {/* 1-Column / 2-Column Layout Toggle */}
        <div className="flex items-center bg-[#1a1d24] border border-gray-800 rounded-xl p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => handleToggleColumns(1)}
            aria-label="1 Spalte"
            title="1 Spalte (Listenansicht)"
            className={`p-1.5 rounded-lg transition-colors ${
              viewColumns === 1
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <LayoutList size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleToggleColumns(2)}
            aria-label="2 Spalten"
            title="2 Spalten (Kompaktansicht)"
            className={`p-1.5 rounded-lg transition-colors ${
              viewColumns === 2
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <LayoutGrid size={15} />
          </button>
        </div>

        {/* Collapsible Sort & Filter Popover */}
        {showFilterMenu && (
          <div className="absolute right-0 top-full mt-2 z-30 w-64 rounded-2xl border border-gray-700 bg-[#161922] p-3 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <SlidersHorizontal size={12} />
                Sortierung
              </span>
              <button
                type="button"
                onClick={() => setShowFilterMenu(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              {SORT_OPTIONS.map((opt) => {
                const label =
                  opt.key === "BEHIND" && contentType === "MANGA"
                    ? "Offene Kapitel"
                    : opt.label;
                const active = sortBy === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setSortBy(opt.key);
                      setShowFilterMenu(false);
                    }}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                      active
                        ? "bg-blue-600 text-white"
                        : "bg-[#1a1d24] text-gray-300 hover:text-white"
                    }`}
                  >
                    <span>{label}</span>
                    {active && <Check size={13} />}
                  </button>
                );
              })}
            </div>

            <div className="border-t border-gray-800 pt-2">
              <button
                type="button"
                onClick={() => setOnlyMalOpen((prev) => !prev)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  onlyMalOpen
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                    : "bg-[#1a1d24] border-gray-800 text-gray-300 hover:text-white"
                }`}
              >
                <span>Nur AniList/MAL offen</span>
                {onlyMalOpen && <Check size={13} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status Pill-Tabs with live counts */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        {STATUS_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = statusCounts[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                isActive
                  ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                  : "bg-[#1a1d24] border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Watchlist / Tracking Rows or 2-Column Grid */}
      {isLoading ? (
        <div
          className={
            viewColumns === 2
              ? "grid grid-cols-2 gap-2.5"
              : "flex flex-col gap-3"
          }
        >
          {Array(6)
            .fill(0)
            .map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-2xl border border-gray-800 bg-[#1a1d24] animate-pulse"
              >
                <div className="w-12 h-16 rounded-lg bg-gray-800 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 rounded bg-gray-800" />
                  <div className="h-1.5 w-full rounded-full bg-gray-800" />
                  <div className="h-3 w-1/2 rounded bg-gray-800" />
                </div>
              </div>
            ))}
        </div>
      ) : visibleWorks.length === 0 ? (
        <div className="rounded-2xl border border-gray-800 bg-[#1a1d24] p-10 text-center text-sm text-gray-400">
          {searchQuery
            ? "Keine passenden Einträge in dieser Kategorie gefunden."
            : "Keine Werke in dieser Kategorie vorhanden."}
        </div>
      ) : viewColumns === 2 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {visibleWorks.map((work) => {
            const details = aniListDetails[work.work_id];
            const globalOverride = globalOverrides[work.work_id];
            const isPaused = pausedWorkIds.has(work.work_id);

            const title =
              details?.title?.english ||
              details?.title?.romaji ||
              `Werk #${work.work_id}`;
            const coverSrc =
              details?.coverImage?.large || details?.coverImage?.extraLarge;

            const current = work.current_episode || 0;
            const total = getTotalCount(work, details, globalOverride);
            const progressPct = total
              ? Math.min(100, Math.max(0, (current / total) * 100))
              : current > 0
              ? 100
              : 0;

            const behindCount = computeBehindCount(
              work,
              details,
              globalOverride,
              isPaused
            );

            const isCompleted =
              work.status === "COMPLETED" ||
              (total !== null && total > 0 && current >= total);

            return (
              <div
                key={work.work_id}
                className="flex flex-col justify-between gap-2.5 p-2.5 rounded-2xl border border-gray-800/90 bg-[#1a1d24] hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <Link
                    href={`/work/${work.work_id}`}
                    className="relative w-12 h-16 rounded-lg overflow-hidden bg-gray-800 shrink-0"
                  >
                    {coverSrc ? (
                      <Image
                        src={coverSrc}
                        alt={title}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : null}
                    {behindCount > 0 && (
                      <span className="absolute top-0.5 right-0.5 rounded bg-blue-600 px-1 py-0.2 text-[9px] font-bold text-white shadow">
                        +{behindCount}
                      </span>
                    )}
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <Link
                      href={`/work/${work.work_id}`}
                      className="font-semibold text-xs text-white hover:text-blue-400 transition-colors line-clamp-2 leading-snug"
                    >
                      {title}
                    </Link>
                    <span className="text-[11px] font-semibold text-gray-400 tabular-nums">
                      {unitPrefix} {current} / {total ?? "?"}
                    </span>
                    {isPaused && (
                      <div className="flex items-center gap-1 flex-wrap mt-0.5">
                        <span className="inline-flex items-center rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                          Auf Pause
                        </span>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.preventDefault();
                            const { unpauseWork } = await import("@/lib/db/pauses");
                            await unpauseWork(work.work_id);
                            setPausedWorkIds((prev) => {
                              const next = new Set(prev);
                              next.delete(work.work_id);
                              return next;
                            });
                          }}
                          className="text-[9px] font-bold text-emerald-400 hover:underline"
                        >
                          Aufheben
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isCompleted ? "bg-green-500" : progressBarColor
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-1.5">
                  {isCompleted ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-green-500/15 border border-green-500/30 px-2 py-1 text-[11px] font-semibold text-green-400">
                      <Check size={12} />
                      Fertig
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleQuickIncrement(work)}
                      className="flex-1 rounded-lg bg-[#222631] hover:bg-blue-600 text-[11px] font-semibold text-white py-1 px-2 transition-colors whitespace-nowrap text-center"
                    >
                      + {unitPrefix} {current + 1}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditModal(work)}
                    className="p-1.5 rounded-lg bg-[#222631] hover:bg-gray-700 text-gray-300 hover:text-white transition-colors shrink-0"
                    aria-label="Schnell bearbeiten"
                    title="Schnell bearbeiten"
                  >
                    <Edit2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleWorks.map((work) => {
            const details = aniListDetails[work.work_id];
            const globalOverride = globalOverrides[work.work_id];
            const isPaused = pausedWorkIds.has(work.work_id);

            const title =
              details?.title?.english ||
              details?.title?.romaji ||
              `Werk #${work.work_id}`;
            const coverSrc =
              details?.coverImage?.large || details?.coverImage?.extraLarge;

            const current = work.current_episode || 0;
            const total = getTotalCount(work, details, globalOverride);
            const progressPct = total
              ? Math.min(100, Math.max(0, (current / total) * 100))
              : current > 0
              ? 100
              : 0;

            const behindCount = computeBehindCount(
              work,
              details,
              globalOverride,
              isPaused
            );
            const nextReleaseText = formatNextReleaseLabel(
              work,
              details,
              globalOverride,
              isPaused
            );

            const isCompleted =
              work.status === "COMPLETED" ||
              (total !== null && total > 0 && current >= total);

            return (
              <div
                key={work.work_id}
                className="flex items-center gap-3.5 p-3 rounded-2xl border border-gray-800/90 bg-[#1a1d24] hover:border-gray-700 transition-colors"
              >
                {/* Left: Cover */}
                <Link
                  href={`/work/${work.work_id}`}
                  className="relative w-14 h-20 rounded-lg overflow-hidden bg-gray-800 shrink-0"
                >
                  {coverSrc ? (
                    <Image
                      src={coverSrc}
                      alt={title}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : null}
                </Link>

                {/* Middle: Title, Progress Bar, Next Release */}
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <Link
                    href={`/work/${work.work_id}`}
                    className="font-semibold text-sm sm:text-base text-white hover:text-blue-400 transition-colors line-clamp-1"
                  >
                    {title}
                  </Link>

                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isCompleted ? "bg-green-500" : progressBarColor
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-gray-300 tabular-nums shrink-0">
                      {unitPrefix} {current} / {total ?? "?"}
                    </span>
                  </div>

                  <div className="flex items-center flex-wrap gap-2">
                    {isPaused ? (
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                          Auf Pause / Hiatus
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            const { unpauseWork } = await import("@/lib/db/pauses");
                            await unpauseWork(work.work_id);
                            setPausedWorkIds((prev) => {
                              const next = new Set(prev);
                              next.delete(work.work_id);
                              return next;
                            });
                          }}
                          className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 hover:underline"
                        >
                          Pause für alle aufheben
                        </button>
                      </div>
                    ) : (
                      nextReleaseText && (
                        <span className="text-xs text-gray-400 truncate">
                          {nextReleaseText}
                        </span>
                      )
                    )}
                    {behindCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                        {behindCount} offen
                      </span>
                    )}
                  </div>
                  {work.status === "DROPPED" && work.dropped_reason && (
                    <p className="text-xs text-red-300/90 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 line-clamp-2">
                      <span className="font-semibold text-red-400">Grund:</span>{" "}
                      {work.dropped_reason}
                    </p>
                  )}
                </div>

                {/* Right: Quick +1 Button & Quick-Edit Pencil */}
                <div className="flex items-center gap-2 shrink-0">
                  {isCompleted ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 border border-green-500/30 px-3 py-1.5 text-xs font-semibold text-green-400">
                      <Check size={13} />
                      Fertig
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleQuickIncrement(work)}
                      className="rounded-full bg-[#222631] hover:bg-blue-600 text-xs font-semibold text-white px-3 py-1.5 transition-colors whitespace-nowrap"
                    >
                      + {unitPrefix} {current + 1}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditModal(work)}
                    className="p-2 rounded-full bg-[#222631] hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                    aria-label="Schnell bearbeiten"
                    title="Schnell bearbeiten"
                  >
                    <Edit2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick-Edit Modal */}
      {editingWork && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !isSavingEdit && setEditingWork(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-gray-800 bg-[#161920] p-5 shadow-2xl flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Schnell bearbeiten
                </p>
                <h2 className="text-base font-bold text-white line-clamp-2 mt-0.5">
                  {aniListDetails[editingWork.work_id]?.title?.english ||
                    aniListDetails[editingWork.work_id]?.title?.romaji ||
                    `Werk #${editingWork.work_id}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingWork(null)}
                className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>

            {/* Episode / Chapter Adjuster */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-300">
                {contentType === "MANGA" ? "Aktuelles Kapitel" : "Aktuelle Folge"}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditEpisode((prev) => Math.max(0, prev - 1))}
                  className="p-2.5 rounded-xl bg-[#222631] hover:bg-gray-700 text-white transition-colors"
                  aria-label="Verringern"
                >
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  min={0}
                  value={editEpisode}
                  onChange={(e) =>
                    setEditEpisode(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  className="flex-1 rounded-xl border border-gray-800 bg-[#1a1d24] px-3 py-2 text-center text-base font-bold text-white focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setEditEpisode((prev) => prev + 1)}
                  className="p-2.5 rounded-xl bg-[#222631] hover:bg-gray-700 text-white transition-colors"
                  aria-label="Erhöhen"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* Status Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-300">Status</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setEditStatus(tab.key)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                      editStatus === tab.key
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-[#1a1d24] border-gray-800 text-gray-400 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {editStatus === "DROPPED" && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-300">
                  Grund für Abbruch (optional)
                </label>
                <input
                  type="text"
                  value={editDroppedReason}
                  onChange={(e) => setEditDroppedReason(e.target.value)}
                  placeholder="Grund für Abbruch (optional)"
                  className="w-full rounded-xl border border-gray-800 bg-[#1a1d24] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            )}

            {editStatus === "PAUSED" && (
              <button
                type="button"
                onClick={() => setEditStatus("CURRENT")}
                className="w-full rounded-xl border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 px-3 py-2 text-xs font-semibold text-blue-300 transition-colors"
              >
                Entpausieren (Aktiv setzen)
              </button>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <Link
                href={`/work/${editingWork.work_id}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
              >
                <ExternalLink size={14} />
                Zur Detailseite
              </Link>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingWork(null)}
                  disabled={isSavingEdit}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-gray-300 hover:text-white bg-[#222631] hover:bg-gray-700 transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuickEdit}
                  disabled={isSavingEdit}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {isSavingEdit ? "Speichern..." : "Speichern"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
