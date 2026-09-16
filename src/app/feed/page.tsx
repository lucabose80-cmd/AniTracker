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

export default function FeedPage() {
  const [feed, setFeed] = useState<ActivityFeed[]>([]);
  const [workDetails, setWorkDetails] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [newPostText, setNewPostText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
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
      const workIds = activities
        .filter(a => a.work_id)
        .map(a => parseInt(a.work_id!, 10))
        .filter(id => !isNaN(id));
        
      const uniqueWorkIds = Array.from(new Set(workIds));

      if (uniqueWorkIds.length > 0) {
        const data = await fetchAniList(GET_WORKS_BATCH, { ids: uniqueWorkIds });
        const map: Record<string, any> = {};
        data.Page.media.forEach((m: any) => {
          map[m.id.toString()] = m;
        });
        setWorkDetails(map);
      }
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
            // Fake username if we don't denormalize it into ActivityFeed (v1 simplified)
            const username = `User ${activity.user_id.substring(0, 4)}`;

            return (
              <div key={activity.activity_id} className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-md">
                <div className="flex gap-3">
                  <img 
                    src={`https://api.dicebear.com/9.x/notionists/svg?seed=${activity.user_id}`} 
                    alt="Avatar" 
                    className="w-10 h-10 rounded-full bg-gray-800 shrink-0"
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
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {activity.text || activity.details}
                    </div>

                    {/* Attached Work Card */}
                    {hasWork && work && (
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
