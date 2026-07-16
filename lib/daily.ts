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