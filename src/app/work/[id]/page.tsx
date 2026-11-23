"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchAniList, GET_WORK_DETAILS } from "@/lib/anilist";
import { calculateOverallScore } from "@/lib/scoring";
import { UserWork, EmotionalImpact, WatchMode } from "@/types/database";
import { Star, ChevronLeft, Save, Library as LibraryIcon, Check, Calendar as CalendarIcon, PlayCircle, CheckCircle, PauseCircle, Bookmark, Settings } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { CalendarOverride, getCalendarOverrides, formatPauseStatusLabel } from "@/lib/db/calendar";
import { auth } from "@/lib/firebase";
import { saveUserWork, getUserWork, updateEpisodeProgress, removeUserWork, updateUserWorkStatus } from "@/lib/db/works";
import { addToHistory } from "@/lib/db/users";
import { WorkSocialFeed } from "./WorkSocialFeed";
import { createActivity } from "@/lib/db/feed";
import { getUserEpisodeRatingsForWork } from "@/lib/db/feedback";
import { WorkPauseRecord, getPausedWorksMap, pauseWorkForWeeks, unpauseWork } from "@/lib/db/pauses";
import { WorkSettingsModal } from "@/components/ui/WorkSettingsModal";
import { useAppStore } from "@/lib/store";

export default function WorkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const reloadTrigger = useAppStore(state => state.reloadTrigger);
  
  const [work, setWork] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [userWorkStatus, setUserWorkStatus] = useState<UserWork["status"]>("NONE");
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const [episodeInputText, setEpisodeInputText] = useState("0");
  const [manualMaxEpisode, setManualMaxEpisode] = useState<number | "">("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [synchroOffset, setSynchroOffset] = useState<number | "">(0);
  const [manualAvailableEps, setManualAvailableEps] = useState<number | "">("");
  const [workOverride, setWorkOverride] = useState<CalendarOverride | undefined>(undefined);
  const [pauseRecord, setPauseRecord] = useState<WorkPauseRecord | null>(null);
  const [droppedReason, setDroppedReason] = useState("");
  const [isWorkPaused, setIsWorkPaused] = useState(false);
  const [pausedUntilIso, setPausedUntilIso] = useState<string>("");

  // Form State for Deep Evaluation
  const [evaluation, setEvaluation] = useState<UserWork["evaluation"]>({
    plotAndStory: 0,
    castAndCharacters: 0,
    sideCharacters: 0,
    ending: 0,
    artstyleAndAnimation: 0,
    introOutro: 0,
    voiceActing: 0,
    romanceAndChemistry: 0,
    bingeFactor: 0,
    rewatchPotential: 0,
    emotionalImpact: "None",
    comments: "",
    overallScore: 0,
  });

  const [hasRomance, setHasRomance] = useState(false);
  const [isRomanceMainFocus, setIsRomanceMainFocus] = useState(false);
  const [malRated, setMalRated] = useState(false);
  const [watchMode, setWatchMode] = useState<WatchMode>("SUB");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [episodeRatingStats, setEpisodeRatingStats] = useState<{ average: number | null; count: number }>({
    average: null,
    count: 0,
  });
  const lastSavedScoreRef = useRef<number>(0);
  const lastSavedCommentRef = useRef<string>("");

  useEffect(() => {
    setEpisodeInputText(String(currentEpisode));
  }, [currentEpisode]);

  useEffect(() => {
    let isMounted = true;

    async function loadData(user: typeof auth.currentUser) {
      if (!id) return;
      setIsLoading(true);
      try {
        const [data, userWork, overrides, epRatings, pausedMap] = await Promise.all([
          fetchAniList(GET_WORK_DETAILS, { id: parseInt(id, 10) }),
          user ? getUserWork(user.uid, id) : Promise.resolve(null),
          getCalendarOverrides(),
          user
            ? getUserEpisodeRatingsForWork(user.uid, id)
            : Promise.resolve({ average: null, count: 0, items: [] }),
          getPausedWorksMap().catch((): Record<string, WorkPauseRecord> => ({})),
        ]);

        if (!isMounted) return;

        setWork(data.Media);
        setEpisodeRatingStats({ average: epRatings.average, count: epRatings.count });
        const loadedPause = pausedMap[id] || null;
        setPauseRecord(loadedPause);
        setIsWorkPaused(Boolean(loadedPause));
        setPausedUntilIso(loadedPause?.paused_until || "");

        const ov = overrides[id];
        setWorkOverride(ov);
        if (ov) {
          if (ov.manualMaxEpisode !== undefined) {
            setManualMaxEpisode(ov.manualMaxEpisode);
          } else {
            setManualMaxEpisode("");
          }
          if (ov.manualAvailableEps !== undefined) {
            const loadedMax =
              ov.manualMaxEpisode != null && Number(ov.manualMaxEpisode) > 0
                ? Number(ov.manualMaxEpisode)
                : data.Media.type === "MANGA" && Number(data.Media.chapters) > 0
                ? Number(data.Media.chapters)
                : data.Media.type !== "MANGA" && Number(data.Media.episodes) > 0
                ? Number(data.Media.episodes)
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
        const isRomance = data.Media.genres?.includes("Romance") || false;
        setIsRomanceMainFocus(isRomance);

        if (userWork) {
          setInLibrary(true);
          setUserWorkStatus(userWork.status || "PLANNING");
          setCurrentEpisode(userWork.current_episode || 0);
          setDroppedReason(userWork.dropped_reason || "");
          setEvaluation({
            ...userWork.evaluation,
            rewatchPotential: userWork.evaluation?.rewatchPotential ?? 0,
          });
          lastSavedScoreRef.current =
            Number(userWork.evaluation?.overallScore) ||
            Number(userWork.evaluation?.manualScore) ||
            0;
          lastSavedCommentRef.current = (userWork.evaluation?.comments || "").trim();
          setWatchMode(userWork.classification?.watchMode || "SUB");
          setMalRated(userWork.mal_rated || false);
          setSynchroOffset(userWork.synchro_offset_episodes || 0);
          if (!ov || ov.manualAvailableEps === undefined) {
            setManualAvailableEps(userWork.manual_available_eps ?? "");
          }
          if (userWork.evaluation.romanceAndChemistry > 0) setHasRomance(true);
        } else {
          setInLibrary(false);
          setUserWorkStatus("NONE");
          setCurrentEpisode(0);
          setDroppedReason("");
          setHasRomance(isRomance);
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

  const handleSlider = (field: keyof UserWork["evaluation"], value: string) => {
    setEvaluation(prev => ({ ...prev, [field]: parseFloat(value) }));
  };

  const aniListMax = work?.episodes || work?.chapters || 9999;
  const calculatedMaxEps = manualMaxEpisode !== "" ? manualMaxEpisode : aniListMax;
  
  // If it's releasing, it shouldn't jump to the manual max episode.
  // It should be capped at the smaller of max and currently available.
  let baseAvailable = work?.nextAiringEpisode ? (work.nextAiringEpisode.episode - 1) : calculatedMaxEps;
  if (baseAvailable > calculatedMaxEps) baseAvailable = calculatedMaxEps;
  if (manualAvailableEps !== "") baseAvailable = manualAvailableEps;
  
  let calculatedAvailableEps = typeof baseAvailable === "number" && baseAvailable !== 9999 ? baseAvailable : 9999;
  if (manualAvailableEps === "" && typeof synchroOffset === "number" && synchroOffset > 0 && calculatedAvailableEps !== 9999) {
    calculatedAvailableEps = Math.max(0, calculatedAvailableEps - synchroOffset);
  }

  const handleQuickAdd = async (status: "CURRENT" | "COMPLETED" | "PLANNING" | "PAUSED") => {
    const user = auth?.currentUser;
    if (!user) {
      alert("Bitte erst einloggen!");
      return;
    }
    
    const { useAppStore } = await import("@/lib/store");
    if (!useAppStore.getState().isOnline) {
      alert("Keine Internetverbindung.");
      return;
    }
    
    setIsSaving(true);
    try {
      let epsToSave = currentEpisode;
      if (status === "COMPLETED" && calculatedMaxEps !== 9999) {
        epsToSave = calculatedMaxEps as number;
        setCurrentEpisode(epsToSave);
      }

      if (inLibrary) {
        await updateUserWorkStatus(user.uid, id, status);
        if (epsToSave !== currentEpisode) {
          await updateEpisodeProgress(user.uid, id, epsToSave);
        }
      } else {
        await saveUserWork(user.uid, id, {
          status: status,
          evaluation: evaluation,
          current_episode: epsToSave,
          mal_rated: malRated,
          added_status: work?.status
        });
        await addToHistory(user.uid, id);
        // Create feed activity
        const title = work?.title?.english || work?.title?.romaji || 'ein Werk';
        await createActivity(user.uid, "TOP9_UPDATE", id, `Hat ${title} zur Bibliothek hinzugefügt.`);

        // --- Prequel Auto-Erkennung ---
        const prequels = work?.relations?.edges?.filter((edge: any) => edge.relationType === "PREQUEL") || [];
        for (const prequelEdge of prequels) {
          const prequel = prequelEdge.node;
          if (!prequel || !prequel.id) continue;
          try {
            const existingPrequel = await getUserWork(user.uid, prequel.id.toString());
            if (!existingPrequel) {
              const maxPrequelEps = prequel.episodes || prequel.chapters || 0;
              await saveUserWork(user.uid, prequel.id.toString(), {
                status: "COMPLETED",
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
                  overallScore: 0
                },
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
                current_episode: maxPrequelEps,
                auto_added: true
              });
              await addToHistory(user.uid, prequel.id.toString());
            }
          } catch (err) {
            console.error("Failed to auto-add prequel:", err);
          }
        }
      }
      setInLibrary(true);
      setUserWorkStatus(status);
    } catch (err: any) {
      console.error(err);
      alert("Fehler beim Hinzufügen: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    const user = auth?.currentUser;
    if (!user) return;
    if (!window.confirm("Wirklich aus der Bibliothek entfernen?")) return;
    setIsSaving(true);
    try {
      await removeUserWork(user.uid, id);
      setInLibrary(false);
      setUserWorkStatus("NONE");
      setSaveMessage("Aus Bibliothek entfernt");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err: any) {
      console.error(err);
      alert("Fehler beim Entfernen: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const user = auth?.currentUser;
    if (!user) {
      setSaveMessage("Bitte erst einloggen!");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    const finalEval = {
      ...evaluation,
      rewatchPotential: evaluation.rewatchPotential || 0,
      overallScore: currentScore,
    };
    setEvaluation(finalEval);

    try {
      await saveUserWork(user.uid, id, {
        evaluation: finalEval,
        classification: {
          watchMode,
          romanceLevel: 0,
          confessionTiming: "",
          intimacyLevel: 0,
          relationshipDynamics: "",
          wholesomeLewdScale: 0,
          comedySeriousScale: 0,
          actionDialogScale: 0,
          pacingScale: 0,
        },
        mal_rated: malRated,
        dropped_reason: droppedReason.trim(),
        synchro_offset_episodes: synchroOffset === "" ? 0 : synchroOffset,
        auto_added: false,
        status: userWorkStatus !== "NONE" ? userWorkStatus : "COMPLETED"
      });

      try {
        await addToHistory(user.uid, id);
      } catch (e) {
        console.warn(e);
      }

      // Notify & create Feed Activity whenever the rating or review comment changed
      const prevScore = lastSavedScoreRef.current;
      const prevComment = lastSavedCommentRef.current;
      const trimmedComment = (finalEval.comments || "").trim();
      const scoreChanged =
        currentScore > 0 && Math.abs(currentScore - prevScore) >= 0.05;
      const commentChanged =
        trimmedComment.length > 0 && trimmedComment !== prevComment;
      const workTitle =
        work?.title?.english || work?.title?.romaji || `Werk #${id}`;

      if (scoreChanged || commentChanged) {
        try {
          const activityText = scoreChanged
            ? prevScore > 0
              ? `Hat die Bewertung von ${workTitle} angepasst: ${prevScore.toFixed(1)} → ${currentScore.toFixed(1)}/10`
              : `Hat ${workTitle} mit ${currentScore.toFixed(1)}/10 bewertet!`
            : `Hat die Review zu ${workTitle}${currentScore > 0 ? ` (${currentScore.toFixed(1)}/10)` : ""} aktualisiert`;
          await createActivity(user.uid, "RATING", id, activityText);
        } catch (e) {
          console.warn(e);
        }
      }

      lastSavedScoreRef.current = currentScore;
      lastSavedCommentRef.current = trimmedComment;

      setInLibrary(true);
      setSaveMessage("Gespeichert!");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error(err);
      setSaveMessage("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDroppedReason = async () => {
    const user = auth?.currentUser;
    if (!user) {
      setSaveMessage("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    setSaveMessage("");
    try {
      await saveUserWork(user.uid, id, {
        dropped_reason: droppedReason.trim(),
      });
      setSaveMessage("Gespeichert!");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error(err);
      setSaveMessage("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnpause = async () => {
    const user = auth?.currentUser;
    if (!user) {
      alert("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    try {
      await unpauseWork(id);
      setPauseRecord(null);
      setIsWorkPaused(false);
      setPausedUntilIso("");
      if (userWorkStatus === "PAUSED") {
        await updateUserWorkStatus(user.uid, id, "CURRENT");
        setUserWorkStatus("CURRENT");
      }
      setSaveMessage("Pause aufgehoben!");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error(err);
      setSaveMessage("Fehler beim Entpausieren");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePauseWork = async (weeks: number) => {
    const user = auth?.currentUser;
    if (!user) {
      alert("Bitte erst einloggen!");
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
      setSaveMessage("Werk pausiert!");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error(err);
      setSaveMessage("Fehler beim Pausieren");
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveMaxEps = calculatedAvailableEps !== 9999 ? Math.max(calculatedAvailableEps as number, currentEpisode) : 9999;

  const handleUpdateEpisode = async (increment: number) => {
    const user = auth?.currentUser;
    if (!user) return alert("Bitte einloggen");
    
    const { useAppStore } = await import("@/lib/store");
    if (!useAppStore.getState().isOnline) {
      alert("Keine Internetverbindung.");
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
        alert("Fehler beim Speichern der Episode");
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
      <div className="flex flex-col pb-12 animate-pulse">
        <div className="h-48 w-full bg-gray-800"></div>
        <div className="relative -mt-16 px-4">
          <div className="flex gap-4">
            <div className="h-40 w-28 rounded-lg bg-gray-700 shrink-0"></div>
            <div className="flex flex-col justify-end pt-16 gap-2 w-full">
              <div className="h-6 w-3/4 bg-gray-700 rounded"></div>
              <div className="h-4 w-1/2 bg-gray-700 rounded"></div>
            </div>
          </div>
          <div className="mt-6 flex gap-2">
            <div className="h-6 w-16 bg-gray-700 rounded"></div>
            <div className="h-6 w-16 bg-gray-700 rounded"></div>
          </div>
          <div className="mt-6 h-24 w-full bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (!work) {
    return <div className="p-8 text-center text-red-500">Werk nicht gefunden.</div>;
  }

  return (
    <div className="flex flex-col pb-12">
      {/* Banner & Cover */}
      <div className="relative h-48 w-full bg-gray-800">
        {work.bannerImage && (
          <Image src={work.bannerImage} alt="Banner" fill priority className="object-cover opacity-60" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] to-transparent" />
        <button onClick={() => router.back()} className="absolute left-4 top-4 rounded-full bg-black/50 p-2 text-white backdrop-blur-md">
          <ChevronLeft size={24} />
        </button>
      </div>

      <div className="relative -mt-16 px-4">
        <div className="flex gap-4">
          <div className="relative h-40 w-28 shrink-0">
            <Image 
              src={work.coverImage?.extraLarge || work.coverImage?.large} 
              alt="Cover" 
              fill
              priority
              className="rounded-lg shadow-xl border border-gray-800 object-cover" 
            />
          </div>
          <div className="flex flex-col justify-end pt-16">
            <h1 className="text-xl font-bold leading-tight line-clamp-3">{work.title?.english || work.title?.romaji}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-300">
              <Star size={14} className="text-yellow-500" />
              <span>{work.averageScore ? (work.averageScore / 10).toFixed(1) : "?"} AniList</span>
              <span className="text-gray-500">•</span>
              <span>{work.format || work.type}</span>
            </div>
          </div>
        </div>

        {/* Genres & Tags */}
        <div className="mt-6 flex flex-wrap gap-2">
          {work.genres?.map((g: string) => (
            <span key={g} className="rounded bg-blue-600/20 px-2 py-1 text-xs font-semibold text-blue-400">
              {g}
            </span>
          ))}
        </div>

        {/* Release Date */}
        {work.startDate?.year && (
          <div className="mt-4 text-sm font-bold text-yellow-500 flex items-center gap-1.5">
            <CalendarIcon size={14} />
            Release: {work.startDate.day ? `${work.startDate.day.toString().padStart(2, '0')}.` : ""}{work.startDate.month ? `${work.startDate.month.toString().padStart(2, '0')}.` : ""}{work.startDate.year}
          </div>
        )}

        {/* GLOBAL PAUSE / HIATUS BANNER (Visible to all users, any user can unpause for everyone) */}
        {isWorkPaused && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                Global auf Pause / Hiatus ({formatPauseStatusLabel(pausedUntilIso)})
              </span>
              <span className="text-[11px] text-amber-200/80 mt-0.5">
                Gilt für alle Nutzer in AniPulse. Jeder Nutzer kann die Pause hier für alle beenden, sobald es weitergeht.
              </span>
            </div>
            <button
              type="button"
              onClick={handleUnpause}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition shrink-0"
            >
              Pause für alle aufheben
            </button>
          </div>
        )}

        <p className={`mt-2 text-sm text-gray-300 ${work.startDate?.year ? '' : 'mt-4'} line-clamp-4`} dangerouslySetInnerHTML={{ __html: work.description || "" }} />

        {/* EPISODE TRACKING */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex flex-col">
            <span className="font-bold text-gray-300">
              {work.type === "MANGA" ? "Kapitel gelesen" : "Folgen geschaut"}
            </span>
          </div>
          <div className="flex items-center gap-4 self-end sm:self-auto">
            <button 
              onClick={() => handleUpdateEpisode(-1)}
              disabled={currentEpisode <= 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-white font-bold hover:bg-gray-700 active:scale-95 disabled:opacity-30"
            >-</button>
            <span className="font-mono font-bold text-lg text-blue-400 flex items-center">
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
                className="w-16 bg-transparent text-center focus:outline-none border-b-2 border-transparent focus:border-blue-500 m-0 p-0"
                style={{ MozAppearance: 'textfield' }}
              />
              <span className="text-sm text-gray-500 ml-1">/ {calculatedMaxEps !== 9999 ? calculatedMaxEps : "?"}</span>
              <button
                onClick={() => setShowSettingsModal(true)}
                title="Werk-Einstellungen (Stand, Takt & Pause)"
                className="ml-3 text-gray-400 hover:text-white transition bg-gray-800 rounded p-1.5"
              >
                <Settings size={14} />
              </button>
            </span>
            <button 
              onClick={() => handleUpdateEpisode(1)}
              disabled={currentEpisode >= effectiveMaxEps}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-500 active:scale-95 disabled:opacity-30 disabled:bg-gray-800"
            >+</button>
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
            synchro_offset_episodes: synchroOffset === "" ? 0 : Number(synchroOffset),
            manual_available_eps: manualAvailableEps === "" ? null : Number(manualAvailableEps),
          }}
          initialTab="LIMITS"
          onSaved={async (result) => {
            setManualMaxEpisode(result.manualMaxEpisode);
            setManualAvailableEps(result.manualAvailableEps);
            setSynchroOffset(result.synchroOffset);
            setIsWorkPaused(result.isPaused);
            setPausedUntilIso(result.pausedUntil);
            const [freshOverrides, freshPauses] = await Promise.all([
              getCalendarOverrides().catch(() => ({} as Record<string, CalendarOverride>)),
              getPausedWorksMap().catch(() => ({} as Record<string, WorkPauseRecord>)),
            ]);
            setWorkOverride(freshOverrides[id]);
            setPauseRecord(freshPauses[id] || null);
            setSaveMessage("Einstellungen gespeichert!");
            setTimeout(() => setSaveMessage(""), 3000);
          }}
        />



        {/* ACTION BUTTONS */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {work.status !== "NOT_YET_RELEASED" && (
              <>
                <button 
                  onClick={() => handleQuickAdd("CURRENT")}
                  disabled={isSaving}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${userWorkStatus === "CURRENT" ? "bg-blue-600 text-white" : "bg-blue-600/20 text-blue-400 border border-blue-600/50 hover:bg-blue-600/40"}`}
                >
                  <PlayCircle size={20} /> <span className="text-xs">Aktiv</span>
                </button>
                <button 
                  onClick={() => handleQuickAdd("COMPLETED")}
                  disabled={isSaving}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${userWorkStatus === "COMPLETED" ? "bg-green-600 text-white" : "bg-green-600/20 text-green-400 border border-green-600/50 hover:bg-green-600/40"}`}
                >
                  <CheckCircle size={20} /> <span className="text-xs">Fertig</span>
                </button>
              </>
            )}
            <button 
              onClick={() => handleQuickAdd("PLANNING")}
              disabled={isSaving}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${work.status === "NOT_YET_RELEASED" ? "col-span-3" : ""} ${userWorkStatus === "PLANNING" ? "bg-purple-600 text-white" : "bg-purple-600/20 text-purple-400 border border-purple-600/50 hover:bg-purple-600/40"}`}
            >
              <Bookmark size={20} /> <span className="text-xs">Wunsch</span>
            </button>
          </div>
          
          {isWorkPaused || userWorkStatus === "PAUSED" ? (
            <button
              onClick={handleUnpause}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-600/20 border border-amber-500/50 hover:bg-amber-600/35 transition text-amber-300 py-3 text-sm font-bold active:scale-95 disabled:opacity-50"
            >
              <PlayCircle size={18} />
              Pause aufheben ({formatPauseStatusLabel(pausedUntilIso)})
            </button>
          ) : (
            inLibrary &&
            userWorkStatus === "CURRENT" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePauseWork(1)}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1d24] border border-gray-800 hover:border-amber-500/40 text-gray-300 hover:text-amber-300 py-2.5 text-xs font-bold transition"
                >
                  <PauseCircle size={15} />
                  Diese Woche Pause
                </button>
                <button
                  type="button"
                  onClick={() => handlePauseWork(2)}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1d24] border border-gray-800 hover:border-amber-500/40 text-gray-300 hover:text-amber-300 py-2.5 text-xs font-bold transition"
                >
                  <PauseCircle size={15} />
                  2 Wochen Pause
                </button>
              </div>
            )
          )}

          {userWorkStatus === "DROPPED" && (
            <div className="rounded-xl border border-gray-800 bg-[#141a29] p-3 flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-400">
                Abbruch-Grund
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={droppedReason}
                  onChange={(e) => setDroppedReason(e.target.value)}
                  placeholder="Warum abgebrochen? (optional)"
                  className="flex-1 rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveDroppedReason}
                  disabled={isSaving}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-bold text-white transition disabled:opacity-50 shrink-0"
                >
                  Speichern
                </button>
              </div>
            </div>
          )}

          {inLibrary && (
            <div className="flex gap-2">
              <button 
                onClick={handleRemove}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-900/30 border border-red-900 hover:bg-red-900/60 transition text-red-500 py-3 text-sm font-bold active:scale-95 disabled:opacity-50"
              >
                X Aus Bibliothek entfernen
              </button>
            </div>
          )}
          
          <button 
            onClick={() => setShowEvaluation(!showEvaluation)}
            className="w-full rounded-xl bg-[#1a1d24] border border-gray-800 py-3.5 font-bold text-white transition hover:bg-gray-800 active:scale-95 flex items-center justify-center gap-2"
          >
            <Star size={20} className={showEvaluation ? "text-yellow-500" : "text-gray-400"} /> 
            {showEvaluation ? "Bewertungsmatrix schließen" : "Bewertungsmatrix öffnen"}
          </button>
        </div>

        {/* --- DEEP EVALUATION UI --- */}
        {showEvaluation && (
          <div className="mt-6 rounded-2xl border border-gray-800 bg-[#1a1d24] p-5 shadow-lg animate-in fade-in slide-in-from-top-4">
          
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white">
              Bewertungsmatrix
            </h2>
            <div className="flex flex-col items-end">
              <span className="text-2xl font-bold text-blue-500">{currentScore.toFixed(2)}<span className="text-sm text-gray-500">/10</span></span>
              <label className="flex items-center gap-2 text-xs text-gray-400 mt-1 cursor-pointer">
                <input type="checkbox" checked={malRated} onChange={(e) => setMalRated(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-blue-600 focus:ring-blue-600" />
                Auf MyAnimeList bewertet
              </label>
            </div>
          </div>

          {episodeRatingStats.count > 0 && episodeRatingStats.average !== null && (
            <div className="mb-6 rounded-xl border border-blue-500/30 bg-blue-950/30 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-blue-300">
                <Star size={15} className="text-yellow-400 fill-yellow-400 shrink-0" />
                <span>
                  Dein {work.type === "MANGA" ? "Kapitel" : "Folgen"}-Durchschnitt: Ø {episodeRatingStats.average.toFixed(1)} / 10
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                (basierend auf {episodeRatingStats.count} bewerteten {work.type === "MANGA" ? "Kapiteln" : "Folgen"} aus deinen Reviews)
              </p>
            </div>
          )}

          <div className="space-y-6">
            <div className="bg-[#141a29] p-4 rounded-xl border border-gray-800">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-300 font-bold flex items-center gap-2">
                  <Star size={14} className="text-yellow-500" />
                  Manuelle Gesamtwertung
                </span>
                <span className="font-bold text-white">{evaluation.manualScore || 'Matrix'}</span>
              </div>
              <input 
                type="range" min="0" max="10" step="0.5" 
                value={evaluation.manualScore || 0}
                onChange={(e) => handleSlider("manualScore", e.target.value)}
                className="w-full accent-yellow-500"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Wenn hier ein Wert über 0 gesetzt wird, überschreibt dieser die berechnete Bewertungsmatrix (z.B. für schnelle Imports).
              </p>
            </div>

            {/* Standard Metrics */}
            {[
              { label: "Story & Handlung (x2.0)", field: "plotAndStory" },
              { label: "Hauptcharaktere (x2.0)", field: "castAndCharacters" },
              { label: "Nebencharaktere (x1.0)", field: "sideCharacters" },
              { label: "Zeichenstil & Animation (x1.5)", field: "artstyleAndAnimation" },
              { label: "Ende (x1.5)", field: "ending" },
              { label: "Binge-Faktor (x1.0)", field: "bingeFactor" },
              { label: "Comedy (x1.0)", field: "comedy" },
            ].map((metric) => (
              <div key={metric.field}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-300 font-medium">{metric.label}</span>
                  <span className="font-bold text-white">{evaluation[metric.field as keyof UserWork["evaluation"]] || '-'}</span>
                </div>
                <input 
                  type="range" min="0" max="10" step="0.5" 
                  value={evaluation[metric.field as keyof UserWork["evaluation"]] as number}
                  onChange={(e) => handleSlider(metric.field as keyof UserWork["evaluation"], e.target.value)}
                  className="w-full accent-blue-500"
                />
              </div>
            ))}

            {/* Conditional Metrics */}
            <div className="pt-4 border-t border-gray-800">
              <label className="flex items-center gap-2 mb-4 text-sm text-gray-300">
                <input type="checkbox" checked={hasRomance} onChange={(e) => setHasRomance(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-blue-600 focus:ring-blue-600" />
                Ist Romance enthalten?
              </label>
              
              {hasRomance && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300 font-medium">Romance & Chemie</span>
                    <span className="font-bold text-white">{evaluation.romanceAndChemistry || '-'}</span>
                  </div>
                  <input type="range" min="0" max="10" step="0.5" value={evaluation.romanceAndChemistry} onChange={(e) => handleSlider("romanceAndChemistry", e.target.value)} className="w-full accent-blue-500 mb-2" />
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <input type="checkbox" checked={isRomanceMainFocus} onChange={(e) => setIsRomanceMainFocus(e.target.checked)} className="rounded bg-gray-900 border-gray-700" />
                    Romance ist der Main-Plot (Gewichtung x2.0 statt x1.0)
                  </label>
                </div>
              )}
            </div>

            {/* Anime Specific */}
            {work.type === "ANIME" && (
              <div className="pt-4 border-t border-gray-800 space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300 font-medium">Intro / Outro (x0.5)</span>
                    <span className="font-bold text-white">{evaluation.introOutro || '-'}</span>
                  </div>
                  <input type="range" min="0" max="10" step="0.5" value={evaluation.introOutro} onChange={(e) => handleSlider("introOutro", e.target.value)} className="w-full accent-blue-500" />
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm text-gray-300 font-medium">Watch Mode</span>
                  <select 
                    value={watchMode} 
                    onChange={(e) => setWatchMode(e.target.value as WatchMode)}
                    className="bg-[#0f1115] border border-gray-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="SUB">SUB (Keine Sync-Wertung)</option>
                    <option value="DUB">DUB (Voice Acting x0.5)</option>
                    <option value="BEIDES">BEIDES (Voice Acting x0.5)</option>
                  </select>
                </div>

                {(watchMode === "DUB" || watchMode === "BEIDES") && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300 font-medium">Voice Acting (x0.5)</span>
                      <span className="font-bold text-white">{evaluation.voiceActing || '-'}</span>
                    </div>
                    <input type="range" min="0" max="10" step="0.5" value={evaluation.voiceActing} onChange={(e) => handleSlider("voiceActing", e.target.value)} className="w-full accent-blue-500" />
                  </div>
                )}
              </div>
            )}

            {/* Rewatch Potential (separate from overall score) */}
            <div className="pt-4 border-t border-gray-800">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-300 font-medium">
                  Rewatch-Potenzial (zählt nicht in Gesamtwertung)
                </span>
                <span className="font-bold text-white">
                  {evaluation.rewatchPotential || '-'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={evaluation.rewatchPotential || 0}
                onChange={(e) => handleSlider("rewatchPotential", e.target.value)}
                className="w-full accent-purple-500"
              />
            </div>

            {/* Emotional Impact */}
            <div className="pt-4 border-t border-gray-800">
              <span className="block text-sm text-gray-300 font-medium mb-2">Emotional Bonus</span>
              <div className="grid grid-cols-2 gap-2">
                {(["None", "Leicht", "Mitgenommen", "Tränen nah", "Tränen ausgelöst", "Geweint"] as EmotionalImpact[]).map((impact) => (
                  <button
                    key={impact}
                    onClick={() => setEvaluation(prev => ({ ...prev, emotionalImpact: impact }))}
                    className={`rounded-lg border p-2 text-xs font-semibold transition ${
                      evaluation.emotionalImpact === impact 
                      ? "border-blue-500 bg-blue-600/20 text-blue-400" 
                      : "border-gray-700 bg-[#0f1115] text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    {impact}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="w-full mt-6 flex justify-center items-center gap-2 rounded-lg bg-blue-600 py-3 font-bold text-white shadow-lg transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
            >
              <Save size={20} />
              {isSaving ? "Speichert..." : "Bewertung Speichern"}
            </button>
            {saveMessage && (
              <p className={`text-center text-sm font-semibold mt-2 ${saveMessage.includes("Fehler") || saveMessage.includes("einloggen") ? "text-red-400" : "text-green-400"}`}>
                {saveMessage}
              </p>
            )}
          </div>
        </div>
        )}
        
        {/* --- COMMENTS SECTION --- */}
        <WorkSocialFeed workId={id} work={work} />
      </div>
    </div>
  );
}
