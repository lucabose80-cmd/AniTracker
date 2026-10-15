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
    let workTitle = "";
    let mediaType: "ANIME" | "MANGA" = "ANIME";
    if (work_id) {
      try {
        const { getWorkTitleAndType } = await import("@/lib/anilist");
        const info = await getWorkTitleAndType(work_id);
        if (info) {
          workTitle = info.title;
          mediaType = info.type;
        }
      } catch(e) {}
    }
    const unit = mediaType === "MANGA" ? "Kapitel" : "Folge";
    const epContext = episode_num ? ` (${unit} ${episode_num})` : "";
    const targetTitle = `Neuer Thread in ${workTitle || "Werk"}${epContext}`;

    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL",
        excludeUserId: user_id,
        title: targetTitle,
        body: text || `Ein neuer Thread für ${unit} ${episode_num || ''} wurde erstellt.`,
        type: "social",
        link: work_id ? `/work/${work_id}?episode=${episode_num || ''}` : "/feed"
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
               work_title: workTitle,
               media_type: mediaType,
               episode_num: episode_num,
               text: text || `Ein neuer Thread für ${unit} ${episode_num || ''} wurde erstellt.`,
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
      activities.push({
        ...doc.data(),
        activity_id: doc.data().activity_id || doc.id,
      } as ActivityFeed);
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
      activities.push({
        ...doc.data(),
        activity_id: doc.data().activity_id || doc.id,
      } as ActivityFeed);
    });
  }
  
  return activities;
}

export async function deleteActivity(activityId: string, userId?: string): Promise<void> {
  const { auth } = await import("@/lib/firebase");
  const uid = userId || auth?.currentUser?.uid;
  if (!uid) throw new Error("Nicht eingeloggt");

  const res = await fetch("/api/feed/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activityId, userId: uid }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Fehler beim Löschen");
  }
  const { useAppStore } = await import("@/lib/store");
  useAppStore.getState().triggerReload();
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
      
      let workTitle = "";
      let mediaType: "ANIME" | "MANGA" = "ANIME";
      if (activityData.work_id) {
        try {
          const { getWorkTitleAndType } = await import("@/lib/anilist");
          const info = await getWorkTitleAndType(activityData.work_id);
          if (info) {
            workTitle = info.title;
            mediaType = info.type;
          }
        } catch(e) {}
      }
      const unit = mediaType === "MANGA" ? "Kapitel" : "Folge";
      const epPrefix = activityData.episode_num ? `[${unit} ${activityData.episode_num}] ` : "";
      const workContext = workTitle ? ` (${workTitle})` : "";

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
              work_title: workTitle,
              media_type: mediaType,
              episode_num: activityData.episode_num,
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
                title: `${actorName} in ${workTitle || "Thread"}${activityData.episode_num ? ` (${unit} ${activityData.episode_num})` : ''}`,
                body: text,
                type: "replies",
                link: activityData.work_id ? `/work/${activityData.work_id}?episode=${activityData.episode_num || ''}` : "/feed"
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
                  work_title: workTitle,
                  media_type: mediaType,
                  episode_num: activityData.episode_num,
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
                     title: `${actorName} in ${workTitle || "Thread"}${activityData.episode_num ? ` (${unit} ${activityData.episode_num})` : ''}`,
                     body: text,
                     type: "replies",
                     link: activityData.work_id ? `/work/${activityData.work_id}?episode=${activityData.episode_num || ''}` : "/feed"
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
          work_title: workTitle,
          media_type: mediaType,
          episode_num: activityData.episode_num,
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
            title: `${actorName} in ${workTitle || "Beitrag"}${activityData.episode_num ? ` (${unit} ${activityData.episode_num})` : ''}`,
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
  if (!db || !userId) return [];
  try {
    const notifRef = collection(db, "notifications");
    const q = query(notifRef, where("user_id", "==", userId));
    const snap = await getDocs(q);
    
    const notifications: InAppNotification[] = [];
    snap.forEach(d => {
      notifications.push({
        ...d.data(),
        notification_id: d.id,
      } as InAppNotification);
    });
    
    return notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 50);
  } catch (err) {
    console.error("Error in getInAppNotifications:", err);
    return [];
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!db || !notificationId) return;
  try {
    const notifRef = doc(db, "notifications", notificationId);
    await updateDoc(notifRef, { read: true });
  } catch (err) {
    console.error("Error marking notification read:", err);
  }
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

export async function toggleCommentLike(
  commentId: string, 
  activityId: string, 
  userId: string
): Promise<{ liked: boolean; likesCount: number }> {
  if (!db || !commentId || !userId) return { liked: false, likesCount: 0 };
  
  const commentRef = doc(db, "activity_comments", commentId);
  const commentSnap = await getDoc(commentRef);
  if (!commentSnap.exists()) return { liked: false, likesCount: 0 };
  
  const comment = commentSnap.data() as ActivityComment;
  const likes = comment.likes || [];
  const isLiked = likes.includes(userId);
  
  if (isLiked) {
    await updateDoc(commentRef, { likes: arrayRemove(userId) });
    return { liked: false, likesCount: Math.max(0, likes.length - 1) };
  } else {
    await updateDoc(commentRef, { likes: arrayUnion(userId) });
    
    // Send notification if not liking own comment
    if (comment.user_id !== userId) {
      try {
        const actorProfile = await getUserProfile(userId);
        const actorName = actorProfile?.username || "Unbekannt";
        const actorAvatar = actorProfile?.avatar_url || "";
        
        let workTitle = "";
        let mediaType: "ANIME" | "MANGA" = "ANIME";
        let activityData: ActivityFeed | undefined;
        
        if (activityId) {
          const actSnap = await getDoc(doc(db, "activity_feed", activityId));
          if (actSnap.exists()) {
            activityData = actSnap.data() as ActivityFeed;
            if (activityData.work_id) {
              try {
                const { getWorkTitleAndType } = await import("@/lib/anilist");
                const info = await getWorkTitleAndType(activityData.work_id);
                if (info) {
                  workTitle = info.title;
                  mediaType = info.type;
                }
              } catch {}
            }
          }
        }
        
        const unit = mediaType === "MANGA" ? "Kapitel" : "Folge";
        const epContext = activityData?.episode_num ? ` (${unit} ${activityData.episode_num})` : "";
        
        const notifRef = doc(collection(db, "notifications"));
        const notifPayload: Partial<InAppNotification> = {
          notification_id: notifRef.id,
          user_id: comment.user_id,
          actor_id: userId,
          actor_name: actorName,
          actor_avatar: actorAvatar,
          type: "COMMENT_LIKE",
          activity_id: activityId,
          comment_id: commentId,
          work_id: activityData?.work_id,
          work_title: workTitle,
          media_type: mediaType,
          episode_num: activityData?.episode_num,
          text: comment.text,
          timestamp: new Date().toISOString(),
          read: false
        };

        (Object.keys(notifPayload) as (keyof InAppNotification)[]).forEach(key => {
          if (notifPayload[key] === undefined) {
            delete notifPayload[key];
          }
        });
        
        await setDoc(notifRef, notifPayload as InAppNotification);
        
        // Push Notification
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId: comment.user_id,
            title: `${actorName} gefällt dein Kommentar${workTitle ? ` in ${workTitle}` : ''}${epContext}`,
            body: comment.text?.length > 80 ? comment.text.slice(0, 77) + "..." : (comment.text || ""),
            type: "likes",
            link: `/feed?activity_id=${activityId}&comment_id=${commentId}`
          })
        }).catch(console.error);
      } catch (err) {
        console.error("Error sending comment like notification:", err);
      }
    }
    
    return { liked: true, likesCount: likes.length + 1 };
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

export async function markAllNotificationsRead(userIdOrIds: string | string[]): Promise<void> {
  if (!db || !userIdOrIds) return;
  const { writeBatch, doc, getDocs, collection, query, where } = await import("firebase/firestore");
  
  try {
    if (Array.isArray(userIdOrIds)) {
      if (userIdOrIds.length === 0) return;
      for (let i = 0; i < userIdOrIds.length; i += 400) {
        const chunk = userIdOrIds.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(id => {
          if (id) batch.update(doc(db, "notifications", id), { read: true });
        });
        await batch.commit();
      }
    } else {
      const notifRef = collection(db, "notifications");
      const q = query(notifRef, where("user_id", "==", userIdOrIds));
      const snap = await getDocs(q);
      const unreadDocs = snap.docs.filter(d => d.data()?.read === false);
      
      if (unreadDocs.length === 0) return;
      
      for (let i = 0; i < unreadDocs.length; i += 400) {
        const chunk = unreadDocs.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(d => {
          batch.update(d.ref, { read: true });
        });
        await batch.commit();
      }
    }
  } catch (err) {
    console.error("Error in markAllNotificationsRead:", err);
  }
}

export async function deleteEpisodeThread(
  activity: ActivityFeed, 
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!activity || !userId) return { success: false, error: "Ungültige Parameter" };
  
  if (activity.user_id !== userId) {
    return { success: false, error: "Nur der Ersteller kann diesen Thread löschen." };
  }
  
  try {
    const res = await fetch("/api/feed/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityId: activity.activity_id,
        userId: userId,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || "Fehler beim Löschen des Threads" };
    }

    // Trigger reload in store so Home / Library immediately updates
    const { useAppStore } = await import("@/lib/store");
    useAppStore.getState().triggerReload();

    return { success: true };
  } catch (err: any) {
    console.error("deleteEpisodeThread error:", err);
    return { success: false, error: err?.message || "Fehler beim Löschen des Threads" };
  }
}
