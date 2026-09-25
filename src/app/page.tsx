"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { fetchAniList, GET_TRENDING_WORKS, GET_UPCOMING_WORKS, GET_RECOMMENDATIONS_BY_GENRE, fetchAniListBatch } from "@/lib/anilist";
import { Star, Flame, Sparkles } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { getAllUserWorks } from "@/lib/db/works";
import { getAllUserProfiles } from "@/lib/db/users";
import { UserWork } from "@/types/database";

const GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

export default function Home() {
  const { contentType } = useAppStore();
  
  // Trending & Upcoming State
  const [trendingWorks, setTrendingWorks] = useState<any[]>([]);
  const [upcomingWorks, setUpcomingWorks] = useState<any[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(true);
  
  // User State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userWorks, setUserWorks] = useState<UserWork[]>([]);
  const [userAniListDetails, setUserAniListDetails] = useState<Record<string, any>>({});
  
  // Recommendations State
  const [selectedGenre, setSelectedGenre] = useState<string>("Action");
  const [recommendedWorks, setRecommendedWorks] = useState<any[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  // Global Community Ranking State
  const [communityRanking, setCommunityRanking] = useState<any[]>([]);
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(true);

  // Home Screen Tab State
  const [activeHomeTab, setActiveHomeTab] = useState<"COMMUNITY" | "UPNEXT" | "TRENDING" | "UPCOMING" | "RECOMMENDATIONS">("UPNEXT");
  const [authLoaded, setAuthLoaded] = useState(false);

  useEffect(() => {
    if (authLoaded && !isLoggedIn && activeHomeTab === "UPNEXT") {
      setActiveHomeTab("COMMUNITY");
    }
  }, [authLoaded, isLoggedIn]);

  function getCurrentSeason() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "SPRING";
    if (month >= 5 && month <= 7) return "SUMMER";
    if (month >= 8 && month <= 10) return "FALL";
    return "WINTER";
  }

  function getNextSeason() {
    const current = getCurrentSeason();
    if (current === "WINTER") return { season: "SPRING", year: new Date().getFullYear() };
    if (current === "SPRING") return { season: "SUMMER", year: new Date().getFullYear() };
    if (current === "SUMMER") return { season: "FALL", year: new Date().getFullYear() };
    return { season: "WINTER", year: new Date().getFullYear() + 1 };
  }

  // 1. Load Trending (Always)
  useEffect(() => {
    async function loadTrending() {
      setIsLoadingTrending(true);
      try {
        const typeArg = contentType === "ANIME" ? "ANIME" : "MANGA";
        const seasonArgs = contentType === "ANIME" ? { season: getCurrentSeason(), seasonYear: new Date().getFullYear() } : {};
        const nextSeasonArgs = contentType === "ANIME" ? { season: getNextSeason().season, seasonYear: getNextSeason().year } : {};
        
        const [trendingData, upcomingData] = await Promise.all([
          fetchAniList(GET_TRENDING_WORKS, { type: typeArg, page: 1, perPage: 20, ...seasonArgs }),
          fetchAniList(GET_UPCOMING_WORKS, { type: typeArg, page: 1, perPage: 10, ...nextSeasonArgs })
        ]);

        setTrendingWorks(trendingData.Page.media);
        setUpcomingWorks(upcomingData.Page.media);
      } catch (error) {
        console.error("Failed to load trending", error);
      } finally {
        setIsLoadingTrending(false);
      }
    }

    async function loadCommunityRanking() {
      setIsLoadingCommunity(true);
      try {
        const profiles = await getAllUserProfiles();
        const scoreMap: Record<string, number> = {};

        profiles.forEach(profile => {
          const ranking = contentType === "ANIME" ? profile.weekly_ranking_anime?.current : profile.weekly_ranking_manga?.current;
          if (ranking && Array.isArray(ranking)) {
            ranking.forEach((workId, index) => {
              if (workId && !workId.startsWith("empty")) {
                const points = 9 - index; // Rank 1 = 9 pts, Rank 9 = 1 pt
                scoreMap[workId] = (scoreMap[workId] || 0) + points;
              }
            });
          }
        });

        // Sort by points descending and take top 9
        const topIds = Object.entries(scoreMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 9)
          .map(([id]) => parseInt(id, 10));

        if (topIds.length > 0) {
          const mediaList = await fetchAniListBatch(topIds);
          // Sort mediaList back to the order of topIds
          const sortedMediaList = topIds.map(id => mediaList.find((m: any) => m.id === id)).filter(Boolean);
          // Attach points for display
          const finalRanking = sortedMediaList.map(m => ({ ...m, communityPoints: scoreMap[m.id.toString()] }));
          setCommunityRanking(finalRanking);
        } else {
          setCommunityRanking([]);
        }
      } catch (err) {
        console.error("Failed to load community ranking", err);
      } finally {
        setIsLoadingCommunity(false);
      }
    }

    loadTrending();
    loadCommunityRanking();
  }, [contentType]);

  // 2. Load User Profile & Favorite Genres
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setAuthLoaded(true);
      if (user) {
        setIsLoggedIn(true);
        const works = await getAllUserWorks(user.uid);
        setUserWorks(works);

        // Fetch AniList Details for ALL User Works to support Up Next & Top Genres
        const idsToFetch = works.map(w => parseInt(w.work_id, 10));
        
        if (idsToFetch.length > 0) {
          try {
            const mediaList = await fetchAniListBatch(idsToFetch);
            const map: Record<string, any> = {};
            const genreCounts: Record<string, number> = {};
            
            mediaList.forEach((m: any) => {
              map[m.id.toString()] = m;
              if (m.genres) {
                m.genres.forEach((g: string) => {
                  genreCounts[g] = (genreCounts[g] || 0) + 1;
                });
              }
            });
            setUserAniListDetails(map);
            
            // Find Top Genre
            let topGenre = "Action";
            let maxCount = 0;
            Object.entries(genreCounts).forEach(([g, count]) => {
              if (count > maxCount && GENRES.includes(g)) {
                topGenre = g;
                maxCount = count;
              }
            });
            setSelectedGenre(topGenre);

            // Run weekly maintenance logic
            const { getUserProfile, performWeeklyMaintenance } = await import("@/lib/db/users");
            const profile = await getUserProfile(user.uid);
            if (profile) {
              const needsUpdate = await performWeeklyMaintenance(user.uid, profile, works, map);
              if (needsUpdate) {
                const updatedWorks = await getAllUserWorks(user.uid);
                setUserWorks(updatedWorks);
              }
            }
          } catch(e) {
            console.error("Failed to load user works batch", e);
          }
        }
      } else {
        setIsLoggedIn(false);
        setUserWorks([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleCheckIn = async (workId: string, nextEp: number) => {
    if (!auth.currentUser) return;
    try {
      const { updateUserWork } = await import("@/lib/db/works");
      await updateUserWork(auth.currentUser.uid, workId, { current_episode: nextEp });
      
      const { createActivity, getGlobalFeed } = await import("@/lib/db/feed");
      // Check if thread exists
      const recent = await getGlobalFeed(50);
      const exists = recent.some(a => a.action_type === "EPISODE_THREAD" && a.work_id === workId && a.episode_num === nextEp);
      
      if (!exists) {
        await createActivity(auth.currentUser.uid, "EPISODE_THREAD", workId, {
          episode_num: nextEp,
          text: `Thread für Folge ${nextEp}`
        });
      }

      router.push(`/social`);
    } catch(e) {
      console.error(e);
      alert("Fehler beim Check-in");
    }
  };

  // 3. Load Recommendations when Genre changes
  useEffect(() => {
    async function loadRecs() {
      setIsLoadingRecs(true);
      try {
        const typeArg = contentType === "ANIME" ? "ANIME" : "MANGA";
        const excludeIds = userWorks.map(w => parseInt(w.work_id, 10));
        
        const data = await fetchAniList(GET_RECOMMENDATIONS_BY_GENRE, {
          genre: selectedGenre,
          type: typeArg,
          excludeIds: excludeIds.length > 0 ? excludeIds : null
        });
        
        setRecommendedWorks(data.Page.media);
      } catch (err) {
        console.error("Failed to load recs", err);
      } finally {
        setIsLoadingRecs(false);
      }
    }
    
    loadRecs();
  }, [selectedGenre, contentType, userWorks.length]); // Depend on userWorks.length to avoid deep equality loop

  // Calculate User's Top 5 in Selected Genre
  const myTopInGenre = userWorks
    .map(w => ({ ...w, details: userAniListDetails[w.work_id] }))
    .filter(w => w.details?.genres?.includes(selectedGenre))
    .sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0))
    .slice(0, 5);

  // Calculate Up Next (Rückstand)
  const upNextWorks = userWorks
    .map(w => {
      const details = userAniListDetails[w.work_id];
      if (!details || details.type !== contentType) return null;
      let maxAiredEp = 0;
      if (w.manual_max_episode !== undefined && w.manual_max_episode !== null) {
        maxAiredEp = Number(w.manual_max_episode);
      } else if (details.type === "MANGA") {
        maxAiredEp = details.chapters || 0;
      } else {
        if (details.status === "RELEASING" && details.nextAiringEpisode) {
          maxAiredEp = details.nextAiringEpisode.episode - 1;
        } else if (details.status === "FINISHED") {
          maxAiredEp = details.episodes || 0;
        }
      }
      
      const offset = Number(w.synchro_offset_episodes) || 0;
      maxAiredEp = Math.max(0, maxAiredEp - offset);
      const current = Number(w.current_episode) || 0;
      const behindCount = Math.max(0, maxAiredEp - current);
      return behindCount > 0 ? { ...w, details, behindCount, nextEpToWatch: current + 1 } : null;
    })
    .filter(w => w !== null)
    .sort((a, b) => b!.behindCount - a!.behindCount);

  // We need to know if we are still loading details
  const isLoadingDetails = userWorks.length > 0 && Object.keys(userAniListDetails).length === 0;

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24">
      {/* HOME TABS */}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        <button
          onClick={() => setActiveHomeTab("COMMUNITY")}
          className={`snap-start shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
            activeHomeTab === "COMMUNITY" ? "bg-blue-600 text-white shadow-md" : "bg-[#1a1d24] text-gray-400 hover:bg-gray-800 border border-gray-800"
          }`}
        >
          Community Ranking
        </button>
        {isLoggedIn && (
          <button
            onClick={() => setActiveHomeTab("UPNEXT")}
            className={`snap-start shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
              activeHomeTab === "UPNEXT" ? "bg-blue-600 text-white shadow-md" : "bg-[#1a1d24] text-gray-400 hover:bg-gray-800 border border-gray-800"
            }`}
          >
            Up Next
          </button>
        )}
        <button
          onClick={() => setActiveHomeTab("TRENDING")}
          className={`snap-start shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
            activeHomeTab === "TRENDING" ? "bg-blue-600 text-white shadow-md" : "bg-[#1a1d24] text-gray-400 hover:bg-gray-800 border border-gray-800"
          }`}
        >
          Trending
        </button>
        <button
          onClick={() => setActiveHomeTab("UPCOMING")}
          className={`snap-start shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
            activeHomeTab === "UPCOMING" ? "bg-blue-600 text-white shadow-md" : "bg-[#1a1d24] text-gray-400 hover:bg-gray-800 border border-gray-800"
          }`}
        >
          Nächste Season
        </button>
        <button
          onClick={() => setActiveHomeTab("RECOMMENDATIONS")}
          className={`snap-start shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
            activeHomeTab === "RECOMMENDATIONS" ? "bg-blue-600 text-white shadow-md" : "bg-[#1a1d24] text-gray-400 hover:bg-gray-800 border border-gray-800"
          }`}
        >
          Empfehlungen
        </button>
      </div>

      {/* COMMUNITY WEEKLY RANKING */}
      {activeHomeTab === "COMMUNITY" && (
        <section className="animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <Star className="text-blue-500" /> 
            Top 9 Community Ranking
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {isLoadingCommunity ? (
              [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                <div key={i} className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg">
                  <div className="aspect-[3/4] w-full bg-gray-800 animate-pulse" />
                </div>
              ))
            ) : communityRanking.length === 0 ? (
              <div className="col-span-3 text-gray-500 text-sm border border-gray-800 bg-[#1a1d24] rounded-xl p-6 text-center w-full">
                Noch keine Rankings für diese Woche.
              </div>
            ) : (
              communityRanking.map((work, index) => (
                <Link href={`/work/${work.id}`} key={work.id} className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg transition-transform hover:scale-[1.02]">
                  <img 
                    src={work.coverImage?.extraLarge || work.coverImage?.large} 
                    alt={work.title.romaji}
                    className="aspect-[3/4] w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-1 left-1 flex h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-blue-600 font-bold text-white shadow-lg border-2 border-white/20 text-xs sm:text-base">
                    {index + 1}
                  </div>
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 sm:p-3">
                    <h3 className="font-bold text-white line-clamp-1 text-[10px] sm:text-sm">{work.title.english || work.title.romaji}</h3>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[9px] sm:text-[10px] font-bold text-gray-400 bg-gray-800 px-1 py-0.5 rounded">
                        {work.communityPoints} Pkt
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      )}

      {/* UP NEXT SECTION */}
      {activeHomeTab === "UPNEXT" && isLoggedIn && (
        <section className="animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <Star className="text-blue-500" /> 
            Up Next (Dein Rückstand)
          </h2>
          
          {isLoadingDetails ? (
            <div className="text-gray-500 text-sm animate-pulse border border-gray-800 bg-[#1a1d24] rounded-xl p-6 text-center">Lade Werke...</div>
          ) : upNextWorks.length === 0 ? (
            <div className="text-gray-500 text-sm border border-gray-800 bg-[#1a1d24] rounded-xl p-6 text-center">
              Du bist auf dem neuesten Stand! Keine fehlenden {contentType === "ANIME" ? "Folgen" : "Kapitel"}.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {upNextWorks.map((work) => (
              <div key={work.work_id} className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg flex flex-col">
                <div className="relative aspect-video w-full overflow-hidden">
                  <img 
                    src={work.details?.bannerImage || work.details?.coverImage?.extraLarge} 
                    alt={work.details?.title?.romaji}
                    className="w-full h-full object-cover opacity-60"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#1a1d24] to-transparent" />
                  <div className="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-md">
                    {work.behindCount} {work.details?.type === "MANGA" ? "Kapitel" : "Folgen"} zurück
                  </div>
                </div>
                <div className="p-4 flex flex-col flex-1 justify-between -mt-8 relative z-10">
                  <div>
                    <h3 className="font-bold text-white text-sm line-clamp-1">{work.details?.title?.english || work.details?.title?.romaji}</h3>
                    <p className="text-xs text-gray-400 mt-1">Als nächstes: {work.details?.type === "MANGA" ? "Kapitel" : "Folge"} {work.nextEpToWatch}</p>
                  </div>
                  <button 
                    onClick={() => handleCheckIn(work.work_id, work.nextEpToWatch)}
                    className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg text-center transition shadow-lg"
                  >
                    Check in & Kommentieren
                  </button>
                </div>
              </div>
            ))}
            </div>
          )}
        </section>
      )}

      {/* TRENDING SECTION */}
      {activeHomeTab === "TRENDING" && (
        <section className="animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <Flame className="text-blue-500" /> 
            Trending {contentType === "ANIME" ? "Anime" : "Manga"}
          </h2>
          {isLoadingTrending ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="aspect-[3/4] rounded-xl bg-gray-800 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {trendingWorks.filter(w => !userWorks.some(uw => uw.work_id === w.id.toString() && uw.status === "CURRENT")).slice(0, 10).map((work) => {
                const isUnreleased = work.status === "NOT_YET_RELEASED";
                const isSequel = work.relations?.edges?.some((edge: any) => {
                  return (edge.relationType === "PREQUEL" || edge.relationType === "PARENT") &&
                         userWorks.some(uw => uw.work_id === edge.node.id.toString());
                });
                
                let borderClass = "border-gray-800";
                if (isUnreleased) borderClass = "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]";
                else if (isSequel) borderClass = "border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]";

                return (
                  <Link href={`/work/${work.id}`} key={work.id} className={`group relative overflow-hidden rounded-xl border ${borderClass} bg-[#1a1d24] shadow-lg transition-transform hover:scale-105 hover:border-gray-600`}>
                    <img 
                      src={work.coverImage.extraLarge || work.coverImage.large} 
                      alt={work.title.english || work.title.romaji}
                      className="aspect-[3/4] w-full object-cover"
                    />
                    <div className="absolute bottom-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent p-2 sm:p-3 pt-6">
                      <h3 className="font-bold text-white text-[10px] sm:text-xs line-clamp-2">{work.title.english || work.title.romaji}</h3>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* UPCOMING SECTION */}
      {activeHomeTab === "UPCOMING" && (
        <section className="animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <Sparkles className="text-yellow-400" /> 
            Nächste Season
          </h2>
          
          {isLoadingTrending ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="aspect-[3/4] rounded-xl bg-gray-800 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {upcomingWorks.map((work) => (
                <Link href={`/work/${work.id}`} key={work.id} className="group relative overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg transition-transform hover:scale-105">
                  <img 
                    src={work.coverImage.extraLarge || work.coverImage.large} 
                    alt={work.title.english || work.title.romaji}
                    className="aspect-[3/4] w-full object-cover"
                  />
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent p-2 sm:p-3 pt-6">
                    <h3 className="font-bold text-white text-[10px] sm:text-xs line-clamp-2">{work.title.english || work.title.romaji}</h3>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* RECOMMENDATIONS SECTION */}
      {activeHomeTab === "RECOMMENDATIONS" && (
        <section className="animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <Sparkles className="text-blue-500" /> 
            Für Dich Empfohlen
          </h2>
          
          {/* Genre Selector */}
          <div className="flex gap-2 overflow-x-auto pb-4 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {GENRES.map(g => (
              <button 
                key={g} 
                onClick={() => setSelectedGenre(g)}
                className={`snap-start shrink-0 px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-colors ${
                  selectedGenre === g ? "bg-blue-600 text-white" : "bg-[#1a1d24] text-gray-400 hover:bg-gray-800 border border-gray-800"
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* User's Top Favorites in Selected Genre */}
          {isLoggedIn && myTopInGenre.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 mb-3">Deine Top Favoriten in {selectedGenre}</h3>
              <div className="flex gap-3 overflow-x-auto pb-4 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                {myTopInGenre.map(work => (
                  <Link href={`/work/${work.work_id}`} key={work.work_id} className="relative w-24 sm:w-28 shrink-0 snap-start overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24]">
                    <img src={work.details?.coverImage?.large} alt="Cover" className="aspect-[3/4] w-full object-cover" />
                    <div className="absolute top-1 right-1 bg-black/70 backdrop-blur-md rounded px-1.5 py-0.5 text-[10px] font-bold text-blue-400 border border-gray-700">
                      ★ {work.evaluation.overallScore.toFixed(1)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* General/Community Recommendations */}
          <div>
             <h3 className="text-sm font-bold text-gray-400 mb-3">Top Empfehlungen ({selectedGenre})</h3>
             <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
               {isLoadingRecs ? (
                 [1, 2, 3, 4, 5, 6].map(i => <div key={i} className="aspect-[3/4] w-full bg-[#1a1d24] border border-gray-800 rounded-xl animate-pulse" />)
               ) : recommendedWorks.length === 0 ? (
                 <p className="text-sm text-gray-500 col-span-full">Keine Empfehlungen gefunden.</p>
               ) : (
                 recommendedWorks.map(work => (
                   <Link href={`/work/${work.id}`} key={work.id} className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] transition hover:border-blue-500">
                     <img src={work.coverImage?.extraLarge || work.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                     <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-2 text-center opacity-0 transition group-hover:opacity-100">
                       <p className="text-[10px] font-bold text-white line-clamp-2">{work.title.english || work.title.romaji}</p>
                     </div>
                   </Link>
                 ))
               )}
             </div>
          </div>
        </section>
      )}
    </div>
  );
}
