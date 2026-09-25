"use client";

import { useEffect, useState } from "react";
import { getGlobalFeed } from "@/lib/db/feed";
import { getAllUserProfiles } from "@/lib/db/users";
import { ActivityFeed } from "@/types/database";
import { auth } from "@/lib/firebase";
import { SpoilerProtectedThread, CommentSection } from "@/components/ui/SocialComponents";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

export function WorkSocialFeed({ workId, work }: { workId: string, work: any }) {
  const [feed, setFeed] = useState<ActivityFeed[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});
  const [currentUserUid, setCurrentUserUid] = useState<string | undefined>(undefined);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setCurrentUserUid(u?.uid));
    return unsub;
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [allFeed, profilesList] = await Promise.all([
          getGlobalFeed(200),
          getAllUserProfiles()
        ]);
        
        const map: Record<string, any> = {};
        profilesList.forEach(p => map[p.uid] = p);
        setUserProfiles(map);
        
        setFeed(allFeed.filter(a => a.work_id === workId));
      } catch (e) {
        console.error(e);
      }
    }
    load();
  }, [workId]);

  if (feed.length === 0) return (
    <div className="mt-8 text-center text-gray-500 py-8 bg-[#1a1d24] rounded-xl border border-gray-800">
      Noch keine Aktivitäten zu diesem Werk. Sei der Erste im Social Feed!
    </div>
  );

  return (
    <div className="mt-8 flex flex-col gap-4">
      <h3 className="text-lg font-bold text-white mb-2 border-b border-gray-800 pb-2">Social Feed zu diesem Werk</h3>
      {feed.map(activity => {
        const user = userProfiles[activity.user_id] || { username: "Unbekannt" };
        const timeAgo = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true, locale: de });
        
        if (activity.action_type === "EPISODE_THREAD") {
          return (
            <SpoilerProtectedThread 
              key={activity.activity_id}
              activity={activity}
              work={work}
              user={user}
              timeAgo={timeAgo}
              currentUserUid={currentUserUid}
              isSpoiler={false}
              userProfiles={userProfiles}
            />
          );
        }

        return (
          <div key={activity.activity_id} className="rounded-xl border-2 border-blue-900/30 bg-[#141a29] p-4 shadow-lg relative overflow-hidden group">
            <div className="flex gap-4">
              <div className="flex flex-col justify-between flex-1 min-w-0 py-1">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <div className="h-4 w-4 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center font-bold text-[8px]">
                      {user.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : (user.username?.[0]?.toUpperCase() || "?")}
                    </div>
                    <span className="font-bold text-gray-200 text-xs">{user.username}</span>
                    <span className="text-xs text-gray-500">{timeAgo}</span>
                  </div>
                  <p className="text-sm text-gray-300 mt-2 break-words whitespace-pre-wrap leading-relaxed">{activity.text || activity.details}</p>
                </div>
              </div>
            </div>
            <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />
          </div>
        );
      })}
    </div>
  );
}
