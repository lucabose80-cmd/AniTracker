"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllUserProfiles } from "@/lib/db/users";
import {
  addSingleEpisodeFeedback,
  deleteSingleEpisodeFeedback,
  getEpisodeFeedbackForWork,
} from "@/lib/db/feedback";
import { EpisodeFeedback, UserProfile } from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import { auth } from "@/lib/firebase";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { MessageSquarePlus, Star, Trash2, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { confirmAction, toast } from "@/lib/ui-feedback";
import { SpoilerText } from "@/components/ui/SpoilerText";

function sortFeedbackDesc(a: EpisodeFeedback, b: EpisodeFeedback): number {
  if (b.episode_num !== a.episode_num) {
    return b.episode_num - a.episode_num;
  }
  return b.timestamp.localeCompare(a.timestamp);
}

function formatFeedbackEpisodeLabel(
  item: EpisodeFeedback,
  unit: string
): string {
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

export function WorkSocialFeed({
  workId,
  work,
}: {
  workId: string;
  work: AniListMedia;
}) {
  const [feedbackItems, setFeedbackItems] = useState<EpisodeFeedback[]>([]);
  const [userProfiles, setUserProfiles] = useState<
    Record<string, UserProfile>
  >({});
  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(
    undefined
  );
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Quick feedback form state
  const [showQuickForm, setShowQuickForm] = useState(false);
  const [epInput, setEpInput] = useState<string>("1");
  const [textInput, setTextInput] = useState<string>("");
  const [ratingInput, setRatingInput] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>("");

  const reloadTrigger = useAppStore((state) => state.reloadTrigger);
  const triggerReload = useAppStore((state) => state.triggerReload);

  const isManga = work?.type === "MANGA";
  const unitLabel = isManga ? "Kapitel" : "Folge";

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setCurrentUserUid(u?.uid));
    return unsub;
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      try {
        const [items, profilesList] = await Promise.all([
          getEpisodeFeedbackForWork(workId),
          getAllUserProfiles(),
        ]);

        if (!active) return;

        const map: Record<string, UserProfile> = {};
        profilesList.forEach((p) => {
          map[p.uid] = p;
        });
        setUserProfiles(map);
        setFeedbackItems(items);
      } catch (e) {
        console.error(e);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [workId, reloadTrigger]);

  const distinctEpisodes = useMemo(() => {
    const set = new Set<number>();
    feedbackItems.forEach((item) => {
      if (typeof item.episode_num === "number") {
        set.add(item.episode_num);
      }
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [feedbackItems]);

  const filteredItems = useMemo(() => {
    if (selectedEpisode === null) return feedbackItems;
    return feedbackItems.filter((item) => item.episode_num === selectedEpisode);
  }, [feedbackItems, selectedEpisode]);

  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError("");

    if (!currentUserUid) {
      setFormError("Bitte erst einloggen!");
      return;
    }

    const parsedEp = parseInt(epInput, 10);
    if (Number.isNaN(parsedEp) || parsedEp < 1) {
      setFormError(`Bitte eine gültige ${unitLabel}-Nummer (ab 1) angeben.`);
      return;
    }

    const trimmedText = textInput.trim();
    if (!trimmedText) {
      setFormError("Bitte einen kurzen Feedback-Text eingeben.");
      return;
    }

    let parsedRating: number | undefined = undefined;
    if (ratingInput !== "") {
      const r = Number(ratingInput);
      if (Number.isNaN(r) || r < 1 || r > 10) {
        setFormError("Bewertung muss zwischen 1 und 10 liegen.");
        return;
      }
      parsedRating = r;
    }

    setIsSubmitting(true);
    try {
      const workTitle = getAniListTitle(work, "Unbekannt");
      const workCover =
        work?.coverImage?.large || work?.coverImage?.medium || "";

      const created = await addSingleEpisodeFeedback(currentUserUid, {
        work_id: workId,
        work_title: workTitle,
        work_cover: workCover,
        media_type: isManga ? "MANGA" : "ANIME",
        episode_num: parsedEp,
        text: trimmedText,
        rating: parsedRating,
      });

      if (created) {
        setFeedbackItems((prev) => [created, ...prev].sort(sortFeedbackDesc));
        setTextInput("");
        setRatingInput("");
        setShowQuickForm(false);
        if (
          selectedEpisode !== null &&
          selectedEpisode !== created.episode_num
        ) {
          setSelectedEpisode(created.episode_num);
        }
        toast.success("Feedback gepostet.");
        triggerReload();
      }
    } catch (err) {
      console.error(err);
      setFormError("Fehler beim Speichern des Feedbacks.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteFeedback = async (item: EpisodeFeedback) => {
    if (!currentUserUid || item.user_id !== currentUserUid) return;
    const confirmed = await confirmAction({
      title: "Feedback löschen?",
      message: "Dieses Episoden-/Kapitel-Feedback wird dauerhaft entfernt.",
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteSingleEpisodeFeedback(item.feedback_id, currentUserUid);
      setFeedbackItems((prev) =>
        prev.filter((fb) => fb.feedback_id !== item.feedback_id)
      );
      toast.success("Feedback gelöscht.");
    } catch (err) {
      console.error("Failed to delete feedback:", err);
      toast.error("Fehler beim Löschen.");
    }
  };

  return (
    <div className="mt-8 flex flex-col gap-4">
      {/* Header + Quick Feedback Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-3">
        <div>
          <h3 className="text-lg font-bold text-white">
            Feedback nach {isManga ? "Kapitel" : "Folge"}
          </h3>
          <p className="text-xs text-gray-400">
            Reaktionen &amp; Bewertungen der Community zu einzelnen{" "}
            {isManga ? "Kapiteln" : "Folgen"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowQuickForm((prev) => !prev);
            setFormError("");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft border border-accent-border px-3 py-1.5 text-xs font-bold text-accent-light hover:bg-accent-soft-hover transition"
        >
          {showQuickForm ? <X size={14} /> : <MessageSquarePlus size={14} />}
          {showQuickForm ? "Schließen" : "Schnell-Feedback hinzufügen"}
        </button>
      </div>

      {/* Inline Quick Feedback Form */}
      {showQuickForm && (
        <form
          onSubmit={handleQuickSubmit}
          className="rounded-2xl border border-gray-800 bg-surface p-4 space-y-3.5 shadow-xl"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-800/90 bg-surface-inset px-3.5 py-2.5">
              <label className="text-xs font-bold text-gray-200">
                {unitLabel}-Nummer
              </label>
              <input
                type="number"
                min={1}
                value={epInput}
                onChange={(e) => setEpInput(e.target.value)}
                className="w-24 rounded-xl border border-gray-700 bg-surface-control px-3 py-1.5 text-sm font-bold text-center text-white focus:border-accent-border-strong focus:outline-none"
                required
              />
            </div>

            <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-gray-200">
                  Bewertung (optional)
                </label>
                {ratingInput !== "" && (
                  <button
                    type="button"
                    onClick={() => setRatingInput("")}
                    className="text-[11px] font-semibold text-gray-400 hover:text-white transition"
                  >
                    Entfernen
                  </button>
                )}
              </div>
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                  const active = ratingInput === String(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRatingInput(active ? "" : String(n))}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition tabular-nums ${
                        active
                          ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                          : "bg-surface-control border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5">
              Dein Eindruck
            </label>
            <textarea
              rows={2}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                ratingInput !== ""
                  ? "Schreib kurz, was du darüber denkst... (||Spoiler|| möglich)"
                  : `Wie fandest du ${unitLabel} ${epInput || "1"}? (||Spoiler|| möglich)`
              }
              className="w-full rounded-xl border border-gray-700 bg-surface-inset px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-accent-border-strong focus:outline-none resize-y"
              required
            />
            {ratingInput !== "" && !textInput.trim() && (
              <p className="text-[11px] text-amber-300/90 mt-1">
                Schreib kurz, was du darüber denkst...
              </p>
            )}
          </div>

          {formError && (
            <p className="text-xs font-semibold text-rose-400">{formError}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowQuickForm(false)}
              className="rounded-xl border border-gray-800 bg-white/5 px-3.5 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 transition"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white hover:bg-accent-hover transition disabled:opacity-50"
            >
              {isSubmitting ? "Speichert..." : "Feedback posten"}
            </button>
          </div>
        </form>
      )}

      {/* Episode/Chapter Filter Bar */}
      {feedbackItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedEpisode(null)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              selectedEpisode === null
                ? "bg-accent text-white shadow"
                : "bg-surface-elevated text-gray-300 border border-gray-800 hover:border-gray-700"
            }`}
          >
            Alle ({feedbackItems.length})
          </button>
          {distinctEpisodes.map((ep) => (
            <button
              key={ep}
              type="button"
              onClick={() =>
                setSelectedEpisode(ep === selectedEpisode ? null : ep)
              }
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                selectedEpisode === ep
                  ? "bg-accent text-white shadow"
                  : "bg-surface-elevated text-gray-300 border border-gray-800 hover:border-gray-700"
              }`}
            >
              {unitLabel} {ep}
            </button>
          ))}
        </div>
      )}

      {/* Feedback Cards */}
      {isLoading ? (
        <div className="rounded-xl border border-gray-800 bg-surface-elevated py-8 text-center text-sm text-gray-400">
          Lade Feedback...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-surface-elevated py-8 px-4 text-center text-sm text-gray-500">
          {feedbackItems.length === 0
            ? `Noch kein Feedback zu einzelnen ${
                isManga ? "Kapiteln" : "Folgen"
              }. Füge oben das erste Schnell-Feedback hinzu!`
            : `Kein Feedback für ${unitLabel} ${selectedEpisode} gefunden.`}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredItems.map((item) => {
            const user = userProfiles[item.user_id];
            const username = user?.username || "Unbekannt";
            const timeAgo = formatDistanceToNow(new Date(item.timestamp), {
              addSuffix: true,
              locale: de,
            });
            const itemUnit = item.media_type === "MANGA" ? "Kapitel" : "Folge";
            const isOwn = Boolean(
              currentUserUid && item.user_id === currentUserUid
            );

            return (
              <div
                key={item.feedback_id}
                className="rounded-xl border border-gray-800 bg-surface-elevated p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Link
                      href={isOwn ? "/profile" : `/profile/${item.user_id}`}
                      className="flex items-center gap-2.5 min-w-0 group/author hover:opacity-90 transition-opacity"
                      title={`Profil von ${username} ansehen`}
                    >
                      {user?.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={username}
                          className="h-7 w-7 rounded-full object-cover border border-gray-700 group-hover/author:border-accent-border-strong shrink-0 transition-colors"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-accent-soft border border-accent-border group-hover/author:border-accent-border-strong flex items-center justify-center text-xs font-bold text-accent-light shrink-0 transition-colors">
                          {username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="font-bold text-sm text-gray-100 group-hover/author:text-accent-light group-hover/author:underline truncate transition-colors">
                        {username}
                      </span>
                    </Link>
                    <span className="text-xs text-gray-500">{timeAgo}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-accent-soft border border-accent-border px-2.5 py-0.5 text-xs font-bold text-accent-light">
                      {formatFeedbackEpisodeLabel(item, itemUnit)}
                    </span>
                    {typeof item.rating === "number" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 border border-yellow-500/30 px-2.5 py-0.5 text-xs font-bold text-yellow-400">
                        <Star size={11} className="fill-yellow-400" />
                        {item.rating}/10
                      </span>
                    )}
                    {isOwn && (
                      <button
                        type="button"
                        onClick={() => handleDeleteFeedback(item)}
                        className="p-1 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                        title="Feedback löschen"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                  <SpoilerText text={item.text} />
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
