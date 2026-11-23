"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchAniList, GET_WORK_DETAILS } from "@/lib/anilist";
import { calculateOverallScore } from "@/lib/scoring";
import { UserWork, EmotionalImpact, WatchMode } from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import {
  Star,
  ChevronLeft,
  Save,
  Calendar as CalendarIcon,
  PlayCircle,
  CheckCircle,
  PauseCircle,
  Bookmark,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import {
  CalendarOverride,
  computeWorkReleaseInfo,
  formatPauseStatusLabel,
  getCalendarOverrideForWork,
} from "@/lib/db/calendar";
import { auth } from "@/lib/firebase";
import {
  saveUserWork,
  getUserWork,
  updateEpisodeProgress,
  removeUserWork,
  updateUserWorkStatus,
} from "@/lib/db/works";
import { addToHistory } from "@/lib/db/users";
import { WorkSocialFeed } from "./WorkSocialFeed";
import { createActivity } from "@/lib/db/feed";
import { getUserEpisodeRatingsForWork } from "@/lib/db/feedback";
import {
  WorkPauseRecord,
  getPausedWorksMap,
  pauseWorkForWeeks,
  unpauseWork,
} from "@/lib/db/pauses";
import { WorkSettingsModal } from "@/components/ui/WorkSettingsModal";
import { useAppStore } from "@/lib/store";
import { confirmAction, toast } from "@/lib/ui-feedback";

const DEFAULT_EVALUATION: UserWork["evaluation"] = {
  plotAndStory: 0,
  castAndCharacters: 0,
  sideCharacters: 0,
  ending: 0,
  artstyleAndAnimation: 0,
  introOutro: 0,
  voiceActing: 0,
  romanceAndChemistry: 0,
  bingeFactor: 0,
  comedy: 0,
  rewatchPotential: 0,
  emotionalImpact: "None",
  comments: "",
  overallScore: 0,
};

const DEFAULT_CLASSIFICATION: UserWork["classification"] = {
  watchMode: "SUB",
  romanceLevel: 0,
  confessionTiming: "",
  intimacyLevel: 0,
  relationshipDynamics: "",
  wholesomeLewdScale: 0,
  comedySeriousScale: 0,
  actionDialogScale: 0,
  pacingScale: 0,
};

/**
 * Safely converts AniList HTML description strings to plain text with preserved
 * line breaks, eliminating any XSS risk from dangerouslySetInnerHTML.
 */
function formatAniListDescription(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function WorkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const reloadTrigger = useAppStore((state) => state.reloadTrigger);

  const [work, setWork] = useState<AniListMedia | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [userWorkStatus, setUserWorkStatus] =
    useState<UserWork["status"]>("NONE");
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const [episodeInputText, setEpisodeInputText] = useState("0");
  const [manualMaxEpisode, setManualMaxEpisode] = useState<number | "">("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [synchroOffset, setSynchroOffset] = useState<number | "">(0);
  const [syncOffsetDays, setSyncOffsetDays] = useState<number>(0);
  const [manualAvailableEps, setManualAvailableEps] = useState<number | "">("");
  const [workOverride, setWorkOverride] = useState<
    CalendarOverride | undefined
  >(undefined);
  const [pauseRecord, setPauseRecord] = useState<WorkPauseRecord | null>(null);
  const [droppedReason, setDroppedReason] = useState("");
  const [isWorkPaused, setIsWorkPaused] = useState(false);
  const [pausedUntilIso, setPausedUntilIso] = useState<string>("");
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [evaluation, setEvaluation] = useState<UserWork["evaluation"]>({
    ...DEFAULT_EVALUATION,
  });
  const [existingClassification, setExistingClassification] =
    useState<UserWork["classification"]>({ ...DEFAULT_CLASSIFICATION });

  const [hasRomance, setHasRomance] = useState(false);
  const [isRomanceMainFocus, setIsRomanceMainFocus] = useState(false);
  const [malRated, setMalRated] = useState(false);
  const [watchMode, setWatchMode] = useState<WatchMode>("SUB");
  const [isSaving, setIsSaving] = useState(false);

  const [episodeRatingStats, setEpisodeRatingStats] = useState<{
    average: number | null;
    count: number;
  }>({
    average: null,
    count: 0,
  });
  const lastSavedScoreRef = useRef<number>(0);
  const lastSavedCommentRef = useRef<string>("");

  const [prevEpisodeSync, setPrevEpisodeSync] = useState(currentEpisode);
  if (currentEpisode !== prevEpisodeSync) {
    setPrevEpisodeSync(currentEpisode);
    setEpisodeInputText(String(currentEpisode));
  }

  useEffect(() => {
    let isMounted = true;

    async function loadData(user: typeof auth.currentUser) {
      if (!id) return;
      setIsLoading(true);
      try {
        const [data, userWork, singleOverride, epRatings, pausedMap] =
          await Promise.all([
            fetchAniList<{ Media?: AniListMedia }>(GET_WORK_DETAILS, {
              id: parseInt(id, 10),
            }),
            user ? getUserWork(user.uid, id) : Promise.resolve(null),
            getCalendarOverrideForWork(id),
            user
              ? getUserEpisodeRatingsForWork(user.uid, id)
              : Promise.resolve({ average: null, count: 0, items: [] }),
            getPausedWorksMap().catch(
              (): Record<string, WorkPauseRecord> => ({})
            ),
          ]);

        if (!isMounted) return;

        const media = data?.Media || null;
        setWork(media);
        setNowMs(Date.now());
        setEpisodeRatingStats({
          average: epRatings.average,
          count: epRatings.count,
        });
        const loadedPause = pausedMap[id] || null;
        setPauseRecord(loadedPause);
        setIsWorkPaused(Boolean(loadedPause));
        setPausedUntilIso(loadedPause?.paused_until || "");

        const ov = singleOverride || undefined;
        setWorkOverride(ov);
        if (ov) {
          setManualMaxEpisode(
            ov.manualMaxEpisode !== undefined ? ov.manualMaxEpisode : ""
          );
          if (ov.manualAvailableEps !== undefined) {
            const loadedMax =
              ov.manualMaxEpisode != null && Number(ov.manualMaxEpisode) > 0
                ? Number(ov.manualMaxEpisode)
                : media?.type === "MANGA" && Number(media?.chapters) > 0
                ? Number(media.chapters)
                : media?.type !== "MANGA" && Number(media?.episodes) > 0
                ? Number(media?.episodes)
                : null;
            setManualAvailableEps(
              loadedMax !== null
                ? Math.min(Number(ov.manualAvailableEps), loadedMax)
                : ov.manualAvailableEps
            );
          } else {
            setManualAvailableEps("");
          }
        } else {
          setManualMaxEpisode("");
          setManualAvailableEps("");
        }

        const isGenreRomance = media?.genres?.includes("Romance") || false;

        if (userWork) {
          setInLibrary(true);
          setUserWorkStatus(userWork.status || "PLANNING");
          setCurrentEpisode(userWork.current_episode || 0);
          setDroppedReason(userWork.dropped_reason || "");

          const mergedEval: UserWork["evaluation"] = {
            ...DEFAULT_EVALUATION,
            ...(userWork.evaluation || {}),
          };
          setEvaluation(mergedEval);
          setExistingClassification({
            ...DEFAULT_CLASSIFICATION,
            ...(userWork.classification || {}),
          });

          lastSavedScoreRef.current =
            Number(mergedEval.overallScore) ||
            Number(mergedEval.manualScore) ||
            0;
          lastSavedCommentRef.current = (mergedEval.comments || "").trim();

          setWatchMode(userWork.classification?.watchMode || "SUB");
          setMalRated(userWork.mal_rated || false);
          setSynchroOffset(userWork.synchro_offset_episodes || 0);
          setSyncOffsetDays(userWork.sync_offset_days || 0);
          if (!ov || ov.manualAvailableEps === undefined) {
            setManualAvailableEps(userWork.manual_available_eps ?? "");
          }

          const savedHasRomance =
            typeof mergedEval.hasRomance === "boolean"
              ? mergedEval.hasRomance
              : (mergedEval.romanceAndChemistry || 0) > 0 || isGenreRomance;
          const savedMainFocus =
            typeof mergedEval.isRomanceMainFocus === "boolean"
              ? mergedEval.isRomanceMainFocus
              : isGenreRomance;
          setHasRomance(savedHasRomance);
          setIsRomanceMainFocus(savedMainFocus);
        } else {
          setInLibrary(false);
          setUserWorkStatus("NONE");
          setCurrentEpisode(0);
          setDroppedReason("");
          setSynchroOffset(0);
          setSyncOffsetDays(0);
          setEvaluation({ ...DEFAULT_EVALUATION });
          setExistingClassification({ ...DEFAULT_CLASSIFICATION });
          setWatchMode("SUB");
          setMalRated(false);
          setHasRomance(isGenreRomance);
          setIsRomanceMainFocus(isGenreRomance);
          lastSavedScoreRef.current = 0;
          lastSavedCommentRef.current = "";
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    if (!auth) {
      loadData(null);
      return () => {
        isMounted = false;
      };
    }

    const unsubscribe = auth.onAuthStateChanged((user) => {
      loadData(user);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [id, reloadTrigger]);

  const currentScore = calculateOverallScore({
    evaluation,
    hasRomance,
    isRomanceMainFocus,
    isAnime: work?.type === "ANIME",
    watchMode,
  });

  const releaseInfo = useMemo(() => {
    if (!work) return null;
    const effectiveOverride: CalendarOverride | undefined =
      workOverride ||
      manualMaxEpisode !== "" ||
      manualAvailableEps !== ""
        ? {
            ...(workOverride || { work_id: id }),
            ...(manualMaxEpisode !== ""
              ? { manualMaxEpisode: Number(manualMaxEpisode) }
              : {}),
            ...(manualAvailableEps !== ""
              ? { manualAvailableEps: Number(manualAvailableEps) }
              : {}),
          }
        : undefined;

    return computeWorkReleaseInfo({
      media: work,
      override: effectiveOverride,
      pauseInfo: pauseRecord,
      userWork: {
        current_episode: currentEpisode,
        status: userWorkStatus,
        synchro_offset_episodes:
          synchroOffset === "" ? 0 : Math.max(0, Number(synchroOffset)),
        sync_offset_days: syncOffsetDays,
        manual_max_episode:
          manualMaxEpisode === "" ? undefined : Number(manualMaxEpisode),
        manual_available_eps:
          manualAvailableEps === "" ? null : Number(manualAvailableEps),
      },
      nowMs,
    });
  }, [
    work,
    workOverride,
    id,
    manualMaxEpisode,
    manualAvailableEps,
    pauseRecord,
    currentEpisode,
    userWorkStatus,
    synchroOffset,
    syncOffsetDays,
    nowMs,
  ]);

  const safeDescription = useMemo(
    () => formatAniListDescription(work?.description),
    [work?.description]
  );

  const handleSlider = (field: keyof UserWork["evaluation"], value: string) => {
    setEvaluation((prev) => ({ ...prev, [field]: parseFloat(value) }));
  };

  const aniListMax =
    (work?.type === "MANGA" ? work?.chapters : work?.episodes) || 9999;
  const calculatedMaxEps =
    manualMaxEpisode !== "" ? Number(manualMaxEpisode) : aniListMax;

  const effectiveMaxEps = useMemo(() => {
    if (
      releaseInfo?.maxAllowedProgress !== null &&
      releaseInfo?.maxAllowedProgress !== undefined
    ) {
      return Math.max(releaseInfo.maxAllowedProgress, currentEpisode);
    }
    return calculatedMaxEps !== 9999
      ? Math.max(calculatedMaxEps, currentEpisode)
      : 9999;
  }, [releaseInfo?.maxAllowedProgress, currentEpisode, calculatedMaxEps]);

  const handleQuickAdd = async (
    status: "CURRENT" | "COMPLETED" | "PLANNING" | "PAUSED" | "DROPPED"
  ) => {
    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }

    if (!useAppStore.getState().isOnline) {
      toast.error("Keine Internetverbindung.");
      return;
    }

    setIsSaving(true);
    try {
      let epsToSave = currentEpisode;
      if (status === "COMPLETED" && calculatedMaxEps !== 9999) {
        epsToSave = calculatedMaxEps;
        setCurrentEpisode(epsToSave);
      }

      if (inLibrary) {
        await updateUserWorkStatus(user.uid, id, status);
        if (epsToSave !== currentEpisode) {
          await updateEpisodeProgress(user.uid, id, epsToSave);
        }
      } else {
        await saveUserWork(user.uid, id, {
          status,
          evaluation,
          current_episode: epsToSave,
          mal_rated: malRated,
          added_status: work?.status,
        });
        await addToHistory(user.uid, id);
        const title = getAniListTitle(work, "ein Werk");
        await createActivity(
          user.uid,
          "TOP9_UPDATE",
          id,
          `Hat ${title} zur Bibliothek hinzugefügt.`
        );

        // Prequel Auto-Erkennung: ONLY for CURRENT / COMPLETED and matching media type!
        if (status === "CURRENT" || status === "COMPLETED") {
          const prequels =
            work?.relations?.edges?.filter(
              (edge) =>
                edge.relationType === "PREQUEL" &&
                edge.node?.type === work.type
            ) || [];
          for (const prequelEdge of prequels) {
            const prequel = prequelEdge.node;
            if (!prequel?.id) continue;
            try {
              const existingPrequel = await getUserWork(
                user.uid,
                prequel.id.toString()
              );
              if (!existingPrequel) {
                const maxPrequelEps =
                  (prequel.type === "MANGA"
                    ? prequel.chapters
                    : prequel.episodes) || 0;
                await saveUserWork(user.uid, prequel.id.toString(), {
                  status: "COMPLETED",
                  evaluation: { ...DEFAULT_EVALUATION },
                  classification: { ...DEFAULT_CLASSIFICATION },
                  current_episode: maxPrequelEps,
                  auto_added: true,
                });
                await addToHistory(user.uid, prequel.id.toString());
              }
            } catch (err) {
              console.error("Failed to auto-add prequel:", err);
            }
          }
        }
      }
      setInLibrary(true);
      setUserWorkStatus(status);
      toast.success("Status aktualisiert.");
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error
          ? `Fehler beim Aktualisieren: ${err.message}`
          : "Fehler beim Aktualisieren."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    const user = auth?.currentUser;
    if (!user) return;
    const confirmed = await confirmAction({
      title: "Aus Bibliothek entfernen?",
      message:
        "Dieses Werk und deine gespeicherte Bewertung werden aus deiner Bibliothek entfernt.",
      confirmLabel: "Entfernen",
      destructive: true,
    });
    if (!confirmed) return;

    setIsSaving(true);
    try {
      await removeUserWork(user.uid, id);
      setInLibrary(false);
      setUserWorkStatus("NONE");
      setCurrentEpisode(0);
      setDroppedReason("");
      setSynchroOffset(0);
      setSyncOffsetDays(0);
      setEvaluation({ ...DEFAULT_EVALUATION });
      setExistingClassification({ ...DEFAULT_CLASSIFICATION });
      setMalRated(false);
      lastSavedScoreRef.current = 0;
      lastSavedCommentRef.current = "";
      toast.success("Aus Bibliothek entfernt.");
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error
          ? `Fehler beim Entfernen: ${err.message}`
          : "Fehler beim Entfernen."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }

    setIsSaving(true);

    const finalEval: UserWork["evaluation"] = {
      ...evaluation,
      comedy: evaluation.comedy || 0,
      rewatchPotential: evaluation.rewatchPotential || 0,
      hasRomance,
      isRomanceMainFocus,
      overallScore: currentScore,
    };
    setEvaluation(finalEval);

    const nextStatus =
      userWorkStatus !== "NONE" ? userWorkStatus : "COMPLETED";

    try {
      await saveUserWork(user.uid, id, {
        evaluation: finalEval,
        classification: {
          ...existingClassification,
          watchMode,
        },
        mal_rated: malRated,
        dropped_reason: droppedReason.trim(),
        synchro_offset_episodes: synchroOffset === "" ? 0 : synchroOffset,
        sync_offset_days: syncOffsetDays,
        auto_added: false,
        status: nextStatus,
      });

      try {
        await addToHistory(user.uid, id);
      } catch (e) {
        console.warn(e);
      }

      const prevScore = lastSavedScoreRef.current;
      const prevComment = lastSavedCommentRef.current;
      const trimmedComment = (finalEval.comments || "").trim();
      const scoreChanged =
        currentScore > 0 && Math.abs(currentScore - prevScore) >= 0.05;
      const commentChanged =
        trimmedComment.length > 0 && trimmedComment !== prevComment;
      const workTitle = getAniListTitle(work, `Werk #${id}`);

      if (scoreChanged || commentChanged) {
        try {
          const activityText = scoreChanged
            ? prevScore > 0
              ? `Hat die Bewertung von ${workTitle} angepasst: ${prevScore.toFixed(1)} → ${currentScore.toFixed(1)}/10`
              : `Hat ${workTitle} mit ${currentScore.toFixed(1)}/10 bewertet!`
            : `Hat die Review zu ${workTitle}${
                currentScore > 0 ? ` (${currentScore.toFixed(1)}/10)` : ""
              } aktualisiert`;
          await createActivity(
            user.uid,
            "RATING",
            id,
            activityText,
            trimmedComment || undefined
          );
        } catch (e) {
          console.warn(e);
        }
      }

      lastSavedScoreRef.current = currentScore;
      lastSavedCommentRef.current = trimmedComment;

      setInLibrary(true);
      setUserWorkStatus(nextStatus);
      toast.success("Bewertung gespeichert!");
    } catch (err) {
      console.error(err);
      toast.error("Fehler beim Speichern der Bewertung.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDroppedReason = async () => {
    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    try {
      await saveUserWork(user.uid, id, {
        dropped_reason: droppedReason.trim(),
      });
      toast.success("Abbruch-Grund gespeichert.");
    } catch (err) {
      console.error(err);
      toast.error("Fehler beim Speichern.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnpause = async () => {
    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    try {
      if (isWorkPaused) {
        await unpauseWork(id);
        setPauseRecord(null);
        setIsWorkPaused(false);
        setPausedUntilIso("");
      }
      if (userWorkStatus === "PAUSED") {
        await updateUserWorkStatus(user.uid, id, "CURRENT");
        setUserWorkStatus("CURRENT");
      }
      toast.success("Pause aufgehoben!");
    } catch (err) {
      console.error(err);
      toast.error("Fehler beim Entpausieren.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePauseWork = async (weeks: number) => {
    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    try {
      await pauseWorkForWeeks(id, user.uid, weeks);
      const pausedMap = await getPausedWorksMap();
      const rec = pausedMap[id] || null;
      setPauseRecord(rec);
      setPausedUntilIso(rec?.paused_until || "");
      setIsWorkPaused(true);
      toast.success(`Werk global für ${weeks} Woche(n) pausiert.`);
    } catch (err) {
      console.error(err);
      toast.error("Fehler beim Pausieren.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateEpisode = async (increment: number) => {
    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }

    if (!useAppStore.getState().isOnline) {
      toast.error("Keine Internetverbindung.");
      return;
    }

    let newEp = currentEpisode + increment;
    if (newEp < 0) newEp = 0;
    if (newEp > effectiveMaxEps) newEp = effectiveMaxEps;
    if (newEp === currentEpisode) {
      setEpisodeInputText(String(currentEpisode));
      return;
    }

    const prevEp = currentEpisode;
    setCurrentEpisode(newEp);
    setEpisodeInputText(String(newEp));

    if (inLibrary) {
      try {
        await updateEpisodeProgress(user.uid, id, newEp);
      } catch (error) {
        console.error(error);
        setCurrentEpisode(prevEp);
        setEpisodeInputText(String(prevEp));
        toast.error("Fehler beim Speichern des Fortschritts.");
      }
    }
  };

  const commitEpisodeInput = () => {
    const parsed = parseInt(episodeInputText, 10);
    if (Number.isNaN(parsed)) {
      setEpisodeInputText(String(currentEpisode));
      return;
    }
    let clamped = Math.max(0, parsed);
    if (clamped > effectiveMaxEps) clamped = effectiveMaxEps;
    setEpisodeInputText(String(clamped));
    if (clamped !== currentEpisode) {
      handleUpdateEpisode(clamped - currentEpisode);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col pb-4 animate-pulse">
        <div className="h-48 w-full bg-gray-800" />
        <div className="relative -mt-16 px-4 max-w-3xl mx-auto w-full">
          <div className="flex gap-4">
            <div className="h-40 w-28 rounded-lg bg-gray-700 shrink-0" />
            <div className="flex flex-col justify-end pt-16 gap-2 w-full">
              <div className="h-6 w-3/4 bg-gray-700 rounded" />
              <div className="h-4 w-1/2 bg-gray-700 rounded" />
            </div>
          </div>
          <div className="mt-6 flex gap-2">
            <div className="h-6 w-16 bg-gray-700 rounded" />
            <div className="h-6 w-16 bg-gray-700 rounded" />
          </div>
          <div className="mt-6 h-24 w-full bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="p-8 text-center text-red-500">Werk nicht gefunden.</div>
    );
  }

  const coverUrl =
    work.coverImage?.extraLarge || work.coverImage?.large || "";

  return (
    <div className="flex flex-col pb-4">
      {/* Banner & Cover */}
      <div className="relative h-48 w-full bg-gray-800">
        {work.bannerImage && (
          <Image
            src={work.bannerImage}
            alt="Banner"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-app to-transparent" />
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute left-4 top-4 rounded-full bg-black/50 p-2 text-white backdrop-blur-md hover:bg-black/70 transition"
          aria-label="Zurück"
        >
          <ChevronLeft size={24} />
        </button>
      </div>

      <div className="relative -mt-16 px-4 max-w-3xl mx-auto w-full">
        <div className="flex gap-4">
          <div className="relative h-40 w-28 shrink-0">
            {coverUrl ? (
              <Image
                src={coverUrl}
                alt="Cover"
                fill
                priority
                sizes="112px"
                className="rounded-xl shadow-xl border border-gray-800 object-cover"
              />
            ) : (
              <div className="h-full w-full rounded-xl bg-gray-800 border border-gray-700" />
            )}
          </div>
          <div className="flex flex-col justify-end pt-16">
            <h1 className="text-xl font-bold leading-tight line-clamp-3">
              {getAniListTitle(work)}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-300">
              <Star size={14} className="text-yellow-500" />
              <span>
                {work.averageScore ? (work.averageScore / 10).toFixed(1) : "?"}{" "}
                AniList
              </span>
              <span className="text-gray-500">•</span>
              <span>{work.format || work.type}</span>
            </div>
          </div>
        </div>

        {/* Genres & Tags */}
        <div className="mt-6 flex flex-wrap gap-1.5">
          {work.genres?.map((g: string) => (
            <span
              key={g}
              className="rounded-full bg-accent-soft border border-accent-border px-2.5 py-0.5 text-xs font-semibold text-accent-light"
            >
              {g}
            </span>
          ))}
        </div>

        {/* Release Date */}
        {work.startDate?.year && (
          <div className="mt-4 text-sm font-bold text-yellow-500 flex items-center gap-1.5">
            <CalendarIcon size={14} />
            Release:{" "}
            {work.startDate.day
              ? `${work.startDate.day.toString().padStart(2, "0")}.`
              : ""}
            {work.startDate.month
              ? `${work.startDate.month.toString().padStart(2, "0")}.`
              : ""}
            {work.startDate.year}
          </div>
        )}

        {/* GLOBAL PAUSE / HIATUS BANNER */}
        {isWorkPaused && (
          <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                Global auf Pause / Hiatus (
                {formatPauseStatusLabel(pausedUntilIso)})
              </span>
              <span className="text-[11px] text-amber-200/80 mt-0.5">
                Gilt für alle Nutzer in AniPulse. Jeder Nutzer kann die Pause
                hier für alle beenden, sobald es weitergeht.
              </span>
            </div>
            <button
              type="button"
              onClick={handleUnpause}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold shadow transition shrink-0"
            >
              Pause für alle aufheben
            </button>
          </div>
        )}

        {/* Safe Description (no dangerouslySetInnerHTML) */}
        {safeDescription && (
          <div className={work.startDate?.year ? "mt-2" : "mt-4"}>
            <p
              className={`text-sm text-gray-300 whitespace-pre-line leading-relaxed ${
                showFullDesc ? "" : "line-clamp-4"
              }`}
            >
              {safeDescription}
            </p>
            {safeDescription.length > 220 && (
              <button
                type="button"
                onClick={() => setShowFullDesc((v) => !v)}
                className="mt-1 text-xs font-semibold text-accent-text hover:text-accent-light"
              >
                {showFullDesc ? "Weniger anzeigen" : "Mehr lesen"}
              </button>
            )}
          </div>
        )}

        {/* EPISODE TRACKING */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface border border-gray-800/90 rounded-2xl p-4">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-gray-300">
              {work.type === "MANGA" ? "Kapitel gelesen" : "Folgen geschaut"}
            </span>
            {releaseInfo?.isStaggeredDubEnding && (
              <span className="text-[11px] font-semibold text-amber-300">
                Dub-Nachlauf aktiv · noch {releaseInfo.dubRemainingEpisodes}{" "}
                Folge{releaseInfo.dubRemainingEpisodes === 1 ? "" : "n"}{" "}
                ausstehend
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => handleUpdateEpisode(-1)}
              disabled={currentEpisode <= 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-white font-bold hover:bg-gray-700 active:scale-95 disabled:opacity-30"
            >
              -
            </button>
            <span className="font-mono font-bold text-lg text-accent-text flex items-center">
              <input
                type="number"
                min="0"
                max={effectiveMaxEps !== 9999 ? effectiveMaxEps : undefined}
                value={episodeInputText}
                onChange={(e) => setEpisodeInputText(e.target.value)}
                onBlur={commitEpisodeInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitEpisodeInput();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-16 bg-transparent text-center focus:outline-none border-b-2 border-transparent focus:border-accent-border-strong m-0 p-0"
                style={{ MozAppearance: "textfield" }}
              />
              <span className="text-sm text-gray-500 ml-1">
                / {calculatedMaxEps !== 9999 ? calculatedMaxEps : "?"}
              </span>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="Werk-Einstellungen (Stand, Dub-Versatz, Takt & Pause)"
                className="ml-3 text-gray-400 hover:text-white transition bg-gray-800 rounded p-1.5"
              >
                <Settings size={14} />
              </button>
            </span>
            <button
              type="button"
              onClick={() => handleUpdateEpisode(1)}
              disabled={currentEpisode >= effectiveMaxEps}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent text-white font-bold hover:bg-accent-hover active:scale-95 disabled:opacity-30 disabled:bg-gray-800"
            >
              +
            </button>
          </div>
        </div>

        {/* UNIFIED WORK SETTINGS MODAL */}
        <WorkSettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          workId={id}
          work={work}
          override={workOverride}
          pauseInfo={pauseRecord}
          userWork={{
            inLibrary,
            current_episode: currentEpisode,
            status: userWorkStatus,
            synchro_offset_episodes:
              synchroOffset === "" ? 0 : Number(synchroOffset),
            sync_offset_days: syncOffsetDays,
            manual_available_eps:
              manualAvailableEps === "" ? null : Number(manualAvailableEps),
          }}
          initialTab="LIMITS"
          onSaved={async (result) => {
            setManualMaxEpisode(result.manualMaxEpisode);
            setManualAvailableEps(result.manualAvailableEps);
            setSynchroOffset(result.synchroOffset);
            setSyncOffsetDays(result.syncOffsetDays);
            setIsWorkPaused(result.isPaused);
            setPausedUntilIso(result.pausedUntil);
            const [freshOverride, freshPauses] = await Promise.all([
              getCalendarOverrideForWork(id).catch(() => null),
              getPausedWorksMap().catch(
                () => ({} as Record<string, WorkPauseRecord>)
              ),
            ]);
            setWorkOverride(freshOverride || undefined);
            setPauseRecord(freshPauses[id] || null);
            setNowMs(Date.now());
          }}
        />

        {/* ACTION BUTTONS */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {work.status !== "NOT_YET_RELEASED" && (
              <>
                <button
                  type="button"
                  onClick={() => handleQuickAdd("CURRENT")}
                  disabled={isSaving}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${
                    userWorkStatus === "CURRENT"
                      ? "bg-accent text-white"
                      : "bg-accent-soft text-accent-light border border-accent-border hover:bg-accent-soft-hover"
                  }`}
                >
                  <PlayCircle size={20} /> <span className="text-xs">Aktiv</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAdd("COMPLETED")}
                  disabled={isSaving}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${
                    userWorkStatus === "COMPLETED"
                      ? "bg-emerald-600 text-white"
                      : "bg-emerald-600/20 text-emerald-400 border border-emerald-600/50 hover:bg-emerald-600/35"
                  }`}
                >
                  <CheckCircle size={20} />{" "}
                  <span className="text-xs">Fertig</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => handleQuickAdd("PLANNING")}
              disabled={isSaving}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${
                work.status === "NOT_YET_RELEASED" ? "col-span-3" : ""
              } ${
                userWorkStatus === "PLANNING"
                  ? "bg-purple-600 text-white"
                  : "bg-purple-600/20 text-purple-400 border border-purple-600/50 hover:bg-purple-600/40"
              }`}
            >
              <Bookmark size={20} /> <span className="text-xs">Wunsch</span>
            </button>
          </div>

          {/* Secondary personal status row: Pausiert & Abgebrochen */}
          {inLibrary && work.status !== "NOT_YET_RELEASED" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickAdd("PAUSED")}
                disabled={isSaving}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold border transition ${
                  userWorkStatus === "PAUSED"
                    ? "bg-amber-600 border-amber-500 text-white"
                    : "bg-surface-elevated border-gray-800 text-gray-300 hover:border-amber-500/40 hover:text-amber-300"
                }`}
              >
                <PauseCircle size={14} />
                Persönlich pausiert
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdd("DROPPED")}
                disabled={isSaving}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold border transition ${
                  userWorkStatus === "DROPPED"
                    ? "bg-rose-600 border-rose-500 text-white"
                    : "bg-surface-elevated border-gray-800 text-gray-300 hover:border-rose-500/40 hover:text-rose-300"
                }`}
              >
                <XCircle size={14} />
                Abgebrochen
              </button>
            </div>
          )}

          {isWorkPaused || userWorkStatus === "PAUSED" ? (
            <button
              type="button"
              onClick={handleUnpause}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-600/20 border border-amber-500/50 hover:bg-amber-600/35 transition text-amber-300 py-3 text-sm font-bold active:scale-95 disabled:opacity-50"
            >
              <PlayCircle size={18} />
              Pause aufheben (
              {isWorkPaused
                ? formatPauseStatusLabel(pausedUntilIso)
                : "Dein Status"}
              )
            </button>
          ) : (
            inLibrary &&
            userWorkStatus === "CURRENT" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePauseWork(1)}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated border border-gray-800 hover:border-amber-500/40 text-gray-300 hover:text-amber-300 py-2.5 text-xs font-bold transition"
                >
                  <PauseCircle size={15} />
                  Global: 1 Wo. Pause
                </button>
                <button
                  type="button"
                  onClick={() => handlePauseWork(2)}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated border border-gray-800 hover:border-amber-500/40 text-gray-300 hover:text-amber-300 py-2.5 text-xs font-bold transition"
                >
                  <PauseCircle size={15} />
                  Global: 2 Wo. Pause
                </button>
              </div>
            )
          )}

          {userWorkStatus === "DROPPED" && (
            <div className="rounded-2xl border border-gray-800/90 bg-surface p-3.5 flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-300">
                Abbruch-Grund
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={droppedReason}
                  onChange={(e) => setDroppedReason(e.target.value)}
                  placeholder="Warum abgebrochen? (optional)"
                  className="flex-1 rounded-xl border border-gray-700 bg-surface-inset px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-accent-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveDroppedReason}
                  disabled={isSaving}
                  className="rounded-xl bg-accent hover:bg-accent-hover px-3.5 py-2 text-xs font-bold text-white transition disabled:opacity-50 shrink-0"
                >
                  Speichern
                </button>
              </div>
            </div>
          )}

          {inLibrary && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 transition text-rose-400 hover:text-rose-300 py-2.5 text-xs font-semibold active:scale-[0.99] disabled:opacity-50"
            >
              <Trash2 size={14} />
              Aus Bibliothek entfernen
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowEvaluation(!showEvaluation)}
            className="w-full rounded-xl bg-surface border border-gray-800/90 py-3.5 font-bold text-sm text-white transition hover:border-gray-700 hover:bg-surface-elevated active:scale-[0.99] flex items-center justify-center gap-2"
          >
            <Star
              size={17}
              className={
                showEvaluation
                  ? "text-amber-400 fill-amber-400"
                  : "text-gray-400"
              }
            />
            {showEvaluation
              ? "Bewertungsmatrix schließen"
              : "Bewertungsmatrix öffnen"}
          </button>
        </div>

        {/* --- DEEP EVALUATION UI --- */}
        {showEvaluation && (
          <div className="mt-6 rounded-2xl border border-gray-800 bg-surface p-5 shadow-xl animate-fade-in">
            <div className="flex justify-between items-center mb-5 pb-4 border-b border-gray-800/80">
              <h2 className="text-lg font-bold text-white">Bewertungsmatrix</h2>
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold text-accent-text tabular-nums">
                  {currentScore.toFixed(2)}
                  <span className="text-xs text-gray-500 ml-0.5">/10</span>
                </span>
                <label className="flex items-center gap-2 text-xs text-gray-400 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={malRated}
                    onChange={(e) => setMalRated(e.target.checked)}
                    className="rounded bg-surface-inset border-gray-700 accent-accent"
                  />
                  Auf MyAnimeList bewertet
                </label>
              </div>
            </div>

            {episodeRatingStats.count > 0 &&
              episodeRatingStats.average !== null && (
                <div className="mb-5 rounded-xl border border-accent-border bg-accent-soft px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-accent-soft-text">
                    <Star
                      size={14}
                      className="text-amber-400 fill-amber-400 shrink-0"
                    />
                    <span>
                      Dein {work.type === "MANGA" ? "Kapitel" : "Folgen"}
                      -Durchschnitt: Ø {episodeRatingStats.average.toFixed(1)} /
                      10
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Basierend auf {episodeRatingStats.count} bewerteten{" "}
                    {work.type === "MANGA" ? "Kapiteln" : "Folgen"} aus deinen
                    Reviews
                  </p>
                </div>
              )}

            <div className="space-y-5">
              <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-200 font-bold flex items-center gap-1.5">
                    <Star
                      size={13}
                      className="text-amber-400 fill-amber-400"
                    />
                    Manuelle Gesamtwertung
                  </span>
                  <span className="font-bold text-white tabular-nums">
                    {evaluation.manualScore || "Matrix"}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={evaluation.manualScore || 0}
                  onChange={(e) => handleSlider("manualScore", e.target.value)}
                  className="w-full accent-amber-400"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Wenn hier ein Wert über 0 gesetzt wird, überschreibt dieser
                  die berechnete Bewertungsmatrix (z. B. für schnelle Imports).
                </p>
              </div>

              {/* Standard Metrics */}
              <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90 space-y-4">
                {(
                  [
                    { label: "Story & Handlung (x2.0)", field: "plotAndStory" },
                    {
                      label: "Hauptcharaktere (x2.0)",
                      field: "castAndCharacters",
                    },
                    {
                      label: "Nebencharaktere (x1.0)",
                      field: "sideCharacters",
                    },
                    {
                      label: "Zeichenstil & Animation (x1.5)",
                      field: "artstyleAndAnimation",
                    },
                    { label: "Ende (x1.5)", field: "ending" },
                    { label: "Binge-Faktor (x1.0)", field: "bingeFactor" },
                    { label: "Comedy (x1.0)", field: "comedy" },
                  ] as const
                ).map((metric) => {
                  const val = Number(evaluation[metric.field] ?? 0);
                  return (
                    <div key={metric.field}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300 font-medium">
                          {metric.label}
                        </span>
                        <span className="font-bold text-white tabular-nums">
                          {val || "-"}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.5"
                        value={val}
                        onChange={(e) =>
                          handleSlider(metric.field, e.target.value)
                        }
                        className="w-full accent-accent"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Conditional Metrics */}
              <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90">
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasRomance}
                    onChange={(e) => setHasRomance(e.target.checked)}
                    className="rounded bg-surface-control border-gray-700 accent-accent"
                  />
                  Ist Romance enthalten?
                </label>

                {hasRomance && (
                  <div className="mt-3 pt-3 border-t border-gray-800/80">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 font-medium">
                        Romance &amp; Chemie
                      </span>
                      <span className="font-bold text-white tabular-nums">
                        {evaluation.romanceAndChemistry || "-"}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={evaluation.romanceAndChemistry || 0}
                      onChange={(e) =>
                        handleSlider("romanceAndChemistry", e.target.value)
                      }
                      className="w-full accent-accent mb-2"
                    />
                    <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isRomanceMainFocus}
                        onChange={(e) =>
                          setIsRomanceMainFocus(e.target.checked)
                        }
                        className="rounded bg-surface-control border-gray-700 accent-accent"
                      />
                      Romance ist der Main-Plot (Gewichtung x2.0 statt x1.0)
                    </label>
                  </div>
                )}
              </div>

              {/* Anime Specific */}
              {work.type === "ANIME" && (
                <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 font-medium">
                        Intro / Outro (x0.5)
                      </span>
                      <span className="font-bold text-white tabular-nums">
                        {evaluation.introOutro || "-"}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={evaluation.introOutro || 0}
                      onChange={(e) =>
                        handleSlider("introOutro", e.target.value)
                      }
                      className="w-full accent-accent"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-gray-300 font-semibold">
                      Watch Mode
                    </span>
                    <div className="grid grid-cols-3 gap-1 bg-app p-1 rounded-xl border border-gray-800/80">
                      {(
                        [
                          { value: "SUB", label: "SUB", sub: "Ohne Sync" },
                          { value: "DUB", label: "DUB", sub: "Sync x0.5" },
                          {
                            value: "BEIDES",
                            label: "Beides",
                            sub: "Sync x0.5",
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setWatchMode(opt.value)}
                          className={`flex flex-col items-center py-1.5 px-2 rounded-lg transition-colors ${
                            watchMode === opt.value
                              ? "bg-accent text-white shadow-sm"
                              : "text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          <span className="text-xs font-bold">{opt.label}</span>
                          <span
                            className={`text-[10px] ${
                              watchMode === opt.value
                                ? "text-white/80"
                                : "text-gray-500"
                            }`}
                          >
                            {opt.sub}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {(watchMode === "DUB" || watchMode === "BEIDES") && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300 font-medium">
                          Voice Acting (x0.5)
                        </span>
                        <span className="font-bold text-white tabular-nums">
                          {evaluation.voiceActing || "-"}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.5"
                        value={evaluation.voiceActing || 0}
                        onChange={(e) =>
                          handleSlider("voiceActing", e.target.value)
                        }
                        className="w-full accent-accent"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Rewatch Potential */}
              <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-300 font-medium">
                    Rewatch-Potenzial (separat)
                  </span>
                  <span className="font-bold text-white tabular-nums">
                    {evaluation.rewatchPotential || "-"}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={evaluation.rewatchPotential || 0}
                  onChange={(e) =>
                    handleSlider("rewatchPotential", e.target.value)
                  }
                  className="w-full accent-purple-500"
                />
              </div>

              {/* Emotional Impact (intentionally allows exceeding 10.0) */}
              <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90">
                <span className="block text-xs text-gray-300 font-semibold mb-2">
                  Emotional Bonus (kann über 10 hinausgehen)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {(
                    [
                      "None",
                      "Leicht",
                      "Mitgenommen",
                      "Tränen nah",
                      "Tränen ausgelöst",
                      "Geweint",
                    ] as EmotionalImpact[]
                  ).map((impact) => (
                    <button
                      key={impact}
                      type="button"
                      onClick={() =>
                        setEvaluation((prev) => ({
                          ...prev,
                          emotionalImpact: impact,
                        }))
                      }
                      className={`rounded-xl border px-2.5 py-2 text-xs font-semibold transition ${
                        evaluation.emotionalImpact === impact
                          ? "border-accent-border-strong bg-accent-soft text-accent-soft-text"
                          : "border-gray-800 bg-surface-control text-gray-400 hover:border-gray-700 hover:text-gray-200"
                      }`}
                    >
                      {impact}
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional Review Fazit / Comment */}
              <div className="bg-surface-inset p-3.5 rounded-xl border border-gray-800/90">
                <label className="block text-xs text-gray-300 font-semibold mb-1.5">
                  Kurzes Fazit zur Gesamtbewertung (optional)
                </label>
                <textarea
                  rows={2}
                  value={evaluation.comments || ""}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      comments: e.target.value,
                    }))
                  }
                  placeholder="Was hat dir besonders gefallen oder gefehlt? (||Spoiler|| möglich)"
                  className="w-full rounded-xl border border-gray-700 bg-surface-control px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-accent-border-strong focus:outline-none resize-y"
                />
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="w-full flex justify-center items-center gap-2 rounded-xl bg-accent py-3 text-sm font-bold text-white shadow-lg transition hover:bg-accent-hover active:scale-[0.99] disabled:opacity-50"
              >
                <Save size={17} />
                {isSaving ? "Speichert..." : "Bewertung speichern"}
              </button>
            </div>
          </div>
        )}

        {/* --- EPISODE/CHAPTER FEEDBACK SECTION --- */}
        <WorkSocialFeed workId={id} work={work} />
      </div>
    </div>
  );
}
