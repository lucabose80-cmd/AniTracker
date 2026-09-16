"use client";

import { useEffect, useState } from "react";
import { Users, MessageSquare, PlayCircle, Trophy } from "lucide-react";
import { getGlobalFeed } from "@/lib/db/feed";
import { ActivityFeed } from "@/types/database";
import { fetchAniListBatch } from "@/lib/anilist";
import { getUserProfile } from "@/lib/db/users";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

export default function SocialPage() {
  const [feed, setFeed] = useState<ActivityFeed[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workDetails, setWorkDetails] = useState<Record<string, any>>({});
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});

  useEffect(() => {
    async function loadFeed() {
      setIsLoading(true);
      try {
        const activities = await getGlobalFeed(30);
        setFeed(activities);
        
        // Extract unique work IDs and user IDs
        const workIds = new Set<string>();
        activities.forEach(a => {
           if (a.work_id) workIds.add(a.work_id);
           if (a.action_type === "WEEKLY_RANKING" && a.details) {
              a.details.split(",").forEach(id => workIds.add(id));
           }
        });
        const workIdsArr = Array.from(workIds);
        const userIds = [...new Set(activities.map(a => a.user_id).filter(Boolean))] as string[];
        
        // Fetch AniList details
        if (workIdsArr.length > 0) {
          const idsToFetch = workIdsArr.map(id => parseInt(id, 10));
          const mediaList = await fetchAniListBatch(idsToFetch);
          const map: Record<string, any> = {};
          mediaList.forEach((m: any) => {
            map[m.id.toString()] = m;
          });
          setWorkDetails(map);
        }
        
        // Fetch User profiles
        const uMap: Record<string, any> = {};
        for (const uid of userIds) {
          const p = await getUserProfile(uid);
          if (p) uMap[uid] = p;
        }
        setUserProfiles(uMap);
        
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    loadFeed();
  }, []);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Users className="text-blue-500" /> 
        Social Feed
      </h2>
      
      <div className="grid gap-4">
        {isLoading ? (
          <div className="text-center text-gray-500 animate-pulse py-8">Lade Feed...</div>
        ) : feed.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-8 text-center text-gray-500">
            <p>Noch keine Aktivitäten vorhanden.</p>
          </div>
        ) : (
          feed.map(activity => {
            const user = userProfiles[activity.user_id] || { username: "Unbekannt" };
            const work = activity.work_id ? workDetails[activity.work_id] : null;
            const timeAgo = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true, locale: de });
            
            if (activity.action_type === "EPISODE_THREAD") {
              return (
                <div key={activity.activity_id} className="rounded-xl border-2 border-blue-900/50 bg-[#141a29] p-4 shadow-lg relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2">
                    <span className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded-full font-bold shadow-md">
                      OFFIZIELLER THREAD
                    </span>
                  </div>
                  
                  <div className="flex gap-4">
                    {work && (
                      <Link href={`/work/${work.id}?episode=${activity.episode_num || ''}`} className="shrink-0">
                        <img 
                          src={work.coverImage?.large} 
                          alt="Cover" 
                          className="w-16 h-24 object-cover rounded-lg shadow-md border border-gray-800 group-hover:border-blue-500 transition"
                        />
                      </Link>
                    )}
                    <div className="flex flex-col justify-between flex-1">
                      <div>
                        <h3 className="font-bold text-gray-100 line-clamp-1">{work?.title?.english || work?.title?.romaji || "Unbekanntes Werk"}</h3>
                        <p className="text-sm font-semibold text-blue-400 mt-0.5">Folge / Kapitel {activity.episode_num}</p>
                        <p className="text-xs text-gray-400 mt-2">{user.username} hat den Raum eröffnet • {timeAgo}</p>
                      </div>
                      
                      <Link 
                        href={`/work/${activity.work_id}?episode=${activity.episode_num || ''}`}
                        className="mt-3 flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 py-1.5 px-3 rounded-lg w-fit transition shadow-lg"
                      >
                        <MessageSquare size={14} /> Mitdiskutieren
                      </Link>
                    </div>
                  </div>
                </div>
              );
            }

            if (activity.action_type === "WEEKLY_RANKING") {
              const rankedIds = activity.details ? activity.details.split(",") : (activity.work_id ? [activity.work_id] : []);
              
              return (
                <div key={activity.activity_id} className="rounded-xl border border-yellow-700/50 bg-[#1a1d24] p-4 shadow-lg">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-full bg-yellow-600/20 flex items-center justify-center font-bold overflow-hidden border border-yellow-600/50 text-yellow-500">
                      <Trophy size={20} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-200">
                        {user.username} <span className="text-gray-400 font-normal">hat sein Wochen-Ranking aktualisiert</span>
                      </p>
                      <p className="text-xs text-gray-500">{timeAgo}</p>
                    </div>
                  </div>
                  
                  <div className="bg-black/40 rounded-lg p-3 border border-gray-800">
                    <p className="text-sm font-bold text-yellow-500 mb-2">🏆 Die Top Plätze diese Woche:</p>
                    <div className="flex flex-col gap-3">
                      {rankedIds.map((id, idx) => {
                        const rankedWork = workDetails[id];
                        if (!rankedWork) return null;
                        return (
                          <div key={id} className="flex gap-3 items-center">
                             <div className="text-yellow-500 font-bold w-5 shrink-0 text-right">{idx + 1}.</div>
                             <Link href={`/work/${id}`} className="shrink-0">
                               <img src={rankedWork.coverImage?.large} alt="Cover" className="w-8 h-12 object-cover rounded shadow border border-gray-700 hover:border-blue-500 transition" />
                             </Link>
                             <div className="flex-1 min-w-0">
                               <h4 className="font-bold text-gray-100 text-sm line-clamp-1">{rankedWork.title?.english || rankedWork.title?.romaji}</h4>
                             </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              );
            }
            
            // Render other activity types (RATING, TOP9_UPDATE, MANUAL_POST)
            return (
              <div key={activity.activity_id} className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-gray-700 flex items-center justify-center font-bold overflow-hidden border border-gray-600">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      user.username?.[0]?.toUpperCase() || "?"
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-200">
                      {user.username}
                      <span className="text-gray-400 font-normal ml-1 text-xs">{timeAgo}</span>
                    </p>
                    {work && (
                      <Link href={`/work/${work.id}`} className="text-xs text-blue-400 hover:underline line-clamp-1 font-semibold">
                        {work.title?.english || work.title?.romaji}
                      </Link>
                    )}
                  </div>
                </div>
                
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{activity.text || activity.details}</p>
                
                {work && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                    <Link href={`/work/${work.id}`} className="flex items-center gap-1 hover:text-blue-400 transition bg-gray-800 px-2 py-1 rounded">
                      <PlayCircle size={14} /> Zum Werk
                    </Link>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
