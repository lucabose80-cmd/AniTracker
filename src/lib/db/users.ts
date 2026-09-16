import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
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
      top_9_list: [],
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

export async function addToHistory(uid: string, workId: string) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(docRef, {
    read_watch_history: arrayUnion(workId)
  }, { merge: true });
}

export async function updateTop9List(uid: string, list: string[]) {
  if (!db) return;
  const docRef = doc(db, "users", uid);
  await setDoc(docRef, {
    top_9_list: list
  }, { merge: true });
}
