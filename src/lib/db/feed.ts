import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs, query, orderBy, limit } from "firebase/firestore";
import { ActivityFeed } from "@/types/database";

export async function createActivity(
  user_id: string,
  action_type: ActivityFeed["action_type"],
  work_id?: string,
  text?: string,
  details?: string
): Promise<ActivityFeed | null> {
  if (!db) return null;

  const feedRef = collection(db, "activity_feed");
  const newDocRef = doc(feedRef);
  const activity_id = newDocRef.id;
  const timestamp = new Date().toISOString();

  const newActivity: ActivityFeed = {
    activity_id,
    user_id,
    action_type,
    work_id,
    text,
    timestamp,
    details
  };

  await setDoc(newDocRef, newActivity);
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
