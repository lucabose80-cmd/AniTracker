"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchAniList, GET_WORK_DETAILS } from "@/lib/anilist";
import { calculateOverallScore } from "@/lib/scoring";
import { UserWork, EmotionalImpact, WatchMode } from "@/types/database";
import { Star, ChevronLeft, Save, Library as LibraryIcon, Check } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { saveUserWork, getUserWork, updateEpisodeProgress } from "@/lib/db/works";
import { addToHistory } from "@/lib/db/users";
import { CommentsSection } from "./CommentsSection";
import { createActivity } from "@/lib/db/feed";

export default function WorkDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  
  const [work, setWork] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [currentEpisode, setCurrentEpisode] = useState(0);

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

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      setIsLoading(true);
      try {
        const user = auth?.currentUser;
        
        const [data, userWork] = await Promise.all([
          fetchAniList(GET_WORK_DETAILS, { id: parseInt(id, 10) }),
          user ? getUserWork(user.uid, id) : Promise.resolve(null)
        ]);

        setWork(data.Media);
        const isRomance = data.Media.genres?.includes("Romance") || false;
        setIsRomanceMainFocus(isRomance);

        if (userWork) {
          setInLibrary(true);
          setCurrentEpisode(userWork.current_episode || 0);
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

  const handleQuickAdd = async () => {
    const user = auth?.currentUser;
    if (!user) {
      alert("Bitte erst einloggen!");
      return;
    }
    setIsSaving(true);
    try {
      await saveUserWork(user.uid, id, {
        status: "PLANNING",
        evaluation: evaluation,
        current_episode: currentEpisode
      });
      await addToHistory(user.uid, id);
      setInLibrary(true);
      // Create feed activity
      await createActivity(user.uid, "TOP9_UPDATE", id, `Hat ${work?.title?.romaji || 'ein Werk'} zur Bibliothek hinzugefügt.`);
    } catch (err: any) {
      console.error(err);
      alert("Fehler beim Hinzufügen: " + err.message);
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
        status: "COMPLETED"
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
    
    const maxEps = work?.episodes || 9999;
    let newEp = currentEpisode + increment;
    if (newEp < 0) newEp = 0;
    if (newEp > maxEps) newEp = maxEps;
    
    setCurrentEpisode(newEp);
    
    if (inLibrary) {
      await updateEpisodeProgress(user.uid, id, newEp);
    }
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
            <h1 className="text-xl font-bold leading-tight line-clamp-3">{work.title?.romaji || work.title?.english}</h1>
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
        <div className="mt-6 flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
          <span className="font-bold text-gray-300">Folgen geschaut</span>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => handleUpdateEpisode(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-white font-bold hover:bg-gray-700 active:scale-95"
            >-</button>
            <span className="font-mono font-bold text-lg text-blue-400">
              {currentEpisode} <span className="text-sm text-gray-500">/ {work.episodes || "?"}</span>
            </span>
            <button 
              onClick={() => handleUpdateEpisode(1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-500 active:scale-95"
            >+</button>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="mt-6 flex flex-col gap-3">
          {!inLibrary ? (
            <button 
              onClick={handleQuickAdd}
              disabled={isSaving}
              className="w-full rounded-xl bg-blue-600 py-3.5 font-bold text-white shadow-lg transition hover:bg-blue-700 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <LibraryIcon size={20} /> {isSaving ? "Füge hinzu..." : "Zur Bibliothek hinzufügen"}
            </button>
          ) : (
            <div className="w-full rounded-xl bg-green-900/40 border border-green-800/50 py-3.5 font-bold text-green-400 text-center flex items-center justify-center gap-2">
              <Check size={20} /> In Bibliothek gespeichert
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
