"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniList, GET_USER_AIRING_SCHEDULE } from "@/lib/anilist";
import { Calendar as CalendarIcon, Clock, Tv } from "lucide-react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

// Map JS getDay() (0 = Sunday, 1 = Monday) for the UI
const DAYS = [
  { label: "Mo", value: 1 },
  { label: "Di", value: 2 },
  { label: "Mi", value: 3 },
  { label: "Do", value: 4 },
  { label: "Fr", value: 5 },
  { label: "Sa", value: 6 },
  { label: "So", value: 0 },
];

export default function CalendarPage() {
  const [airingAnime, setAiringAnime] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDay());

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setIsLoggedIn(true);
        setIsLoading(true);
        try {
          const works = await getAllUserWorks(user.uid);
          const ids = works.map(w => parseInt(w.work_id, 10));
          
          if (ids.length > 0) {
            const data = await fetchAniList(GET_USER_AIRING_SCHEDULE, { ids });
            const scheduled = data.Page.media.filter((m: any) => m.nextAiringEpisode);
            
            // Sort by airing time so they appear in chronological order for the day
            scheduled.sort((a: any, b: any) => a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt);
            setAiringAnime(scheduled);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoggedIn(false);
        setAiringAnime([]);
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const dayAnime = airingAnime.filter(anime => {
    const date = new Date(anime.nextAiringEpisode.airingAt * 1000);
    return date.getDay() === selectedDay;
  });

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <CalendarIcon className="text-blue-500" /> 
        Release Kalender
      </h2>
      <p className="text-xs text-gray-400 -mt-4 mb-2">Zeigt nur Serien an, die sich in deiner Bibliothek befinden.</p>

      {!isLoggedIn ? (
        <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-6 text-center text-gray-400">
          Bitte logge dich ein, um deinen Release-Kalender zu sehen.
        </div>
      ) : (
        <>
          {/* Day Selector */}
          <div className="flex justify-between items-center bg-[#1a1d24] border border-gray-800 rounded-xl p-2">
            {DAYS.map(day => {
              const isSelected = selectedDay === day.value;
              const hasAnime = airingAnime.some(a => new Date(a.nextAiringEpisode.airingAt * 1000).getDay() === day.value);
              
              return (
                <button
                  key={day.label}
                  onClick={() => setSelectedDay(day.value)}
                  className={`relative flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${
                    isSelected 
                      ? "bg-blue-600 text-white shadow-md" 
                      : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                  }`}
                >
                  {day.label}
                  {hasAnime && !isSelected && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Schedule List */}
          <div className="flex flex-col gap-4 mt-2">
            {isLoading ? (
              <div className="text-center text-gray-500 py-8 animate-pulse">Lade Kalender...</div>
            ) : dayAnime.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 bg-[#1a1d24] border border-gray-800 rounded-xl border-dashed">
                <Tv size={48} className="mb-4 text-gray-700" strokeWidth={1} />
                <p>An diesem Tag erscheint nichts Neues.</p>
                <p className="text-xs mt-1">Füge mehr aktuell laufende Anime hinzu!</p>
              </div>
            ) : (
              dayAnime.map(anime => {
                const date = new Date(anime.nextAiringEpisode.airingAt * 1000);
                const timeString = format(date, "HH:mm");
                const countdown = formatDistanceToNow(date, { addSuffix: true, locale: de });
                
                return (
                  <Link 
                    href={`/work/${anime.id}`} 
                    key={anime.id}
                    className="flex gap-4 p-3 bg-[#1a1d24] border border-gray-800 rounded-xl shadow-md hover:border-blue-500 transition-colors group"
                  >
                    <img 
                      src={anime.coverImage.large} 
                      alt="Cover" 
                      className="w-16 h-24 object-cover rounded-lg shadow-sm"
                    />
                    <div className="flex flex-col justify-between flex-1 py-1">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="font-bold text-sm text-gray-200 line-clamp-2 group-hover:text-blue-400 transition-colors">
                            {anime.title.romaji}
                          </h3>
                        </div>
                        <p className="text-xs text-blue-400 font-semibold mt-1">
                          Episode {anime.nextAiringEpisode.episode}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-3 mt-3">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-900 border border-gray-800">
                          <Clock size={12} className="text-gray-400" />
                          <span className="text-xs font-bold text-gray-300">{timeString} Uhr</span>
                        </div>
                        <span className="text-[10px] font-medium text-gray-500 bg-gray-900/50 px-2 py-1 rounded">
                          {countdown}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
