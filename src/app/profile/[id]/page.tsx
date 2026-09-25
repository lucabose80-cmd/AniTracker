"use client";

import { useEffect, useState, use } from "react";
import { getUserProfile } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import Link from "next/link";
import { User as UserIcon } from "lucide-react";

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
  
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [favItems, setFavItems] = useState<any[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const p = await getUserProfile(userId);
        if (p) {
          setProfile(p);
          
          const works = await getAllUserWorks(userId);
          const top9 = works.filter((w: any) => w.top9_rank).sort((a: any, b: any) => a.top9_rank! - b.top9_rank!);
          setFavItems(Array.from({ length: 9 }).map((_, i) => top9.find((w: any) => w.top9_rank === i + 1) || null));
          
          const idsToFetch = top9.map(w => parseInt(w.work_id, 10));
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
      
      <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg">
        <h3 className="font-bold text-lg mb-4 text-blue-400">Top 9</h3>
        <div className="grid grid-cols-3 gap-2">
          {favItems.map((item, i) => (
            <FavoriteItem 
              key={i} 
              id={item?.work_id} 
              index={i} 
              workDetails={item ? aniListDetails[item.work_id] : null} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}
