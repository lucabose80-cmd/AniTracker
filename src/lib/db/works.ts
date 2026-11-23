import { db } from "@/lib/firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { UserWork } from "@/types/database";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      result[key] = stripUndefined(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

// Speichert oder aktualisiert eine Bewertung/Tracking für ein bestimmtes Werk durch einen User
export async function saveUserWork(
  userId: string,
  workId: string,
  data: Partial<UserWork>
) {
  if (!db) throw new Error("Firestore ist nicht initialisiert");

  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);

  const docSnap = await getDoc(docRef);
  const now = Date.now();
  const cleanData = stripUndefined(data as Record<string, unknown>);

  if (docSnap.exists()) {
    await updateDoc(docRef, {
      ...cleanData,
      user_id: userId,
      work_id: workId,
      updated_at: now,
    });
  } else {
    await setDoc(docRef, {
      ...cleanData,
      user_id: userId,
      work_id: workId,
      status: data.status || "PLANNING",
      priority_tier: data.priority_tier || 3,
      updated_at: now,
    });
  }
}

// Holt die Tracking-Daten eines Users für ein spezifisches Werk
export async function getUserWork(
  userId: string,
  workId: string
): Promise<UserWork | null> {
  if (!db) return null;

  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as UserWork;
  }

  return null;
}

// Holt alle Werke eines Users
export async function getAllUserWorks(userId: string): Promise<UserWork[]> {
  if (!db) return [];

  try {
    const worksRef = collection(db, "user_works");
    const q = query(worksRef, where("user_id", "==", userId));
    const querySnapshot = await getDocs(q);

    const works: UserWork[] = [];
    querySnapshot.forEach((docSnap) => {
      works.push(docSnap.data() as UserWork);
    });

    return works;
  } catch (error) {
    console.error("Fehler beim Laden der Bibliothek:", error);
    return [];
  }
}

// Holt alle Werke aller Nutzer (für Community-Markierungen in der Suche)
export async function getAllCommunityWorks(): Promise<UserWork[]> {
  if (!db) return [];
  try {
    const worksRef = collection(db, "user_works");
    const snap = await getDocs(worksRef);
    const works: UserWork[] = [];
    snap.forEach((docSnap) => {
      works.push(docSnap.data() as UserWork);
    });
    return works;
  } catch (error) {
    console.error("Fehler beim Laden der Community-Werke:", error);
    return [];
  }
}

// Löscht ein Werk aus der Bibliothek
export async function removeUserWork(userId: string, workId: string) {
  if (!db) return;
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  await deleteDoc(docRef);
}

export async function updateEpisodeProgress(
  userId: string,
  workId: string,
  current_episode: number
): Promise<void> {
  if (!db) return;
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    await updateDoc(docRef, {
      user_id: userId,
      work_id: workId,
      current_episode,
      auto_added: false,
      updated_at: Date.now(),
    });
  } else {
    // Always supply required user_id, work_id, status & priority_tier so Firestore rules accept creation
    await setDoc(docRef, {
      user_id: userId,
      work_id: workId,
      status: "CURRENT",
      priority_tier: 3,
      current_episode,
      auto_added: false,
      updated_at: Date.now(),
    });
  }
}

export async function updateUserWorkStatus(
  userId: string,
  workId: string,
  status: UserWork["status"]
): Promise<void> {
  if (!db) return;
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    await updateDoc(docRef, {
      user_id: userId,
      work_id: workId,
      status,
      auto_added: false,
      updated_at: Date.now(),
    });
  } else {
    await setDoc(docRef, {
      user_id: userId,
      work_id: workId,
      status,
      priority_tier: 3,
      current_episode: 0,
      auto_added: false,
      updated_at: Date.now(),
    });
  }
}
