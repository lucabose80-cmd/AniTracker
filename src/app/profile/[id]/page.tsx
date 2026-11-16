"use client";

import { useEffect, useMemo, useState, use } from "react";
import { getUserProfile } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import Link from "next/link";
import { User as UserIcon } from "lucide-react";
import { ProfileStats } from "@/components/ui/ProfileStats";
import { useAppStore } from "@/lib/store";

function FavoriteItem({ id, index, workDetails }: { id: string, index: number, workDetails?: any }) {
  return (
    <div className={`w-full aspect-[3/4] relative rounded-lg bg-[#1a1d24] border border-gray-700 hover:border-blue-500 transition flex items-center justify-center font-bold text-gray-500 overflow-hidden shadow-sm group`}>
      <span className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-bold text-white shadow-md z-10 border border-blue-400 text-[10px]">
        {index + 1}
      </span>
      {workDetails ? (
        <Link href={`/work/${id}`} className="absolute inset-0 block h-full w-full group">
          <img src={workDetails.coverImage?.extraLarge || workDetails.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          <div className="absolute bottom-0 w-full bg-black/80 backdrop-blur-md text-[10px] text-center text-blue-400 py-1 font-bold">
            ★ {workDetails.userScore?.toFixed(1) || "?"}
          </div>
        </Link>
      ) : (
        <span className="text-xs text-center p-2 text-white line-clamp-3"></span>
      )}
    </div>
  );
}

export default function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const userId = resolvedParams.id;
  const { contentType } = useAppStore();
  
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [favItems, setFavItems] = useState<any[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [allWorks, setAllWorks] = useState<any[]>([]);
  const [onlyMalOpen, setOnlyMalOpen] = useState(false);

  const ratedWorks = useMemo(() => {
    return allWorks
      .filter(
        (w) =>
          aniListDetails[w.work_id]?.type === contentType &&
          (w.evaluation?.overallScore || 0) > 0 &&
          (!onlyMalOpen || !w.mal_rated)
      )
      .sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0));
  }, [allWorks, aniListDetails, contentType, onlyMalOpen]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const p = await getUserProfile(userId);
        if (p) {
          setProfile(p);
          const works = await getAllUserWorks(userId);
          setAllWorks(works);
          
          const topAnime = works
            .filter((w: any) => (w.evaluation?.overallScore || 0) > 0)
            .sort((a: any, b: any) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0))
            .slice(0, 9);
            
          setFavItems(topAnime);
          
          const idsToFetch = works.map(w => parseInt(w.work_id, 10));
          if (idsToFetch.length > 0) {
            const mediaList = await fetchAniListBatch(idsToFetch);
            const map: Record<string, any> = {};
            mediaList.forEach((m: any) => { map[m.id.toString()] = m; });
            setAniListDetails(map);
          }
        }
      } catch(e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [userId]);

  if (isLoading) {
    return <div className="p-10 text-center text-gray-400">Lade Profil...</div>;
  }

  if (!profile) {
    return <div className="p-10 text-center text-red-400">Profil nicht gefunden.</div>;
  }

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-4 bg-[#1a1d24] p-4 rounded-xl border border-gray-800 shadow-lg">
        <button onClick={() => window.history.back()} className="text-gray-400 hover:text-white p-2 shrink-0">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div className="h-20 w-20 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-blue-500 shrink-0">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            <UserIcon size={32} className="text-gray-400" />
          )}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{profile.username || "Unbekannt"}</h2>
        </div>
      </div>
      
      <ProfileStats allWorks={allWorks} aniListDetails={aniListDetails} />

      <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg">
        <h3 className="font-bold text-lg mb-4 text-blue-400">All-Time Top 9</h3>
        <div className="grid grid-cols-3 gap-2">
          {favItems.map((item, i) => (
            <FavoriteItem 
              key={i} 
              id={item?.work_id} 
              index={i} 
              workDetails={item ? { ...aniListDetails[item.work_id], userScore: item.evaluation?.overallScore } : null} 
            />
          ))}
        </div>
      </div>

      <section className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-base font-bold text-white">
            Alle Bewertungen ({contentType}) ({ratedWorks.length})
          </h3>
          <button
            type="button"
            onClick={() => setOnlyMalOpen((prev) => !prev)}
            className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap ${
              onlyMalOpen
                ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                : "bg-[#141a29] border-gray-700 text-gray-400 hover:text-white"
            }`}
          >
            Nur AniList/MAL offen
          </button>
        </div>

        {ratedWorks.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">
            {onlyMalOpen
              ? "Alle bewerteten Werke sind bereits auf AniList/MAL markiert."
              : "Keine bewerteten Werke für diese Kategorie vorhanden."}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
            {ratedWorks.map((w) => {
              const details = aniListDetails[w.work_id];
              const title =
                details?.title?.english ||
                details?.title?.romaji ||
                `Werk #${w.work_id}`;
              const cover = details?.coverImage?.large || details?.coverImage?.extraLarge;
              const score = w.evaluation?.overallScore || 0;
              const rewatch = w.evaluation?.rewatchPotential || 0;

              return (
                <div
                  key={w.work_id}
                  className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#141a29] p-2.5 hover:border-gray-700 transition-colors"
                >
                  <Link
                    href={`/work/${w.work_id}`}
                    className="w-10 h-14 rounded-md overflow-hidden bg-gray-800 shrink-0 block"
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </Link>

                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/work/${w.work_id}`}
                      className="text-sm font-semibold text-white hover:text-blue-400 transition-colors line-clamp-1 block"
                    >
                      {title}
                    </Link>
                    <div className="flex items-center flex-wrap gap-1.5 mt-1">
                      {rewatch > 0 && (
                        <span className="inline-flex items-center rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                          Rewatch: {rewatch}/10
                        </span>
                      )}
                      {!w.mal_rated && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          AniList offen
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-sm font-bold text-blue-400 shrink-0 tabular-nums">
                    ★ {score.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
