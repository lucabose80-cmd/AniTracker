import { adminDb } from "@/lib/firebase-admin";
import FeedClient from "./FeedClient";
import { ActivityFeed } from "@/types/database";

export default async function FeedPage() {
  let initialActivities: ActivityFeed[] = [];
  
  try {
    const snapshot = await adminDb
      .collection("activity_feed")
      .orderBy("timestamp", "desc")
      .limit(30)
      .get();
      
    initialActivities = snapshot.docs.map(doc => doc.data() as ActivityFeed);
  } catch (error) {
    console.error("Error fetching initial activities in SSR:", error);
  }

  return <FeedClient initialActivities={initialActivities} />;
}
