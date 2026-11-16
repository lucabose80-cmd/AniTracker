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
  Tv,
  BookOpen,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { fetchAniListBatch } from "@/lib/anilist";
import { UserWork, UserWorkStatus } from "@/types/database";
import {
  getAllUserWorks,
  updateEpisodeProgress,
  updateUserWorkStatus,
} from "@/lib/db/works";
import { CalendarOverride, getCalendarOverrides } from "@/lib/db/calendar";
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
  if (!details || isPaused || work.status === "PAUSED" || work.status === "COMPLETED" || work.status === "DROPPED") {
    return 0;
  }

  const currentEp = work.current_episode || 0;
  let totalEps = 9999;

  if (globalOverride?.manualMaxEpisode !== undefined && globalOverride?.manualMaxEpisode !== null) {
    totalEps = globalOverride.manualMaxEpisode;
  } else if (work.manual_max_episode !== undefined && work.manual_max_episode !== null) {
    totalEps = work.manual_max_episode;
  }

  let maxAiredEp = 0;
  if (globalOverride?.manualAvailableEps !== undefined && globalOverride?.manualAvailableEps !== null) {
    maxAiredEp = globalOverride.manualAvailableEps;
  } else if (work.manual_available_eps !== undefined && work.manual_available_eps !== null) {
    maxAiredEp = Number(work.manual_available_eps);
  } else if (details?.type === "MANGA") {
    maxAiredEp = totalEps !== 9999 ? totalEps : (details?.chapters || 0);
  } else if (details?.status === "RELEASING" && details?.nextAiringEpisode?.episode) {
    maxAiredEp = details.nextAiringEpisode.episode - 1;
  } else if (details?.status === "RELEASING") {
    maxAiredEp = currentEp;
  } else if (details?.status === "FINISHED") {
    maxAiredEp = totalEps !== 9999 ? totalEps : (details?.episodes || 0);
  }

  const offset = work.synchro_offset_episodes || 0;
  if (globalOverride?.manualAvailableEps == null && work.manual_available_eps == null) {
    maxAiredEp = Math.max(0, maxAiredEp - offset);
  }

  return Math.max(0, maxAiredEp - currentEp);
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
  const now = Date.now();

  if (globalOverride?.airingAt && globalOverride.airingAt * 1000 > now) {
    return globalOverride.airingAt * 1000;
  }

  if (details?.nextAiringEpisode?.airingAt) {
    return details.nextAiringEpisode.airingAt * 1000;
  }

  if (globalOverride?.weeklyDay !== undefined && globalOverride?.weeklyTime) {
    const [hoursStr, minutesStr] = globalOverride.weeklyTime.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const candidate = new Date();
      const currentDay = candidate.getDay();
      let daysUntil = (globalOverride.weeklyDay - currentDay + 7) % 7;
      candidate.setHours(hours, minutes, 0, 0);
      if (daysUntil === 0 && candidate.getTime() <= now) {
        daysUntil = 7;
      }
      candidate.setDate(candidate.getDate() + daysUntil);
      return candidate.getTime();
    }
  }

  return null;
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

  const nextMs = getNextReleaseTimestampMs(details, globalOverride);
  if (!nextMs) {
    if (details?.status === "FINISHED") return "Abgeschlossen";
    if (details?.status === "NOT_YET_RELEASED") return "Noch nicht gestartet";
    return null;
  }

  const nextDate = new Date(nextMs);
  const now = new Date();
  const timeStr = nextDate.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(nextDate, now)) {
    return `Heute ${timeStr}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(nextDate, tomorrow)) {
    return `Morgen ${timeStr}`;
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
  const { contentType, setContentType } = useAppStore();
  const reloadTrigger = useAppStore((state) => state.reloadTrigger);

  const [allWorks, setAllWorks] = useState<UserWork[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, CalendarOverride>>({});
  const [pausedWorkIds, setPausedWorkIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("RECENT");
  const [activeTab, setActiveTab] = useState<TabStatus>("CURRENT");

  // Quick-Edit Modal State
  const [editingWork, setEditingWork] = useState<UserWork | null>(null);
  const [editEpisode, setEditEpisode] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<UserWorkStatus>("CURRENT");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

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
  };

  const handleSaveQuickEdit = async () => {
    if (!editingWork) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const prevEpisode = editingWork.current_episode || 0;
    const prevStatus = editingWork.status;
    const sanitizedEpisode = Math.max(0, editEpisode);

    setIsSavingEdit(true);

    // Optimistic update
    setAllWorks((prev) =>
      prev.map((w) =>
        w.work_id === editingWork.work_id
          ? {
              ...w,
              current_episode: sanitizedEpisode,
              status: editStatus,
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
      await Promise.all(promises);
      setEditingWork(null);
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      // Revert on error
      setAllWorks((prev) =>
        prev.map((w) =>
          w.work_id === editingWork.work_id
            ? { ...w, current_episode: prevEpisode, status: prevStatus }
            : w
        )
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const unitPrefix = contentType === "MANGA" ? "KAP" : "EP";
  const progressBarColor = contentType === "MANGA" ? "bg-pink-500" : "bg-blue-500";

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-24 max-w-4xl mx-auto">
      {/* Header + ContentType Switch */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2.5 text-xl font-bold text-white">
          <LibraryIcon className="text-blue-500" size={22} />
          Meine Bibliothek
        </h1>

        <div className="flex items-center bg-[#1a1d24] border border-gray-800 rounded-full p-1">
          <button
            type="button"
            onClick={() => setContentType("ANIME")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              contentType === "ANIME"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Tv size={13} />
            Anime
          </button>
          <button
            type="button"
            onClick={() => setContentType("MANGA")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              contentType === "MANGA"
                ? "bg-pink-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <BookOpen size={13} />
            Manga
          </button>
        </div>
      </div>

      {/* Top Search & Sort Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"
            size={16}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Suche in Bibliothek..."
            className="w-full rounded-full border border-gray-800 bg-[#1a1d24] py-2.5 pl-10 pr-9 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              aria-label="Suche zurücksetzen"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 shrink-0">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSortBy(opt.key)}
              className={`px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                sortBy === opt.key
                  ? "bg-[#222631] border-gray-600 text-white"
                  : "bg-[#1a1d24] border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
              }`}
            >
              {opt.key === "BEHIND" && contentType === "MANGA"
                ? "Offene Kapitel"
                : opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status Pill-Tabs with live counts */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {STATUS_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = statusCounts[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
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

      {/* Watchlist / Tracking Rows */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array(6)
            .fill(0)
            .map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3.5 p-3 rounded-2xl border border-gray-800 bg-[#1a1d24] animate-pulse"
              >
                <div className="w-14 h-20 rounded-lg bg-gray-800 shrink-0" />
                <div className="flex-1 space-y-2.5">
                  <div className="h-4 w-2/3 rounded bg-gray-800" />
                  <div className="h-1.5 w-full rounded-full bg-gray-800" />
                  <div className="h-3 w-1/3 rounded bg-gray-800" />
                </div>
                <div className="w-20 h-8 rounded-full bg-gray-800 shrink-0" />
              </div>
            ))}
        </div>
      ) : visibleWorks.length === 0 ? (
        <div className="rounded-2xl border border-gray-800 bg-[#1a1d24] p-10 text-center text-sm text-gray-400">
          {searchQuery
            ? "Keine passenden Einträge in dieser Kategorie gefunden."
            : "Keine Werke in dieser Kategorie vorhanden."}
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
                    {nextReleaseText && (
                      <span className="text-xs text-gray-400 truncate">
                        {nextReleaseText}
                      </span>
                    )}
                    {behindCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                        {behindCount} offen
                      </span>
                    )}
                  </div>
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
