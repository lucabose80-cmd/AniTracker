"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchAniList, GET_WORK_DETAILS } from "@/lib/anilist";
import { calculateOverallScore } from "@/lib/scoring";
import { UserWork, EmotionalImpact, WatchMode } from "@/types/database";
import { Star, ChevronLeft, Save, Library as LibraryIcon, Check, Calendar as CalendarIcon, PlayCircle, CheckCircle, Bookmark } from "lucide-react";
import Link from "next/link";
import { setCalendarOverride, getCalendarOverrides, clearManualMaxEpisode, CalendarOverride } from "@/lib/db/calendar";
import { auth } from "@/lib/firebase";
import { saveUserWork, getUserWork, updateEpisodeProgress, removeUserWork, updateUserWorkStatus } from "@/lib/db/works";
import { addToHistory } from "@/lib/db/users";
import { CommentsSection } from "./CommentsSection";
import { createActivity } from "@/lib/db/feed";

export default function WorkDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  
  const [work, setWork] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [userWorkStatus, setUserWorkStatus] = useState<UserWork["status"]>("NONE");
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const [manualMaxEpisode, setManualMaxEpisode] = useState<number | "">("");

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
    emotionalImpact: "None",
    comments: "",
    overallScore: 0,
  });

  const [hasEnding, setHasEnding] = useState(false);
  const [isRomanceMainFocus, setIsRomanceMainFocus] = useState(false);
  const [watchMode, setWatchMode] = useState<WatchMode>("SUB");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [customDay, setCustomDay] = useState<number>(1);
  const [customTime, setCustomTime] = useState<string>("12:00");
  const [hasCustomOverride, setHasCustomOverride] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      setIsLoading(true);
      try {
        const user = auth?.currentUser;
        
        const [data, userWork, overrides] = await Promise.all([
          fetchAniList(GET_WORK_DETAILS, { id: parseInt(id, 10) }),
          user ? getUserWork(user.uid, id) : Promise.resolve(null),
          getCalendarOverrides()
        ]);

        setWork(data.Media);
        
        if (overrides[id]) {
          if (overrides[id].weeklyTime) {
            setHasCustomOverride(true);
            if (overrides[id].weeklyDay !== undefined) setCustomDay(overrides[id].weeklyDay!);
            if (overrides[id].weeklyTime !== undefined) setCustomTime(overrides[id].weeklyTime!);
          }
          if (overrides[id].manualMaxEpisode !== undefined) {
            setManualMaxEpisode(overrides[id].manualMaxEpisode!);
          }
        }
        const isRomance = data.Media.genres?.includes("Romance") || false;
        setIsRomanceMainFocus(isRomance);

        if (userWork) {
          setInLibrary(true);
          setUserWorkStatus(userWork.status || "PLANNING");
          setCurrentEpisode(userWork.current_episode || 0);
          // Legacy support: if local override exists but no global override, use local (or we just ignore local entirely, ignoring local is cleaner)
          setEvaluation(userWork.evaluation);
          setWatchMode(userWork.classification?.watchMode || "SUB");
          if (userWork.evaluation.ending > 0) setHasEnding(true);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [id]);

  const currentScore = calculateOverallScore({
    evaluation,
    hasEnding,
    isRomanceMainFocus,
    isAnime: work?.type === "ANIME",
    watchMode,
  });

  const handleSlider = (field: keyof UserWork["evaluation"], value: string) => {
    setEvaluation(prev => ({ ...prev, [field]: parseFloat(value) }));
  };

  const handleQuickAdd = async (status: "CURRENT" | "COMPLETED" | "PLANNING") => {
    const user = auth?.currentUser;
    if (!user) {
      alert("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    try {
      if (inLibrary) {
        await updateUserWorkStatus(user.uid, id, status);
      } else {
        await saveUserWork(user.uid, id, {
          status: status,
          evaluation: evaluation,
          current_episode: currentEpisode
        });
        await addToHistory(user.uid, id);
        // Create feed activity
        await createActivity(user.uid, "TOP9_UPDATE", id, `Hat ${work?.title?.romaji || 'ein Werk'} zur Bibliothek hinzugefügt.`);
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

    const finalEval = { ...evaluation, overallScore: currentScore };
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
        status: userWorkStatus !== "NONE" ? userWorkStatus : "COMPLETED"
      });
      
      await addToHistory(user.uid, id);
      
      // Create Feed Activity for High Ratings
      if (currentScore >= 7) {
        await createActivity(user.uid, "RATING", id, `Hat ${work?.title?.romaji} mit ${currentScore.toFixed(1)}/10 bewertet!`);
      }

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

  const handleUpdateEpisode = async (increment: number) => {
    const user = auth?.currentUser;
    if (!user) return alert("Bitte einloggen");
    
    const maxEps = work?.episodes || work?.chapters || 9999;
    let newEp = currentEpisode + increment;
    if (newEp < 0) newEp = 0;
    if (newEp > maxEps) newEp = maxEps;
    
    setCurrentEpisode(newEp);
    
    if (inLibrary) {
      await updateEpisodeProgress(user.uid, id, newEp);
    }
  };

  const handleSaveCustomRelease = async () => {
    if (!id) return;
    await setCalendarOverride(id, undefined, customDay, customTime);
    setHasCustomOverride(true);
    alert("Wöchentlicher Release-Zeitpunkt gespeichert!");
  };

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400 animate-pulse">Lade Werk Details...</div>;
  }

  if (!work) {
    return <div className="p-8 text-center text-red-500">Werk nicht gefunden.</div>;
  }

  return (
    <div className="flex flex-col pb-12">
      {/* Banner & Cover */}
      <div className="relative h-48 w-full bg-gray-800">
        {work.bannerImage && (
          <img src={work.bannerImage} alt="Banner" className="h-full w-full object-cover opacity-60" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] to-transparent" />
        <Link href="/" className="absolute left-4 top-4 rounded-full bg-black/50 p-2 text-white backdrop-blur-md">
          <ChevronLeft size={24} />
        </Link>
      </div>

      <div className="relative -mt-16 px-4">
        <div className="flex gap-4">
          <img 
            src={work.coverImage?.extraLarge || work.coverImage?.large} 
            alt="Cover" 
            className="h-40 w-28 rounded-lg shadow-xl border border-gray-800 object-cover" 
          />
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

        <p className="mt-4 text-sm text-gray-300 line-clamp-4" dangerouslySetInnerHTML={{ __html: work.description || "" }} />

        {/* EPISODE TRACKING */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex flex-col">
            <span className="font-bold text-gray-300">
              {work.type === "MANGA" ? "Kapitel gelesen" : "Folgen geschaut"}
            </span>
            {inLibrary && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">Aktuell verfügbar:</span>
                <input 
                  type="number" 
                  placeholder={work.episodes || work.chapters || "?"} 
                  value={manualMaxEpisode}
                  onChange={(e) => setManualMaxEpisode(e.target.value === "" ? "" : parseInt(e.target.value))}
                  onBlur={async () => {
                    const user = auth?.currentUser;
                    if (!user || !inLibrary) return;
                    if (manualMaxEpisode === "") {
                      await clearManualMaxEpisode(id);
                    } else {
                      await setCalendarOverride(id, undefined, undefined, undefined, manualMaxEpisode as number);
                    }
                  }}
                  title="Hier eintragen, wenn die API keine oder falsche Werte liefert"
                  className="w-16 bg-[#1a1d24] border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 self-end sm:self-auto">
            <button 
              onClick={() => handleUpdateEpisode(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-white font-bold hover:bg-gray-700 active:scale-95"
            >-</button>
            <span className="font-mono font-bold text-lg text-blue-400">
              {currentEpisode} <span className="text-sm text-gray-500">/ {manualMaxEpisode !== "" ? manualMaxEpisode : (work.episodes || work.chapters || "?")}</span>
            </span>
            <button 
              onClick={() => handleUpdateEpisode(1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-500 active:scale-95"
            >+</button>
          </div>
        </div>

        {/* MANUAL RELEASE TIMES */}
        {(!work.nextAiringEpisode || work.type === "MANGA") && inLibrary && (
          <div className="mt-4 flex flex-col gap-3 bg-[#1a1d24] border border-gray-800 rounded-xl p-4">
            <span className="font-bold text-gray-300 flex items-center gap-2 text-sm">
              <CalendarIcon size={16} className="text-blue-500" /> Wöchentlicher Release
            </span>
            <div className="flex gap-2 text-sm">
              <select 
                value={customDay} 
                onChange={e => setCustomDay(parseInt(e.target.value))} 
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg p-2 text-white outline-none focus:border-blue-500"
              >
                <option value={1}>Montag</option>
                <option value={2}>Dienstag</option>
                <option value={3}>Mittwoch</option>
                <option value={4}>Donnerstag</option>
                <option value={5}>Freitag</option>
                <option value={6}>Samstag</option>
                <option value={0}>Sonntag</option>
              </select>
              {work.type !== "MANGA" && (
                <input 
                  type="time" 
                  value={customTime} 
                  onChange={e => setCustomTime(e.target.value)} 
                  className="w-24 bg-gray-900 border border-gray-700 rounded-lg p-2 text-white outline-none focus:border-blue-500" 
                />
              )}
              <button 
                onClick={handleSaveCustomRelease} 
                className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg font-bold text-white transition"
              >
                {hasCustomOverride ? <Check size={18} /> : "Speichern"}
              </button>
            </div>
            {hasCustomOverride && <p className="text-xs text-green-400 mt-1">Im Kalender aktiviert!</p>}
          </div>
        )}

        {/* ACTION BUTTONS */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
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
            <button 
              onClick={() => handleQuickAdd("PLANNING")}
              disabled={isSaving}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-3 font-bold transition shadow-lg ${userWorkStatus === "PLANNING" ? "bg-purple-600 text-white" : "bg-purple-600/20 text-purple-400 border border-purple-600/50 hover:bg-purple-600/40"}`}
            >
              <Bookmark size={20} /> <span className="text-xs">Wunsch</span>
            </button>
          </div>
          
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
            {showEvaluation ? "Deep Evaluation schließen" : "Deep Evaluation öffnen"}
          </button>
        </div>

        {/* --- DEEP EVALUATION UI --- */}
        {showEvaluation && (
          <div className="mt-6 rounded-2xl border border-gray-800 bg-[#1a1d24] p-5 shadow-lg animate-in fade-in slide-in-from-top-4">
          <h2 className="text-xl font-bold mb-6 text-white flex justify-between items-center">
            Deep Evaluation
            <span className="text-2xl text-blue-500">{currentScore.toFixed(2)}<span className="text-sm text-gray-500">/10</span></span>
          </h2>

          <div className="space-y-6">
            {/* Standard Metrics */}
            {[
              { label: "Story & Plot (x2.0)", field: "plotAndStory" },
              { label: "Main Cast (x2.0)", field: "castAndCharacters" },
              { label: "Side Characters (x1.0)", field: "sideCharacters" },
              { label: "Artstyle & Animation (x1.5)", field: "artstyleAndAnimation" },
              { label: "Binge-Factor (x1.0)", field: "bingeFactor" },
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
                <input type="checkbox" checked={hasEnding} onChange={(e) => setHasEnding(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-blue-600 focus:ring-blue-600" />
                Hat ein richtiges Ende? (Ending Score x1.5)
              </label>
              
              {hasEnding && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300 font-medium">Ending</span>
                    <span className="font-bold text-white">{evaluation.ending || '-'}</span>
                  </div>
                  <input type="range" min="0" max="10" step="0.5" value={evaluation.ending} onChange={(e) => handleSlider("ending", e.target.value)} className="w-full accent-blue-500" />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-800">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-300 font-medium">Romance & Chemistry</span>
                <span className="font-bold text-white">{evaluation.romanceAndChemistry || '-'}</span>
              </div>
              <input type="range" min="0" max="10" step="0.5" value={evaluation.romanceAndChemistry} onChange={(e) => handleSlider("romanceAndChemistry", e.target.value)} className="w-full accent-blue-500 mb-2" />
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input type="checkbox" checked={isRomanceMainFocus} onChange={(e) => setIsRomanceMainFocus(e.target.checked)} />
                Ist Romance der Main Focus? (Gewichtung x2.0 statt x1.0)
              </label>
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

            {/* Emotional Impact */}
            <div className="pt-4 border-t border-gray-800">
              <span className="block text-sm text-gray-300 font-medium mb-2">Emotional Bonus</span>
              <div className="grid grid-cols-2 gap-2">
                {(["None", "Leicht", "Mitgenommen", "Tränen nah", "Tränen ausgelöst"] as EmotionalImpact[]).map((impact) => (
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
        <CommentsSection workId={id} />
      </div>
    </div>
  );
}
