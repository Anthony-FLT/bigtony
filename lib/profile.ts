// Profil utilisateur : personnalise les scènes et pilote le gating d'onboarding.
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Level } from "./level";

export type Goal =
  | "travail" | "entretien" | "voyage" | "quotidien" | "etudes" | "expat"
  | "vo" | "gaming" | "presentations" | "reseautage" | "examens" | "confiance";
export type Feeling = "panique" | "cherche-mots" | "passer-cap";
export type Gender = "homme" | "femme" | "non-precise";
// Voix du coach (choix utilisateur)
export type VoiceKey = "us-male" | "us-female" | "uk-male" | "uk-female";

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
  voice?: VoiceKey;
  speechRate?: number;
  weeklyGoal?: number;
  firstSessionDone?: boolean;
  trialExerciseDone?: boolean;
  trialExercisesDone?: { reading?: boolean; translation?: boolean; listening?: boolean };
  tourSeen?: boolean;
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
      voice: data.voice ?? "us-male",
      speechRate: data.speechRate ?? 0.95,
      weeklyGoal: data.weeklyGoal ?? 3,
      firstSessionDone: data.firstSessionDone ?? false,
      trialExerciseDone: data.trialExerciseDone ?? false,
      trialExercisesDone: {
        reading: data.trialExercisesDone?.reading ?? data.trialExerciseDone ?? false,
        translation: data.trialExercisesDone?.translation ?? data.trialExerciseDone ?? false,
        listening: data.trialExercisesDone?.listening ?? data.trialExerciseDone ?? false,
      },
      tourSeen: data.tourSeen ?? false,
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

export async function markTrialExerciseUsed(type: "reading" | "translation" | "listening"): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    // Fusion imbriquée : Firestore merge:true fusionne récursivement les objets, donc ça ne remplace
    // pas les autres exercices déjà marqués — seul trialExercisesDone.<type> est touché.
    await setDoc(doc(db, "users", uid), { trialExercisesDone: { [type]: true } }, { merge: true });
  } catch (e) {
    console.warn("markTrialExerciseUsed échoué:", e);
  }
}

export async function markTourSeen(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { tourSeen: true }, { merge: true });
  } catch (e) {
    console.warn("markTourSeen échoué:", e);
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

export async function saveVoice(voice: VoiceKey): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { voice }, { merge: true });
  } catch (e) {
    console.warn("saveVoice échoué:", e);
  }
}

export async function saveSpeechRate(speechRate: number): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { speechRate }, { merge: true });
  } catch (e) {
    console.warn("saveSpeechRate échoué:", e);
  }
}

export async function saveWeeklyGoal(weeklyGoal: number): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { weeklyGoal }, { merge: true });
  } catch (e) {
    console.warn("saveWeeklyGoal échoué:", e);
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