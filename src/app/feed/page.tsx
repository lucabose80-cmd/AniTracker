import { Suspense } from "react";
import { adminDb } from "@/lib/firebase-admin";
import FeedClient from "./FeedClient";
import { ActivityFeed } from "@/types/database";

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  let initialActivities: ActivityFeed[] = [];
  
  try {
    const snapshot = await adminDb
      .collection("activity_feed")
      .orderBy("timestamp", "desc")
      .limit(30)
      .get();
      
    initialActivities = snapshot.docs.map(doc => ({
      ...doc.data(),
      activity_id: doc.data().activity_id || doc.id,
    } as ActivityFeed));
  } catch (error) {
    console.error("Error fetching initial activities in SSR:", error);
  }

  return (
    <Suspense fallback={<div className="text-center text-gray-500 py-8 animate-pulse">Lade Feed...</div>}>
      <FeedClient initialActivities={initialActivities} />
    </Suspense>
  );
}

