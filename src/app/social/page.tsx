"use client";

import { useEffect, useState } from "react";
import { Users, MessageSquare, PlayCircle, Trophy } from "lucide-react";
import { getGlobalFeed } from "@/lib/db/feed";
import { ActivityFeed } from "@/types/database";
import { fetchAniListBatch } from "@/lib/anilist";
import { getUserProfile } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { deleteActivity, getActivityComments, addActivityComment, deleteActivityComment } from "@/lib/db/feed";
import { ActivityComment } from "@/types/database";

import { CommentSection, SpoilerProtectedThread } from "@/components/ui/SocialComponents";

export default function SocialPage() {
  const [feed, setFeed] = useState<ActivityFeed[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workDetails, setWorkDetails] = useState<Record<string, any>>({});
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});
  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(undefined);
  const [currentUserWorks, setCurrentUserWorks] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setCurrentUserUid(user?.uid);
      if (user) {
        try {
          const works = await getAllUserWorks(user.uid);
          const map: Record<string, number> = {};
          works.forEach((w: any) => { map[w.work_id] = w.current_episode; });
          setCurrentUserWorks(map);
        } catch (e) {
          console.error(e);
        }
      }
    });
    return () => unsubscribe();
  }, []);

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
          const idsToFetch = workIdsArr.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
          if (idsToFetch.length > 0) {
            const mediaList = await fetchAniListBatch(idsToFetch);
            const map: Record<string, any> = {};
            mediaList.forEach((m: any) => {
              map[m.id.toString()] = m;
            });
            setWorkDetails(map);
          }
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

  const handleDeletePost = async (activityId: string) => {
    if (!confirm("Diesen Beitrag wirklich löschen?")) return;
    try {
      await deleteActivity(activityId);
      setFeed(prev => prev.filter(a => a.activity_id !== activityId));
    } catch (e) {
      console.error(e);
      alert("Fehler beim Löschen");
    }
  };

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
              const userCurrentEp = currentUserWorks[activity.work_id!] || 0;
              const isSpoiler = (activity.episode_num || 0) > userCurrentEp;
              
              return (
                <SpoilerProtectedThread 
                  key={activity.activity_id}
                  activity={activity}
                  work={work}
                  user={user}
                  timeAgo={timeAgo}
                  currentUserUid={currentUserUid}
                  isSpoiler={isSpoiler}
                  userProfiles={userProfiles}
                />
              );
            }

            if (activity.action_type === "WEEKLY_RANKING") {
              const isOldPost = activity.details?.startsWith("Wochen-Ranking");
              const rankedIds = (activity.details && !isOldPost) 
                ? activity.details.split(",") 
                : (activity.work_id ? [activity.work_id] : []);
              
              return (
                <div key={activity.activity_id} className="rounded-xl border border-yellow-700/50 bg-[#1a1d24] p-4 shadow-lg relative">
                  {activity.user_id === currentUserUid && (
                    <button 
                      onClick={() => handleDeletePost(activity.activity_id)}
                      className="absolute top-3 right-3 text-gray-500 hover:text-red-500 transition"
                    >
                      X
                    </button>
                  )}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-[9px] bg-yellow-600 text-white px-2 py-0.5 rounded-full font-bold shadow-md">
                      WOCHEN-RANKING
                    </span>
                    <span className="font-bold text-gray-200 text-xs">{user.username}</span>
                    <span className="text-xs text-gray-500">{timeAgo}</span>
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
                  <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} />
                </div>
              );
            }
            
            // Render other activity types (RATING, TOP9_UPDATE, MANUAL_POST)
            return (
              <div key={activity.activity_id} className="rounded-xl border-2 border-blue-900/30 bg-[#141a29] p-4 shadow-lg relative overflow-hidden group">
                {activity.user_id === currentUserUid && (
                  <button 
                    onClick={() => handleDeletePost(activity.activity_id)}
                    className="absolute top-3 right-3 text-gray-600 hover:text-red-500 transition z-10"
                  >
                    X
                  </button>
                )}
                
                <div className="flex gap-4">
                  {work && (
                    <Link href={`/work/${work.id}`} className="shrink-0 relative">
                      <img 
                        src={work.coverImage?.large} 
                        alt="Cover" 
                        className="w-20 h-28 object-cover rounded-lg shadow-md border border-gray-800 group-hover:border-blue-500 transition"
                      />
                    </Link>
                  )}
                  
                  <div className="flex flex-col justify-between flex-1 min-w-0 py-1">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {activity.action_type === "RATING" ? (
                          <span className="text-[9px] bg-purple-600 text-white px-2 py-0.5 rounded-full font-bold shadow-md">
                            BEWERTUNG
                          </span>
                        ) : (
                          <span className="text-[9px] bg-gray-600 text-white px-2 py-0.5 rounded-full font-bold shadow-md">
                            BEITRAG
                          </span>
                        )}
                        <span className="font-bold text-gray-200 text-xs">{user.username}</span>
                        <span className="text-xs text-gray-500">{timeAgo}</span>
                      </div>
                      
                      {work && (
                        <h3 className="font-bold text-gray-100 line-clamp-1">{work.title?.english || work.title?.romaji}</h3>
                      )}
                      
                      <p className="text-sm text-gray-300 mt-2 break-words whitespace-pre-wrap leading-relaxed">{activity.text || activity.details}</p>
                    </div>
                  </div>
                </div>
                
                <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
