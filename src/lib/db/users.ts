import { db } from "@/lib/firebase";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  arrayUnion,
} from "firebase/firestore";
import { UserProfile } from "@/types/database";

export async function createUserProfile(
  uid: string,
  username: string,
  email: string
) {
  if (!db) throw new Error("Firestore ist nicht initialisiert");

  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    await setDoc(docRef, {
      uid,
      username,
      avatar_url: "",
      following_array: [],
      top_9_anime: [],
      top_9_manga: [],
      read_watch_history: [],
      email,
    });
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!db) return null;
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);

  if (docSnap && docSnap.exists()) {
    const data = docSnap.data() as UserProfile;
    return {
      ...data,
      uid: data.uid || docSnap.id,
    };
  }
  return null;
}

export async function getAllUserProfiles(): Promise<UserProfile[]> {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, "users"));
  const profiles: UserProfile[] = [];
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as UserProfile;
    profiles.push({
      ...data,
      uid: data.uid || docSnap.id,
    });
  });
  return profiles;
}

export async function addToHistory(uid: string, workId: string) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(
    docRef,
    {
      uid,
      read_watch_history: arrayUnion(workId),
    },
    { merge: true }
  );
}

export async function updateNotificationSettings(
  uid: string,
  settings: NonNullable<UserProfile["notification_settings"]>
) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(
    docRef,
    {
      uid,
      notification_settings: settings,
    },
    { merge: true }
  );
}

export async function updateUserProfileData(
  uid: string,
  username: string,
  avatar_url: string
) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(
    docRef,
    {
      uid,
      username,
      avatar_url,
    },
    { merge: true }
  );
}
