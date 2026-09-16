import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
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
