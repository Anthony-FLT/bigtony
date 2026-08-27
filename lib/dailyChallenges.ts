// Défis du jour : suivi de l'état "fait aujourd'hui", stocké par jour dans Firestore.
// Doc : users/{uid}/dailyChallenges/{YYYY-MM-DD}
// Ce même doc accueillera plus tard le contenu généré (texte de lecture, texte à traduire).
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export type ChallengeType = "reading" | "translation" | "listening";

export const HUB_CHALLENGES: ChallengeType[] = ["reading", "translation", "listening"];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const FIELD: Record<ChallengeType, string> = {
  reading: "readingDone",
  translation: "translationDone",
  listening: "listeningDone",
};

// État "fait aujourd'hui" de chaque défi.
export async function getChallengesDone(): Promise<Record<ChallengeType, boolean>> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { reading: false, translation: false, listening: false };
  try {
    const snap = await getDoc(doc(db, "users", uid, "dailyChallenges", todayKey()));
    const d: any = snap.data() || {};
    return { reading: !!d.readingDone, translation: !!d.translationDone, listening: !!d.listeningDone };
  } catch (e) {
    console.warn("getChallengesDone échoué:", e);
    return { reading: false, translation: false, listening: false };
  }
}

// Nombre de défis faits aujourd'hui (pour la progression).
export async function getDoneCount(): Promise<number> {
  const d = await getChallengesDone();
  return HUB_CHALLENGES.reduce((n, c) => n + (d[c] ? 1 : 0), 0);
}

// Suivi : nombre de défis faits aujourd'hui et sur les 7 derniers jours.
export async function getChallengeStats(): Promise<{ todayDone: number; weekDone: number }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { todayDone: 0, weekDone: 0 };
  try {
    const now = new Date();
    const keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const snaps = await Promise.all(keys.map((k) => getDoc(doc(db, "users", uid, "dailyChallenges", k))));
    let todayDone = 0;
    let weekDone = 0;
    snaps.forEach((snap, i) => {
      const data: any = snap.data() || {};
      const dayCount = HUB_CHALLENGES.reduce((n, c) => n + (data[FIELD[c]] ? 1 : 0), 0);
      weekDone += dayCount;
      if (i === 0) todayDone = dayCount;
    });
    return { todayDone, weekDone };
  } catch (e) {
    console.warn("getChallengeStats échoué:", e);
    return { todayDone: 0, weekDone: 0 };
  }
}

// Marque un défi comme fait aujourd'hui.
export async function markChallengeDone(type: ChallengeType): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid, "dailyChallenges", todayKey()), { [FIELD[type]]: true }, { merge: true });
  } catch (e) {
    console.warn("markChallengeDone échoué:", e);
  }
}