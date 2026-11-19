"use client";

import { useEffect, useMemo, useState } from "react";
import { getAllUserProfiles } from "@/lib/db/users";
import { addSingleEpisodeFeedback, getEpisodeFeedbackForWork } from "@/lib/db/feedback";
import { EpisodeFeedback } from "@/types/database";
import { auth } from "@/lib/firebase";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { MessageSquarePlus, Star, X } from "lucide-react";
import { useAppStore } from "@/lib/store";

function sortFeedbackDesc(a: EpisodeFeedback, b: EpisodeFeedback): number {
  if (b.episode_num !== a.episode_num) {
    return b.episode_num - a.episode_num;
  }
  return b.timestamp.localeCompare(a.timestamp);
}

export function WorkSocialFeed({ workId, work }: { workId: string; work: any }) {
  const [feedbackItems, setFeedbackItems] = useState<EpisodeFeedback[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});
  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(undefined);
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

        const map: Record<string, any> = {};
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
      const workTitle = work?.title?.english || work?.title?.romaji || "Unbekannt";
      const workCover = work?.coverImage?.large || work?.coverImage?.medium || "";

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
        if (selectedEpisode !== null && selectedEpisode !== created.episode_num) {
          setSelectedEpisode(created.episode_num);
        }
        triggerReload();
      }
    } catch (err) {
      console.error(err);
      setFormError("Fehler beim Speichern des Feedbacks.");
    } finally {
      setIsSubmitting(false);
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
            Reaktionen & Bewertungen der Community zu einzelnen {isManga ? "Kapiteln" : "Folgen"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowQuickForm((prev) => !prev);
            setFormError("");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 px-3 py-1.5 text-xs font-bold text-blue-300 hover:bg-blue-600/30 transition"
        >
          {showQuickForm ? <X size={14} /> : <MessageSquarePlus size={14} />}
          {showQuickForm ? "Schließen" : "Schnell-Feedback hinzufügen"}
        </button>
      </div>

      {/* Inline Quick Feedback Form */}
      {showQuickForm && (
        <form
          onSubmit={handleQuickSubmit}
          className="rounded-xl border border-blue-500/30 bg-[#141a29] p-4 space-y-3 shadow-lg"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-400 mb-1">
                {unitLabel}-Nummer
              </label>
              <input
                type="number"
                min={1}
                value={epInput}
                onChange={(e) => setEpInput(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-400 mb-1">
                Bewertung (optional, 1–10)
              </label>
              <select
                value={ratingInput}
                onChange={(e) => setRatingInput(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">Keine Bewertung</option>
                {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    ★ {n} / 10
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-400 mb-1">
              Dein Eindruck
            </label>
            <textarea
              rows={2}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                ratingInput !== ""
                  ? "Schreib kurz, was du darüber denkst..."
                  : `Wie fandest du ${unitLabel} ${epInput || "1"}?`
              }
              className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-y"
              required
            />
            {ratingInput !== "" && !textInput.trim() && (
              <p className="text-[11px] text-amber-300/90 mt-1">
                Schreib kurz, was du darüber denkst...
              </p>
            )}
          </div>

          {formError && <p className="text-xs font-semibold text-red-400">{formError}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowQuickForm(false)}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 transition"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-500 transition disabled:opacity-50"
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
                ? "bg-blue-600 text-white shadow"
                : "bg-[#1a1d24] text-gray-300 border border-gray-800 hover:border-gray-700"
            }`}
          >
            Alle ({feedbackItems.length})
          </button>
          {distinctEpisodes.map((ep) => (
            <button
              key={ep}
              type="button"
              onClick={() => setSelectedEpisode(ep === selectedEpisode ? null : ep)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                selectedEpisode === ep
                  ? "bg-blue-600 text-white shadow"
                  : "bg-[#1a1d24] text-gray-300 border border-gray-800 hover:border-gray-700"
              }`}
            >
              {unitLabel} {ep}
            </button>
          ))}
        </div>
      )}

      {/* Feedback Cards */}
      {isLoading ? (
        <div className="rounded-xl border border-gray-800 bg-[#1a1d24] py-8 text-center text-sm text-gray-400">
          Lade Feedback...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-[#1a1d24] py-8 px-4 text-center text-sm text-gray-500">
          {feedbackItems.length === 0
            ? `Noch kein Feedback zu einzelnen ${isManga ? "Kapiteln" : "Folgen"}. Füge oben das erste Schnell-Feedback hinzu!`
            : `Kein Feedback für ${unitLabel} ${selectedEpisode} gefunden.`}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredItems.map((item) => {
            const user = userProfiles[item.user_id] || { username: "Unbekannt" };
            const timeAgo = formatDistanceToNow(new Date(item.timestamp), {
              addSuffix: true,
              locale: de,
            });
            const itemUnit = item.media_type === "MANGA" ? "Kapitel" : "Folge";

            return (
              <div
                key={item.feedback_id}
                className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.username || "Avatar"}
                        className="h-7 w-7 rounded-full object-cover border border-gray-700 shrink-0"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-blue-900/50 border border-blue-700/50 flex items-center justify-center text-xs font-bold text-blue-300 shrink-0">
                        {(user.username || "U").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="font-bold text-sm text-gray-100 truncate">
                      {user.username || "Unbekannt"}
                    </span>
                    <span className="text-xs text-gray-500">{timeAgo}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-600/20 border border-blue-500/30 px-2.5 py-0.5 text-xs font-bold text-blue-300">
                      {itemUnit} {item.episode_num}
                    </span>
                    {typeof item.rating === "number" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 border border-yellow-500/30 px-2.5 py-0.5 text-xs font-bold text-yellow-400">
                        <Star size={11} className="fill-yellow-400" />
                        {item.rating}/10
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                  {item.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
