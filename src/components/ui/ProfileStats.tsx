"use client";

import { Clock, BookOpen, Tv, Star, PlayCircle, CheckCircle2, Bookmark } from "lucide-react";

export function ProfileStats({
  allWorks,
  aniListDetails,
}: {
  allWorks: any[];
  aniListDetails: Record<string, any>;
}) {
  let completedAnime = 0;
  let activeAnime = 0;
  let planningAnime = 0;
  let totalAnimeEpisodes = 0;
  let totalMinutes = 0;
  let animeScoreSum = 0;
  let animeScoreCount = 0;

  let completedManga = 0;
  let activeManga = 0;
  let planningManga = 0;
  let totalChapters = 0;
  let mangaScoreSum = 0;
  let mangaScoreCount = 0;

  allWorks.forEach((w) => {
    const details = aniListDetails[w.work_id];
    if (!details) return;
    const score = Number(w.evaluation?.overallScore) || 0;

    if (details.type === "ANIME") {
      if (w.status === "COMPLETED") completedAnime++;
      else if (w.status === "CURRENT") activeAnime++;
      else if (w.status === "PLANNING") planningAnime++;

      const eps = Number(w.current_episode) || 0;
      totalAnimeEpisodes += eps;
      totalMinutes += eps * (details.duration || 24);
      if (score > 0) {
        animeScoreSum += score;
        animeScoreCount++;
      }
    } else {
      if (w.status === "COMPLETED") completedManga++;
      else if (w.status === "CURRENT") activeManga++;
      else if (w.status === "PLANNING") planningManga++;

      const chaps = Number(w.current_episode) || 0;
      totalChapters += chaps;
      if (score > 0) {
        mangaScoreSum += score;
        mangaScoreCount++;
      }
    }
  });

  const totalDays = Math.floor(totalMinutes / (60 * 24));
  const remainingHours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const avgAnimeScore = animeScoreCount > 0 ? (animeScoreSum / animeScoreCount).toFixed(1) : "–";
  const avgMangaScore = mangaScoreCount > 0 ? (mangaScoreSum / mangaScoreCount).toFixed(1) : "–";

  return (
    <div className="bg-[#1a1d24] border border-gray-800 rounded-2xl p-4 shadow-lg w-full flex flex-col gap-3.5">
      <div className="flex items-center justify-between border-b border-gray-800 pb-2.5">
        <h3 className="font-bold text-base text-white flex items-center gap-2">
          Statistiken
        </h3>
        <span className="text-[11px] font-semibold text-gray-400">
          {allWorks.length} Werke in Bibliothek
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Anime Stats Card */}
        <div className="flex flex-col justify-between gap-2.5 bg-[#121622] p-3.5 rounded-xl border border-blue-500/20">
          <div className="flex items-center justify-between">
            <div className="text-blue-400 text-xs flex items-center gap-1.5 font-extrabold uppercase tracking-wider">
              <Tv size={14} className="text-blue-500" /> Anime
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-md">
              <Star size={10} className="fill-amber-400 text-amber-400" /> Ø {avgAnimeScore}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 my-0.5">
            <div className="bg-white/[0.03] rounded-lg p-2 border border-white/5">
              <div className="text-lg font-extrabold text-white leading-none">{completedAnime}</div>
              <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                <CheckCircle2 size={10} className="text-emerald-400" /> Beendet
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2 border border-white/5">
              <div className="text-lg font-extrabold text-blue-400 leading-none">{activeAnime}</div>
              <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                <PlayCircle size={10} className="text-blue-400" /> Aktiv
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 pt-1 border-t border-white/5 text-[11px] text-gray-400">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-gray-500">
                <Clock size={11} /> Watchtime:
              </span>
              <span className="font-bold text-gray-200">
                {totalDays > 0 ? `${totalDays}T ${remainingHours}h` : `${remainingHours}h`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Folgen / Wunschliste:</span>
              <span className="font-bold text-gray-300">
                {totalAnimeEpisodes} Ep. · {planningAnime} WL
              </span>
            </div>
          </div>
        </div>

        {/* Manga Stats Card */}
        <div className="flex flex-col justify-between gap-2.5 bg-[#121622] p-3.5 rounded-xl border border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div className="text-emerald-400 text-xs flex items-center gap-1.5 font-extrabold uppercase tracking-wider">
              <BookOpen size={14} className="text-emerald-500" /> Manga
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-md">
              <Star size={10} className="fill-amber-400 text-amber-400" /> Ø {avgMangaScore}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 my-0.5">
            <div className="bg-white/[0.03] rounded-lg p-2 border border-white/5">
              <div className="text-lg font-extrabold text-white leading-none">{completedManga}</div>
              <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                <CheckCircle2 size={10} className="text-emerald-400" /> Beendet
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2 border border-white/5">
              <div className="text-lg font-extrabold text-emerald-400 leading-none">{activeManga}</div>
              <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                <PlayCircle size={10} className="text-emerald-400" /> Aktiv
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 pt-1 border-t border-white/5 text-[11px] text-gray-400">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-gray-500">
                <BookOpen size={11} /> Gelesen:
              </span>
              <span className="font-bold text-gray-200">{totalChapters} Kap.</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 flex items-center gap-1">
                <Bookmark size={10} /> Wunschliste:
              </span>
              <span className="font-bold text-gray-300">{planningManga} Werke</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
