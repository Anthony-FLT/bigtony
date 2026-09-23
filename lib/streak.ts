// Streak : nombre de jours consécutifs avec au moins une séance terminée.
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { auth, db } from "./firebase";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // AAAA-MM-JJ
}

export async function computeStreak(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  try {
    const q = query(collection(db, "users", uid, "sessions"), orderBy("startedAt", "desc"));
    const snap = await getDocs(q);
    const days = new Set<string>();
    for (const doc of snap.docs) {
      const s = doc.data();
      if (s.status !== "done" || !s.startedAt?.toDate) continue;
      days.add(dayKey(s.startedAt.toDate()));
    }
    if (days.size === 0) return 0;

    // Le streak compte à rebours depuis aujourd'hui (ou hier si pas encore pratiqué aujourd'hui)
    let streak = 0;
    const cursor = new Date();
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dayKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  } catch (e) {
    console.warn("computeStreak échoué:", e);
    return 0;
  }
}

export const STREAK_MILESTONES = [3, 7, 14, 30];

// Renvoie le palier si le streak correspond exactement à un cap, sinon null.
export function milestoneReached(streak: number): number | null {
  return STREAK_MILESTONES.includes(streak) ? streak : null;
}

// Objectif hebdomadaire : jours pratiqués cette semaine vs objectif fixé.
export type WeeklyGoalStatus = { done: number; goal: number; reached: boolean; remaining: number };

export async function getWeeklyGoalStatus(goal: number): Promise<WeeklyGoalStatus> {
  const g = goal && goal > 0 ? goal : 3;
  const week = await getWeekActivity();
  const done = week.filter(Boolean).length;
  const remaining = Math.max(0, g - done);
  return { done, goal: g, reached: done >= g, remaining };
}
export async function getWeekActivity(): Promise<boolean[]> {
  const week = new Array(7).fill(false) as boolean[];
  const uid = auth.currentUser?.uid;
  if (!uid) return week;
  try {
    const snap = await getDocs(collection(db, "users", uid, "sessions"));
    const days = new Set<string>();
    snap.forEach((doc) => {
      const data: any = doc.data();
      const t = data.endedAt ?? data.createdAt ?? data.startedAt ?? data.date;
      const dt: Date | null = t?.toDate ? t.toDate() : null;
      if (dt) days.add(dt.toDateString());
    });
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      week[i] = days.has(d.toDateString());
    }
  } catch (e) {
    console.warn("getWeekActivity échoué:", e);
  }
  return week;
}