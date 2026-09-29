"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { auth } from "@/lib/firebase";
import { ActivityFeed } from "@/types/database";
import { getGlobalFeedPaginated, createActivity } from "@/lib/db/feed";
import { getUserProfile } from "@/lib/db/users";
import { fetchAniList, GET_WORKS_BATCH } from "@/lib/anilist";
import { MessageCircle, Star, Sparkles, Send, Activity, BookmarkPlus, Bell, X } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { deleteActivity, getActivityComments, addActivityComment, deleteActivityComment, getInAppNotifications, markNotificationRead } from "@/lib/db/feed";
import { ActivityComment, InAppNotification } from "@/types/database";
import { SpoilerProtectedThread, CommentSection, SpoilerText } from "@/components/ui/SocialComponents";
import { groupFeedItems, StackedThreadBlock, FeedGroup } from "@/components/ui/FeedGrouping";
import { getAllUserWorks } from "@/lib/db/works";
import { useAppStore } from "@/lib/store";

export default function FeedClient({ initialActivities }: { initialActivities: ActivityFeed[] }) {
  const { contentType, setContentType } = useAppStore();
  const [feed, setFeed] = useState<ActivityFeed[]>(initialActivities || []);
  const [feedFilter, setFeedFilter] = useState<'focus' | 'all'>('all');
  const [workDetails, setWorkDetails] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);
  
  const [newPostText, setNewPostText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  
  const [userProfile, setUserProfile] = useState<any>(null);
  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(undefined);
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});
  const [currentUserWorks, setCurrentUserWorks] = useState<Record<string, number>>({});
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setCurrentUserUid(user.uid);
        const profile = await getUserProfile(user.uid);
        setUserProfile(profile);
        const works = await getAllUserWorks(user.uid);
        const map: Record<string, number> = {};
        works.forEach((w: any) => { map[w.work_id] = w.current_episode; });
        setCurrentUserWorks(map);
        
        getInAppNotifications(user.uid).then(setNotifications).catch(console.error);
      } else {
        setUserProfile(null);
        setCurrentUserWorks({});
        setNotifications([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchRelatedData = async (activities: ActivityFeed[]) => {
      const workIds = new Set<string>();
      activities.forEach(a => {
         if (a.work_id) workIds.add(a.work_id);
         if (a.action_type === "WEEKLY_RANKING" && a.details && !a.details.startsWith("Wochen-Ranking")) {
            a.details.split(",").forEach(id => workIds.add(id));
         }
      });
      const uniqueWorkIds = Array.from(workIds)
         .filter(id => !workDetails[id])
         .map(id => parseInt(id, 10))
         .filter(id => !isNaN(id));

      if (uniqueWorkIds.length > 0) {
        const data = await fetchAniList(GET_WORKS_BATCH, { ids: uniqueWorkIds });
        const map: Record<string, any> = {};
        data.Page.media.forEach((m: any) => {
          map[m.id.toString()] = m;
        });
        setWorkDetails(prev => ({...prev, ...map}));
      }

      const userIds = [...new Set(activities.map(a => a.user_id).filter(Boolean))] as string[];
      const missingUserIds = userIds.filter(id => !userProfiles[id]);
      if (missingUserIds.length > 0) {
        const uMap: Record<string, any> = {};
        for (const uid of missingUserIds) {
          const p = await getUserProfile(uid);
          if (p) uMap[uid] = p;
        }
        setUserProfiles(prev => ({...prev, ...uMap}));
      }
  };

  const loadFeed = async () => {
    setIsLoading(true);
    try {
      const activities = await getGlobalFeedPaginated(30);
      setFeed(activities);
      if (activities.length < 30) setHasMore(false);
      await fetchRelatedData(activities);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreFeed = useCallback(async () => {
    if (isLoadingMore || !hasMore || feed.length === 0) return;
    setIsLoadingMore(true);
    try {
      const lastDoc = feed[feed.length - 1];
      const activities = await getGlobalFeedPaginated(30, lastDoc.timestamp);
      
      if (activities.length === 0) {
        setHasMore(false);
        return;
      }
      if (activities.length < 30) {
        setHasMore(false);
      }
      
      setFeed(prev => [...prev, ...activities]);
      await fetchRelatedData(activities);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, feed, workDetails, userProfiles]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) {
          loadMoreFeed();
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    
    return () => observer.disconnect();
  }, [loadMoreFeed, isLoadingMore, hasMore]);

  useEffect(() => {
    if (initialActivities && initialActivities.length > 0) {
      fetchRelatedData(initialActivities);
      if (initialActivities.length < 30) setHasMore(false);
    } else {
      loadFeed();
    }
  }, [initialActivities]);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newPostText.trim()) return;

    setIsPosting(true);
    try {
      if (!useAppStore.getState().isOnline) useAppStore.getState().incrementOfflineQueue();
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

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleNotificationClick = async (notif: InAppNotification) => {
    if (!notif.read) {
      await markNotificationRead(notif.notification_id);
      setNotifications(prev => prev.map(n => n.notification_id === notif.notification_id ? { ...n, read: true } : n));
    }
    setShowNotifications(false);
    
    // Smooth scroll to the activity
    setTimeout(() => {
      const element = document.getElementById(`activity_${notif.activity_id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Optional: flash the element
        element.classList.add('ring-2', 'ring-blue-500', 'transition-all');
        setTimeout(() => element.classList.remove('ring-2', 'ring-blue-500'), 2000);
      }
    }, 100);
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto relative">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Activity className="text-blue-500" /> 
          Community Feed
        </h2>
        
        {currentUserUid && (
          <div className="relative">
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition relative"
            >
              <Bell size={20} className="text-gray-300" />
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 transform translate-x-1/3 -translate-y-1/3 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-[#1a1d24]">
                  {unreadCount}
                </span>
              )}
            </button>
            
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-72 max-h-96 overflow-y-auto bg-[#1a1d24] border border-gray-700 rounded-xl shadow-2xl z-50 flex flex-col">
                <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-[#141a29] sticky top-0 z-10">
                  <h3 className="font-bold text-gray-200">Benachrichtigungen</h3>
                  <button onClick={() => setShowNotifications(false)} className="text-gray-400 hover:text-white"><X size={16} /></button>
                </div>
                {notifications.filter(n => !n.read).length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">Keine Neuigkeiten.</div>
                ) : (
                  <div className="flex flex-col">
                    {notifications.filter(n => !n.read).map(n => (
                      <button 
                        key={n.notification_id}
                        onClick={() => handleNotificationClick(n)}
                        className={`flex gap-3 p-3 border-b border-gray-800/50 hover:bg-gray-800 transition text-left ${n.read ? 'opacity-70' : 'bg-blue-900/10'}`}
                      >
                        <div className="w-8 h-8 rounded-full bg-gray-700 shrink-0 overflow-hidden">
                          {n.actor_avatar ? <img src={n.actor_avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-xs">{n.actor_name[0]}</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300">
                            <span className="font-bold text-gray-200">{n.actor_name}</span> 
                            {n.type === "REPLY_TO_COMMENT" ? " hat auf deinen Kommentar geantwortet:" : " hat kommentiert:"}
                          </p>
                          <p className="text-sm text-gray-400 truncate mt-0.5 italic">"{n.text}"</p>
                          <p className="text-[10px] text-gray-500 mt-1">{formatDistanceToNow(new Date(n.timestamp), { addSuffix: true, locale: de })}</p>
                        </div>
                        {!n.read && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toggles */}
      <div className="flex items-center justify-between -mt-2">
        <div className="flex bg-[#1a1d24] p-1 rounded-full border border-gray-800">
          <button 
            onClick={() => setFeedFilter('focus')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              feedFilter === 'focus' 
                ? 'bg-purple-600 text-white shadow-md' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Fokus
          </button>
          <button 
            onClick={() => setFeedFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              feedFilter === 'all' 
                ? 'bg-purple-600 text-white shadow-md' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Alles
          </button>
        </div>

        <div className="flex bg-[#1a1d24] p-1 rounded-full border border-gray-800">
          <button 
            onClick={() => setContentType("ANIME")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              contentType === "ANIME" 
                ? "bg-blue-600 text-white shadow-md" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            Anime
          </button>
          <button 
            onClick={() => setContentType("MANGA")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              contentType === "MANGA" 
                ? "bg-blue-600 text-white shadow-md" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            Manga
          </button>
        </div>
      </div>

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
          <>{(() => {
            const filteredActivities = feed
              .filter(activity => {
                if (feedFilter === 'focus') {
                  if (!['EPISODE_THREAD', 'RATING', 'WEEKLY_RANKING'].includes(activity.action_type)) {
                    return false;
                  }
                }
                if (!activity.work_id) return true;
                const work = workDetails[activity.work_id];
                if (!work) return true;
                return work.type === contentType;
              });

            const groups = groupFeedItems(filteredActivities);
            const userWorkIdSet = new Set(Object.keys(currentUserWorks));

            const renderActivity = (activity: ActivityFeed) => {
              const user = userProfiles[activity.user_id] || { username: "Unbekannt" };
              const work = activity.work_id ? workDetails[activity.work_id] : null;
              const timeAgo = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true, locale: de });
              
              if (activity.action_type === "EPISODE_THREAD") {
                return (
                  <div id={`activity_${activity.activity_id}`} key={activity.activity_id}>
                    <SpoilerProtectedThread 
                      activity={activity}
                      work={work}
                      user={user}
                      timeAgo={timeAgo}
                      currentUserUid={currentUserUid}
                      userProfiles={userProfiles}
                      userWorkIds={userWorkIdSet}
                    />
                  </div>
                );
              }

              if (activity.action_type === "WEEKLY_RANKING") {
                const isOldPost = activity.details?.startsWith("Wochen-Ranking");
                const rankedIds = (activity.details && !isOldPost) 
                  ? activity.details.split(",") 
                  : (activity.work_id ? [activity.work_id] : []);
                
                return (
                  <div id={`activity_${activity.activity_id}`} key={activity.activity_id} className="rounded-xl border border-yellow-700/50 bg-[#1a1d24] p-4 shadow-lg relative">
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
                      <Link href={`/profile/${activity.user_id}`} className="font-bold text-gray-200 text-xs hover:text-blue-400 transition">{user.username}</Link>
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
                    <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />
                  </div>
                );
              }
              
              // Render other activity types (RATING, TOP9_UPDATE, MANUAL_POST)
              return (
                <div id={`activity_${activity.activity_id}`} key={activity.activity_id} className="rounded-xl border-2 border-blue-900/30 bg-[#141a29] p-4 shadow-lg relative overflow-hidden group">
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
                      <Link href={`/work/${work.id}`} prefetch={false} className="shrink-0 relative">
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
                          <Link href={`/profile/${activity.user_id}`} className="font-bold text-gray-200 text-xs hover:text-blue-400 transition">{user.username}</Link>
                          <span className="text-xs text-gray-500">{timeAgo}</span>
                        </div>
                        
                        {work && (
                          <h3 className="font-bold text-gray-100 line-clamp-1">{work.title?.english || work.title?.romaji}</h3>
                        )}
                        
                        <p className="text-sm text-gray-300 mt-2 break-words whitespace-pre-wrap leading-relaxed"><SpoilerText text={activity.text || activity.details} /></p>
                      </div>
                    </div>
                  </div>
                  
                  <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />
                </div>
              );
            };

            return groups.map((group, groupIndex) => {
              if (group.type === 'stacked') {
                return (
                  <StackedThreadBlock
                    key={`group-${groupIndex}`}
                    group={group}
                    workDetails={workDetails}
                    renderItem={renderActivity}
                  />
                );
              }
              return renderActivity(group.items[0]);
            });
          })()}</>
        )}
        {hasMore && !isLoading && (
          <div ref={loadMoreRef} className="py-8 text-center text-gray-500">
            {isLoadingMore && "Lade mehr..."}
          </div>
        )}
      </div>
    </div>
  );
}
