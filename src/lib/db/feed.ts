import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs, query, orderBy, limit, deleteDoc, updateDoc, increment, getDoc, where, startAfter, arrayRemove, arrayUnion } from "firebase/firestore";
import { ActivityFeed, ActivityComment, InAppNotification } from "@/types/database";
import { getUserProfile } from "@/lib/db/users";
import { UserWork } from "@/types/database";

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
        body: text || `Ein neuer Thread f�r Folge/Kapitel ${episode_num || ''} wurde erstellt.`,
        type: "social",
        link: "/feed"
      })
    }).catch(console.error);

    // Create InAppNotifications for followers
    try {
      const actorProfile = await getUserProfile(user_id);
      const actorName = actorProfile?.username || "Unbekannt";
      const actorAvatar = actorProfile?.avatar_url || "";
      
      const userWorksRef = collection(db, "user_works");
      const q = query(userWorksRef, where("work_id", "==", work_id));
      const snap = await getDocs(q);
      const notificationsRef = collection(db, "notifications");
      
      const notifiedUsers = new Set<string>();
      notifiedUsers.add(user_id);
      
      snap.forEach((docSnap) => {
         const data = docSnap.data();
         if (!notifiedUsers.has(data.user_id)) {
            notifiedUsers.add(data.user_id);
            const notifRef = doc(notificationsRef);
            setDoc(notifRef, {
               notification_id: notifRef.id,
               user_id: data.user_id,
               actor_id: user_id,
               actor_name: actorName,
               actor_avatar: actorAvatar,
               type: "NEW_EPISODE_THREAD",
               activity_id: activity_id,
               work_id: work_id,
               text: text || `Ein neuer Thread f�r Folge/Kapitel ${episode_num || ''} wurde erstellt.`,
               timestamp: timestamp,
               read: false
            });
         }
      });
    } catch (e) { console.error(e); }
  }

  return newActivity;
}

export async function getGlobalFeed(limitCount: number = 50): Promise<ActivityFeed[]> {
  if (!db) return [];
  
  const feedRef = collection(db, "activity_feed");
  const q = query(
    feedRef, 
    orderBy("timestamp", "desc"),
    limit(limitCount)
  );
  
  const snapshot = await getDocs(q);
  const activities: ActivityFeed[] = [];
  if (snapshot && typeof snapshot.forEach === 'function') {
    snapshot.forEach((doc: any) => {
      activities.push(doc.data() as ActivityFeed);
    });
  }
  
  return activities;
}

export async function getGlobalFeedPaginated(limitCount: number = 50, lastDocTimestamp?: string): Promise<ActivityFeed[]> {
  if (!db) return [];
  
  const feedRef = collection(db, "activity_feed");
  let q;
  
  if (lastDocTimestamp) {
    q = query(
      feedRef, 
      orderBy("timestamp", "desc"),
      startAfter(lastDocTimestamp),
      limit(limitCount)
    );
  } else {
    q = query(
      feedRef, 
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
  }
  
  const snapshot = await getDocs(q);
  const activities: ActivityFeed[] = [];
  if (snapshot && typeof snapshot.forEach === 'function') {
    snapshot.forEach((doc: any) => {
      activities.push(doc.data() as ActivityFeed);
    });
  }
  
  return activities;
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
      else if (activityData.action_type === "EPISODE_THREAD") {
         // Notify all users tracking the work
         const userWorksRef = collection(db, "user_works");
         const q = query(userWorksRef, where("work_id", "==", activityData.work_id));
         const snap = await getDocs(q);
         const notifiedUsers = new Set<string>();
         notifiedUsers.add(userId);
         
         snap.forEach((docSnap) => {
            const data = docSnap.data();
            if (!notifiedUsers.has(data.user_id)) {
               notifiedUsers.add(data.user_id);
               const notifRef = doc(notificationsRef);
               setDoc(notifRef, {
                  notification_id: notifRef.id,
                  user_id: data.user_id,
                  actor_id: userId,
                  actor_name: actorName,
                  actor_avatar: actorAvatar,
                  type: "COMMENT_ON_THREAD",
                  activity_id: activityId,
                  work_id: activityData.work_id,
                  comment_id: comment_id,
                  text: text,
                  timestamp: timestamp,
                  read: false
               });
               
               // Send Push Notification
               fetch("/api/notify", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                     targetUserId: data.user_id,
                     title: `${actorName} hat im Thread kommentiert`,
                     body: text,
                     type: "replies",
                     link: "/feed"
                  })
               }).catch(console.error);
            }
         });
      } else if (activityData.user_id !== userId) {
        const notifRef = doc(notificationsRef);
        const notif: InAppNotification = {
          notification_id: notifRef.id,
          user_id: activityData.user_id,
          actor_id: userId,
          actor_name: actorName,
          actor_avatar: actorAvatar,
          type: "REPLY_TO_COMMENT", // It's a comment on their post
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
  } catch (err) {
    console.error(err);
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

export async function toggleLike(activityId: string, userId: string): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "activity_feed", activityId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return;
  
  const data = docSnap.data();
  const likes = data.likes || [];
  
  if (likes.includes(userId)) {
    await updateDoc(docRef, { likes: arrayRemove(userId) });
  } else {
    await updateDoc(docRef, { likes: arrayUnion(userId) });
  }
}

export async function editActivity(activityId: string, newText: string) {
  const q = query(collection(db, "activities"), where("activity_id", "==", activityId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const docRef = doc(db, "activities", snap.docs[0].id);
    await updateDoc(docRef, { text: newText });
  }
}

export async function editActivityComment(commentId: string, newText: string) {
  const q = query(collection(db, "activity_comments"), where("comment_id", "==", commentId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const docRef = doc(db, "activity_comments", snap.docs[0].id);
    await updateDoc(docRef, { text: newText });
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  if (!db) return;
  const { writeBatch } = await import("firebase/firestore");
  const batch = writeBatch(db);
  const notifRef = collection(db, "notifications");
  const q = query(notifRef, where("user_id", "==", userId), where("read", "==", false));
  const snap = await getDocs(q);
  
  snap.forEach(d => {
    batch.update(d.ref, { read: true });
  });
  
  await batch.commit();
}
