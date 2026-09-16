"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { ActivityFeed } from "@/types/database";
import { getGlobalFeed, createActivity } from "@/lib/db/feed";
import { getUserProfile } from "@/lib/db/users";
import { fetchAniList, GET_WORKS_BATCH } from "@/lib/anilist";
import { MessageCircle, Star, Sparkles, Send, Activity, BookmarkPlus } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { deleteActivity, getActivityComments, addActivityComment, deleteActivityComment } from "@/lib/db/feed";
import { ActivityComment } from "@/types/database";

function CommentSection({ activityId, userProfiles, currentUserUid }: { activityId: string, userProfiles: Record<string, any>, currentUserUid?: string }) {
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getActivityComments(activityId).then(setComments).catch(console.error);
    }
  }, [isOpen, activityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || !currentUserUid) return;
    setIsSubmitting(true);
    try {
      const added = await addActivityComment(activityId, currentUserUid, newText.trim());
      if (added) setComments(prev => [...prev, added]);
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
        <MessageCircle size={14} /> 
        {isOpen ? "Kommentare verbergen" : "Kommentieren"}
      </button>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 pt-3 border-t border-gray-800">
          {comments.map(c => {
            const author = userProfiles[c.user_id] || { username: "Unbekannt" };
            return (
              <div key={c.comment_id} className="flex gap-2 text-sm bg-black/20 p-2 rounded-lg relative group">
                <div className="h-6 w-6 shrink-0 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center font-bold text-[10px]">
                  {author.avatar_url ? <img src={author.avatar_url} alt="" className="w-full h-full object-cover" /> : (author.username?.[0]?.toUpperCase() || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-blue-400">{author.username}</span>
                    <span className="text-[10px] text-gray-500">{formatDistanceToNow(new Date(c.timestamp), { addSuffix: true, locale: de })}</span>
                  </div>
                  <p className="text-gray-300 mt-0.5 break-words">{c.text}</p>
                </div>
                {c.user_id === currentUserUid && (
                  <button 
                    onClick={() => handleDelete(c.comment_id)}
                    className="absolute top-2 right-2 text-red-500/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
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

export default function FeedPage() {
  const [feed, setFeed] = useState<ActivityFeed[]>([]);
  const [workDetails, setWorkDetails] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [newPostText, setNewPostText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  
  const [userProfile, setUserProfile] = useState<any>(null);
  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(undefined);
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setCurrentUserUid(user.uid);
        const profile = await getUserProfile(user.uid);
        setUserProfile(profile);
      } else {
        setUserProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadFeed = async () => {
    setIsLoading(true);
    try {
      const activities = await getGlobalFeed(30);
      setFeed(activities);

      // Extract unique work IDs to fetch covers
      const workIds = new Set<string>();
      activities.forEach(a => {
         if (a.work_id) workIds.add(a.work_id);
         if (a.action_type === "WEEKLY_RANKING" && a.details && !a.details.startsWith("Wochen-Ranking")) {
            a.details.split(",").forEach(id => workIds.add(id));
         }
      });
      const uniqueWorkIds = Array.from(workIds).map(id => parseInt(id, 10)).filter(id => !isNaN(id));

      if (uniqueWorkIds.length > 0) {
        const data = await fetchAniList(GET_WORKS_BATCH, { ids: uniqueWorkIds });
        const map: Record<string, any> = {};
        data.Page.media.forEach((m: any) => {
          map[m.id.toString()] = m;
        });
        setWorkDetails(map);
      }

      // Fetch User profiles
      const userIds = [...new Set(activities.map(a => a.user_id).filter(Boolean))] as string[];
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
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newPostText.trim()) return;

    setIsPosting(true);
    try {
      const newActivity = await createActivity(
        auth.currentUser.uid,
        "MANUAL_POST",
        undefined,
        newPostText
      );
      if (newActivity) {
        setFeed(prev => [newActivity, ...prev]);
        setNewPostText("");
      }
    } catch (e) {
      console.error(e);
      alert("Fehler beim Posten");
    } finally {
      setIsPosting(false);
    }
  };

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

  const getActionIcon = (type: string) => {
    switch(type) {
      case "RATING": return <Star size={16} className="text-yellow-500" />;
      case "COMMENT": return <MessageCircle size={16} className="text-blue-500" />;
      case "TOP9_UPDATE": return <BookmarkPlus size={16} className="text-green-500" />;
      case "RECOMMENDATION": return <Sparkles size={16} className="text-purple-500" />;
      default: return <MessageCircle size={16} className="text-gray-400" />;
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Activity className="text-blue-500" /> 
        Community Feed
      </h2>

      {/* Post Box */}
      {auth.currentUser ? (
        <form onSubmit={handlePost} className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg focus-within:border-blue-500 transition-colors">
          <div className="flex gap-3">
            <img 
              src={userProfile?.avatar_url || auth.currentUser.photoURL || `https://api.dicebear.com/9.x/notionists/svg?seed=${auth.currentUser.uid}`} 
              alt="Avatar" 
              className="w-10 h-10 rounded-full bg-gray-800 object-cover" 
            />
            <div className="flex-1">
              <textarea 
                value={newPostText}
                onChange={(e) => setNewPostText(e.target.value)}
                placeholder="Was möchtest du der Community mitteilen?"
                className="w-full bg-transparent text-sm text-white focus:outline-none resize-none pt-2"
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end mt-2 pt-2 border-t border-gray-800">
            <button 
              type="submit" 
              disabled={isPosting || !newPostText.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors"
            >
              <Send size={16} /> Posten
            </button>
          </div>
        </form>
      ) : (
        <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 text-center text-sm text-gray-400">
          Bitte logge dich ein, um im Feed zu posten.
        </div>
      )}

      {/* Feed Stream */}
      <div className="flex flex-col gap-4">
        {isLoading ? (
          <div className="text-center text-gray-500 py-8 animate-pulse">Lade Aktivitäten...</div>
        ) : feed.length === 0 ? (
          <div className="text-center text-gray-500 py-8">Noch keine Aktivitäten. Mach den ersten Post!</div>
        ) : (
          feed.map((activity) => {
            const hasWork = !!activity.work_id;
            const work = hasWork ? workDetails[activity.work_id!] : null;
            const authorProfile = userProfiles[activity.user_id];
            const username = authorProfile?.username || `User ${activity.user_id.substring(0, 4)}`;
            const avatarUrl = authorProfile?.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${activity.user_id}`;

            return (
              <div key={activity.activity_id} className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-md relative">
                {activity.user_id === currentUserUid && (
                  <button 
                    onClick={() => handleDeletePost(activity.activity_id)}
                    className="absolute top-3 right-3 text-gray-500 hover:text-red-500 transition"
                  >
                    X
                  </button>
                )}
                <div className="flex gap-3">
                  <img 
                    src={avatarUrl} 
                    alt="Avatar" 
                    className="w-10 h-10 rounded-full bg-gray-800 shrink-0 object-cover"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1 text-sm">
                        <span className="font-bold text-gray-200">{username}</span>
                        {activity.action_type !== "MANUAL_POST" && (
                          <span className="flex items-center gap-1 text-gray-500 ml-1">
                            {getActionIcon(activity.action_type)}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true, locale: de })}
                      </span>
                    </div>

                    {/* Manual Post Text or System Details */}
                    {activity.action_type === "WEEKLY_RANKING" ? (
                      <div className="mt-2 bg-black/40 rounded-lg p-3 border border-gray-800">
                        <p className="text-sm font-bold text-yellow-500 mb-2">🏆 Die Top Plätze diese Woche:</p>
                        <div className="flex flex-col gap-3">
                          {(() => {
                            const isOldPost = activity.details?.startsWith("Wochen-Ranking");
                            const rankedIds = (activity.details && !isOldPost) 
                              ? activity.details.split(",") 
                              : (activity.work_id ? [activity.work_id] : []);
                            
                            return rankedIds.map((id, idx) => {
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
                            });
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-300 whitespace-pre-wrap">
                        {activity.text || activity.details}
                      </div>
                    )}

                    {/* Attached Work Card */}
                    {hasWork && work && activity.action_type !== "WEEKLY_RANKING" && (
                      <Link href={`/work/${work.id}`} className="mt-3 flex gap-3 p-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 transition group">
                        <img 
                          src={work.coverImage?.large} 
                          alt="Cover" 
                          className="w-12 h-16 object-cover rounded"
                        />
                        <div className="flex flex-col justify-center">
                          <h4 className="text-sm font-bold text-gray-200 group-hover:text-blue-400 transition-colors line-clamp-1">{work.title?.romaji}</h4>
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <Star size={10} className="text-yellow-500" />
                            <span>{(work.averageScore / 10).toFixed(1)}</span>
                          </div>
                        </div>
                      </Link>
                    )}
                    
                    <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
