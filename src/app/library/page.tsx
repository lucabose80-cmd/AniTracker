"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import Image from "next/image";
import Link from "next/link";
import {
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
  Dices,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Star,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { ANILIST_GENRES, fetchAniListBatch } from "@/lib/anilist";
import { UserWork, UserWorkStatus } from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import {
  getAllUserWorks,
  saveUserWork,
  updateEpisodeProgress,
  updateUserWorkStatus,
} from "@/lib/db/works";
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
import { toast } from "@/lib/ui-feedback";

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
  details: AniListMedia | undefined,
  globalOverride?: CalendarOverride,
  pauseInfo?: WorkPauseRecord | null,
  nowMs?: number
): number {
  const releaseInfo = computeWorkReleaseInfo({
    media: details,
    override: globalOverride,
    pauseInfo: pauseInfo || null,
    userWork: work,
    nowMs,
  });
  return releaseInfo.behindCount;
}

function getTotalCount(
  work: UserWork,
  details: AniListMedia | undefined,
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

function isWishlistWorkEligibleForDice(
  work: UserWork,
  details: AniListMedia | undefined,
  globalOverride?: CalendarOverride,
  nowMs?: number
): boolean {
  if (!details) return false;
  if (details.status === "NOT_YET_RELEASED" || details.status === "CANCELLED") {
    return false;
  }

  if (globalOverride?.manualAvailableEps != null) {
    return Number(globalOverride.manualAvailableEps) > 0;
  }
  if (work.manual_available_eps != null) {
    return Number(work.manual_available_eps) > 0;
  }

  const total = getTotalCount(work, details, globalOverride);

  if (details.type === "MANGA") {
    if (
      details.status === "FINISHED" ||
      details.status === "RELEASING" ||
      details.status === "HIATUS"
    ) {
      if (typeof details.chapters === "number" && details.chapters <= 0) {
        return false;
      }
      return total === null || total > 0;
    }
    return false;
  }

  // ANIME
  if (details.nextAiringEpisode?.episode) {
    const releaseInfo = computeWorkReleaseInfo({
      media: details,
      override: globalOverride,
      userWork: work,
      nowMs,
    });
    return releaseInfo.availableEpisodes > 0;
  }

  if (details.status === "RELEASING") {
    return total === null || total > 0;
  }

  if (details.status === "FINISHED") {
    return total !== null && total > 0;
  }

  return false;
}

function formatNextReleaseLabel(
  work: UserWork,
  details: AniListMedia | undefined,
  globalOverride?: CalendarOverride,
  pauseInfo?: WorkPauseRecord | null,
  nowMs: number = Date.now()
): string | null {
  if (pauseInfo) return formatPauseStatusLabel(pauseInfo.paused_until);
  if (work.status === "PAUSED") return "Pausiert";
  if (work.status === "DROPPED") return "Abgebrochen";
  if (work.status === "COMPLETED") return "Abgeschlossen";

  const releaseInfo = computeWorkReleaseInfo({
    media: details,
    override: globalOverride,
    pauseInfo: pauseInfo || null,
    userWork: work,
    nowMs,
  });

  if (!releaseInfo.hasSchedule || !releaseInfo.airingAt) {
    if (details?.status === "FINISHED") return "Abgeschlossen";
    if (details?.status === "NOT_YET_RELEASED") return "Noch nicht gestartet";
    return null;
  }

  const nextMs = releaseInfo.airingAt * 1000;
  const nextDate = new Date(nextMs);
  const now = new Date(nowMs);
  const timeStr =
    releaseInfo.isFlexible && releaseInfo.flexibleRangeLabel
      ? releaseInfo.flexibleRangeLabel
      : nextDate.toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        });

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const dubSuffix = releaseInfo.isStaggeredDubEnding ? " (Dub-Nachlauf)" : "";

  if (isSameDay(nextDate, now)) {
    return releaseInfo.isFlexible && releaseInfo.flexibleRangeLabel
      ? `Heute (${releaseInfo.flexibleRangeLabel})${dubSuffix}`
      : `Heute ${timeStr}${dubSuffix}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(nextDate, tomorrow)) {
    return releaseInfo.isFlexible && releaseInfo.flexibleRangeLabel
      ? `Morgen (${releaseInfo.flexibleRangeLabel})${dubSuffix}`
      : `Morgen ${timeStr}${dubSuffix}`;
  }

  const datePart = nextDate.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const unitLabel =
    details?.type === "MANGA" ? "Nächstes Kapitel" : "Nächste Folge";
  return `${unitLabel}: ${datePart} · ${timeStr}${dubSuffix}`;
}

function buildNewSequelUserWork(
  uid: string,
  sequelId: string,
  targetStatus: UserWorkStatus,
  addedStatus: "RELEASING" | "NOT_YET_RELEASED"
): UserWork {
  return {
    user_id: uid,
    work_id: sequelId,
    status: targetStatus,
    added_status: addedStatus,
    current_episode: 0,
    updated_at: Date.now(),
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
  };
}

export default function LibraryPage() {
  const contentType = useAppStore((s) => s.contentType);
  const reloadTrigger = useAppStore((s) => s.reloadTrigger);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [allWorks, setAllWorks] = useState<UserWork[]>([]);
  const [aniListDetails, setAniListDetails] = useState<
    Record<string, AniListMedia>
  >({});
  const [globalOverrides, setGlobalOverrides] = useState<
    Record<string, CalendarOverride>
  >({});
  const [pausedWorksMap, setPausedWorksMap] = useState<
    Record<string, WorkPauseRecord>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("RECENT");
  const [activeTab, setActiveTab] = useState<TabStatus>("CURRENT");
  const [onlyMalOpen, setOnlyMalOpen] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [viewColumns, setViewColumns] = useState<1 | 2>(1);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  // Subtle Sequel Hint & Random Wishlist Pick State
  const [showSequels, setShowSequels] = useState(false);
  const [dismissedSequelIds, setDismissedSequelIds] = useState<Set<string>>(
    new Set()
  );
  const [addingSequelId, setAddingSequelId] = useState<string | null>(null);
  const [randomPickWork, setRandomPickWork] = useState<UserWork | null>(null);
  const [isStartingRandom, setIsStartingRandom] = useState(false);

  // Quick-Edit Modal State
  const [editingWork, setEditingWork] = useState<UserWork | null>(null);
  const [editEpisode, setEditEpisode] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<UserWorkStatus>("CURRENT");
  const [editDroppedReason, setEditDroppedReason] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const savedCols =
          window.localStorage.getItem("anipulse_lib_cols") ??
          window.localStorage.getItem("weebcheck_lib_cols");
        if (savedCols === "2") setViewColumns(2);
        const savedDismissedSequels = window.localStorage.getItem(
          "anipulse_dismissed_sequels"
        );
        if (savedDismissedSequels) {
          const parsed = JSON.parse(savedDismissedSequels);
          if (Array.isArray(parsed)) {
            setDismissedSequelIds(
              new Set(parsed.filter((x) => typeof x === "string"))
            );
          }
        }
      } catch {
        // ignore localStorage errors
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!showFilterMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        filterMenuRef.current &&
        !filterMenuRef.current.contains(e.target as Node)
      ) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFilterMenu]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const handleToggleColumns = (cols: 1 | 2) => {
    setViewColumns(cols);
    try {
      window.localStorage.setItem("anipulse_lib_cols", String(cols));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setIsLoggedIn(true);
        setIsLoading(true);
        try {
          const [works, pauses] = await Promise.all([
            getAllUserWorks(user.uid),
            getPausedWorksMap().catch(
              (): Record<string, WorkPauseRecord> => ({})
            ),
          ]);
          setAllWorks(works);
          setPausedWorksMap(pauses);
          setNowMs(Date.now());

          const allIdsToFetch = works
            .map((w: UserWork) => parseInt(w.work_id, 10))
            .filter((id) => !Number.isNaN(id) && id > 0);

          if (allIdsToFetch.length > 0) {
            try {
              const [mediaList, overrides] = await Promise.all([
                fetchAniListBatch(allIdsToFetch),
                getCalendarOverrides(),
              ]);

              const map: Record<string, AniListMedia> = {};
              mediaList.forEach((m) => {
                map[m.id.toString()] = m;
              });
              setAniListDetails(map);
              setGlobalOverrides(overrides);
            } catch (e) {
              console.warn("AniList Error", e);
              const overrides = await getCalendarOverrides().catch(() => ({}));
              setGlobalOverrides(overrides);
            }
          } else {
            setAniListDetails({});
          }
        } catch (error) {
          console.error("Fehler beim Laden der Bibliothek:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoggedIn(false);
        setAllWorks([]);
        setAniListDetails({});
        setGlobalOverrides({});
        setPausedWorksMap({});
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, [reloadTrigger]);

  // Works matching active contentType (ANIME / MANGA)
  const contentTypeWorks = useMemo(() => {
    return allWorks.filter(
      (w) => aniListDetails[w.work_id]?.type === contentType
    );
  }, [allWorks, aniListDetails, contentType]);

  // Detect sequels (RELEASING or NOT_YET_RELEASED) for user's COMPLETED works
  const availableSequels = useMemo(() => {
    const libraryIdSet = new Set(allWorks.map((w) => String(w.work_id)));
    const seenSequelIds = new Set<string>();
    const results: Array<{
      id: string;
      title: string;
      cover?: string;
      status: "RELEASING" | "NOT_YET_RELEASED";
      fromTitle: string;
    }> = [];

    contentTypeWorks.forEach((w) => {
      if (w.status !== "COMPLETED") return;
      const details = aniListDetails[w.work_id];
      const edges = details?.relations?.edges;
      if (!Array.isArray(edges)) return;
      const fromTitle = getAniListTitle(details, "");

      edges.forEach((edge) => {
        if (edge?.relationType !== "SEQUEL") return;
        const node = edge?.node;
        if (!node?.id) return;
        if (node.type !== contentType) return;
        if (
          node.status !== "RELEASING" &&
          node.status !== "NOT_YET_RELEASED"
        ) {
          return;
        }
        const seqId = String(node.id);
        if (
          libraryIdSet.has(seqId) ||
          dismissedSequelIds.has(seqId) ||
          seenSequelIds.has(seqId)
        ) {
          return;
        }
        seenSequelIds.add(seqId);
        results.push({
          id: seqId,
          title: getAniListTitle(node, `Werk #${seqId}`),
          cover:
            node.coverImage?.medium || node.coverImage?.large || undefined,
          status: node.status,
          fromTitle,
        });
      });
    });

    return results.sort((a, b) =>
      a.status === b.status
        ? a.title.localeCompare(b.title, "de")
        : a.status === "RELEASING"
        ? -1
        : 1
    );
  }, [
    allWorks,
    contentTypeWorks,
    aniListDetails,
    contentType,
    dismissedSequelIds,
  ]);

  const handleDismissSequel = (sequelId: string) => {
    setDismissedSequelIds((prev) => {
      const next = new Set(prev);
      next.add(sequelId);
      try {
        window.localStorage.setItem(
          "anipulse_dismissed_sequels",
          JSON.stringify(Array.from(next).slice(-200))
        );
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleQuickAddSequel = async (sequel: {
    id: string;
    status: "RELEASING" | "NOT_YET_RELEASED";
  }) => {
    const uid = auth.currentUser?.uid;
    if (!uid || addingSequelId) return;
    setAddingSequelId(sequel.id);
    const targetStatus: UserWorkStatus =
      sequel.status === "RELEASING" ? "CURRENT" : "PLANNING";
    try {
      await saveUserWork(uid, sequel.id, {
        status: targetStatus,
        added_status: sequel.status,
        current_episode: 0,
      });
      const newEntry = buildNewSequelUserWork(
        uid,
        sequel.id,
        targetStatus,
        sequel.status
      );
      setAllWorks((prev) => [...prev, newEntry]);
      const parsedId = parseInt(sequel.id, 10);
      if (!Number.isNaN(parsedId)) {
        const fetched = await fetchAniListBatch([parsedId]).catch(() => []);
        if (fetched.length > 0) {
          setAniListDetails((prev) => ({
            ...prev,
            [sequel.id]: fetched[0],
          }));
        }
      }
      toast.success(
        targetStatus === "CURRENT"
          ? "Fortsetzung zu Aktiv hinzugefügt."
          : "Fortsetzung zur Planung hinzugefügt."
      );
    } catch (err) {
      console.error("Failed to add sequel:", err);
      toast.error("Fehler beim Hinzufügen der Fortsetzung.");
    } finally {
      setAddingSequelId(null);
    }
  };

  // Available genres present in the user's current Anime/Manga library
  const availableGenres = useMemo(() => {
    const present = new Set<string>();
    contentTypeWorks.forEach((w) => {
      const genres = aniListDetails[w.work_id]?.genres;
      if (Array.isArray(genres)) {
        genres.forEach((g) => {
          if (typeof g === "string" && g.trim()) present.add(g);
        });
      }
    });
    if (present.size === 0) {
      return [...ANILIST_GENRES];
    }
    const ordered: string[] = [];
    ANILIST_GENRES.forEach((g) => {
      if (present.has(g)) {
        ordered.push(g);
        present.delete(g);
      }
    });
    const remaining = Array.from(present).sort((a, b) => a.localeCompare(b));
    return [...ordered, ...remaining];
  }, [contentTypeWorks, aniListDetails]);

  // Works filtered by selected genres
  const genreFilteredWorks = useMemo(() => {
    if (selectedGenres.length === 0) return contentTypeWorks;
    return contentTypeWorks.filter((w) => {
      const workGenres = aniListDetails[w.work_id]?.genres;
      if (!Array.isArray(workGenres)) return false;
      return selectedGenres.every((g) => workGenres.includes(g));
    });
  }, [contentTypeWorks, selectedGenres, aniListDetails]);

  // Live counts per status
  const statusCounts = useMemo(() => {
    const counts: Record<TabStatus, number> = {
      PLANNING: 0,
      CURRENT: 0,
      COMPLETED: 0,
      PAUSED: 0,
      DROPPED: 0,
    };
    genreFilteredWorks.forEach((w) => {
      if (w.status in counts) {
        counts[w.status as TabStatus] += 1;
      }
    });
    return counts;
  }, [genreFilteredWorks]);

  // Filtered & sorted works for active tab
  const visibleWorks = useMemo(() => {
    const queryLower = searchQuery.trim().toLowerCase();

    return genreFilteredWorks
      .filter((w) => w.status === activeTab)
      .filter(
        (w) =>
          !onlyMalOpen ||
          ((w.evaluation?.overallScore || 0) > 0 && !w.mal_rated)
      )
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
          return getAniListTitle(detA).localeCompare(
            getAniListTitle(detB),
            "de"
          );
        }

        if (sortBy === "BEHIND") {
          const behindA = computeBehindCount(
            a,
            detA,
            globalOverrides[a.work_id],
            pausedWorksMap[a.work_id],
            nowMs
          );
          const behindB = computeBehindCount(
            b,
            detB,
            globalOverrides[b.work_id],
            pausedWorksMap[b.work_id],
            nowMs
          );
          if (behindB !== behindA) return behindB - behindA;
        }

        // RECENT: Sort by updated_at desc, then AniList ID desc as tie-breaker
        const updDiff = (b.updated_at || 0) - (a.updated_at || 0);
        if (updDiff !== 0) return updDiff;
        return parseInt(b.work_id, 10) - parseInt(a.work_id, 10);
      });
  }, [
    genreFilteredWorks,
    activeTab,
    onlyMalOpen,
    searchQuery,
    sortBy,
    aniListDetails,
    globalOverrides,
    pausedWorksMap,
    nowMs,
  ]);

  const handleQuickIncrement = async (work: UserWork) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const current = work.current_episode || 0;
    const details = aniListDetails[work.work_id];
    const globalOverride = globalOverrides[work.work_id];
    const pauseInfo = pausedWorksMap[work.work_id] || null;
    const releaseInfo = computeWorkReleaseInfo({
      media: details,
      override: globalOverride,
      pauseInfo,
      userWork: work,
      nowMs,
    });
    const maxAllowed = releaseInfo.maxAllowedProgress;
    if (maxAllowed !== null && current >= maxAllowed) return;
    const nextEp =
      maxAllowed !== null ? Math.min(current + 1, maxAllowed) : current + 1;
    if (nextEp <= current) return;

    const prevUpdatedAt = work.updated_at;
    const nextUpdatedAt = Date.now();
    setAllWorks((prev) =>
      prev.map((w) =>
        w.work_id === work.work_id
          ? {
              ...w,
              current_episode: nextEp,
              updated_at: nextUpdatedAt,
              auto_added: false,
            }
          : w
      )
    );

    try {
      await updateEpisodeProgress(uid, work.work_id, nextEp);
    } catch (error) {
      console.error("Fehler beim Aktualisieren des Fortschritts:", error);
      toast.error("Fortschritt konnte nicht gespeichert werden.");
      setAllWorks((prev) =>
        prev.map((w) =>
          w.work_id === work.work_id
            ? { ...w, current_episode: current, updated_at: prevUpdatedAt }
            : w
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
    const prevUpdatedAt = editingWork.updated_at;

    const details = aniListDetails[editingWork.work_id];
    const globalOverride = globalOverrides[editingWork.work_id];
    const pauseInfo = pausedWorksMap[editingWork.work_id] || null;
    const releaseInfo = computeWorkReleaseInfo({
      media: details,
      override: globalOverride,
      pauseInfo,
      userWork: editingWork,
      nowMs,
    });

    const maxAllowed = releaseInfo.maxAllowedProgress;
    const rawEpisode = Math.max(0, editEpisode);
    const sanitizedEpisode =
      maxAllowed !== null && editStatus !== "COMPLETED"
        ? Math.min(rawEpisode, maxAllowed)
        : rawEpisode;

    const nextDroppedReason =
      editStatus === "DROPPED" ? editDroppedReason.trim() : prevDroppedReason;
    const nextUpdatedAt = Date.now();

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
              updated_at: nextUpdatedAt,
              auto_added: false,
            }
          : w
      )
    );

    try {
      // Single atomic saveUserWork call instead of 3 parallel writes
      await saveUserWork(uid, editingWork.work_id, {
        current_episode: sanitizedEpisode,
        status: editStatus,
        auto_added: false,
        ...(editStatus === "DROPPED"
          ? { dropped_reason: nextDroppedReason }
          : {}),
      });
      setEditingWork(null);
      toast.success("Änderungen gespeichert.");
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      toast.error("Fehler beim Speichern.");
      setAllWorks((prev) =>
        prev.map((w) =>
          w.work_id === editingWork.work_id
            ? {
                ...w,
                current_episode: prevEpisode,
                status: prevStatus,
                dropped_reason: prevDroppedReason,
                updated_at: prevUpdatedAt,
              }
            : w
        )
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleQuickUnpauseItem = async (workId: string) => {
    try {
      await unpauseWork(workId);
      setPausedWorksMap((prev) => {
        const next = { ...prev };
        delete next[workId];
        return next;
      });
      toast.success("Pause aufgehoben.");
    } catch (err) {
      console.error("Failed to unpause work:", err);
      toast.error("Fehler beim Aufheben der Pause.");
    }
  };

  const unitPrefix = contentType === "MANGA" ? "KAP" : "EP";
  const progressBarColor =
    contentType === "MANGA" ? "bg-purple-500" : "bg-accent";
  const activeSortLabel =
    sortBy === "TITLE"
      ? "A-Z"
      : sortBy === "BEHIND"
      ? contentType === "MANGA"
        ? "Offene Kap."
        : "Offene Folgen"
      : "Zuletzt";

  const randomEligibleWishlistWorks = useMemo(() => {
    if (activeTab !== "PLANNING") return [];
    return visibleWorks.filter((w) =>
      isWishlistWorkEligibleForDice(
        w,
        aniListDetails[w.work_id],
        globalOverrides[w.work_id],
        nowMs
      )
    );
  }, [activeTab, visibleWorks, aniListDetails, globalOverrides, nowMs]);

  const handlePickRandomWishlist = (excludeWorkId?: string) => {
    if (randomEligibleWishlistWorks.length === 0) return;
    const pool =
      randomEligibleWishlistWorks.length > 1 && excludeWorkId
        ? randomEligibleWishlistWorks.filter(
            (w) => w.work_id !== excludeWorkId
          )
        : randomEligibleWishlistWorks;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen) setRandomPickWork(chosen);
  };

  const handleStartRandomPick = async () => {
    if (!randomPickWork || isStartingRandom) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setIsStartingRandom(true);
    try {
      const nextUpdatedAt = Date.now();
      await updateUserWorkStatus(uid, randomPickWork.work_id, "CURRENT");
      setAllWorks((prev) =>
        prev.map((w) =>
          w.work_id === randomPickWork.work_id
            ? { ...w, status: "CURRENT", updated_at: nextUpdatedAt }
            : w
        )
      );
      setRandomPickWork(null);
      setActiveTab("CURRENT");
      toast.success("Werk auf Aktiv verschoben.");
    } catch (err) {
      console.error("Failed to start random wishlist work:", err);
      toast.error("Fehler beim Verschieben auf Aktiv.");
    } finally {
      setIsStartingRandom(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-4 max-w-4xl mx-auto">
      {/* Compact Top Row: Search + Sort/Filter Button + (Optional Dice on Planung) + 1/2 Column Switcher */}
      <div className="relative flex items-center gap-2" ref={filterMenuRef}>
        <div className="relative flex-1 min-w-0">
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"
            size={15}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`${
              contentType === "MANGA" ? "Manga" : "Anime"
            } in Bibliothek suchen...`}
            className="w-full rounded-xl border border-gray-800 bg-surface-elevated py-2 pl-9 pr-8 text-sm text-white placeholder:text-gray-500 focus:border-accent-border-strong focus:outline-none transition-colors"
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

        {/* Subtle Random Wishlist Dice Button (ONLY on Planung tab with released works) */}
        {activeTab === "PLANNING" && randomEligibleWishlistWorks.length >= 1 && (
          <button
            type="button"
            onClick={() => handlePickRandomWishlist()}
            className="flex items-center justify-center p-2 rounded-xl border border-gray-800 bg-surface-elevated text-gray-300 hover:text-purple-300 hover:border-purple-500/40 transition-colors shrink-0"
            title="Zufälliges bereits erschienenes Werk aus der Wunschliste wählen"
            aria-label="Zufall aus Wunschliste"
          >
            <Dices size={15} />
          </button>
        )}

        {/* Sort & Filter Popover Trigger */}
        <button
          type="button"
          onClick={() => setShowFilterMenu((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold shrink-0 transition-colors ${
            showFilterMenu ||
            sortBy !== "RECENT" ||
            onlyMalOpen ||
            selectedGenres.length > 0
              ? "bg-accent-soft border-accent-border-strong text-accent-light"
              : "bg-surface-elevated border-gray-800 text-gray-300 hover:text-white"
          }`}
          title="Sortierung & Filter"
        >
          <ArrowUpDown size={14} />
          <span>{activeSortLabel}</span>
          {selectedGenres.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-bold">
              {selectedGenres.length}
            </span>
          )}
          {onlyMalOpen && (
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          )}
        </button>

        {/* 1-Column / 2-Column Layout Toggle */}
        <div className="flex items-center bg-surface-elevated border border-gray-800 rounded-xl p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => handleToggleColumns(1)}
            aria-label="1 Spalte"
            title="1 Spalte (Listenansicht)"
            className={`p-1.5 rounded-lg transition-colors ${
              viewColumns === 1
                ? "bg-accent text-white"
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
                ? "bg-accent text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <LayoutGrid size={15} />
          </button>
        </div>

        {/* Collapsible Sort & Filter Popover */}
        {showFilterMenu && (
          <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-2xl border border-gray-700 bg-surface p-3 shadow-2xl flex flex-col gap-3">
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
                        ? "bg-accent text-white"
                        : "bg-surface-elevated text-gray-300 hover:text-white"
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
                    : "bg-surface-elevated border-gray-800 text-gray-300 hover:text-white"
                }`}
              >
                <span>Nur AniList/MAL offen</span>
                {onlyMalOpen && <Check size={13} />}
              </button>
            </div>

            {/* Subtle Genre Filter Section */}
            <div className="border-t border-gray-800 pt-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Genre
                </span>
                {selectedGenres.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedGenres([])}
                    className="text-[11px] font-semibold text-gray-400 hover:text-white transition-colors"
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                {availableGenres.map((genre) => {
                  const active = selectedGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => toggleGenre(genre)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                        active
                          ? "bg-accent-soft-hover border-accent-border-strong text-accent-soft-text"
                          : "bg-surface-elevated border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
                      }`}
                    >
                      {genre}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Slim active genre chips */}
      {selectedGenres.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5 -mt-1">
          {selectedGenres.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => toggleGenre(genre)}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent-soft border border-accent-border text-accent-light hover:bg-accent-soft-hover transition-colors"
              title={`${genre}-Filter entfernen`}
            >
              <span>{genre}</span>
              <X size={11} />
            </button>
          ))}
          {selectedGenres.length > 1 && (
            <button
              type="button"
              onClick={() => setSelectedGenres([])}
              className="text-[11px] text-gray-500 hover:text-gray-300 px-1 transition-colors"
            >
              Alle löschen
            </button>
          )}
        </div>
      )}

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
                  ? "bg-accent border-accent-border-strong text-white shadow-sm"
                  : "bg-surface-elevated border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Subtle 1-line Collapsible Sequel Available Hint */}
      {!isLoading && availableSequels.length > 0 && (
        <div className="rounded-xl border border-accent-border bg-surface/90 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowSequels((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.03] transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-accent-light truncate">
              <Sparkles size={13} className="text-accent-text shrink-0" />
              <span>
                {availableSequels.length === 1
                  ? "1 Fortsetzung verfügbar"
                  : `${availableSequels.length} Fortsetzungen verfügbar`}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
              {showSequels ? "Ausblenden" : "Anzeigen"}
              {showSequels ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </span>
          </button>

          {showSequels && (
            <div className="border-t border-gray-800/80 divide-y divide-gray-800/60">
              {availableSequels.map((seq) => {
                const isReleasing = seq.status === "RELEASING";
                const isBusy = addingSequelId === seq.id;
                return (
                  <div
                    key={seq.id}
                    className="flex items-center gap-2.5 px-3 py-2 bg-surface-inset/70"
                  >
                    <Link
                      href={`/work/${seq.id}`}
                      className="w-8 h-11 rounded overflow-hidden bg-gray-800 shrink-0 block"
                    >
                      {seq.cover && (
                        <img
                          src={seq.cover}
                          alt={seq.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </Link>

                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/work/${seq.id}`}
                        className="text-xs font-semibold text-white hover:text-accent-light transition-colors truncate block"
                      >
                        {seq.title}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                        <span
                          className={`px-1.5 py-0.5 leading-none rounded font-semibold ${
                            isReleasing
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-purple-500/15 text-purple-300"
                          }`}
                        >
                          {isReleasing ? "Läuft jetzt" : "Angekündigt"}
                        </span>
                        {seq.fromTitle && (
                          <span className="text-gray-500 truncate">
                            nach {seq.fromTitle}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleQuickAddSequel(seq)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-accent-soft hover:bg-accent text-accent-light hover:text-white border border-accent-border transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        {isBusy ? "..." : isReleasing ? "+ Aktiv" : "+ Planung"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissSequel(seq.id)}
                        className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                        title="Hinweis ausblenden"
                        aria-label="Hinweis ausblenden"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
                className="flex items-center gap-3 p-3 rounded-2xl border border-gray-800 bg-surface-elevated animate-pulse"
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
      ) : !isLoggedIn ? (
        <div className="rounded-2xl border border-gray-800 bg-surface-elevated p-8 text-center text-sm text-gray-400 flex flex-col items-center gap-3">
          <p>Melde dich an, um deine persönliche Bibliothek zu verwalten.</p>
          <Link
            href="/login"
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition"
          >
            Jetzt anmelden
          </Link>
        </div>
      ) : visibleWorks.length === 0 ? (
        <div className="rounded-2xl border border-gray-800 bg-surface-elevated p-10 text-center text-sm text-gray-400 flex flex-col items-center gap-2.5">
          <p>
            {searchQuery || selectedGenres.length > 0 || onlyMalOpen
              ? "Keine passenden Einträge für deine Filter in dieser Kategorie gefunden."
              : "Keine Werke in dieser Kategorie vorhanden."}
          </p>
          {(selectedGenres.length > 0 || onlyMalOpen) && (
            <button
              type="button"
              onClick={() => {
                setSelectedGenres([]);
                setOnlyMalOpen(false);
              }}
              className="text-xs font-semibold text-accent-text hover:text-accent-light underline"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      ) : viewColumns === 2 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {visibleWorks.map((work) => {
            const details = aniListDetails[work.work_id];
            const globalOverride = globalOverrides[work.work_id];
            const pauseInfo = pausedWorksMap[work.work_id] || null;
            const isPaused = Boolean(pauseInfo);

            const title = getAniListTitle(details, `Werk #${work.work_id}`);
            const coverSrc =
              details?.coverImage?.large || details?.coverImage?.extraLarge;

            const current = work.current_episode || 0;
            const total = getTotalCount(work, details, globalOverride);
            const progressPct = total
              ? Math.min(100, Math.max(0, (current / total) * 100))
              : current > 0
              ? 100
              : 0;

            const releaseInfo = computeWorkReleaseInfo({
              media: details,
              override: globalOverride,
              pauseInfo,
              userWork: work,
              nowMs,
            });
            const behindCount = releaseInfo.behindCount;

            const isCompleted =
              work.status === "COMPLETED" ||
              (total !== null && total > 0 && current >= total);
            const isCaughtUp =
              !isCompleted &&
              releaseInfo.maxAllowedProgress !== null &&
              current >= releaseInfo.maxAllowedProgress;
            const userScore =
              Number(work.evaluation?.overallScore) ||
              Number(work.evaluation?.manualScore) ||
              0;

            return (
              <div
                key={work.work_id}
                className="flex flex-col justify-between gap-2.5 p-2.5 rounded-2xl border border-gray-800/90 bg-surface-elevated hover:border-gray-700 transition-colors"
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
                      <span className="absolute top-0.5 right-0.5 rounded bg-accent px-1 py-0.5 leading-none text-[9px] font-bold text-white shadow">
                        +{behindCount}
                      </span>
                    )}
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <Link
                      href={`/work/${work.work_id}`}
                      className="font-semibold text-xs text-white hover:text-accent-light transition-colors line-clamp-2 leading-snug"
                    >
                      {title}
                    </Link>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-gray-400 tabular-nums">
                        {unitPrefix} {current} / {total ?? "?"}
                      </span>
                      {isCompleted && userScore > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300 tabular-nums"
                          title={`Deine Bewertung: ${userScore.toFixed(1)} / 10`}
                        >
                          <Star
                            size={10}
                            className="fill-amber-400 text-amber-400"
                          />
                          {userScore.toFixed(1)}
                        </span>
                      )}
                    </div>
                    {isPaused && pauseInfo && (
                      <div className="flex items-center gap-1 flex-wrap mt-0.5">
                        <span className="inline-flex items-center rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 leading-none text-[9px] font-bold text-amber-300">
                          {formatPauseStatusLabel(pauseInfo.paused_until)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            handleQuickUnpauseItem(work.work_id);
                          }}
                          className="text-[9px] font-bold text-accent-text hover:underline"
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
                      isCompleted ? "bg-emerald-500" : progressBarColor
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-1.5">
                  {isCompleted ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 text-[11px] font-semibold text-emerald-400">
                      <Check size={12} />
                      Fertig
                    </span>
                  ) : isCaughtUp ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-accent-soft border border-accent-border px-2 py-1 text-[11px] font-semibold text-accent-light">
                      <Check size={12} />
                      Aktuell
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleQuickIncrement(work)}
                      className="flex-1 rounded-lg bg-surface-control hover:bg-accent text-[11px] font-semibold text-white py-1 px-2 transition-colors whitespace-nowrap text-center"
                    >
                      + {unitPrefix} {current + 1}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditModal(work)}
                    className="p-1.5 rounded-lg bg-surface-control hover:bg-gray-700 text-gray-300 hover:text-white transition-colors shrink-0"
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
            const pauseInfo = pausedWorksMap[work.work_id] || null;
            const isPaused = Boolean(pauseInfo);

            const title = getAniListTitle(details, `Werk #${work.work_id}`);
            const coverSrc =
              details?.coverImage?.large || details?.coverImage?.extraLarge;

            const current = work.current_episode || 0;
            const total = getTotalCount(work, details, globalOverride);
            const progressPct = total
              ? Math.min(100, Math.max(0, (current / total) * 100))
              : current > 0
              ? 100
              : 0;

            const releaseInfo = computeWorkReleaseInfo({
              media: details,
              override: globalOverride,
              pauseInfo,
              userWork: work,
              nowMs,
            });
            const behindCount = releaseInfo.behindCount;
            const nextReleaseText = formatNextReleaseLabel(
              work,
              details,
              globalOverride,
              pauseInfo,
              nowMs
            );

            const isCompleted =
              work.status === "COMPLETED" ||
              (total !== null && total > 0 && current >= total);
            const isCaughtUp =
              !isCompleted &&
              releaseInfo.maxAllowedProgress !== null &&
              current >= releaseInfo.maxAllowedProgress;
            const userScore =
              Number(work.evaluation?.overallScore) ||
              Number(work.evaluation?.manualScore) ||
              0;

            return (
              <div
                key={work.work_id}
                className="flex items-center gap-3.5 p-3 rounded-2xl border border-gray-800/90 bg-surface-elevated hover:border-gray-700 transition-colors"
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
                    className="font-semibold text-sm sm:text-base text-white hover:text-accent-light transition-colors line-clamp-1"
                  >
                    {title}
                  </Link>

                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isCompleted ? "bg-emerald-500" : progressBarColor
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-gray-300 tabular-nums shrink-0">
                      {unitPrefix} {current} / {total ?? "?"}
                    </span>
                  </div>

                  <div className="flex items-center flex-wrap gap-2">
                    {isPaused && pauseInfo ? (
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                          {formatPauseStatusLabel(pauseInfo.paused_until)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuickUnpauseItem(work.work_id)}
                          className="text-[11px] font-bold text-accent-text hover:text-accent-light hover:underline"
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
                    {isCompleted && userScore > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 text-[11px] font-semibold text-amber-300 tabular-nums"
                        title={`Deine Bewertung: ${userScore.toFixed(1)} / 10`}
                      >
                        <Star
                          size={11}
                          className="fill-amber-400 text-amber-400"
                        />
                        {userScore.toFixed(1)}
                      </span>
                    )}
                    {behindCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-accent-soft border border-accent-border px-2 py-0.5 text-[10px] font-semibold text-accent-light">
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
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-400">
                      <Check size={13} />
                      Fertig
                    </span>
                  ) : isCaughtUp ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft border border-accent-border px-3 py-1.5 text-xs font-semibold text-accent-light">
                      <Check size={13} />
                      Aktuell
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleQuickIncrement(work)}
                      className="rounded-full bg-surface-control hover:bg-accent text-xs font-semibold text-white px-3 py-1.5 transition-colors whitespace-nowrap"
                    >
                      + {unitPrefix} {current + 1}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditModal(work)}
                    className="p-2 rounded-full bg-surface-control hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
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
      {editingWork &&
        (() => {
          const editDetails = aniListDetails[editingWork.work_id];
          const editTitle = getAniListTitle(
            editDetails,
            `Werk #${editingWork.work_id}`
          );
          const editCover =
            editDetails?.coverImage?.large ||
            editDetails?.coverImage?.extraLarge;
          const editTotal = getTotalCount(
            editingWork,
            editDetails,
            globalOverrides[editingWork.work_id]
          );

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
              onClick={() => !isSavingEdit && setEditingWork(null)}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-gray-800 bg-surface shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-800/80">
                  {editCover && (
                    <img
                      src={editCover}
                      alt=""
                      className="w-8 h-11 rounded-lg object-cover bg-gray-800 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Schnell bearbeiten
                    </p>
                    <h2 className="text-sm font-bold text-white truncate">
                      {editTitle}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => !isSavingEdit && setEditingWork(null)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                    aria-label="Schließen"
                  >
                    <X size={17} />
                  </button>
                </div>

                {/* Body */}
                <div className="p-4 flex flex-col gap-3">
                  {/* Episode / Chapter Adjuster */}
                  <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-2.5">
                    <label className="text-xs font-bold text-white">
                      {contentType === "MANGA"
                        ? "Dein Stand (gelesene Kapitel)"
                        : "Dein Stand (gesehene Folgen)"}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditEpisode((prev) => Math.max(0, prev - 1))
                        }
                        className="p-2.5 rounded-xl bg-surface-control border border-gray-700 hover:bg-gray-700 text-white transition-colors"
                        aria-label="Verringern"
                      >
                        <Minus size={15} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={editEpisode}
                        onChange={(e) =>
                          setEditEpisode(
                            Math.max(0, parseInt(e.target.value, 10) || 0)
                          )
                        }
                        className="flex-1 rounded-xl border border-gray-700 bg-surface-control px-3 py-2 text-center text-base font-bold text-white focus:border-accent-border-strong focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => setEditEpisode((prev) => prev + 1)}
                        className="p-2.5 rounded-xl bg-surface-control border border-gray-700 hover:bg-gray-700 text-white transition-colors"
                        aria-label="Erhöhen"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Status Selector */}
                  <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-2.5">
                    <label className="text-xs font-bold text-white">
                      Status
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {STATUS_TABS.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => {
                            setEditStatus(tab.key);
                            if (
                              tab.key === "COMPLETED" &&
                              editTotal !== null &&
                              editTotal > 0 &&
                              editEpisode < editTotal
                            ) {
                              setEditEpisode(editTotal);
                            }
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                            editStatus === tab.key
                              ? "bg-accent border-accent-border-strong text-white shadow-sm"
                              : "bg-surface-control border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {editStatus === "DROPPED" && (
                    <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5 flex flex-col gap-2">
                      <label className="text-xs font-bold text-white">
                        Grund für Abbruch (optional)
                      </label>
                      <input
                        type="text"
                        value={editDroppedReason}
                        onChange={(e) => setEditDroppedReason(e.target.value)}
                        placeholder="Grund für Abbruch (optional)"
                        className="w-full rounded-xl border border-gray-700 bg-surface-control px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-rose-500 focus:outline-none"
                      />
                    </div>
                  )}

                  {editStatus === "PAUSED" && (
                    <button
                      type="button"
                      onClick={() => setEditStatus("CURRENT")}
                      className="w-full rounded-xl border border-accent-border bg-accent-soft hover:bg-accent-soft-hover px-3 py-2 text-xs font-semibold text-accent-light transition-colors"
                    >
                      Entpausieren (Aktiv setzen)
                    </button>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-800/80 bg-surface-inset">
                  <Link
                    href={`/work/${editingWork.work_id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text hover:text-accent-light transition-colors"
                  >
                    <ExternalLink size={14} />
                    Zur Detailseite
                  </Link>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingWork(null)}
                      disabled={isSavingEdit}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveQuickEdit}
                      disabled={isSavingEdit}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-md"
                    >
                      {isSavingEdit ? "Speichern..." : "Speichern"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Compact Random Wishlist Pick Modal */}
      {randomPickWork &&
        (() => {
          const det = aniListDetails[randomPickWork.work_id];
          const title = getAniListTitle(det, `Werk #${randomPickWork.work_id}`);
          const cover =
            det?.coverImage?.extraLarge || det?.coverImage?.large || "";
          const genres: string[] = Array.isArray(det?.genres)
            ? det.genres.slice(0, 3)
            : [];
          const totalEps =
            det?.type === "MANGA" ? det?.chapters : det?.episodes;
          const score = det?.averageScore
            ? (det.averageScore / 10).toFixed(1)
            : null;

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
              onClick={() => !isStartingRandom && setRandomPickWork(null)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-gray-800 bg-surface shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/80">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-300">
                    <Dices size={14} />
                    Zufallsauswahl
                    {selectedGenres.length > 0
                      ? ` · ${selectedGenres.join(", ")}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRandomPickWork(null)}
                    className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                    aria-label="Schließen"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="p-4 flex gap-3.5 items-start">
                  <Link
                    href={`/work/${randomPickWork.work_id}`}
                    className="w-20 h-28 rounded-xl overflow-hidden bg-gray-800 shrink-0 block"
                  >
                    {cover && (
                      <img
                        src={cover}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </Link>
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <Link
                      href={`/work/${randomPickWork.work_id}`}
                      className="text-sm font-bold text-white hover:text-accent-light transition-colors line-clamp-2 leading-snug"
                    >
                      {title}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {score && (
                        <span className="inline-flex items-center gap-1 text-amber-300 font-semibold tabular-nums">
                          <Star
                            size={11}
                            className="fill-amber-400 text-amber-400"
                          />
                          {score}
                        </span>
                      )}
                      {totalEps && (
                        <span>
                          {totalEps}{" "}
                          {det?.type === "MANGA" ? "Kap." : "Folgen"}
                        </span>
                      )}
                    </div>
                    {genres.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {genres.map((g) => (
                          <span
                            key={g}
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-inset border border-gray-800 text-gray-300"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-800/80 bg-surface-inset">
                  {randomEligibleWishlistWorks.length > 1 ? (
                    <button
                      type="button"
                      disabled={isStartingRandom}
                      onClick={() =>
                        handlePickRandomWishlist(randomPickWork.work_id)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-gray-200 transition-colors"
                    >
                      <Dices size={13} />
                      Nochmal
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/work/${randomPickWork.work_id}`}
                      className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      Details
                    </Link>
                    <button
                      type="button"
                      disabled={isStartingRandom}
                      onClick={handleStartRandomPick}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-md"
                    >
                      {isStartingRandom ? "..." : "Starten"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
