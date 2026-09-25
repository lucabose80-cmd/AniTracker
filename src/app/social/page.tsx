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

export function CommentSection({ activityId, userProfiles, currentUserUid, commentCount: initialCount = 0 }: { activityId: string, userProfiles: Record<string, any>, currentUserUid?: string, commentCount?: number }) {
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const [commentCount, setCommentCount] = useState(initialCount);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`seen_comments_${activityId}`);
      if (saved) setSeenCount(parseInt(saved, 10));
    }
    
    // Always fetch comments to ensure count is accurate (especially for older posts)
    getActivityComments(activityId).then(res => {
      setComments(res);
      setCommentCount(res.length);
    }).catch(console.error);
  }, [activityId]);

  useEffect(() => {
    if (isOpen) {
      if (typeof window !== "undefined") {
        localStorage.setItem(`seen_comments_${activityId}`, commentCount.toString());
      }
      setSeenCount(commentCount);
    }
  }, [isOpen, activityId, commentCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || !currentUserUid) return;
    setIsSubmitting(true);
    try {
      const added = await addActivityComment(activityId, currentUserUid, newText.trim());
      if (added) {
        setComments(prev => [...prev, added]);
        setCommentCount(prev => prev + 1);
        setSeenCount(prev => prev + 1);
      }
      setNewText("");
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("Kommentar wirklich löschen?")) return;
    try {
      await deleteActivityComment(commentId, activityId);
      setComments(prev => prev.filter(c => c.comment_id !== commentId));
      setCommentCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="mt-3">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white transition"
      >
        <MessageSquare size={14} /> 
        {isOpen ? "Kommentare verbergen" : `${commentCount} Kommentare`}
        {!isOpen && commentCount > seenCount && (
          <span className="ml-1 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-full shadow-md animate-pulse">
            {commentCount - seenCount} neu
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 pt-3 border-t border-gray-800">
          {comments.map(c => {
            const author = userProfiles[c.user_id] || { username: "Unbekannt" };
            return (
              <div key={c.comment_id} className="flex gap-3 text-sm relative group border-t border-gray-800/50 pt-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center font-bold text-xs shadow-inner">
                  {author.avatar_url ? <img src={author.avatar_url} alt="" className="w-full h-full object-cover" /> : (author.username?.[0]?.toUpperCase() || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-200">{author.username}</span>
                    <span className="text-[10px] text-gray-500">{formatDistanceToNow(new Date(c.timestamp), { addSuffix: true, locale: de })}</span>
                  </div>
                  <p className="text-gray-300 mt-0.5 break-words leading-relaxed">{c.text}</p>
                </div>
                {c.user_id === currentUserUid && (
                  <button 
                    onClick={() => handleDelete(c.comment_id)}
                    className="absolute top-3 right-0 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                  >
                    X
                  </button>
                )}
              </div>
            );
          })}

          {comments.length === 0 && <p className="text-xs text-gray-500 italic">Noch keine Kommentare. Sei der erste!</p>}

          {currentUserUid ? (
            <form onSubmit={handleSubmit} className="flex gap-2 mt-1">
              <input 
                type="text" 
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="Schreibe einen Kommentar..." 
                className="flex-1 bg-[#141a29] border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 text-white"
                disabled={isSubmitting}
              />
              <button 
                type="submit" 
                disabled={!newText.trim() || isSubmitting}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
              >
                Senden
              </button>
            </form>
          ) : (
            <p className="text-xs text-gray-500">Du musst angemeldet sein, um zu kommentieren.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SpoilerProtectedThread({ activity, work, user, timeAgo, currentUserUid, isSpoiler, userProfiles }: any) {
  const [showAnyway, setShowAnyway] = useState(false);
  
  if (isSpoiler && !showAnyway) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-[#1a1d24] p-6 text-center shadow-lg relative overflow-hidden flex flex-col items-center justify-center min-h-[160px]">
        <div className="absolute inset-0 bg-red-900/10" />
        <p className="text-red-400 font-bold mb-2 relative z-10 flex items-center gap-2">
          SPOILER WARNUNG
        </p>
        <p className="text-sm text-gray-400 mb-4 relative z-10">{work?.title?.english || work?.title?.romaji} - {work?.type === "MANGA" ? "Kapitel" : "Folge"} {activity.episode_num}</p>
        <button 
          onClick={() => setShowAnyway(true)} 
          className="bg-red-900/50 hover:bg-red-900 text-white text-xs font-bold px-4 py-2 rounded-lg transition relative z-10 shadow-lg"
        >
          Trotzdem anzeigen
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-blue-900/50 bg-[#141a29] p-4 shadow-lg relative overflow-hidden group">
      <div className="flex gap-4">
        {work && (
          <Link href={`/work/${work.id}?episode=${activity.episode_num || ''}`} className="shrink-0 relative">
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
              <span className="text-[9px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-bold shadow-md">
                OFFIZIELLER THREAD
              </span>
              <span className="text-xs text-gray-500">{timeAgo}</span>
            </div>
            <h3 className="font-bold text-gray-100 line-clamp-1">{work?.title?.english || work?.title?.romaji || "Unbekanntes Werk"}</h3>
            <p className="text-sm font-semibold text-blue-400 mt-0.5">Folge / Kapitel {activity.episode_num}</p>
          </div>

          <div className="flex gap-2 mt-3">
            <button 
              onClick={async () => {
                if (!currentUserUid) return;
                try {
                  const { saveUserWork } = await import("@/lib/db/works");
                  await saveUserWork(currentUserUid, work.id.toString(), { status: "CURRENT" });
                  alert("Zu 'Aktiv' hinzugefügt!");
                } catch(e) { console.error(e); }
              }}
              className="text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded font-bold transition"
            >
              + Aktiv
            </button>
            <button 
              onClick={async () => {
                if (!currentUserUid) return;
                try {
                  const { saveUserWork } = await import("@/lib/db/works");
                  await saveUserWork(currentUserUid, work.id.toString(), { status: "PLANNING" });
                  alert("Zur Wunschliste hinzugefügt!");
                } catch(e) { console.error(e); }
              }}
              className="text-[10px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 rounded font-bold transition"
            >
              + Wunschliste
            </button>
          </div>
        </div>
      </div>
      <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />
    </div>
  );
}

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
                        <div className="h-4 w-4 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center font-bold text-[8px]">
                          {user.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : (user.username?.[0]?.toUpperCase() || "?")}
                        </div>
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
