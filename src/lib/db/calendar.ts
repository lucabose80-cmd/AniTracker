import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, deleteField } from "firebase/firestore";

export interface CalendarOverride {
  work_id: string;
  airingAt?: number; // Unix timestamp in seconds
  weeklyDay?: number; // 0-6 (0 = Sunday, 1 = Monday, etc.)
  weeklyTime?: string; // "HH:MM"
  releaseFrequency?: number; // 1, 2, or 4 (weeks)
  manualMaxEpisode?: number; // Global override for missing episode counts
  manualAvailableEps?: number; // Global override for currently released chapters
  lastIncrementedAt?: number; // Unix timestamp
  startDate?: string;           // ISO date string - when the release schedule started
  rhythmType?: 'strict' | 'flexible'; // strict = exact weekday, flexible = range
  flexibleDayRange?: {
    minDay: number;             // e.g. 4 (Thursday)
    maxDay: number;             // e.g. 0 (Sunday)
  };
}

export async function getCalendarOverrides(): Promise<Record<string, CalendarOverride>> {
  if (!db) return {};
  
  try {
    const overridesRef = collection(db, "calendar_overrides");
    const snapshot = await getDocs(overridesRef);
    
    const overrides: Record<string, CalendarOverride> = {};
    snapshot.forEach((doc) => {
      const data = (doc.data() || {}) as CalendarOverride;
      overrides[data.work_id || doc.id] = { ...data, work_id: data.work_id || doc.id };
    });
    
    return overrides;
  } catch (error) {
    console.error("Error fetching calendar overrides:", error);
    return {};
  }
}

export async function getCalendarOverrideForWork(work_id: string): Promise<CalendarOverride | null> {
  if (!db || !work_id?.trim()) return null;

  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    const snap = await getDoc(overrideRef);
    if (!snap.exists()) return null;

    const data = (snap.data() || {}) as CalendarOverride;
    return {
      ...data,
      work_id: data.work_id || snap.id,
    };
  } catch (error) {
    console.error(`Error fetching calendar override for work ${work_id}:`, error);
    return null;
  }
}

export async function setCalendarOverride(
  work_id: string, 
  airingAt?: number, 
  weeklyDay?: number, 
  weeklyTime?: string, 
  manualMaxEpisode?: number,
  releaseFrequency?: number,
  manualAvailableEps?: number,
  lastIncrementedAt?: number,
  startDate?: string,
  rhythmType?: 'strict' | 'flexible',
  flexibleDayRange?: { minDay: number; maxDay: number }
): Promise<void> {
  if (!db || !work_id?.trim()) return;
  
  const cleanId = work_id.trim();
  const overrideRef = doc(db, "calendar_overrides", cleanId);
  const data: Record<string, any> = { work_id: cleanId };
  
  // If airingAt is explicitly passed as null, we delete it, otherwise we set it if defined
  if (airingAt !== undefined) {
    if ((airingAt as any) === null) {
      data.airingAt = deleteField();
    } else {
      data.airingAt = airingAt;
    }
  }

  if (weeklyDay !== undefined) {
    if ((weeklyDay as any) === null) {
      data.weeklyDay = deleteField();
      data.weeklyTime = deleteField();
      data.releaseFrequency = deleteField();
      data.lastIncrementedAt = deleteField();
    } else {
      data.weeklyDay = weeklyDay;
    }
  }
  
  if (weeklyTime !== undefined) {
    if ((weeklyTime as any) === null) {
      data.weeklyTime = deleteField();
    } else {
      data.weeklyTime = weeklyTime;
    }
  }

  if (releaseFrequency !== undefined) {
    if ((releaseFrequency as any) === null) {
      data.releaseFrequency = deleteField();
    } else {
      data.releaseFrequency = releaseFrequency;
    }
  }
  
  if (manualMaxEpisode !== undefined) {
    if ((manualMaxEpisode as any) === null) {
      data.manualMaxEpisode = deleteField();
    } else {
      data.manualMaxEpisode = manualMaxEpisode;
    }
  }

  if (manualAvailableEps !== undefined) {
    if ((manualAvailableEps as any) === null) {
      data.manualAvailableEps = deleteField();
    } else {
      data.manualAvailableEps = manualAvailableEps;
    }
  }

  if (lastIncrementedAt !== undefined) {
    if ((lastIncrementedAt as any) === null) {
      data.lastIncrementedAt = deleteField();
    } else {
      data.lastIncrementedAt = lastIncrementedAt;
    }
  }

  if (startDate !== undefined) {
    if ((startDate as any) === null) {
      data.startDate = deleteField();
    } else {
      data.startDate = startDate;
    }
  }

  if (rhythmType !== undefined) {
    if ((rhythmType as any) === null) {
      data.rhythmType = deleteField();
    } else {
      data.rhythmType = rhythmType;
    }
  }

  if (flexibleDayRange !== undefined) {
    if ((flexibleDayRange as any) === null) {
      data.flexibleDayRange = deleteField();
    } else {
      data.flexibleDayRange = flexibleDayRange;
    }
  }

  try {
    await setDoc(overrideRef, data, { merge: true });
  } catch (error) {
    console.error(`Error setting calendar override for work ${work_id}:`, error);
  }
}

export async function clearManualMaxEpisode(work_id: string): Promise<void> {
  if (!db || !work_id?.trim()) return;
  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    await setDoc(overrideRef, { manualMaxEpisode: deleteField() }, { merge: true });
  } catch (error) {
    console.error(`Error clearing manual max episode for work ${work_id}:`, error);
  }
}

export async function deleteCalendarOverride(work_id: string): Promise<void> {
  if (!db || !work_id?.trim()) return;
  try {
    const cleanId = work_id.trim();
    const overrideRef = doc(db, "calendar_overrides", cleanId);
    await deleteDoc(overrideRef);
  } catch (error) {
    console.error(`Error deleting calendar override for work ${work_id}:`, error);
  }
}
