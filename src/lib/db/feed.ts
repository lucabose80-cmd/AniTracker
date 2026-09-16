import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs, query, orderBy, limit, deleteDoc, updateDoc, increment } from "firebase/firestore";
import { ActivityFeed, ActivityComment } from "@/types/database";

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
        title: "Neuer Social Beitrag",
        body: text || "Jemand hat etwas im Social Feed gepostet.",
        type: "social",
        link: "/social"
      })
    }).catch(console.error);
  } else if (action_type === "WEEKLY_RANKING") {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL", // Or followers if we had follower logic easily accessible
        title: "Neues Wochen-Ranking!",
        body: text || "Jemand hat sein neues Wochen-Ranking veröffentlicht.",
        type: "social",
        link: "/social"
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

export async function addActivityComment(activityId: string, userId: string, text: string): Promise<ActivityComment | null> {
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

  await setDoc(newDocRef, comment);
  
  // Update comments count on the activity
  const activityRef = doc(db, "activity_feed", activityId);
  try {
    await updateDoc(activityRef, { comments_count: increment(1) });
  } catch (e) {
    console.error("Failed to update comments_count", e);
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
