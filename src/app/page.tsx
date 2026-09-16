"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { fetchAniList, GET_TRENDING_WORKS } from "@/lib/anilist";
import { Star, Flame, Clock } from "lucide-react";
import Link from "next/link";

export default function Home() {
  const { contentType } = useAppStore();
  const [trendingWorks, setTrendingWorks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const typeArg = contentType === "ANIME" ? "ANIME" : "MANGA";
        const data = await fetchAniList(GET_TRENDING_WORKS, { type: typeArg, page: 1, perPage: 10 });
        setTrendingWorks(data.Page.media);
      } catch (error) {
        console.error("Failed to load AniList data", error);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [contentType]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <Flame className="text-blue-500" /> 
          Trending {contentType === "ANIME" ? "Anime" : "Manga"}
        </h2>
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 scrollbar-hide">
          {isLoading ? (
            /* Skeletons */
            [1, 2, 3].map((i) => (
              <div key={i} className="relative min-w-[240px] snap-center overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg">
                <div className="aspect-[3/4] w-full bg-gray-800 animate-pulse" />
              </div>
            ))
          ) : (
            trendingWorks.map((work) => (
              <Link href={`/work/${work.id}`} key={work.id} className="relative min-w-[240px] snap-center overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg transition-transform hover:scale-[1.02]">
                <img 
                  src={work.coverImage.extraLarge || work.coverImage.large} 
                  alt={work.title.romaji}
                  className="aspect-[3/4] w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4">
                  <h3 className="font-bold text-white line-clamp-1">{work.title.romaji || work.title.english}</h3>
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

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <Clock className="text-blue-500" /> 
          Beliebt auf AniTracker
        </h2>
        <div className="grid gap-4">
          {isLoading ? (
             [1, 2, 3].map((i) => (
              <div key={i} className="flex h-24 items-center gap-4 rounded-xl border border-gray-800 bg-[#1a1d24] p-3 shadow-md animate-pulse" />
            ))
          ) : (
            trendingWorks.slice(0, 5).map((work) => (
              <Link href={`/work/${work.id}`} key={`list-${work.id}`} className="flex items-center gap-4 rounded-xl border border-gray-800 bg-[#1a1d24] p-3 shadow-md hover:bg-gray-800 transition-colors">
                <img 
                  src={work.coverImage.large} 
                  alt={work.title.romaji}
                  className="h-20 w-16 rounded object-cover flex-shrink-0"
                  loading="lazy"
                />
                <div className="flex flex-col justify-between h-full w-full">
                  <div>
                    <h4 className="font-semibold text-sm line-clamp-2">{work.title.romaji}</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      {contentType === "ANIME" ? `${work.episodes || '?'} Ep.` : `${work.chapters || '?'} Ch.`} • {work.genres?.[0]}
                    </p>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="rounded bg-blue-600/10 px-3 py-1 text-xs font-semibold text-blue-500 transition-colors hover:bg-blue-600/20">
                      Hinzufügen
                    </button>
                    <button className="rounded bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-700">
                      Details
                    </button>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
