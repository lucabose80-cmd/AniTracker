import { db } from '@/lib/firebase';
import { doc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';

export interface WorkPauseRecord {
  work_id: string;
  paused: boolean;
  paused_until: string; // ISO string, or '9999-12-31T23:59:59.999Z' for indefinite hiatus
  paused_by: string;
}

export const INDEFINITE_PAUSE_UNTIL = '9999-12-31T23:59:59.999Z';

/** Returns the ISO string of Sunday 23:59:59 at the end of N weeks from now (1 = end of current week) */
export function getEndOfWeeksFromNow(weeks: number = 1): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysUntilThisSunday = day === 0 ? 0 : 7 - day;
  const extraWeeks = Math.max(0, weeks - 1);
  const targetSunday = new Date(now);
  targetSunday.setDate(now.getDate() + daysUntilThisSunday + extraWeeks * 7);
  targetSunday.setHours(23, 59, 59, 999);
  return targetSunday.toISOString();
}

export async function pauseWorkUntil(
  workId: string,
  userId: string,
  pausedUntilIso: string
): Promise<void> {
  if (!db || !workId) return;
  const ref = doc(db, 'work_pauses', workId);
  await setDoc(ref, {
    work_id: workId,
    paused: true,
    paused_until: pausedUntilIso,
    paused_by: userId,
  });
}

export async function pauseWorkThisWeek(workId: string, userId: string): Promise<void> {
  await pauseWorkUntil(workId, userId, getEndOfWeeksFromNow(1));
}

export async function pauseWorkForWeeks(
  workId: string,
  userId: string,
  weeks: number
): Promise<void> {
  await pauseWorkUntil(workId, userId, getEndOfWeeksFromNow(Math.max(1, weeks)));
}

export async function pauseWorkIndefinitely(workId: string, userId: string): Promise<void> {
  await pauseWorkUntil(workId, userId, INDEFINITE_PAUSE_UNTIL);
}

export async function unpauseWork(workId: string): Promise<void> {
  if (!db || !workId) return;
  const ref = doc(db, 'work_pauses', workId);
  await deleteDoc(ref);
}

export async function getPausedWorksMap(): Promise<Record<string, WorkPauseRecord>> {
  if (!db) return {};
  const now = new Date().toISOString();
  const snap = await getDocs(collection(db, 'work_pauses'));
  const pausedMap: Record<string, WorkPauseRecord> = {};
  snap.forEach((d) => {
    const data = d.data() as WorkPauseRecord;
    if (data.paused && data.paused_until > now) {
      const id = data.work_id || d.id;
      pausedMap[id] = {
        work_id: id,
        paused: true,
        paused_until: data.paused_until,
        paused_by: data.paused_by || '',
      };
    }
  });
  return pausedMap;
}

export async function getPausedWorkIds(): Promise<Set<string>> {
  const map = await getPausedWorksMap();
  return new Set(Object.keys(map));
}

