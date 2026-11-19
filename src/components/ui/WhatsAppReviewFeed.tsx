"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Plus,
  Send,
  Trash2,
  X,
  Search,
  Check,
  SmilePlus,
  Star,
  Loader2,
  MessageSquareText,
  Minus,
  Edit2,
  MessageCircle,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ActivityComment,
  ActivityFeed,
  EpisodeFeedback,
  ReviewListItem,
  UserProfile,
  UserWork,
} from "@/types/database";
import {
  addActivityComment,
  deleteActivityComment,
  getActivityComments,
  getGlobalFeed,
} from "@/lib/db/feed";
import { getAllUserProfiles } from "@/lib/db/users";
import {
  createReviewList,
  deleteReviewList,
  getAllEpisodeFeedback,
  getReviewItemTargetEpisode,
  toggleActivityReaction,
  updateReviewList,
} from "@/lib/db/feedback";
import { updateEpisodeProgress } from "@/lib/db/works";
import { fetchAniList, SEARCH_WORKS } from "@/lib/anilist";
import { useAppStore } from "@/lib/store";

const QUICK_EMOJIS = ["🔥", "❤️", "😂", "👍", "🤯"];

interface DraftReviewItem extends ReviewListItem {
  updateProgress: boolean;
}

interface SelectableWork {
  work_id: string;
  title: string;
  cover?: string;
  media_type: "ANIME" | "MANGA";
  current_episode: number;
}

interface ComparisonEntry {
  user_id: string;
  username: string;
  avatar_url?: string;
  episode_label: string;
  rating?: number;
  text: string;
  timestamp: string;
  source_id: string;
}

interface WhatsAppReviewFeedProps {
  currentUserUid?: string;
  userWorks: UserWork[];
  userAniListDetails: Record<string, any>;
  onProgressUpdated?: (workId: string, newEp: number) => void;
}

function getRatingBadgeClass(rating: number): string {
  if (rating >= 8) {
    return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  }
  if (rating >= 6) {
    return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  }
  return "bg-rose-500/20 text-rose-300 border-rose-500/40";
}

function formatMessageTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    const diffHours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
    if (diffHours < 24) {
      return format(date, "HH:mm");
    }
    return formatDistanceToNow(date, { addSuffix: true, locale: de });
  } catch {
    return "";
  }
}

function formatEpisodeBadge(item: ReviewListItem): string {
  const unit = item.media_type === "MANGA" ? "Kap." : "Folge";
  if (Array.isArray(item.episodes) && item.episodes.length > 1) {
    return `${unit} ${item.episodes.join(", ")}`;
  }
  if (
    typeof item.episode_end === "number" &&
    item.episode_end > item.episode_num
  ) {
    return `${unit} ${item.episode_num}–${item.episode_end}`;
  }
  return `${unit} ${item.episode_num}`;
}

function doReviewItemsOverlap(
  a: { episode_num: number; episode_end?: number; episodes?: number[] },
  b: { episode_num: number; episode_end?: number; episodes?: number[] }
): boolean {
  const getSet = (item: {
    episode_num: number;
    episode_end?: number;
    episodes?: number[];
  }): Set<number> => {
    if (Array.isArray(item.episodes) && item.episodes.length > 0) {
      return new Set(item.episodes);
    }
    if (
      typeof item.episode_end === "number" &&
      item.episode_end > item.episode_num
    ) {
      const s = new Set<number>();
      // Cap range expansion at 300 to avoid large sets
      const end = Math.min(item.episode_end, item.episode_num + 300);
      for (let i = item.episode_num; i <= end; i++) {
        s.add(i);
      }
      return s;
    }
    return new Set([item.episode_num]);
  };

  const setA = getSet(a);
  const setB = getSet(b);
  for (const ep of setA) {
    if (setB.has(ep)) return true;
  }
  return false;
}

export default function WhatsAppReviewFeed({
  currentUserUid,
  userWorks,
  userAniListDetails,
  onProgressUpdated,
}: WhatsAppReviewFeedProps) {
  const isOnline = useAppStore((s) => s.isOnline);
  const contentType = useAppStore((s) => s.contentType);

  const [activities, setActivities] = useState<ActivityFeed[]>([]);
  const [allFeedback, setAllFeedback] = useState<EpisodeFeedback[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>(
    {}
  );
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);

  // Media filter (Alle Medien / Anime / Manga)
  const [mediaFilter, setMediaFilter] = useState<"ALL" | "ANIME" | "MANGA">(
    "ALL"
  );

  // Composer & Edit state
  const [editingActivityId, setEditingActivityId] = useState<string | null>(
    null
  );
  const [title, setTitle] = useState("");
  const [composerMediaType, setComposerMediaType] = useState<"ANIME" | "MANGA">(
    contentType === "MANGA" ? "MANGA" : "ANIME"
  );
  const [draftItems, setDraftItems] = useState<DraftReviewItem[]>([]);
  const [isSending, setIsSending] = useState(false);

  // Sync composer media type with top header toggle when draft is empty and not editing
  useEffect(() => {
    if (draftItems.length === 0 && !editingActivityId) {
      setComposerMediaType(contentType === "MANGA" ? "MANGA" : "ANIME");
    }
  }, [contentType, draftItems.length, editingActivityId]);

  // Picker Modal state (supports both adding new draft items and editing an existing draft item by index)
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(
    null
  );
  const [pickerSearch, setPickerSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SelectableWork[]>([]);
  const [isSearchingAniList, setIsSearchingAniList] = useState(false);
  const [selectedWork, setSelectedWork] = useState<SelectableWork | null>(null);
  const [epMode, setEpMode] = useState<"SINGLE" | "RANGE" | "MULTI">("SINGLE");
  const [epNum, setEpNum] = useState<number>(1);
  const [epEndNum, setEpEndNum] = useState<number>(2);
  const [multiEps, setMultiEps] = useState<number[]>([1]);
  const [multiEpCandidate, setMultiEpCandidate] = useState<number>(2);
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState<number | undefined>(undefined);
  const [updateProgress, setUpdateProgress] = useState(true);

  // Emoji picker toggle per activity
  const [openReactionForId, setOpenReactionForId] = useState<string | null>(
    null
  );

  // Text Comments / Opinions state per activity
  const [openCommentsForIds, setOpenCommentsForIds] = useState<
    Record<string, boolean>
  >({});
  const [commentsByActivity, setCommentsByActivity] = useState<
    Record<string, ActivityComment[]>
  >({});
  const [loadingCommentsForIds, setLoadingCommentsForIds] = useState<
    Record<string, boolean>
  >({});
  const [commentInputByActivity, setCommentInputByActivity] = useState<
    Record<string, string>
  >({});
  const [sendingCommentForIds, setSendingCommentForIds] = useState<
    Record<string, boolean>
  >({});

  // Expanded Comparison detail toggle per activity item key
  const [openComparisonKey, setOpenComparisonKey] = useState<string | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    async function loadFeed() {
      setIsLoadingFeed(true);
      try {
        const [feedData, profiles, feedbackList] = await Promise.all([
          getGlobalFeed(60),
          getAllUserProfiles(),
          getAllEpisodeFeedback(300),
        ]);
        if (cancelled) return;
        const profileMap: Record<string, UserProfile> = {};
        profiles.forEach((p) => {
          if (p.uid) {
            profileMap[p.uid] = p;
          }
        });
        setUserProfiles(profileMap);
        setActivities(feedData);
        setAllFeedback(feedbackList);
      } catch (err) {
        console.error("Failed to load WhatsApp review feed:", err);
      } finally {
        if (!cancelled) setIsLoadingFeed(false);
      }
    }
    loadFeed();
    return () => {
      cancelled = true;
    };
  }, [currentUserUid]);

  // Build quick-select list from user's CURRENT works matching composerMediaType
  const activeSelectableWorks = useMemo<SelectableWork[]>(() => {
    return userWorks
      .filter((w) => w.status === "CURRENT")
      .map((w) => {
        const details = userAniListDetails[w.work_id];
        const workTitle =
          details?.title?.english ||
          details?.title?.romaji ||
          `Werk #${w.work_id}`;
        const cover =
          details?.coverImage?.large || details?.coverImage?.extraLarge;
        const mediaType: "ANIME" | "MANGA" =
          details?.type === "MANGA" ? "MANGA" : "ANIME";
        return {
          work_id: w.work_id,
          title: workTitle,
          cover,
          media_type: mediaType,
          current_episode: Number(w.current_episode) || 0,
        };
      })
      .filter((w) => w.media_type === composerMediaType);
  }, [userWorks, userAniListDetails, composerMediaType]);

  // All library works for local search fallback matching composerMediaType
  const allLibrarySelectableWorks = useMemo<SelectableWork[]>(() => {
    return userWorks
      .map((w) => {
        const details = userAniListDetails[w.work_id];
        const workTitle =
          details?.title?.english ||
          details?.title?.romaji ||
          `Werk #${w.work_id}`;
        const cover =
          details?.coverImage?.large || details?.coverImage?.extraLarge;
        const mediaType: "ANIME" | "MANGA" =
          details?.type === "MANGA" ? "MANGA" : "ANIME";
        return {
          work_id: w.work_id,
          title: workTitle,
          cover,
          media_type: mediaType,
          current_episode: Number(w.current_episode) || 0,
        };
      })
      .filter((w) => w.media_type === composerMediaType);
  }, [userWorks, userAniListDetails, composerMediaType]);

  // Search AniList when pickerSearch has >= 2 chars (only for composerMediaType)
  useEffect(() => {
    const q = pickerSearch.trim();
    if (!isPickerOpen || q.length < 2) {
      setSearchResults([]);
      setIsSearchingAniList(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingAniList(true);
      try {
        const res = await fetchAniList(SEARCH_WORKS, {
          search: q,
          type: composerMediaType,
          page: 1,
          perPage: 10,
        });

        const combined: SelectableWork[] = [];
        const userWorkById = new Map(userWorks.map((w) => [w.work_id, w]));

        (res?.Page?.media || []).forEach((m: any) => {
          const idStr = m.id.toString();
          const existing = userWorkById.get(idStr);
          combined.push({
            work_id: idStr,
            title: m.title?.english || m.title?.romaji || "Unbekannt",
            cover: m.coverImage?.large || m.coverImage?.extraLarge,
            media_type: composerMediaType,
            current_episode: existing
              ? Number(existing.current_episode) || 0
              : 0,
          });
        });

        setSearchResults(combined);
      } catch (err) {
        console.error("AniList search in review picker failed:", err);
      } finally {
        setIsSearchingAniList(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [pickerSearch, isPickerOpen, userWorks, composerMediaType]);

  // Filtered feed: ONLY show REVIEW_LIST and RATING activities
  const visibleActivities = useMemo(() => {
    return activities.filter((act) => {
      const isSupportedType =
        act.action_type === "REVIEW_LIST" || act.action_type === "RATING";
      if (!isSupportedType) return false;

      if (mediaFilter !== "ALL") {
        if (act.action_type === "REVIEW_LIST") {
          const items = act.review_items || [];
          const hasMedia = items.some(
            (item) => item.media_type === mediaFilter
          );
          if (!hasMedia) return false;
        } else if (act.work_id) {
          const details = userAniListDetails[act.work_id];
          if (details?.type && details.type !== mediaFilter) return false;
        }
      }

      return true;
    });
  }, [activities, mediaFilter, userAniListDetails]);

  // Helper to find other users' reviews/ratings for the same work & overlapping episode/chapter
  const getComparisonsForItem = (
    activityId: string,
    authorId: string,
    item: ReviewListItem
  ): ComparisonEntry[] => {
    const byUser = new Map<string, ComparisonEntry>();
    const unit = item.media_type === "MANGA" ? "Kap." : "Folge";

    // 1. Check all REVIEW_LIST activities in the feed
    for (const act of activities) {
      if (
        act.activity_id === activityId ||
        act.user_id === authorId ||
        act.action_type !== "REVIEW_LIST" ||
        !Array.isArray(act.review_items)
      ) {
        continue;
      }
      for (const otherItem of act.review_items) {
        if (otherItem.work_id !== item.work_id) continue;
        if (doReviewItemsOverlap(item, otherItem)) {
          const profile = userProfiles[act.user_id];
          const existing = byUser.get(act.user_id);
          if (!existing || act.timestamp > existing.timestamp) {
            byUser.set(act.user_id, {
              user_id: act.user_id,
              username: profile?.username || "Unbekannt",
              avatar_url: profile?.avatar_url,
              episode_label: formatEpisodeBadge(otherItem),
              rating: otherItem.rating,
              text: otherItem.text,
              timestamp: act.timestamp,
              source_id: act.activity_id,
            });
          }
        }
      }
    }

    // 2. Also check global episode_feedback collection (in case rated on Work Detail page or older posts)
    for (const fb of allFeedback) {
      if (fb.user_id === authorId || fb.work_id !== item.work_id) continue;
      if (fb.activity_id && fb.activity_id === activityId) continue;
      if (
        doReviewItemsOverlap(item, {
          episode_num: fb.episode_num,
        })
      ) {
        const profile = userProfiles[fb.user_id];
        const existing = byUser.get(fb.user_id);
        if (!existing || fb.timestamp > existing.timestamp) {
          byUser.set(fb.user_id, {
            user_id: fb.user_id,
            username: profile?.username || "Unbekannt",
            avatar_url: profile?.avatar_url,
            episode_label: `${unit} ${fb.episode_num}`,
            rating: fb.rating,
            text: fb.text,
            timestamp: fb.timestamp,
            source_id: fb.feedback_id,
          });
        }
      }
    }

    // Sort so currentUserUid appears first if present
    return Array.from(byUser.values()).sort((a, b) => {
      if (currentUserUid) {
        if (a.user_id === currentUserUid) return -1;
        if (b.user_id === currentUserUid) return 1;
      }
      return b.timestamp.localeCompare(a.timestamp);
    });
  };

  const openPickerForNew = () => {
    setEditingDraftIndex(null);
    setSelectedWork(null);
    setPickerSearch("");
    setSearchResults([]);
    setEpMode("SINGLE");
    setEpNum(1);
    setEpEndNum(2);
    setMultiEps([1]);
    setMultiEpCandidate(2);
    setReviewText("");
    setRating(undefined);
    setUpdateProgress(true);
    setIsPickerOpen(true);
  };

  const openPickerForEditDraftItem = (idx: number) => {
    const item = draftItems[idx];
    if (!item) return;

    const existingUserWork = userWorks.find((w) => w.work_id === item.work_id);
    setEditingDraftIndex(idx);
    setSelectedWork({
      work_id: item.work_id,
      title: item.work_title,
      cover: item.work_cover,
      media_type: item.media_type,
      current_episode: existingUserWork
        ? Number(existingUserWork.current_episode) || 0
        : item.episode_num,
    });

    if (Array.isArray(item.episodes) && item.episodes.length > 1) {
      setEpMode("MULTI");
      setMultiEps(item.episodes);
      setMultiEpCandidate(Math.max(...item.episodes) + 1);
      setEpNum(item.episode_num);
      setEpEndNum(item.episode_num + 1);
    } else if (
      typeof item.episode_end === "number" &&
      item.episode_end > item.episode_num
    ) {
      setEpMode("RANGE");
      setEpNum(item.episode_num);
      setEpEndNum(item.episode_end);
      setMultiEps([item.episode_num]);
      setMultiEpCandidate(item.episode_end + 1);
    } else {
      setEpMode("SINGLE");
      setEpNum(item.episode_num);
      setEpEndNum(item.episode_num + 1);
      setMultiEps([item.episode_num]);
      setMultiEpCandidate(item.episode_num + 1);
    }

    setReviewText(item.text || "");
    setRating(item.rating);
    setUpdateProgress(item.updateProgress);
    setIsPickerOpen(true);
  };

  const handleSelectWork = (work: SelectableWork) => {
    const nextEp = work.current_episode > 0 ? work.current_episode + 1 : 1;
    setSelectedWork(work);
    setEpMode("SINGLE");
    setEpNum(nextEp);
    setEpEndNum(
      Math.max(nextEp + 1, work.current_episode > 0 ? work.current_episode + 5 : 10)
    );
    setMultiEps([nextEp]);
    setMultiEpCandidate(nextEp + 1);
    setReviewText("");
    setRating(undefined);
    setUpdateProgress(true);
  };

  const handleSwitchEpMode = (mode: "SINGLE" | "RANGE" | "MULTI") => {
    setEpMode(mode);
    if (mode === "RANGE") {
      const start =
        selectedWork && selectedWork.current_episode === 0 ? 1 : epNum;
      const end = Math.max(start + 1, epEndNum, epNum);
      setEpNum(start);
      setEpEndNum(end);
    } else if (mode === "MULTI") {
      const base = Math.max(1, epNum || 1);
      if (multiEps.length === 0) {
        setMultiEps([base]);
        setMultiEpCandidate(base + 1);
      }
    }
  };

  const handleAddMultiEp = (numToAdd?: number) => {
    const val = Math.max(1, numToAdd ?? multiEpCandidate);
    setMultiEps((prev) => {
      const next = Array.from(new Set([...prev, val])).sort((a, b) => a - b);
      const maxVal = next[next.length - 1] || val;
      setMultiEpCandidate(maxVal + 1);
      return next;
    });
  };

  const handleRemoveMultiEp = (numToRemove: number) => {
    setMultiEps((prev) => prev.filter((n) => n !== numToRemove));
  };

  const handleAddDraftItem = () => {
    if (!selectedWork) return;
    const trimmedText = reviewText.trim();
    if (!trimmedText && rating === undefined) return;
    if (epMode === "MULTI" && multiEps.length === 0) return;

    let finalEpNum = Math.max(1, epNum || 1);
    let finalEpEnd: number | undefined = undefined;
    let finalEpisodes: number[] | undefined = undefined;

    if (epMode === "RANGE") {
      const start = Math.max(1, Math.min(epNum || 1, epEndNum || 1));
      const end = Math.max(start, epEndNum || start);
      finalEpNum = start;
      if (end > start) {
        finalEpEnd = end;
      }
    } else if (epMode === "MULTI") {
      const sorted = Array.from(new Set(multiEps.filter((n) => n >= 1))).sort(
        (a, b) => a - b
      );
      if (sorted.length === 0) return;
      finalEpNum = sorted[sorted.length - 1];
      if (sorted.length > 1) {
        finalEpisodes = sorted;
      }
    }

    const prevItem =
      editingDraftIndex !== null ? draftItems[editingDraftIndex] : undefined;

    const newItem: DraftReviewItem = {
      work_id: selectedWork.work_id,
      work_title: selectedWork.title,
      work_cover: selectedWork.cover,
      media_type: selectedWork.media_type,
      episode_num: finalEpNum,
      ...(finalEpEnd ? { episode_end: finalEpEnd } : {}),
      ...(finalEpisodes ? { episodes: finalEpisodes } : {}),
      ...(typeof prevItem?.previous_episode === "number"
        ? { previous_episode: prevItem.previous_episode }
        : {}),
      text: trimmedText,
      rating,
      updateProgress,
    };

    if (editingDraftIndex !== null) {
      setDraftItems((prev) =>
        prev.map((it, idx) => (idx === editingDraftIndex ? newItem : it))
      );
    } else {
      setDraftItems((prev) => [...prev, newItem]);
    }
    setEditingDraftIndex(null);
    setIsPickerOpen(false);
  };

  const handleRemoveDraftItem = (index: number) => {
    setDraftItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleStartEditActivity = (activity: ActivityFeed) => {
    if (activity.action_type !== "REVIEW_LIST") return;
    const items = activity.review_items || [];
    const firstMediaType = items[0]?.media_type || "ANIME";
    setEditingActivityId(activity.activity_id);
    setComposerMediaType(firstMediaType);
    setTitle(activity.text || "");
    setDraftItems(
      items.map((item) => ({
        ...item,
        updateProgress: true,
      }))
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEditActivity = () => {
    setEditingActivityId(null);
    setTitle("");
    setDraftItems([]);
  };

  const handleSendReviewList = async () => {
    if (!currentUserUid || draftItems.length === 0 || isSending) return;
    if (!isOnline) {
      alert("Keine Internetverbindung. Senden nicht möglich.");
      return;
    }

    setIsSending(true);
    try {
      // Map current user progress per work_id before applying this review list
      const currentProgressByWork = new Map<string, number>();
      userWorks.forEach((w) => {
        currentProgressByWork.set(w.work_id, Number(w.current_episode) || 0);
      });

      const itemsToSave: ReviewListItem[] = draftItems.map(
        ({ updateProgress: shouldUpdate, ...rest }) => {
          const targetEp = getReviewItemTargetEpisode(rest);
          const prevEp =
            typeof rest.previous_episode === "number"
              ? rest.previous_episode
              : currentProgressByWork.get(rest.work_id) ?? 0;

          if (shouldUpdate) {
            return {
              ...rest,
              previous_episode: prevEp,
              applied_episode: targetEp,
            };
          }
          return rest;
        }
      );

      if (editingActivityId) {
        const oldActivity = activities.find(
          (a) => a.activity_id === editingActivityId
        );
        const oldItems = oldActivity?.review_items || [];
        const newWorkIds = new Set(itemsToSave.map((i) => i.work_id));

        const updated = await updateReviewList(
          editingActivityId,
          currentUserUid,
          title.trim(),
          itemsToSave
        );

        // If an item was removed during editing, roll back its episode progress
        for (const removedItem of oldItems) {
          if (!newWorkIds.has(removedItem.work_id)) {
            const rollbackEp =
              typeof removedItem.previous_episode === "number"
                ? removedItem.previous_episode
                : Math.max(0, removedItem.episode_num - 1);
            await updateEpisodeProgress(
              currentUserUid,
              removedItem.work_id,
              rollbackEp
            );
            onProgressUpdated?.(removedItem.work_id, rollbackEp);
          }
        }

        // Update progress for current items where checked
        const progressUpdates = draftItems.filter((item) => item.updateProgress);
        for (const item of progressUpdates) {
          const targetEp = getReviewItemTargetEpisode(item);
          await updateEpisodeProgress(currentUserUid, item.work_id, targetEp);
          onProgressUpdated?.(item.work_id, targetEp);
        }

        if (updated) {
          setActivities((prev) =>
            prev.map((a) =>
              a.activity_id === editingActivityId ? updated : a
            )
          );
        }

        // Refresh global feedback list for comparisons
        getAllEpisodeFeedback(300).then(setAllFeedback).catch(() => {});

        setEditingActivityId(null);
        setTitle("");
        setDraftItems([]);
      } else {
        const created = await createReviewList(
          currentUserUid,
          title.trim(),
          itemsToSave
        );

        // Update episode progress where checked (set to highest reviewed episode/chapter)
        const progressUpdates = draftItems.filter((item) => item.updateProgress);
        await Promise.all(
          progressUpdates.map(async (item) => {
            const targetEp = getReviewItemTargetEpisode(item);
            await updateEpisodeProgress(currentUserUid, item.work_id, targetEp);
            onProgressUpdated?.(item.work_id, targetEp);
          })
        );

        if (created) {
          setActivities((prev) => [created, ...prev]);
        }

        getAllEpisodeFeedback(300).then(setAllFeedback).catch(() => {});

        setTitle("");
        setDraftItems([]);
      }
    } catch (err) {
      console.error("Failed to send/update review list:", err);
      alert("Fehler beim Speichern der Review-Nachricht.");
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    if (!currentUserUid) return;
    if (
      !window.confirm(
        "Diese Review-Nachricht wirklich löschen? Dein Folgen-/Kapitel-Fortschritt wird dabei wieder auf den vorherigen Stand zurückgesetzt."
      )
    ) {
      return;
    }

    try {
      const targetActivity = activities.find(
        (a) => a.activity_id === activityId
      );
      const deletedItems = await deleteReviewList(activityId, currentUserUid);
      const itemsForRollback =
        deletedItems.length > 0
          ? deletedItems
          : targetActivity?.review_items || [];

      // Roll back episode/chapter progress per work_id (take earliest previous_episode if multiple items for same work)
      const rollbackByWork = new Map<string, number>();
      for (const item of itemsForRollback) {
        let restoredEp: number | undefined = undefined;
        if (
          typeof item.previous_episode === "number" &&
          !Number.isNaN(item.previous_episode)
        ) {
          restoredEp = Math.max(0, item.previous_episode);
        } else {
          // Fallback for older posts created before previous_episode field existed
          const currentUserWork = userWorks.find(
            (w) => w.work_id === item.work_id
          );
          const appliedEp =
            item.applied_episode ?? getReviewItemTargetEpisode(item);
          if (!currentUserWork || currentUserWork.current_episode === appliedEp) {
            restoredEp = Math.max(0, item.episode_num - 1);
          }
        }

        if (restoredEp !== undefined) {
          const existing = rollbackByWork.get(item.work_id);
          if (existing === undefined || restoredEp < existing) {
            rollbackByWork.set(item.work_id, restoredEp);
          }
        }
      }

      await Promise.all(
        Array.from(rollbackByWork.entries()).map(
          async ([workId, restoredEp]) => {
            await updateEpisodeProgress(currentUserUid, workId, restoredEp);
            onProgressUpdated?.(workId, restoredEp);
          }
        )
      );

      setActivities((prev) => prev.filter((a) => a.activity_id !== activityId));
      setAllFeedback((prev) =>
        prev.filter((fb) => fb.activity_id !== activityId)
      );
      if (editingActivityId === activityId) {
        handleCancelEditActivity();
      }
    } catch (err) {
      console.error("Failed to delete review list:", err);
      alert("Fehler beim Löschen.");
    }
  };

  const handleToggleReaction = async (activityId: string, emoji: string) => {
    if (!currentUserUid) return;
    setOpenReactionForId(null);

    // Optimistic update
    let previousReactions: Record<string, string[]> = {};
    setActivities((prev) =>
      prev.map((act) => {
        if (act.activity_id !== activityId) return act;
        previousReactions = act.reactions || {};
        const nextReactions: Record<string, string[]> = {
          ...previousReactions,
        };
        const users = Array.isArray(nextReactions[emoji])
          ? [...nextReactions[emoji]]
          : [];

        if (users.includes(currentUserUid)) {
          const filtered = users.filter((uid) => uid !== currentUserUid);
          if (filtered.length === 0) {
            delete nextReactions[emoji];
          } else {
            nextReactions[emoji] = filtered;
          }
        } else {
          nextReactions[emoji] = [...users, currentUserUid];
        }
        return { ...act, reactions: nextReactions };
      })
    );

    try {
      const serverReactions = await toggleActivityReaction(
        activityId,
        currentUserUid,
        emoji
      );
      setActivities((prev) =>
        prev.map((act) =>
          act.activity_id === activityId
            ? { ...act, reactions: serverReactions }
            : act
        )
      );
    } catch (err) {
      console.error("Failed to toggle reaction:", err);
      setActivities((prev) =>
        prev.map((act) =>
          act.activity_id === activityId
            ? { ...act, reactions: previousReactions }
            : act
        )
      );
    }
  };

  const handleToggleCommentsSection = async (activityId: string) => {
    const isCurrentlyOpen = Boolean(openCommentsForIds[activityId]);
    setOpenCommentsForIds((prev) => ({
      ...prev,
      [activityId]: !isCurrentlyOpen,
    }));

    if (!isCurrentlyOpen && !commentsByActivity[activityId]) {
      setLoadingCommentsForIds((prev) => ({ ...prev, [activityId]: true }));
      try {
        const loaded = await getActivityComments(activityId);
        setCommentsByActivity((prev) => ({ ...prev, [activityId]: loaded }));
      } catch (err) {
        console.error("Failed to load activity comments:", err);
      } finally {
        setLoadingCommentsForIds((prev) => ({ ...prev, [activityId]: false }));
      }
    }
  };

  const handleSendComment = async (activityId: string) => {
    if (!currentUserUid) return;
    const rawText = (commentInputByActivity[activityId] || "").trim();
    if (!rawText || sendingCommentForIds[activityId]) return;

    setSendingCommentForIds((prev) => ({ ...prev, [activityId]: true }));
    try {
      const created = await addActivityComment(
        activityId,
        currentUserUid,
        rawText
      );
      if (created) {
        setCommentsByActivity((prev) => ({
          ...prev,
          [activityId]: [...(prev[activityId] || []), created],
        }));
        setActivities((prev) =>
          prev.map((act) =>
            act.activity_id === activityId
              ? { ...act, comments_count: (act.comments_count || 0) + 1 }
              : act
          )
        );
        setCommentInputByActivity((prev) => ({ ...prev, [activityId]: "" }));
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
      alert("Kommentar konnte nicht gesendet werden.");
    } finally {
      setSendingCommentForIds((prev) => ({ ...prev, [activityId]: false }));
    }
  };

  const handleDeleteComment = async (
    activityId: string,
    commentId: string
  ) => {
    if (!currentUserUid) return;
    try {
      await deleteActivityComment(commentId, activityId);
      setCommentsByActivity((prev) => ({
        ...prev,
        [activityId]: (prev[activityId] || []).filter(
          (c) => c.comment_id !== commentId
        ),
      }));
      setActivities((prev) =>
        prev.map((act) =>
          act.activity_id === activityId
            ? {
                ...act,
                comments_count: Math.max(0, (act.comments_count || 1) - 1),
              }
            : act
        )
      );
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const localFilteredWorks = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return activeSelectableWorks;
    return allLibrarySelectableWorks.filter((w) =>
      w.title.toLowerCase().includes(q)
    );
  }, [pickerSearch, activeSelectableWorks, allLibrarySelectableWorks]);

  return (
    <section className="flex flex-col gap-4">
      {/* WHATSAPP-STYLE COMPOSER (New or Editing Existing Post) */}
      {currentUserUid && (
        <div
          className={`bg-[#111827] border rounded-2xl p-3.5 shadow-lg flex flex-col gap-3 ${
            editingActivityId
              ? "border-amber-500/50 ring-1 ring-amber-500/20"
              : "border-white/10"
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span
              className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                editingActivityId ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {editingActivityId ? (
                <>
                  <Edit2 className="w-3.5 h-3.5" />
                  Review bearbeiten
                </>
              ) : (
                <>
                  <MessageSquareText className="w-3.5 h-3.5" />
                  Neue Review-Nachricht
                </>
              )}
            </span>

            <div className="flex items-center gap-2">
              {editingActivityId && (
                <button
                  type="button"
                  onClick={handleCancelEditActivity}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
                >
                  Abbrechen
                </button>
              )}

              {/* Anime / Manga Separation Toggle for Composer */}
              <div className="flex items-center gap-1 bg-[#0b101b] p-1 rounded-xl border border-white/10">
                {(["ANIME", "MANGA"] as const).map((type) => {
                  const isActive = composerMediaType === type;
                  const isLocked =
                    draftItems.length > 0 && composerMediaType !== type;
                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={isLocked}
                      title={
                        isLocked
                          ? "Ein Review-Post kann nur entweder Anime oder Manga enthalten."
                          : undefined
                      }
                      onClick={() => setComposerMediaType(type)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                        isActive
                          ? "bg-emerald-600 text-white"
                          : isLocked
                          ? "text-gray-600 cursor-not-allowed"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {type === "ANIME" ? "Anime" : "Manga"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Überschrift (optional, z. B. ${
              composerMediaType === "MANGA" ? "Manga" : "Anime"
            } Review)...`}
            className="w-full bg-[#0b101b] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60"
          />

          {/* Draft Items List */}
          {draftItems.length > 0 && (
            <div className="flex flex-col gap-2">
              {draftItems.map((item, idx) => (
                <div
                  key={`${item.work_id}-${item.episode_num}-${idx}`}
                  className="flex items-start gap-2.5 bg-[#0b101b] border border-white/10 rounded-xl p-2.5"
                >
                  {item.work_cover ? (
                    <img
                      src={item.work_cover}
                      alt={item.work_title}
                      className="w-8 h-11 rounded object-cover shrink-0 bg-gray-800 opacity-90"
                    />
                  ) : (
                    <div className="w-8 h-11 rounded bg-gray-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-400">
                      <span className="font-medium text-gray-400 truncate max-w-[180px]">
                        {item.work_title}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/5">
                        {formatEpisodeBadge(item)}
                      </span>
                      {typeof item.rating === "number" && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getRatingBadgeClass(
                            item.rating
                          )}`}
                        >
                          ★ {item.rating}/10
                        </span>
                      )}
                    </div>
                    {item.text && (
                      <p className="text-sm sm:text-[15px] font-medium text-white mt-1 break-words leading-snug">
                        {item.text}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openPickerForEditDraftItem(idx)}
                      aria-label="Eintrag bearbeiten"
                      title="Eintrag bearbeiten"
                      className="text-gray-400 hover:text-emerald-400 p-1 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveDraftItem(idx)}
                      aria-label="Eintrag entfernen"
                      title="Eintrag entfernen"
                      className="text-gray-400 hover:text-rose-400 p-1 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Composer Action Row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={openPickerForNew}
              className="flex-1 flex items-center justify-center gap-2 bg-[#1a2436] hover:bg-[#223047] border border-emerald-500/30 text-emerald-300 font-semibold text-sm py-2.5 px-4 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              {composerMediaType === "MANGA"
                ? "Manga hinzufügen"
                : "Anime hinzufügen"}
            </button>
            <button
              type="button"
              onClick={handleSendReviewList}
              disabled={draftItems.length === 0 || isSending}
              className={`flex items-center justify-center gap-1.5 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold text-sm py-2.5 px-4 rounded-xl transition-colors shrink-0 ${
                editingActivityId
                  ? "bg-amber-600 hover:bg-amber-500"
                  : "bg-emerald-600 hover:bg-emerald-500"
              }`}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {editingActivityId ? "Änderung speichern" : "Senden"}
            </button>
          </div>
        </div>
      )}

      {/* MEDIA FILTER PILLS (Anime / Manga / Alle Medien) */}
      <div className="flex items-center gap-1.5">
        {(["ALL", "ANIME", "MANGA"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setMediaFilter(type)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
              mediaFilter === type
                ? "bg-emerald-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white"
            }`}
          >
            {type === "ALL" ? "Alle" : type === "ANIME" ? "Anime" : "Manga"}
          </button>
        ))}
      </div>

      {/* WHATSAPP-STYLE CHAT BUBBLES FEED */}
      {isLoadingFeed ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-28 rounded-2xl bg-[#1a2230]/60 animate-pulse border border-white/5"
            />
          ))}
        </div>
      ) : visibleActivities.length === 0 ? (
        <div className="text-center py-10 px-4 bg-[#111827]/60 rounded-2xl border border-white/5 text-gray-400 text-sm">
          Noch keine passenden Reviews im Feed. Starte oben mit einer neuen
          Review!
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {visibleActivities.map((activity) => {
            const isOwn = Boolean(
              currentUserUid && activity.user_id === currentUserUid
            );
            const author = userProfiles[activity.user_id];
            const authorName = author?.username || "Unbekannt";
            const authorAvatar = author?.avatar_url;
            const reactions = activity.reactions || {};
            const activeReactionEntries = Object.entries(reactions).filter(
              ([, users]) => Array.isArray(users) && users.length > 0
            );
            const isCommentsOpen = Boolean(
              openCommentsForIds[activity.activity_id]
            );
            const activityComments =
              commentsByActivity[activity.activity_id] || [];
            const commentsCount =
              commentsByActivity[activity.activity_id] !== undefined
                ? activityComments.length
                : activity.comments_count || 0;

            return (
              <div key={activity.activity_id} className="flex flex-col w-full">
                <div
                  className={`relative w-full rounded-2xl p-3.5 border shadow-md ${
                    isOwn
                      ? "bg-[#142a26] border-emerald-500/25"
                      : "bg-[#1a2230] border-white/10"
                  }`}
                >
                  {/* Bubble Header */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {authorAvatar ? (
                        <img
                          src={authorAvatar}
                          alt={authorName}
                          className="w-6 h-6 rounded-full object-cover shrink-0 bg-gray-800"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-emerald-700/60 text-emerald-200 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {authorName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs font-bold text-emerald-300 truncate">
                        {authorName}
                      </span>
                      <span className="text-[11px] text-gray-400 shrink-0">
                        {formatMessageTime(activity.timestamp)}
                      </span>
                    </div>

                    {isOwn && activity.action_type === "REVIEW_LIST" && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditActivity(activity)}
                          aria-label="Nachricht bearbeiten"
                          title="Review bearbeiten"
                          className="text-gray-400 hover:text-emerald-300 p-1 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteActivity(activity.activity_id)
                          }
                          aria-label="Nachricht löschen"
                          title="Review löschen (setzt Fortschritt zurück)"
                          className="text-gray-400 hover:text-rose-400 p-1 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Optional Bold Title */}
                  {activity.text && activity.text.trim() !== "" && (
                    <p className="text-base font-bold text-white mb-2.5 leading-snug">
                      {activity.text}
                    </p>
                  )}

                  {/* REVIEW_LIST Items */}
                  {activity.action_type === "REVIEW_LIST" &&
                    Array.isArray(activity.review_items) && (
                      <div className="flex flex-col gap-2.5">
                        {activity.review_items.map((item, idx) => {
                          const comparisons = getComparisonsForItem(
                            activity.activity_id,
                            activity.user_id,
                            item
                          );
                          const compKey = `${activity.activity_id}_${item.work_id}_${idx}`;
                          const isCompExpanded = openComparisonKey === compKey;

                          return (
                            <div
                              key={`${item.work_id}-${item.episode_num}-${idx}`}
                              className="flex flex-col gap-2 bg-black/20 border border-white/5 rounded-xl p-2.5"
                            >
                              <div className="flex items-start gap-2.5">
                                <Link
                                  href={`/work/${item.work_id}`}
                                  className="shrink-0 block mt-0.5"
                                >
                                  {item.work_cover ? (
                                    <img
                                      src={item.work_cover}
                                      alt={item.work_title}
                                      className="w-8 h-11 rounded object-cover bg-gray-800 opacity-85 hover:opacity-100 transition-opacity"
                                    />
                                  ) : (
                                    <div className="w-8 h-11 rounded bg-gray-800" />
                                  )}
                                </Link>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <Link
                                        href={`/work/${item.work_id}`}
                                        className="text-[11px] font-medium text-gray-400 hover:text-emerald-300 transition-colors truncate max-w-[180px]"
                                      >
                                        {item.work_title}
                                      </Link>
                                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/5 shrink-0">
                                        {formatEpisodeBadge(item)}
                                      </span>
                                    </div>

                                    {typeof item.rating === "number" && (
                                      <span
                                        className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border flex items-center gap-0.5 ${getRatingBadgeClass(
                                          item.rating
                                        )}`}
                                      >
                                        <Star className="w-2.5 h-2.5 fill-current" />
                                        {item.rating}/10
                                      </span>
                                    )}
                                  </div>

                                  {item.text && (
                                    <p className="text-[15px] sm:text-base font-medium text-white mt-1 whitespace-pre-wrap break-words leading-snug">
                                      {item.text}
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* CROSS-USER RATING & OPINION COMPARISON WIDGET */}
                              {comparisons.length > 0 && (
                                <div className="pt-1.5 border-t border-white/5 flex flex-col gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenComparisonKey(
                                        isCompExpanded ? null : compKey
                                      )
                                    }
                                    className="flex items-center justify-between gap-2 text-left w-full px-2 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/25 transition-colors"
                                  >
                                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                      <span className="font-bold text-blue-300 inline-flex items-center gap-1">
                                        <ArrowLeftRight className="w-3 h-3" />
                                        Vergleich:
                                      </span>
                                      {typeof item.rating === "number" && (
                                        <span className="text-gray-300 font-semibold">
                                          {isOwn ? "Du" : authorName}: ★{" "}
                                          {item.rating}/10
                                        </span>
                                      )}
                                      {comparisons.map((comp) => {
                                        const isMe =
                                          currentUserUid &&
                                          comp.user_id === currentUserUid;
                                        return (
                                          <span
                                            key={comp.user_id}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-white/10 text-white font-semibold"
                                          >
                                            <span>
                                              {isMe ? "Du" : comp.username}:
                                            </span>
                                            {typeof comp.rating === "number" ? (
                                              <span className="text-amber-300">
                                                ★ {comp.rating}/10
                                              </span>
                                            ) : (
                                              <span className="text-gray-300">
                                                Review
                                              </span>
                                            )}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <span className="text-blue-300 shrink-0">
                                      {isCompExpanded ? (
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      )}
                                    </span>
                                  </button>

                                  {isCompExpanded && (
                                    <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-blue-500/40 mt-0.5">
                                      {comparisons.map((comp) => {
                                        const isMe =
                                          currentUserUid &&
                                          comp.user_id === currentUserUid;
                                        const diff =
                                          typeof item.rating === "number" &&
                                          typeof comp.rating === "number"
                                            ? item.rating - comp.rating
                                            : null;
                                        return (
                                          <div
                                            key={comp.user_id}
                                            className="bg-black/30 rounded-lg p-2 text-xs flex flex-col gap-1"
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-1.5">
                                                <Link
                                                  href={
                                                    isMe
                                                      ? "/profile"
                                                      : `/profile/${comp.user_id}`
                                                  }
                                                  className="font-bold text-blue-300 hover:underline"
                                                >
                                                  {isMe
                                                    ? `Deine Review (${comp.username})`
                                                    : comp.username}
                                                </Link>
                                                <span className="text-[10px] text-gray-400">
                                                  • {comp.episode_label}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1.5">
                                                {diff !== null && (
                                                  <span className="text-[10px] text-gray-400">
                                                    {diff === 0
                                                      ? "Gleiche Wertung"
                                                      : `Diff: ${
                                                          diff > 0
                                                            ? `+${diff}`
                                                            : diff
                                                        }`}
                                                  </span>
                                                )}
                                                {typeof comp.rating ===
                                                  "number" && (
                                                  <span
                                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getRatingBadgeClass(
                                                      comp.rating
                                                    )}`}
                                                  >
                                                    ★ {comp.rating}/10
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            {comp.text && (
                                              <p className="text-xs text-gray-200 leading-snug whitespace-pre-wrap">
                                                {comp.text}
                                              </p>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                  {/* RATING rendering */}
                  {activity.action_type === "RATING" && (
                    <div className="flex flex-col gap-2 text-xs text-gray-300">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          ★ Bewertung
                        </span>
                      </div>

                      {activity.details && (
                        <p className="text-[15px] font-medium text-white whitespace-pre-wrap break-words leading-snug">
                          {activity.details}
                        </p>
                      )}

                      {activity.work_id &&
                        (() => {
                          const wDetails = userAniListDetails[activity.work_id];
                          const wTitle =
                            wDetails?.title?.english || wDetails?.title?.romaji;
                          const wCover =
                            wDetails?.coverImage?.large ||
                            wDetails?.coverImage?.extraLarge;
                          return wDetails ? (
                            <Link
                              href={`/work/${activity.work_id}`}
                              className="flex items-center gap-2.5 bg-black/20 border border-white/5 hover:border-emerald-500/30 rounded-xl p-2 transition-colors"
                            >
                              {wCover ? (
                                <img
                                  src={wCover}
                                  alt={wTitle || "Cover"}
                                  className="w-8 h-11 rounded object-cover shrink-0 bg-gray-800 opacity-85"
                                />
                              ) : (
                                <div className="w-8 h-11 rounded bg-gray-800 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-gray-300 truncate">
                                  {wTitle}
                                </p>
                                <span className="text-[11px] text-emerald-400 font-semibold">
                                  Werk ansehen →
                                </span>
                              </div>
                            </Link>
                          ) : (
                            <Link
                              href={`/work/${activity.work_id}`}
                              className="inline-block mt-0.5 text-emerald-400 hover:underline font-semibold"
                            >
                              Werk ansehen →
                            </Link>
                          );
                        })()}
                    </div>
                  )}

                  {/* WHATSAPP EMOJI-REACTION & OPINION COMMENT BAR */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t border-white/10">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeReactionEntries.map(([emoji, users]) => {
                        const hasReacted = Boolean(
                          currentUserUid && users.includes(currentUserUid)
                        );
                        return (
                          <button
                            key={emoji}
                            type="button"
                            disabled={!currentUserUid}
                            onClick={() =>
                              handleToggleReaction(activity.activity_id, emoji)
                            }
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors ${
                              hasReacted
                                ? "bg-emerald-500/25 border-emerald-400/50 text-emerald-200"
                                : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
                            }`}
                          >
                            <span>{emoji}</span>
                            <span className="text-[11px]">{users.length}</span>
                          </button>
                        );
                      })}

                      {currentUserUid && (
                        <div className="relative flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenReactionForId((prev) =>
                                prev === activity.activity_id
                                  ? null
                                  : activity.activity_id
                              )
                            }
                            aria-label="Reaktion hinzufügen"
                            className="inline-flex items-center justify-center w-7 h-6 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-gray-300 transition-colors"
                          >
                            <SmilePlus className="w-3.5 h-3.5" />
                          </button>

                          {openReactionForId === activity.activity_id && (
                            <div className="flex items-center gap-1 bg-[#0b101b] border border-white/15 rounded-full px-2 py-1 shadow-xl">
                              {QUICK_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() =>
                                    handleToggleReaction(
                                      activity.activity_id,
                                      emoji
                                    )
                                  }
                                  className="hover:scale-125 transition-transform text-sm px-0.5"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Text Comment / Opinion Toggle Button */}
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleCommentsSection(activity.activity_id)
                      }
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        isCommentsOpen || commentsCount > 0
                          ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-200"
                          : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
                      }`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>
                        {commentsCount > 0
                          ? `${commentsCount} ${
                              commentsCount === 1 ? "Meinung" : "Meinungen"
                            }`
                          : "Meinung schreiben"}
                      </span>
                    </button>
                  </div>

                  {/* EXPANDABLE TEXT COMMENTS / OPINIONS SECTION */}
                  {isCommentsOpen && (
                    <div className="mt-2.5 pt-2.5 border-t border-white/10 flex flex-col gap-2">
                      {loadingCommentsForIds[activity.activity_id] ? (
                        <div className="text-xs text-gray-400 flex items-center gap-1.5 py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Lade Meinungen...
                        </div>
                      ) : activityComments.length === 0 ? (
                        <p className="text-xs text-gray-400">
                          Noch keine Text-Reaktionen. Schreib deine Meinung
                          dazu!
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {activityComments.map((c) => {
                            const cAuthor = userProfiles[c.user_id];
                            const cName = cAuthor?.username || "Unbekannt";
                            const cAvatar = cAuthor?.avatar_url;
                            const isOwnComment =
                              currentUserUid && c.user_id === currentUserUid;

                            return (
                              <div
                                key={c.comment_id}
                                className="flex items-start gap-2 bg-black/25 border border-white/5 rounded-xl p-2"
                              >
                                <Link
                                  href={
                                    isOwnComment
                                      ? "/profile"
                                      : `/profile/${c.user_id}`
                                  }
                                  className="shrink-0 mt-0.5 hover:opacity-90 transition-opacity"
                                  title={`Profil von ${cName} ansehen`}
                                >
                                  {cAvatar ? (
                                    <img
                                      src={cAvatar}
                                      alt={cName}
                                      className="w-5 h-5 rounded-full object-cover bg-gray-800"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-emerald-700/60 text-emerald-200 flex items-center justify-center text-[10px] font-bold">
                                      {cName.slice(0, 1).toUpperCase()}
                                    </div>
                                  )}
                                </Link>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <Link
                                        href={
                                          isOwnComment
                                            ? "/profile"
                                            : `/profile/${c.user_id}`
                                        }
                                        className="text-[11px] font-bold text-emerald-300 hover:underline"
                                      >
                                        {cName}
                                      </Link>
                                      <span className="text-[10px] text-gray-500">
                                        {formatMessageTime(c.timestamp)}
                                      </span>
                                    </div>
                                    {isOwnComment && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteComment(
                                            activity.activity_id,
                                            c.comment_id
                                          )
                                        }
                                        className="text-gray-500 hover:text-rose-400 transition"
                                        title="Kommentar löschen"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-xs sm:text-sm text-white mt-0.5 whitespace-pre-wrap break-words leading-snug">
                                    {c.text}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {currentUserUid && (
                        <div className="flex items-center gap-1.5 pt-1">
                          <input
                            type="text"
                            value={
                              commentInputByActivity[activity.activity_id] || ""
                            }
                            onChange={(e) =>
                              setCommentInputByActivity((prev) => ({
                                ...prev,
                                [activity.activity_id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSendComment(activity.activity_id);
                              }
                            }}
                            placeholder="Kurzer Text oder Meinung zur Review..."
                            className="flex-1 bg-[#0b101b] border border-white/10 rounded-xl px-3 py-1.5 text-xs sm:text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60"
                          />
                          <button
                            type="button"
                            disabled={
                              !(
                                commentInputByActivity[activity.activity_id] ||
                                ""
                              ).trim() ||
                              Boolean(sendingCommentForIds[activity.activity_id])
                            }
                            onClick={() =>
                              handleSendComment(activity.activity_id)
                            }
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-bold transition shrink-0 flex items-center gap-1"
                          >
                            {sendingCommentForIds[activity.activity_id] ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            Senden
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PICKER MODAL FOR "+ Werk hinzufügen" or Editing Draft Item */}
      {isPickerOpen && (
        <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-[#111827] border border-white/15 rounded-t-3xl sm:rounded-2xl p-4 pb-8 sm:pb-4 max-h-[85vh] overflow-y-auto flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {selectedWork
                  ? editingDraftIndex !== null
                    ? "Review-Eintrag bearbeiten"
                    : "Review-Eintrag"
                  : `${
                      composerMediaType === "MANGA" ? "Manga" : "Anime"
                    } auswählen`}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingDraftIndex(null);
                  setIsPickerOpen(false);
                }}
                className="text-gray-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!selectedWork ? (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder={`Nach ${
                      composerMediaType === "MANGA" ? "Manga" : "Anime"
                    } in Bibliothek oder AniList suchen...`}
                    className="w-full bg-[#0b101b] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>

                <div className="overflow-y-auto flex-1 flex flex-col gap-2 pr-1">
                  {localFilteredWorks.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                        {pickerSearch.trim()
                          ? "Aus deiner Bibliothek"
                          : "Aktuell aktiv"}
                      </span>
                      {localFilteredWorks.map((work) => (
                        <button
                          key={`lib-${work.work_id}`}
                          type="button"
                          onClick={() => handleSelectWork(work)}
                          className="flex items-center gap-2.5 p-2 rounded-xl bg-[#0b101b] hover:bg-[#192234] border border-white/5 text-left transition-colors"
                        >
                          {work.cover ? (
                            <img
                              src={work.cover}
                              alt={work.title}
                              className="w-9 h-12 rounded object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-12 rounded bg-gray-800 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {work.title}
                            </p>
                            <p className="text-xs text-gray-400">
                              {work.media_type} • Stand:{" "}
                              {work.media_type === "MANGA" ? "Kap." : "Folge"}{" "}
                              {work.current_episode}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {pickerSearch.trim().length >= 2 && (
                    <div className="flex flex-col gap-1.5 mt-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                        AniList Ergebnisse ({composerMediaType})
                        {isSearchingAniList && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                      </span>
                      {searchResults.map((work) => (
                        <button
                          key={`al-${work.media_type}-${work.work_id}`}
                          type="button"
                          onClick={() => handleSelectWork(work)}
                          className="flex items-center gap-2.5 p-2 rounded-xl bg-[#0b101b] hover:bg-[#192234] border border-white/5 text-left transition-colors"
                        >
                          {work.cover ? (
                            <img
                              src={work.cover}
                              alt={work.title}
                              className="w-9 h-12 rounded object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-12 rounded bg-gray-800 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {work.title}
                            </p>
                            <p className="text-xs text-gray-400">
                              {work.media_type}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3 overflow-y-auto">
                <div className="flex items-center gap-2.5 bg-[#0b101b] p-2.5 rounded-xl border border-white/10">
                  {selectedWork.cover && (
                    <img
                      src={selectedWork.cover}
                      alt={selectedWork.title}
                      className="w-10 h-14 rounded object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {selectedWork.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      {selectedWork.media_type} • Aktueller Stand:{" "}
                      {selectedWork.media_type === "MANGA" ? "Kap." : "Folge"}{" "}
                      {selectedWork.current_episode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedWork(null)}
                    className="text-xs text-emerald-400 hover:underline font-semibold shrink-0"
                  >
                    Ändern
                  </button>
                </div>

                {/* Episode / Chapter Selection Mode Switcher */}
                <div className="flex flex-col gap-2 bg-[#0b101b] p-2.5 rounded-xl border border-white/10">
                  <div className="grid grid-cols-3 gap-1 bg-[#111827] p-1 rounded-lg">
                    {(
                      [
                        { id: "SINGLE", label: "Einzeln" },
                        { id: "RANGE", label: "Von – Bis (Catch-up)" },
                        { id: "MULTI", label: "Mehrere einzeln" },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSwitchEpMode(m.id)}
                        className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-colors ${
                          epMode === m.id
                            ? "bg-emerald-600 text-white"
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {epMode === "SINGLE" && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs font-semibold text-gray-300">
                        {selectedWork.media_type === "MANGA"
                          ? "Kapitel"
                          : "Folge"}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEpNum((prev) => Math.max(1, prev - 1))
                          }
                          className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={epNum}
                          onChange={(e) =>
                            setEpNum(
                              Math.max(1, parseInt(e.target.value, 10) || 1)
                            )
                          }
                          className="w-14 text-center bg-transparent text-sm font-bold text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setEpNum((prev) => prev + 1)}
                          className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {epMode === "RANGE" && (
                    <div className="flex flex-col gap-2 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 flex flex-col gap-1">
                          <span className="text-[11px] text-gray-400 font-semibold">
                            Von{" "}
                            {selectedWork.media_type === "MANGA"
                              ? "Kap."
                              : "Folge"}
                          </span>
                          <div className="flex items-center gap-1 bg-[#111827] border border-white/10 rounded-lg p-1">
                            <button
                              type="button"
                              onClick={() =>
                                setEpNum((prev) => Math.max(1, prev - 1))
                              }
                              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={epNum}
                              onChange={(e) =>
                                setEpNum(
                                  Math.max(1, parseInt(e.target.value, 10) || 1)
                                )
                              }
                              className="w-full text-center bg-transparent text-sm font-bold text-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next = epNum + 1;
                                setEpNum(next);
                                if (epEndNum < next) setEpEndNum(next);
                              }}
                              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <span className="text-gray-500 font-bold pt-4">–</span>

                        <div className="flex-1 flex flex-col gap-1">
                          <span className="text-[11px] text-gray-400 font-semibold">
                            Bis{" "}
                            {selectedWork.media_type === "MANGA"
                              ? "Kap."
                              : "Folge"}
                          </span>
                          <div className="flex items-center gap-1 bg-[#111827] border border-white/10 rounded-lg p-1">
                            <button
                              type="button"
                              onClick={() =>
                                setEpEndNum((prev) => Math.max(epNum, prev - 1))
                              }
                              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={epEndNum}
                              onChange={(e) =>
                                setEpEndNum(
                                  Math.max(1, parseInt(e.target.value, 10) || 1)
                                )
                              }
                              className="w-full text-center bg-transparent text-sm font-bold text-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setEpEndNum((prev) => prev + 1)}
                              className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setEpNum(1)}
                          className="text-[11px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-emerald-300 border border-white/10"
                        >
                          Ab{" "}
                          {selectedWork.media_type === "MANGA"
                            ? "Kap. 1"
                            : "Folge 1"}
                        </button>
                        {selectedWork.current_episode > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setEpNum(1);
                              setEpEndNum(selectedWork.current_episode);
                            }}
                            className="text-[11px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-emerald-300 border border-white/10"
                          >
                            1 bis aktueller Stand (
                            {selectedWork.current_episode})
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {epMode === "MULTI" && (
                    <div className="flex flex-col gap-2 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-300">
                          {selectedWork.media_type === "MANGA"
                            ? "Kapitel hinzufügen"
                            : "Folge hinzufügen"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setMultiEpCandidate((prev) =>
                                Math.max(1, prev - 1)
                              )
                            }
                            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={multiEpCandidate}
                            onChange={(e) =>
                              setMultiEpCandidate(
                                Math.max(1, parseInt(e.target.value, 10) || 1)
                              )
                            }
                            className="w-12 text-center bg-[#111827] border border-white/10 rounded-lg py-1 text-sm font-bold text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setMultiEpCandidate((prev) => prev + 1)
                            }
                            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddMultiEp()}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                          >
                            + Dazu
                          </button>
                        </div>
                      </div>

                      {multiEps.length > 0 ? (
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          {multiEps.map((n) => (
                            <span
                              key={n}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold"
                            >
                              {selectedWork.media_type === "MANGA"
                                ? "Kap."
                                : "Folge"}{" "}
                              {n}
                              <button
                                type="button"
                                onClick={() => handleRemoveMultiEp(n)}
                                className="hover:text-rose-300"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-amber-300/90">
                          Bitte mindestens eine{" "}
                          {selectedWork.media_type === "MANGA"
                            ? "Kapitel"
                            : "Folge"}
                          -Nummer hinzufügen.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Review Text */}
                <textarea
                  rows={3}
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  placeholder="Kurze Review oder Gedanken zur Folge/Kapitel..."
                  className="w-full bg-[#0b101b] border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60 resize-none"
                />
                {typeof rating === "number" && !reviewText.trim() && (
                  <p className="text-[11px] text-amber-300/90 -mt-1">
                    Tipp: Schreib noch kurz, was du darüber denkst...
                  </p>
                )}

                {/* Optional 1-10 Rating */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-gray-300">
                    Bewertung (optional, 1–10)
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                      const active = rating === num;
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setRating(active ? undefined : num)}
                          className={`py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            active
                              ? "bg-emerald-600 border-emerald-400 text-white"
                              : "bg-[#0b101b] border-white/10 text-gray-400 hover:text-white"
                          }`}
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Auto-update progress checkbox */}
                <label className="flex items-center gap-2.5 text-xs text-gray-300 cursor-pointer select-none py-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={updateProgress}
                    onClick={() => setUpdateProgress((v) => !v)}
                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                      updateProgress
                        ? "bg-emerald-600 border-emerald-500 text-white"
                        : "bg-[#0b101b] border-white/25"
                    }`}
                  >
                    {updateProgress && <Check className="w-3 h-3" />}
                  </button>
                  Fortschritt automatisch auf diese Folge/Kapitel setzen
                </label>

                <button
                  type="button"
                  disabled={
                    (!reviewText.trim() && rating === undefined) ||
                    (epMode === "MULTI" && multiEps.length === 0)
                  }
                  onClick={handleAddDraftItem}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold text-sm transition-colors"
                >
                  {editingDraftIndex !== null
                    ? "Eintrag übernehmen"
                    : "Hinzufügen"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

