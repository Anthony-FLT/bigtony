// Traduction du jour : contenu généré à la demande + mis en cache (doc du jour), et évaluation.
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";
import { loadProfile } from "./profile";
import { themeForToday } from "./dailyThemes";

const dailyTranslationFn = httpsCallable(functions, "dailyTranslation", { timeout: 25000 });
const assessTranslationFn = httpsCallable(functions, "assessTranslation", { timeout: 30000 });

export type TranslationDirection = "fr-to-en" | "en-to-fr";
export type TranslationContent = { source_text: string; direction: TranslationDirection };
export type TranslationResult = { correction: any | null; feedback_fr: string; model_translation: string };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Sens de traduction déterministe selon le jour (alterne fr→en / en→fr).
function directionForToday(): TranslationDirection {
  const day = Math.floor(Date.now() / 86400000);
  return day % 2 === 0 ? "fr-to-en" : "en-to-fr";
}

// Texte du jour : lu depuis le cache Firestore, sinon généré puis mis en cache.
export async function getTodayTranslation(): Promise<TranslationContent | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const ref = doc(db, "users", uid, "dailyChallenges", todayKey());

  try {
    const snap = await getDoc(ref);
    const d: any = snap.data() || {};
    if (d.translationContent?.source_text) return d.translationContent as TranslationContent;
  } catch {}

  try {
    const p = await loadProfile();
    const direction = directionForToday();
    const theme = themeForToday(p?.interests ?? [], p?.job ?? null, "translation");
    const res: any = await dailyTranslationFn({
      level: p?.level ?? "B1",
      interests: [theme],
      goals: p?.goals ?? [],
      job: null,
      direction,
      seed: todayKey() + "-" + Math.random().toString(36).slice(2, 7),
    });
    const content: TranslationContent = { source_text: res.data.source_text ?? "", direction };
    if (!content.source_text) return null;
    await setDoc(ref, { translationContent: content }, { merge: true });
    return content;
  } catch (e) {
    console.warn("getTodayTranslation échoué:", e);
    return null;
  }
}

export async function assessTranslation(
  source_text: string,
  direction: TranslationDirection,
  attempt: string,
  level: string
): Promise<TranslationResult> {
  const res: any = await assessTranslationFn({ source_text, direction, attempt, level });
  return {
    correction: res.data?.correction ?? null,
    feedback_fr: res.data?.feedback_fr ?? "",
    model_translation: res.data?.model_translation ?? "",
  };
}