import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { UserWork } from "@/types/database";

// Speichert oder aktualisiert eine Bewertung/Tracking für ein bestimmtes Werk durch einen User
export async function saveUserWork(userId: string, workId: string, data: Partial<UserWork>) {
  if (!db) throw new Error("Firestore ist nicht initialisiert");
  
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    // Update existing
    await updateDoc(docRef, {
      ...data,
      user_id: userId,
      work_id: workId,
    });
  } else {
    // Create new
    await setDoc(docRef, {
      ...data,
      user_id: userId,
      work_id: workId,
      status: data.status || "PLANNING",
      priority_tier: data.priority_tier || 3,
    });
  }
}

// Holt die Tracking-Daten eines Users für ein spezifisches Werk
export async function getUserWork(userId: string, workId: string): Promise<UserWork | null> {
  if (!db) return null;

  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  
  try {
    const docSnap = await Promise.race([
      getDoc(docRef),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore Timeout")), 3000))
    ]) as any;

    if (docSnap.exists()) {
      return docSnap.data() as UserWork;
    }
  } catch (error) {
    console.error("Fehler beim Laden der UserWork (möglicherweise blockiert/Timeout):", error);
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
    querySnapshot.forEach((doc) => {
      works.push(doc.data() as UserWork);
    });
    
    return works;
  } catch (error) {
    console.error("Fehler beim Laden der Bibliothek:", error);
    return [];
  }
}

// Löscht ein Werk aus der Bibliothek
export async function removeUserWork(userId: string, workId: string) {
  if (!db) return;
  const { deleteDoc } = await import("firebase/firestore");
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  await deleteDoc(docRef);
}

export async function updateEpisodeProgress(userId: string, workId: string, current_episode: number): Promise<void> {
  if (!db) return;
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  
  await updateDoc(docRef, { current_episode, auto_added: false });
}

export async function updateUserWorkStatus(userId: string, workId: string, status: UserWork["status"]): Promise<void> {
  if (!db) return;
  const docId = `${userId}_${workId}`;
  const docRef = doc(db, "user_works", docId);
  
  await updateDoc(docRef, { status, auto_added: false });
}
