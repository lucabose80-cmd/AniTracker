"use client";

import { Clock, BookOpen, Tv } from "lucide-react";

export function ProfileStats({ allWorks, aniListDetails }: { allWorks: any[], aniListDetails: Record<string, any> }) {
  let completedAnime = 0;
  let completedManga = 0;
  let totalMinutes = 0;
  let totalChapters = 0;

  allWorks.forEach(w => {
    const details = aniListDetails[w.work_id];
    if (!details) return;
    
    if (details.type === "ANIME") {
      if (w.status === "COMPLETED") completedAnime++;
      const eps = w.current_episode || 0;
      // Normal episode ~24 mins. We assume average 24 mins if we don't have exact duration.
      totalMinutes += eps * (details.duration || 24); 
    } else {
      if (w.status === "COMPLETED") completedManga++;
      const chaps = w.current_episode || 0;
      totalChapters += chaps;
    }
  });

  const totalDays = Math.floor(totalMinutes / (60 * 24));
  const remainingHours = Math.floor((totalMinutes % (60 * 24)) / 60);

  return (
    <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg w-full flex flex-col gap-4">
      <h3 className="font-bold text-lg text-blue-400 border-b border-gray-800 pb-2">Statistiken</h3>
      
      <div className="grid grid-cols-2 gap-4">
        {/* Anime Stats */}
        <div className="flex flex-col gap-1 bg-gray-900/50 p-3 rounded-lg border border-gray-800">
          <div className="text-gray-400 text-xs flex items-center gap-1 font-bold">
            <Tv size={14} className="text-blue-500" /> Anime geschaut
          </div>
          <div className="text-2xl font-bold text-white">{completedAnime}</div>
          <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-1">
            <Clock size={10} /> 
            {totalDays > 0 ? `${totalDays}T ${remainingHours}h` : `${remainingHours}h`} gesamtzeit
          </div>
        </div>

        {/* Manga Stats */}
        <div className="flex flex-col gap-1 bg-gray-900/50 p-3 rounded-lg border border-gray-800">
          <div className="text-gray-400 text-xs flex items-center gap-1 font-bold">
            <BookOpen size={14} className="text-green-500" /> Manga gelesen
          </div>
          <div className="text-2xl font-bold text-white">{completedManga}</div>
          <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-1">
            <Clock size={10} /> {totalChapters} Kapitel gesamt
          </div>
        </div>
      </div>
    </div>
  );
}
