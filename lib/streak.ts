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