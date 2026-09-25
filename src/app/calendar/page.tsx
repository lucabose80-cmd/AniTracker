"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { getCalendarOverrides, setCalendarOverride } from "@/lib/db/calendar";
import { useAppStore } from "@/lib/store";
import { Calendar as CalendarIcon, Clock, Tv, Edit2, Check, X } from "lucide-react";
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
  const { contentType } = useAppStore();
  const [airingAnime, setAiringAnime] = useState<any[]>([]);
  const [userWorkMap, setUserWorkMap] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDateString, setEditDateString] = useState("");

  const loadData = async () => {
    const user = auth.currentUser;
    if (!user) {
      setIsLoggedIn(false);
      setAiringAnime([]);
      setIsLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setIsLoading(true);
    try {
      const works = await getAllUserWorks(user.uid);
      const activeWorks = works.filter(w => w.status === "CURRENT");
      const ids = activeWorks.map(w => parseInt(w.work_id, 10));
      
      const map: Record<string, any> = {};
      activeWorks.forEach(w => map[w.work_id] = w);
      setUserWorkMap(map);
      
      if (ids.length > 0) {
        const [mediaList, overrides] = await Promise.all([
          fetchAniListBatch(ids),
          getCalendarOverrides()
        ]);
        setGlobalOverrides(overrides);
        
        let scheduled: any[] = [];
        const filteredMediaList = mediaList.filter((m: any) => m.type === contentType);

        filteredMediaList.forEach((m: any) => {
          const strId = m.id.toString();
          const over = overrides[strId];
          
          let hasSchedule = false;
          let computedAiringAt = m.nextAiringEpisode?.airingAt;
          
          if (over) {
            if (over.airingAt) {
              computedAiringAt = over.airingAt;
              hasSchedule = true;
            } else if (over.weeklyDay !== undefined && over.weeklyTime !== undefined) {
              // Compute next occurrence in the future
              const [hours, minutes] = over.weeklyTime.split(':').map(Number);
              const date = new Date();
              date.setHours(hours, minutes, 0, 0);
              const currentDay = date.getDay();
              
              let diff = over.weeklyDay - currentDay;
              if (diff < 0) diff += 7;
              
              // If diff is 0 (today) but the time has already passed, the next occurrence is next week
              if (diff === 0 && date.getTime() < new Date().getTime()) {
                  diff += 7;
              }
              
              date.setDate(date.getDate() + diff);
              computedAiringAt = Math.floor(date.getTime() / 1000);
              
              const freqWeeks = over.releaseFrequency || 1;
              const lastInc = over.lastIncrementedAt || 0;
              
              if (lastInc > 0 && freqWeeks > 1) {
                 // Calculate if we need to skip weeks based on frequency
                 const weeksPassed = Math.floor((computedAiringAt - lastInc) / (7 * 24 * 3600));
                 if (weeksPassed % freqWeeks !== 0) {
                     const weeksToAdd = freqWeeks - (weeksPassed % freqWeeks);
                     computedAiringAt += weeksToAdd * 7 * 24 * 3600;
                 }
              }
              
              hasSchedule = true;
            }
          } else if (m.nextAiringEpisode) {
            hasSchedule = true;
          }

          if (hasSchedule && computedAiringAt) {
            // Shallow clone to inject the computed time safely
            const cloned = { ...m };
            cloned.nextAiringEpisode = {
              ...m.nextAiringEpisode, // keep episode num if exists
              airingAt: computedAiringAt,
              episode: m.nextAiringEpisode?.episode || ((over?.manualAvailableEps ?? userWorkMap[strId]?.manual_available_eps ?? m.chapters ?? m.episodes ?? userWorkMap[strId]?.current_episode ?? 0) + 1)
            };
            scheduled.push(cloned);
          }
        });

        // Sort by airing time so they appear in chronological order for the day
        scheduled.sort((a: any, b: any) => a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt);
        setAiringAnime(scheduled);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => loadData());
    return () => unsubscribe();
  }, [contentType]);

  const handleEditClick = (anime: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(anime.id.toString());
    // Convert unix timestamp to datetime-local string format YYYY-MM-DDTHH:mm
    const date = new Date(anime.nextAiringEpisode.airingAt * 1000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditDateString(local);
  };

  const handleSaveOverride = async (animeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const newDate = new Date(editDateString);
    const newUnix = Math.floor(newDate.getTime() / 1000);
    
    await setCalendarOverride(animeId, newUnix);
    setEditingId(null);
    
    // Refresh
    loadData();
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <CalendarIcon className="text-blue-500" /> 
        Release Kalender
      </h2>
      <p className="text-xs text-gray-400 -mt-4 mb-2">Zeigt nur Serien an, die in deiner Bibliothek als "Aktiv" markiert sind.</p>

      {!isLoggedIn ? (
        <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-6 text-center text-gray-400">
          Bitte logge dich ein, um deinen Release-Kalender zu sehen.
        </div>
      ) : (
        <>
          {/* Schedule List */}
          <div className="flex flex-col gap-8 mt-2">
            {isLoading ? (
              <div className="text-center text-gray-500 py-8 animate-pulse">Lade Kalender...</div>
            ) : airingAnime.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 bg-[#1a1d24] border border-gray-800 rounded-xl border-dashed">
                <Tv size={48} className="mb-4 text-gray-700" strokeWidth={1} />
                <p>Es erscheinen diese Woche keine neuen Folgen.</p>
                <p className="text-xs mt-1">Füge mehr aktuell laufende Anime hinzu!</p>
              </div>
            ) : (
              DAYS.map(day => {
                const dayAnimeList = airingAnime.filter(anime => {
                  const date = new Date(anime.nextAiringEpisode.airingAt * 1000);
                  return date.getDay() === day.value;
                });
                
                if (dayAnimeList.length === 0) return null;
                
                return (
                  <div key={day.label} className="flex flex-col gap-4">
                    <h3 className="text-lg font-bold text-white border-b border-gray-800 pb-2">{day.label}</h3>
                    <div className="flex flex-col gap-4">
                      {dayAnimeList.map(anime => {
                        const date = new Date(anime.nextAiringEpisode.airingAt * 1000);
                        const strId = anime.id.toString();
                        const uWork = userWorkMap[strId];
                        const offset = uWork?.synchro_offset_episodes || 0;
                        
                        // Calculate the actual German episode airing at Date D
                        const germanEpAiring = anime.nextAiringEpisode.episode - offset;
                        
                        // What is the next episode the user needs to watch?
                        const currentEp = uWork?.current_episode || 0;
                        const targetUserEp = currentEp + 1;
                        
                        // If they are ahead or on track, shift the date to when THEIR next episode airs
                        // Note: If targetUserEp <= germanEpAiring, the date will shift backwards (which is correct, it aired in the past)
                        let displayEpisode = anime.nextAiringEpisode.episode;
                        if (offset > 0 || currentEp > 0) {
                          const weeksDiff = targetUserEp - germanEpAiring;
                          date.setDate(date.getDate() + (weeksDiff * 7));
                          displayEpisode = targetUserEp;
                        }

                        const timeString = format(date, "HH:mm");
                        const countdown = formatDistanceToNow(date, { addSuffix: true, locale: de });
                        
                        // Calculate Behind Status
                        
                        let episodesOut = anime.nextAiringEpisode.episode - 1;
                        const override = globalOverrides[strId];
                        if (override?.manualMaxEpisode !== undefined && override?.manualMaxEpisode !== null) {
                          episodesOut = override.manualMaxEpisode;
                        } else if (uWork?.manual_max_episode !== undefined && uWork?.manual_max_episode !== null) {
                          episodesOut = uWork.manual_max_episode;
                        }
                        
                        episodesOut = Math.max(0, episodesOut - offset);
                        const behindCount = Math.max(0, episodesOut - currentEp);

                        const isEditing = editingId === strId;
                        
                        return (
                          <Link 
                            href={`/work/${strId}`} 
                            key={strId}
                            className="relative flex gap-4 p-3 bg-[#1a1d24] border border-gray-800 rounded-xl shadow-md hover:border-blue-500 transition-colors group overflow-hidden"
                          >
                            <div className="relative shrink-0">
                              <img 
                                src={anime.coverImage.large} 
                                alt="Cover" 
                                className="w-16 h-24 object-cover rounded-lg shadow-sm"
                              />
                              {behindCount > 0 && (
                                <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-bl-lg border-b border-l border-gray-800">
                                  {behindCount}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col justify-between flex-1 py-1">
                              <div>
                                <div className="flex justify-between items-start gap-2">
                                  <h3 className="font-bold text-sm text-gray-200 line-clamp-2 group-hover:text-blue-400 transition-colors">
                                    {anime.title.english || anime.title.romaji}
                                  </h3>
                                </div>
                                <p className="text-xs text-blue-400 font-semibold mt-1">
                                  Episode {displayEpisode}
                                </p>
                              </div>
                              
                              {isEditing ? (
                                <div className="flex items-center gap-2 mt-2" onClick={e => e.preventDefault()}>
                                  <input 
                                    type="datetime-local" 
                                    value={editDateString}
                                    onChange={(e) => setEditDateString(e.target.value)}
                                    className="bg-gray-900 border border-gray-700 rounded text-xs text-white p-1"
                                  />
                                  <button onClick={(e) => handleSaveOverride(strId, e)} className="bg-green-600 p-1 rounded text-white">
                                    <Check size={14} />
                                  </button>
                                  <button onClick={(e) => { e.preventDefault(); setEditingId(null); }} className="bg-red-600 p-1 rounded text-white">
                                    <X size={14} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex justify-between items-end mt-3">
                                  <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-900 border border-gray-800">
                                      <Clock size={12} className="text-gray-400" />
                                      <span className="text-xs font-bold text-gray-300">{timeString} Uhr</span>
                                    </div>
                                    <span className="text-[10px] font-medium text-gray-500 bg-gray-900/50 px-2 py-1 rounded">
                                      {countdown}
                                    </span>
                                  </div>
                                  
                                  <button 
                                    onClick={(e) => handleEditClick(anime, e)}
                                    className="text-gray-500 hover:text-white transition p-1"
                                    title="Zeit korrigieren"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
