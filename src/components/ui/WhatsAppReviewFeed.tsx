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
} from "lucide-react";
import { ActivityFeed, ReviewListItem, UserProfile, UserWork } from "@/types/database";
import { getGlobalFeed } from "@/lib/db/feed";
import { getAllUserProfiles } from "@/lib/db/users";
import {
  createReviewList,
  deleteReviewList,
  toggleActivityReaction,
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

export default function WhatsAppReviewFeed({
  currentUserUid,
  userWorks,
  userAniListDetails,
  onProgressUpdated,
}: WhatsAppReviewFeedProps) {
  const isOnline = useAppStore((s) => s.isOnline);

  const [activities, setActivities] = useState<ActivityFeed[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);

  // Filters
  const [scopeFilter, setScopeFilter] = useState<"ALL" | "MY_WORKS">("ALL");
  const [mediaFilter, setMediaFilter] = useState<"ALL" | "ANIME" | "MANGA">("ALL");

  // Composer state
  const [title, setTitle] = useState("");
  const [draftItems, setDraftItems] = useState<DraftReviewItem[]>([]);
  const [isSending, setIsSending] = useState(false);

  // Picker Modal state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SelectableWork[]>([]);
  const [isSearchingAniList, setIsSearchingAniList] = useState(false);
  const [selectedWork, setSelectedWork] = useState<SelectableWork | null>(null);
  const [epNum, setEpNum] = useState<number>(1);
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState<number | undefined>(undefined);
  const [updateProgress, setUpdateProgress] = useState(true);

  // Emoji picker toggle per activity
  const [openReactionForId, setOpenReactionForId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadFeed() {
      setIsLoadingFeed(true);
      try {
        const [feedData, profiles] = await Promise.all([
          getGlobalFeed(60),
          getAllUserProfiles(),
        ]);
        if (cancelled) return;
        const profileMap: Record<string, UserProfile> = {};
        profiles.forEach((p) => {
          profileMap[p.uid] = p;
        });
        setUserProfiles(profileMap);
        setActivities(feedData);
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
  }, []);

  // Build quick-select list from user's CURRENT works
  const activeSelectableWorks = useMemo<SelectableWork[]>(() => {
    return userWorks
      .filter((w) => w.status === "CURRENT")
      .map((w) => {
        const details = userAniListDetails[w.work_id];
        const workTitle =
          details?.title?.english ||
          details?.title?.romaji ||
          `Werk #${w.work_id}`;
        const cover = details?.coverImage?.large || details?.coverImage?.extraLarge;
        const mediaType: "ANIME" | "MANGA" =
          details?.type === "MANGA" ? "MANGA" : "ANIME";
        return {
          work_id: w.work_id,
          title: workTitle,
          cover,
          media_type: mediaType,
          current_episode: Number(w.current_episode) || 0,
        };
      });
  }, [userWorks, userAniListDetails]);

  // All library works for local search fallback
  const allLibrarySelectableWorks = useMemo<SelectableWork[]>(() => {
    return userWorks.map((w) => {
      const details = userAniListDetails[w.work_id];
      const workTitle =
        details?.title?.english ||
        details?.title?.romaji ||
        `Werk #${w.work_id}`;
      const cover = details?.coverImage?.large || details?.coverImage?.extraLarge;
      const mediaType: "ANIME" | "MANGA" =
        details?.type === "MANGA" ? "MANGA" : "ANIME";
      return {
        work_id: w.work_id,
        title: workTitle,
        cover,
        media_type: mediaType,
        current_episode: Number(w.current_episode) || 0,
      };
    });
  }, [userWorks, userAniListDetails]);

  // Search AniList when pickerSearch has >= 2 chars
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
        const [animeRes, mangaRes] = await Promise.all([
          fetchAniList(SEARCH_WORKS, { search: q, type: "ANIME", page: 1, perPage: 6 }),
          fetchAniList(SEARCH_WORKS, { search: q, type: "MANGA", page: 1, perPage: 6 }),
        ]);

        const combined: SelectableWork[] = [];
        const userWorkById = new Map(userWorks.map((w) => [w.work_id, w]));

        (animeRes?.Page?.media || []).forEach((m: any) => {
          const idStr = m.id.toString();
          const existing = userWorkById.get(idStr);
          combined.push({
            work_id: idStr,
            title: m.title?.english || m.title?.romaji || "Unbekannt",
            cover: m.coverImage?.large || m.coverImage?.extraLarge,
            media_type: "ANIME",
            current_episode: existing ? Number(existing.current_episode) || 0 : 0,
          });
        });

        (mangaRes?.Page?.media || []).forEach((m: any) => {
          const idStr = m.id.toString();
          const existing = userWorkById.get(idStr);
          combined.push({
            work_id: idStr,
            title: m.title?.english || m.title?.romaji || "Unbekannt",
            cover: m.coverImage?.large || m.coverImage?.extraLarge,
            media_type: "MANGA",
            current_episode: existing ? Number(existing.current_episode) || 0 : 0,
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
  }, [pickerSearch, isPickerOpen, userWorks]);

  const userWorkIdsSet = useMemo(
    () => new Set(userWorks.map((w) => w.work_id)),
    [userWorks]
  );

  // Filtered feed
  const visibleActivities = useMemo(() => {
    return activities.filter((act) => {
      // Focus on REVIEW_LIST, plus gracefully allow RATING / MANUAL_POST
      const isSupportedType =
        act.action_type === "REVIEW_LIST" ||
        act.action_type === "RATING" ||
        act.action_type === "MANUAL_POST";
      if (!isSupportedType) return false;

      if (scopeFilter === "MY_WORKS") {
        if (act.action_type === "REVIEW_LIST") {
          const items = act.review_items || [];
          const hasMyWork = items.some((item) => userWorkIdsSet.has(item.work_id));
          if (!hasMyWork) return false;
        } else if (!act.work_id || !userWorkIdsSet.has(act.work_id)) {
          return false;
        }
      }

      if (mediaFilter !== "ALL") {
        if (act.action_type === "REVIEW_LIST") {
          const items = act.review_items || [];
          const hasMedia = items.some((item) => item.media_type === mediaFilter);
          if (!hasMedia) return false;
        } else if (act.work_id) {
          const details = userAniListDetails[act.work_id];
          if (details?.type && details.type !== mediaFilter) return false;
        }
      }

      return true;
    });
  }, [activities, scopeFilter, mediaFilter, userWorkIdsSet, userAniListDetails]);

  const openPicker = () => {
    setSelectedWork(null);
    setPickerSearch("");
    setSearchResults([]);
    setEpNum(1);
    setReviewText("");
    setRating(undefined);
    setUpdateProgress(true);
    setIsPickerOpen(true);
  };

  const handleSelectWork = (work: SelectableWork) => {
    setSelectedWork(work);
    setEpNum(work.current_episode > 0 ? work.current_episode + 1 : 1);
    setReviewText("");
    setRating(undefined);
    setUpdateProgress(true);
  };

  const handleAddDraftItem = () => {
    if (!selectedWork) return;
    const trimmedText = reviewText.trim();
    if (!trimmedText) return;

    const newItem: DraftReviewItem = {
      work_id: selectedWork.work_id,
      work_title: selectedWork.title,
      work_cover: selectedWork.cover,
      media_type: selectedWork.media_type,
      episode_num: Math.max(1, epNum || 1),
      text: trimmedText,
      rating,
      updateProgress,
    };

    setDraftItems((prev) => [...prev, newItem]);
    setIsPickerOpen(false);
  };

  const handleRemoveDraftItem = (index: number) => {
    setDraftItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSendReviewList = async () => {
    if (!currentUserUid || draftItems.length === 0 || isSending) return;
    if (!isOnline) {
      alert("Keine Internetverbindung. Senden nicht möglich.");
      return;
    }

    setIsSending(true);
    try {
      const itemsToSave: ReviewListItem[] = draftItems.map(
        ({ updateProgress: _up, ...rest }) => rest
      );
      const created = await createReviewList(
        currentUserUid,
        title.trim(),
        itemsToSave
      );

      // Update episode progress where checked
      const progressUpdates = draftItems.filter((item) => item.updateProgress);
      await Promise.all(
        progressUpdates.map(async (item) => {
          await updateEpisodeProgress(currentUserUid, item.work_id, item.episode_num);
          onProgressUpdated?.(item.work_id, item.episode_num);
        })
      );

      if (created) {
        setActivities((prev) => [created, ...prev]);
      }

      setTitle("");
      setDraftItems([]);
    } catch (err) {
      console.error("Failed to send review list:", err);
      alert("Fehler beim Senden der Review-Nachricht.");
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    if (!currentUserUid) return;
    if (!window.confirm("Diese Review-Nachricht wirklich löschen?")) return;

    try {
      await deleteReviewList(activityId, currentUserUid);
      setActivities((prev) => prev.filter((a) => a.activity_id !== activityId));
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
        const nextReactions: Record<string, string[]> = { ...previousReactions };
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
      // Revert on error
      setActivities((prev) =>
        prev.map((act) =>
          act.activity_id === activityId
            ? { ...act, reactions: previousReactions }
            : act
        )
      );
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
      {/* WHATSAPP-STYLE COMPOSER */}
      {currentUserUid && (
        <div className="bg-[#111827] border border-white/10 rounded-2xl p-3.5 shadow-lg flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5" />
              Neue Review-Nachricht
            </span>
            {draftItems.length > 0 && (
              <span className="text-[11px] text-gray-400">
                {draftItems.length}{" "}
                {draftItems.length === 1 ? "Werk" : "Werke"} angehängt
              </span>
            )}
          </div>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Überschrift (optional, z. B. Peak Review)..."
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
                      className="w-9 h-12 rounded object-cover shrink-0 bg-gray-800"
                    />
                  ) : (
                    <div className="w-9 h-12 rounded bg-gray-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-white truncate max-w-[180px]">
                        {item.work_title}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-gray-200">
                        {item.media_type === "MANGA" ? "Kap." : "Folge"}{" "}
                        {item.episode_num}
                      </span>
                      {typeof item.rating === "number" && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getRatingBadgeClass(
                            item.rating
                          )}`}
                        >
                          ★ {item.rating}/10
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-300 mt-1 break-words">
                      {item.text}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveDraftItem(idx)}
                    aria-label="Eintrag entfernen"
                    className="text-gray-400 hover:text-rose-400 p-1 rounded-lg transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Composer Action Row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={openPicker}
              className="flex-1 flex items-center justify-center gap-2 bg-[#1a2436] hover:bg-[#223047] border border-emerald-500/30 text-emerald-300 font-semibold text-sm py-2.5 px-4 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              Werk hinzufügen
            </button>
            <button
              type="button"
              onClick={handleSendReviewList}
              disabled={draftItems.length === 0 || isSending}
              className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold text-sm py-2.5 px-4 rounded-xl transition-colors shrink-0"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Senden
            </button>
          </div>
        </div>
      )}

      {/* FILTER PILLS */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScopeFilter("ALL")}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              scopeFilter === "ALL"
                ? "bg-emerald-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white"
            }`}
          >
            Alle
          </button>
          {currentUserUid && (
            <button
              type="button"
              onClick={() => setScopeFilter("MY_WORKS")}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                scopeFilter === "MY_WORKS"
                  ? "bg-emerald-600 text-white"
                  : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              Meine Werke
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {(["ALL", "ANIME", "MANGA"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setMediaFilter(type)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                mediaFilter === type
                  ? "bg-white text-black"
                  : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {type === "ALL" ? "Alle Medien" : type === "ANIME" ? "Anime" : "Manga"}
            </button>
          ))}
        </div>
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
          Noch keine passenden Reviews im Feed. Starte mit{" "}
          <span className="text-emerald-400 font-semibold">+ Werk hinzufügen</span>!
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

            return (
              <div
                key={activity.activity_id}
                className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}
              >
                <div
                  className={`relative w-full max-w-[95%] sm:max-w-[88%] rounded-2xl p-3.5 border shadow-md ${
                    isOwn
                      ? "bg-[#142a26] border-emerald-500/25 rounded-tr-sm"
                      : "bg-[#1a2230] border-white/10 rounded-tl-sm"
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
                      <button
                        type="button"
                        onClick={() => handleDeleteActivity(activity.activity_id)}
                        aria-label="Nachricht löschen"
                        className="text-gray-400 hover:text-rose-400 p-1 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Optional Bold Title */}
                  {activity.text && activity.text.trim() !== "" && (
                    <p className="text-sm font-bold text-white mb-2.5 leading-snug">
                      {activity.text}
                    </p>
                  )}

                  {/* REVIEW_LIST Items */}
                  {activity.action_type === "REVIEW_LIST" &&
                    Array.isArray(activity.review_items) && (
                      <div className="flex flex-col gap-2">
                        {activity.review_items.map((item, idx) => (
                          <div
                            key={`${item.work_id}-${item.episode_num}-${idx}`}
                            className="flex items-start gap-2.5 bg-black/25 border border-white/5 rounded-xl p-2"
                          >
                            <Link
                              href={`/work/${item.work_id}`}
                              className="shrink-0 block"
                            >
                              {item.work_cover ? (
                                <img
                                  src={item.work_cover}
                                  alt={item.work_title}
                                  className="w-9 h-12 rounded object-cover bg-gray-800 hover:opacity-90 transition-opacity"
                                />
                              ) : (
                                <div className="w-9 h-12 rounded bg-gray-800" />
                              )}
                            </Link>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Link
                                  href={`/work/${item.work_id}`}
                                  className="text-xs font-bold text-white hover:text-emerald-300 transition-colors truncate max-w-[180px]"
                                >
                                  {item.work_title}
                                </Link>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-gray-200">
                                  {item.media_type === "MANGA" ? "Kap." : "Folge"}{" "}
                                  {item.episode_num}
                                </span>
                              </div>
                              <p className="text-xs text-gray-200 mt-1 whitespace-pre-wrap break-words leading-relaxed">
                                {item.text}
                              </p>
                            </div>

                            {typeof item.rating === "number" && (
                              <span
                                className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-lg border flex items-center gap-0.5 ${getRatingBadgeClass(
                                  item.rating
                                )}`}
                              >
                                <Star className="w-3 h-3 fill-current" />
                                {item.rating}/10
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                  {/* Legacy RATING / MANUAL_POST fallback */}
                  {activity.action_type !== "REVIEW_LIST" && (
                    <div className="text-xs text-gray-300">
                      {activity.details && (
                        <p className="text-gray-200">{activity.details}</p>
                      )}
                      {activity.work_id && (
                        <Link
                          href={`/work/${activity.work_id}`}
                          className="inline-block mt-1 text-emerald-400 hover:underline font-semibold"
                        >
                          Werk ansehen →
                        </Link>
                      )}
                    </div>
                  )}

                  {/* WHATSAPP EMOJI-REACTION BAR */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-white/10">
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
                                  handleToggleReaction(activity.activity_id, emoji)
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PICKER MODAL FOR "+ Werk hinzufügen" */}
      {isPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-[#111827] border border-white/15 rounded-t-3xl sm:rounded-2xl p-4 max-h-[88vh] flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {selectedWork ? "Review-Eintrag" : "Werk auswählen"}
              </h3>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
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
                    placeholder="In Bibliothek oder AniList suchen..."
                    className="w-full bg-[#0b101b] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>

                <div className="overflow-y-auto flex-1 flex flex-col gap-2 pr-1">
                  {localFilteredWorks.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                        {pickerSearch.trim() ? "Aus deiner Bibliothek" : "Aktuell aktiv"}
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
                        AniList Ergebnisse
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
                            <p className="text-xs text-gray-400">{work.media_type}</p>
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
                      {selectedWork.media_type}
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

                {/* Episode / Chapter Counter */}
                <div className="flex items-center justify-between bg-[#0b101b] px-3 py-2 rounded-xl border border-white/10">
                  <span className="text-xs font-semibold text-gray-300">
                    {selectedWork.media_type === "MANGA" ? "Kapitel" : "Folge"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEpNum((prev) => Math.max(1, prev - 1))}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={epNum}
                      onChange={(e) =>
                        setEpNum(Math.max(1, parseInt(e.target.value, 10) || 1))
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

                {/* Review Text */}
                <textarea
                  rows={3}
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  placeholder="Kurze Review oder Gedanken zur Folge/Kapitel..."
                  className="w-full bg-[#0b101b] border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60 resize-none"
                />

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
                  disabled={!reviewText.trim()}
                  onClick={handleAddDraftItem}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold text-sm transition-colors"
                >
                  Hinzufügen
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
