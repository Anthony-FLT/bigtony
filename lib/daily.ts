// Discussion quotidienne : savoir si celle d'aujourd'hui est déjà terminée.
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { auth, db } from "./firebase";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// La discussion du jour est-elle terminée aujourd'hui ?
export async function isDailyDone(): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const q = query(collection(db, "users", uid, "sessions"), orderBy("startedAt", "desc"));
    const snap = await getDocs(q);
    const today = todayKey();
    for (const doc of snap.docs) {
      const s = doc.data();
      if (s.kind === "daily" && s.status === "done" && s.startedAt?.toDate && s.startedAt.toDate().toISOString().slice(0, 10) === today) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn("isDailyDone échoué:", e);
    return false;
  }
}

// La session daily d'aujourd'hui (ou null) — pour afficher stats + bilan sur l'accueil.
export async function getTodayDailySession(): Promise<any | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const snap = await getDocs(collection(db, "users", uid, "sessions"));
    const today = new Date().toDateString();
    let found: any = null;
    snap.forEach((doc) => {
      const d: any = doc.data();
      if (d.kind !== "daily") return;
      const t = d.endedAt ?? d.startedAt;
      const dt: Date | null = t?.toDate ? t.toDate() : null;
      if (dt && dt.toDateString() === today) found = d;
    });
    return found;
  } catch { return null; }
}