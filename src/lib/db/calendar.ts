import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs } from "firebase/firestore";

export interface CalendarOverride {
  work_id: string;
  airingAt?: number; // Unix timestamp in seconds
  weeklyDay?: number; // 0-6 (0 = Sunday, 1 = Monday, etc.)
  weeklyTime?: string; // "HH:MM"
  releaseFrequency?: number; // 1, 2, or 4 (weeks)
  manualMaxEpisode?: number; // Global override for missing episode counts
  manualAvailableEps?: number; // Global override for currently released chapters
  lastIncrementedAt?: number; // Unix timestamp
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

export async function setCalendarOverride(
  work_id: string, 
  airingAt?: number, 
  weeklyDay?: number, 
  weeklyTime?: string, 
  manualMaxEpisode?: number,
  releaseFrequency?: number,
  manualAvailableEps?: number,
  lastIncrementedAt?: number
): Promise<void> {
  if (!db) return;
  
  const overrideRef = doc(db, "calendar_overrides", work_id);
  const data: any = { work_id };
  
  // If airingAt is explicitly passed as null, we delete it, otherwise we set it if defined
  if (airingAt !== undefined) {
    if ((airingAt as any) === null) {
      const { deleteField } = await import("firebase/firestore");
      data.airingAt = deleteField();
    } else {
      data.airingAt = airingAt;
    }
  }

  if (weeklyDay !== undefined) {
    if ((weeklyDay as any) === null) {
      const { deleteField } = await import("firebase/firestore");
      data.weeklyDay = deleteField();
      data.weeklyTime = deleteField();
      data.releaseFrequency = deleteField();
      data.lastIncrementedAt = deleteField();
    } else {
      data.weeklyDay = weeklyDay;
    }
  }
  
  if (weeklyTime !== undefined && (weeklyTime as any) !== null) data.weeklyTime = weeklyTime;
  if (releaseFrequency !== undefined && (releaseFrequency as any) !== null) data.releaseFrequency = releaseFrequency;
  
  if (manualMaxEpisode !== undefined) {
    if ((manualMaxEpisode as any) === null) {
       const { deleteField } = await import("firebase/firestore");
       data.manualMaxEpisode = deleteField();
    } else {
      data.manualMaxEpisode = manualMaxEpisode;
    }
  }

  if (manualAvailableEps !== undefined) {
    if ((manualAvailableEps as any) === null) {
       const { deleteField } = await import("firebase/firestore");
       data.manualAvailableEps = deleteField();
    } else {
      data.manualAvailableEps = manualAvailableEps;
    }
  }

  if (lastIncrementedAt !== undefined && (lastIncrementedAt as any) !== null) data.lastIncrementedAt = lastIncrementedAt;

  await setDoc(overrideRef, data, { merge: true });
}

export async function clearManualMaxEpisode(work_id: string): Promise<void> {
  if (!db) return;
  const { deleteField } = await import("firebase/firestore");
  const overrideRef = doc(db, "calendar_overrides", work_id);
  await setDoc(overrideRef, { manualMaxEpisode: deleteField() }, { merge: true });
}
