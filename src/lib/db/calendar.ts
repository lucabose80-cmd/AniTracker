import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs } from "firebase/firestore";

export interface CalendarOverride {
  work_id: string;
  airingAt?: number; // Unix timestamp in seconds
  weeklyDay?: number; // 0-6 (0 = Sunday, 1 = Monday, etc.)
  weeklyTime?: string; // "HH:MM"
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

export async function setCalendarOverride(work_id: string, airingAt?: number, weeklyDay?: number, weeklyTime?: string): Promise<void> {
  if (!db) return;
  
  const overrideRef = doc(db, "calendar_overrides", work_id);
  const data: any = { work_id };
  if (airingAt !== undefined) data.airingAt = airingAt;
  if (weeklyDay !== undefined) data.weeklyDay = weeklyDay;
  if (weeklyTime !== undefined) data.weeklyTime = weeklyTime;

  await setDoc(overrideRef, data, { merge: true });
}
