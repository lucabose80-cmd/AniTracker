"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchAniList, GET_WORK_DETAILS } from "@/lib/anilist";
import { calculateOverallScore } from "@/lib/scoring";
import { UserWork, EmotionalImpact, WatchMode } from "@/types/database";
import { Star, ChevronLeft } from "lucide-react";
import Link from "next/link";

export default function WorkDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  
  const [work, setWork] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    async function loadWork() {
      if (!id) return;
      setIsLoading(true);
      try {
        const data = await fetchAniList(GET_WORK_DETAILS, { id: parseInt(id, 10) });
        setWork(data.Media);
        // Auto-detect romance focus from tags if possible
        const isRomance = data.Media.genres?.includes("Romance") || false;
        setIsRomanceMainFocus(isRomance);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    loadWork();
  }, [id]);

  // Dynamically calculate score whenever inputs change
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
            src={work.coverImage.extraLarge} 
            alt="Cover" 
            className="h-40 w-28 rounded-lg shadow-xl border border-gray-800 object-cover" 
          />
          <div className="flex flex-col justify-end pt-16">
            <h1 className="text-xl font-bold leading-tight line-clamp-3">{work.title.romaji}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-300">
              <Star size={14} className="text-yellow-500" />
              <span>{(work.averageScore / 10).toFixed(1)} AniList</span>
              <span className="text-gray-500">•</span>
              <span>{work.format}</span>
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

        {/* --- DEEP EVALUATION UI --- */}
        <div className="mt-10 rounded-2xl border border-gray-800 bg-[#1a1d24] p-5 shadow-lg">
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

            <button className="w-full mt-6 rounded-lg bg-blue-600 py-3 font-bold text-white shadow-lg transition hover:bg-blue-700 active:scale-95">
              Bewertung Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
