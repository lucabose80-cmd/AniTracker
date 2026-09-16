import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs } from "firebase/firestore";

export interface CalendarOverride {
  work_id: string;
  airingAt: number; // Unix timestamp in seconds
}

export async function getCalendarOverrides(): Promise<Record<string, number>> {
  if (!db) return {};
  
  const overridesRef = collection(db, "calendar_overrides");
  const snapshot = await getDocs(overridesRef);
  
  const overrides: Record<string, number> = {};
  snapshot.forEach((doc) => {
    const data = doc.data() as CalendarOverride;
    overrides[data.work_id] = data.airingAt;
  });
  
  return overrides;
}

export async function setCalendarOverride(work_id: string, airingAt: number): Promise<void> {
  if (!db) return;
  
  const overrideRef = doc(db, "calendar_overrides", work_id);
  await setDoc(overrideRef, { work_id, airingAt });
}
