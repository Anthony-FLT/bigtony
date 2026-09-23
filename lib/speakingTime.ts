// Temps de parole : durée cumulée des tours enregistrés (mode vocal), par jour.
// Instrumentation démarrée maintenant — pas de données rétroactives avant sa mise en place.
import { doc, setDoc, getDoc, increment } from "firebase/firestore";
import { auth, db } from "./firebase";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Ajoute une durée (en secondes) au total du jour courant. Écriture atomique (increment) :
// sûre même si plusieurs tours s'enchaînent rapidement.
export async function addSpeakingSeconds(seconds: number): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || !seconds || seconds <= 0) return;
  try {
    await setDoc(
      doc(db, "users", uid, "speakingTime", dayKey(new Date())),
      { seconds: increment(Math.round(seconds)) },
      { merge: true }
    );
  } catch (e) {
    console.warn("addSpeakingSeconds échoué:", e);
  }
}

// Minutes de parole par jour de la semaine EN COURS (lundi → dimanche), + total.
export async function getWeekSpeakingMinutes(): Promise<{ perDay: number[]; totalMinutes: number }> {
  const perDay = new Array(7).fill(0) as number[];
  const uid = auth.currentUser?.uid;
  if (!uid) return { perDay, totalMinutes: 0 };
  try {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return dayKey(d);
    });
    const snaps = await Promise.all(keys.map((k) => getDoc(doc(db, "users", uid, "speakingTime", k))));
    let totalSeconds = 0;
    snaps.forEach((snap, i) => {
      const seconds = (snap.data()?.seconds as number) ?? 0;
      perDay[i] = Math.round(seconds / 60);
      totalSeconds += seconds;
    });
    return { perDay, totalMinutes: Math.round(totalSeconds / 60) };
  } catch (e) {
    console.warn("getWeekSpeakingMinutes échoué:", e);
    return { perDay, totalMinutes: 0 };
  }
}