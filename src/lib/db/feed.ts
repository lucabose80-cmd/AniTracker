import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs, query, orderBy, limit, deleteDoc, updateDoc, increment, getDoc, where } from "firebase/firestore";
import { ActivityFeed, ActivityComment, InAppNotification } from "@/types/database";
import { getUserProfile } from "@/lib/db/users";

export async function createActivity(
  user_id: string,
  action_type: ActivityFeed["action_type"],
  work_id?: string,
  text?: string,
  details?: string,
  episode_num?: number
): Promise<ActivityFeed | null> {
  if (!db) return null;

  const feedRef = collection(db, "activity_feed");
  const newDocRef = doc(feedRef);
  const activity_id = newDocRef.id;
  const timestamp = new Date().toISOString();

  const newActivity: any = {
    activity_id,
    user_id,
    action_type,
    timestamp,
  };
  if (work_id !== undefined) newActivity.work_id = work_id;
  if (text !== undefined) newActivity.text = text;
  if (details !== undefined) newActivity.details = details;
  if (episode_num !== undefined) newActivity.episode_num = episode_num;

  await setDoc(newDocRef, newActivity as ActivityFeed);

  if (action_type === "MANUAL_POST") {
    // Send broadcast notification to all users who have 'social' notifications enabled
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL",
        excludeUserId: user_id,
        title: "Neuer Social Beitrag",
        body: text || "Jemand hat etwas im Social Feed gepostet.",
        type: "social",
        link: "/feed"
      })
    }).catch(console.error);
  } else if (action_type === "WEEKLY_RANKING") {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL", // Or followers if we had follower logic easily accessible
        excludeUserId: user_id,
        title: "Neues Wochen-Ranking!",
        body: text || "Jemand hat sein neues Wochen-Ranking veröffentlicht.",
        type: "social",
        link: "/feed"
      })
    }).catch(console.error);
  } else if (action_type === "RATING") {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL",
        excludeUserId: user_id,
        title: "Neue Bewertung",
        body: text || "Jemand hat ein Werk bewertet.",
        type: "social",
        link: "/feed"
      })
    }).catch(console.error);
  } else if (action_type === "EPISODE_THREAD") {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL",
        excludeUserId: user_id,
        title: "Neuer Thread",
        body: text || `Ein neuer Thread für Folge/Kapitel ${episode_num || ''} wurde erstellt.`,
        type: "social",
        link: "/feed"
      })
    }).catch(console.error);
  }

  return newActivity;
}

export async function getGlobalFeed(limitCount: number = 50): Promise<ActivityFeed[]> {
  if (!db) return [];
  
  const feedRef = collection(db, "activity_feed");
  const q = query(
    feedRef, 
    // Usually orderBy timestamp desc, but we'll sort on client if index is missing.
    // For now we just get them and sort.
    limit(limitCount)
  );
  
  const snapshot = await getDocs(q);
  const activities: ActivityFeed[] = [];
  snapshot.forEach((doc) => {
    activities.push(doc.data() as ActivityFeed);
  });
  
  // Sort descending by timestamp
  return activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function deleteActivity(activityId: string): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "activity_feed", activityId);
  await deleteDoc(docRef);
}

export async function addActivityComment(activityId: string, userId: string, text: string, parentCommentId?: string): Promise<ActivityComment | null> {
  if (!db) return null;
  const commentsRef = collection(db, "activity_comments");
  const newDocRef = doc(commentsRef);
  const comment_id = newDocRef.id;
  const timestamp = new Date().toISOString();

  const comment: ActivityComment = {
    comment_id,
    activity_id: activityId,
    user_id: userId,
    text,
    timestamp
  };
  if (parentCommentId) comment.parent_comment_id = parentCommentId;

  await setDoc(newDocRef, comment);
  
  // Update comments count on the activity
  const activityRef = doc(db, "activity_feed", activityId);
  try {
    await updateDoc(activityRef, { comments_count: increment(1) });
    
    // Notification Logic
    const activitySnap = await getDoc(activityRef);
    if (activitySnap.exists()) {
      const activityData = activitySnap.data() as ActivityFeed;
      const actorProfile = await getUserProfile(userId);
      const actorName = actorProfile?.username || "Unbekannt";
      const actorAvatar = actorProfile?.avatar_url || "";
      
      const notificationsRef = collection(db, "notifications");
      
      // 1. Notify Parent Comment Author (if reply)
      if (parentCommentId) {
        const parentDoc = await getDoc(doc(db, "activity_comments", parentCommentId));
        if (parentDoc.exists()) {
          const parentData = parentDoc.data() as ActivityComment;
          if (parentData.user_id !== userId) {
            const notifRef = doc(notificationsRef);
            const notif: InAppNotification = {
              notification_id: notifRef.id,
              user_id: parentData.user_id,
              actor_id: userId,
              actor_name: actorName,
              actor_avatar: actorAvatar,
              type: "REPLY_TO_COMMENT",
              activity_id: activityId,
              work_id: activityData.work_id,
              comment_id: comment_id,
              text: text,
              timestamp: timestamp,
              read: false
            };
            await setDoc(notifRef, notif);
            
            // Send Push Notification
            fetch("/api/notify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                targetUserId: parentData.user_id,
                title: `${actorName} hat geantwortet`,
                body: text,
                type: "replies",
                link: "/feed"
              })
            }).catch(console.error);
          }
        }
      } 
      // 2. Notify Thread/Activity Author (if not reply, and not their own post)
      else if (activityData.user_id !== userId) {
        const notifRef = doc(notificationsRef);
        const notif: InAppNotification = {
          notification_id: notifRef.id,
          user_id: activityData.user_id,
          actor_id: userId,
          actor_name: actorName,
          actor_avatar: actorAvatar,
          type: activityData.action_type === "EPISODE_THREAD" ? "COMMENT_ON_THREAD" : "REPLY_TO_COMMENT", // Actually it's a comment on their post
          activity_id: activityId,
          work_id: activityData.work_id,
          comment_id: comment_id,
          text: text,
          timestamp: timestamp,
          read: false
        };
        await setDoc(notifRef, notif);
        
        // Send Push Notification
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId: activityData.user_id,
            title: `${actorName} hat deinen Beitrag kommentiert`,
            body: text,
            type: "replies",
            link: "/feed"
          })
        }).catch(console.error);
      }
    }
  } catch (e) {
    console.error("Failed to update comments_count or send notification", e);
  }

  return comment;
}

export async function getActivityComments(activityId: string): Promise<ActivityComment[]> {
  if (!db) return [];
  const commentsRef = collection(db, "activity_comments");
  // Simple query filtering by activity_id
  const snapshot = await getDocs(query(commentsRef, limit(100)));
  
  const comments: ActivityComment[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data() as ActivityComment;
    if (data.activity_id === activityId) {
      comments.push(data);
    }
  });
  
  // Sort ascending by timestamp (oldest first, like reddit comments inside a post)
  return comments.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function deleteActivityComment(commentId: string, activityId: string): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "activity_comments", commentId);
  await deleteDoc(docRef);
  
  // Decrement comments count
  const activityRef = doc(db, "activity_feed", activityId);
  try {
    await updateDoc(activityRef, { comments_count: increment(-1) });
  } catch (e) {
    console.error("Failed to decrement comments_count", e);
  }
}

export async function getInAppNotifications(userId: string): Promise<InAppNotification[]> {
  if (!db) return [];
  const notifRef = collection(db, "notifications");
  const q = query(notifRef, where("user_id", "==", userId), limit(30));
  const snap = await getDocs(q);
  
  const notifications: InAppNotification[] = [];
  snap.forEach(d => {
    notifications.push(d.data() as InAppNotification);
  });
  
  return notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!db) return;
  const notifRef = doc(db, "notifications", notificationId);
  await updateDoc(notifRef, { read: true });
}
