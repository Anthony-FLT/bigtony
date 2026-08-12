// Profil utilisateur : personnalise les scènes et pilote le gating d'onboarding.
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Level } from "./level";

export type Goal =
  | "travail" | "entretien" | "voyage" | "quotidien" | "etudes" | "expat"
  | "vo" | "gaming" | "presentations" | "reseautage" | "examens" | "confiance";
export type Feeling = "panique" | "cherche-mots" | "passer-cap";
export type Gender = "homme" | "femme" | "non-precise";

export type Profile = {
  onboarded: boolean;
  goals?: Goal[];
  feeling?: Feeling;
  job?: string;
  gender?: Gender;
  interests?: string[];
  level?: Level;
  testScore?: number | null;
  name?: string;
  firstSessionDone?: boolean;
  translateHintSeen?: boolean;
  lastMilestone?: number;
};

export async function loadProfile(): Promise<Profile | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.data();
    if (!data) return { onboarded: false };
    return {
      onboarded: !!data.onboarded,
      goals: data.goals,
      feeling: data.feeling,
      job: data.job,
      gender: data.gender,
      interests: data.interests,
      level: data.level,
      testScore: data.testScore ?? null,
      name: data.name,
      firstSessionDone: data.firstSessionDone ?? false,
      translateHintSeen: data.translateHintSeen ?? false,
      lastMilestone: data.lastMilestone ?? 0,
    };
  } catch (e) {
    console.warn("loadProfile échoué:", e);
    return null;
  }
}

export async function saveProfile(p: Omit<Profile, "onboarded">): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Utilisateur non connecté");

  // Firestore refuse les valeurs undefined → on ne garde que les champs définis
  const clean: Record<string, unknown> = { onboarded: true, onboardedAt: serverTimestamp() };
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) clean[k] = v;
  }

  await setDoc(doc(db, "users", uid), clean, { merge: true });
}

export async function markFirstSessionDone(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { firstSessionDone: true }, { merge: true });
  } catch (e) {
    console.warn("markFirstSessionDone échoué:", e);
  }
}

export async function markTranslateHintSeen(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { translateHintSeen: true }, { merge: true });
  } catch (e) {
    console.warn("markTranslateHintSeen échoué:", e);
  }
}

export async function saveMilestone(n: number): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { lastMilestone: n }, { merge: true });
  } catch (e) {
    console.warn("saveMilestone échoué:", e);
  }
}