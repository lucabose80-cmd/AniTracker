"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { fetchAniList, GET_TRENDING_WORKS, GET_WORKS_BATCH, GET_RECOMMENDATIONS_BY_GENRE } from "@/lib/anilist";
import { Star, Flame, Sparkles } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { getAllUserWorks } from "@/lib/db/works";
import { UserWork } from "@/types/database";

const GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

export default function Home() {
  const { contentType } = useAppStore();
  
  // Trending State
  const [trendingWorks, setTrendingWorks] = useState<any[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(true);
  
  // User State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userWorks, setUserWorks] = useState<UserWork[]>([]);
  const [userAniListDetails, setUserAniListDetails] = useState<Record<string, any>>({});
  
  // Recommendations State
  const [selectedGenre, setSelectedGenre] = useState<string>("Action");
  const [recommendedWorks, setRecommendedWorks] = useState<any[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  // 1. Load Trending (Always)
  useEffect(() => {
    async function loadTrending() {
      setIsLoadingTrending(true);
      try {
        const typeArg = contentType === "ANIME" ? "ANIME" : "MANGA";
        const data = await fetchAniList(GET_TRENDING_WORKS, { type: typeArg, page: 1, perPage: 10 });
        setTrendingWorks(data.Page.media);
      } catch (error) {
        console.error("Failed to load trending", error);
      } finally {
        setIsLoadingTrending(false);
      }
    }
    loadTrending();
  }, [contentType]);

  // 2. Load User Profile & Favorite Genres
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setIsLoggedIn(true);
        const works = await getAllUserWorks(user.uid);
        setUserWorks(works);

        // Fetch AniList Details for User's Top 50 Works to extract genres
        const sortedWorks = [...works].sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0)).slice(0, 50);
        const idsToFetch = sortedWorks.map(w => parseInt(w.work_id, 10));
        
        if (idsToFetch.length > 0) {
          try {
            const data = await fetchAniList(GET_WORKS_BATCH, { ids: idsToFetch });
            const map: Record<string, any> = {};
            const genreCounts: Record<string, number> = {};
            
            data.Page.media.forEach((m: any) => {
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

  return (
    <div className="flex flex-col gap-8 px-4 pt-6 pb-24">
      {/* TRENDING SECTION */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <Flame className="text-blue-500" /> 
          Trending {contentType === "ANIME" ? "Anime" : "Manga"}
        </h2>
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
          {isLoadingTrending ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="relative min-w-[240px] snap-center overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg">
                <div className="aspect-[3/4] w-full bg-gray-800 animate-pulse" />
              </div>
            ))
          ) : (
            trendingWorks.map((work) => (
              <Link href={`/work/${work.id}`} key={work.id} className="relative min-w-[240px] snap-center overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg transition-transform hover:scale-[1.02]">
                <img 
                  src={work.coverImage?.extraLarge || work.coverImage?.large} 
                  alt={work.title.romaji}
                  className="aspect-[3/4] w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4">
                  <h3 className="font-bold text-white line-clamp-1">{work.title.english || work.title.romaji}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-300 mt-1">
                    <Star size={12} className="text-yellow-500" />
                    <span>{(work.averageScore / 10).toFixed(1)}</span>
                    <span className="text-blue-400 font-semibold">{work.format || contentType}</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* RECOMMENDATIONS SECTION */}
      <section>
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
              className={`snap-start shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
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
                <Link href={`/work/${work.work_id}`} key={work.work_id} className="relative w-28 shrink-0 snap-start overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24]">
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
               [1, 2, 3].map(i => <div key={i} className="aspect-[3/4] w-full bg-[#1a1d24] border border-gray-800 rounded-xl animate-pulse" />)
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
    </div>
  );
}
