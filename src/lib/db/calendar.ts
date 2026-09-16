import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs } from "firebase/firestore";

export interface CalendarOverride {
  work_id: string;
  airingAt?: number; // Unix timestamp in seconds
  weeklyDay?: number; // 0-6 (0 = Sunday, 1 = Monday, etc.)
  weeklyTime?: string; // "HH:MM"
  manualMaxEpisode?: number; // Global override for missing episode counts
}

export async function getCalendarOverrides(): Promise<Record<string, CalendarOverride>> {
  if (!db) return {};
  
  const overridesRef = collection(db, "calendar_overrides");
  const snapshot = await getDocs(overridesRef);
  
  const overrides: Record<string, CalendarOverride> = {};
  snapshot.forEach((doc) => {
    const data = doc.data() as CalendarOverride;
    overrides[data.work_id] = data;
  });
  
  return overrides;
}

export async function setCalendarOverride(work_id: string, airingAt?: number, weeklyDay?: number, weeklyTime?: string, manualMaxEpisode?: number): Promise<void> {
  if (!db) return;
  
  const overrideRef = doc(db, "calendar_overrides", work_id);
  const data: any = { work_id };
  if (airingAt !== undefined) data.airingAt = airingAt;
  if (weeklyDay !== undefined) data.weeklyDay = weeklyDay;
  if (weeklyTime !== undefined) data.weeklyTime = weeklyTime;
  
  // undefined leaves it alone. null deletes it (handled on client side or we can explicit pass null)
  if (manualMaxEpisode !== undefined) {
    if (manualMaxEpisode === null as any) {
       // Import deleteField at top if we want to delete it, but let's just allow writing null and firebase handles it or we use deleteField
    }
    data.manualMaxEpisode = manualMaxEpisode;
  }

  await setDoc(overrideRef, data, { merge: true });
}

export async function clearManualMaxEpisode(work_id: string): Promise<void> {
  if (!db) return;
  const { deleteField } = await import("firebase/firestore");
  const overrideRef = doc(db, "calendar_overrides", work_id);
  await setDoc(overrideRef, { manualMaxEpisode: deleteField() }, { merge: true });
}
