import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, arrayUnion } from "firebase/firestore";
import { UserProfile } from "@/types/database";

export async function createUserProfile(uid: string, username: string, email: string) {
  if (!db) throw new Error("Firestore ist nicht initialisiert");
  
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);
  
  // Create only if it doesn't exist
  if (!docSnap.exists()) {
    await setDoc(docRef, {
      uid,
      username,
      avatar_url: "",
      following_array: [],
      top_9_anime: [],
      top_9_manga: [],
      read_watch_history: [],
      email // Saving email securely on backend is fine
    });
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!db) return null;
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data() as UserProfile;
  }
  return null;
}

export async function getAllUserProfiles(): Promise<UserProfile[]> {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, "users"));
  const profiles: UserProfile[] = [];
  snapshot.forEach((doc) => {
    profiles.push(doc.data() as UserProfile);
  });
  return profiles;
}

export async function addToHistory(uid: string, workId: string) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(docRef, {
    read_watch_history: arrayUnion(workId)
  }, { merge: true });
}

export async function updateTop9List(uid: string, list: string[], type: "ANIME" | "MANGA") {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  const fieldName = type === "ANIME" ? "top_9_anime" : "top_9_manga";
  await setDoc(docRef, {
    [fieldName]: list
  }, { merge: true });
}

export async function updateNotificationSettings(uid: string, settings: any) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(docRef, {
    notification_settings: settings
  }, { merge: true });
}

export async function updateUserProfileData(uid: string, username: string, avatar_url: string) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(docRef, {
    username,
    avatar_url
  }, { merge: true });
}

export async function updateWeeklyRanking(uid: string, type: "ANIME" | "MANGA", currentList: string[]) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  const fieldName = type === "ANIME" ? "weekly_ranking_anime" : "weekly_ranking_manga";
  
  await setDoc(docRef, {
    [fieldName]: {
      current: currentList,
      last_active: Date.now()
    }
  }, { merge: true });
}

export async function saveWeeklyRankingSnapshot(uid: string, type: "ANIME" | "MANGA", currentList: string[]) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  const fieldName = type === "ANIME" ? "weekly_ranking_anime" : "weekly_ranking_manga";
  
  await setDoc(docRef, {
    [fieldName]: {
      current: currentList,
      previous: currentList, // snapshot sets previous to current
      last_updated: new Date().toISOString(),
      last_active: Date.now()
    }
  }, { merge: true });
}

export function getLastMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

export async function performWeeklyMaintenance(uid: string, profile: UserProfile, userWorks: any[], aniListDetails: Record<string, any>) {
  if (!db) return false;
  const lastMonday = getLastMonday();
  const lastMaintenance = profile.last_maintenance_timestamp || 0;
  
  if (lastMaintenance < lastMonday) {
    const { saveUserWork } = await import("@/lib/db/works");
    let needsUpdate = false;
    
    for (const work of userWorks) {
      if (work.status === "CURRENT") {
        const details = aniListDetails[work.work_id];
        if (!details) continue;
        
        let maxAiredEp = 0;
        if (work.manual_max_episode !== undefined && work.manual_max_episode !== null) {
          maxAiredEp = Number(work.manual_max_episode);
        } else if (details.type === "MANGA") {
          maxAiredEp = details.chapters || 0;
        } else if (details.status === "FINISHED") {
          maxAiredEp = details.episodes || 0;
        } else {
          continue; // still releasing
        }
        
        const offset = Number(work.synchro_offset_episodes) || 0;
        maxAiredEp = Math.max(0, maxAiredEp - offset);
        
        const current = Number(work.current_episode) || 0;
        if (current >= maxAiredEp && maxAiredEp > 0) {
          await saveUserWork(uid, work.work_id, { status: "COMPLETED" });
          needsUpdate = true;
        }
      }
    }
    
    const docRef = doc(db, "users", uid);
    await setDoc(docRef, { last_maintenance_timestamp: Date.now() }, { merge: true });
    
    return needsUpdate;
  }
  return false;
}
