import { db } from '@/lib/firebase';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';

/** Returns the ISO string of this Sunday 23:59:59 (end of current week) */
function getEndOfWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  sunday.setHours(23, 59, 59, 999);
  return sunday.toISOString();
}

export async function pauseWorkThisWeek(workId: string, userId: string): Promise<void> {
  if (!db) return;
  const ref = doc(db, 'work_pauses', workId);
  await setDoc(ref, {
    work_id: workId,
    paused: true,
    paused_until: getEndOfWeek(),
    paused_by: userId,
  });
}

export async function getPausedWorkIds(): Promise<Set<string>> {
  if (!db) return new Set();
  const now = new Date().toISOString();
  const snap = await getDocs(collection(db, 'work_pauses'));
  const paused = new Set<string>();
  snap.forEach(d => {
    const data = d.data();
    // Only count as paused if paused_until is in the future
    if (data.paused && data.paused_until > now) {
      paused.add(d.id);
    }
  });
  return paused;
}
