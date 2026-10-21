// Parcours d'apprentissage — appels serveur des tentatives de leçon (J2).
// Le client ne lit/écrit jamais users/{uid}/attempts directement : tout passe par ces callables.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type { AttemptResult, AttemptState, AttemptTurn, LessonAttempt, LessonTurnResponse, LessonVariant, Modality } from "./types";

const startOrResumeLessonFn = httpsCallable(functions, "startOrResumeLesson", { timeout: 20000 });
const recordLessonTurnFn = httpsCallable(functions, "recordLessonTurn", { timeout: 20000 });
const updateAttemptStateFn = httpsCallable(functions, "updateAttemptState", { timeout: 20000 });
const finalizeAttemptFn = httpsCallable(functions, "finalizeAttempt", { timeout: 70000 });
const lessonTurnFn = httpsCallable(functions, "lessonTurn", { timeout: 70000 });
const syncEntitlementFn = httpsCallable(functions, "syncEntitlement", { timeout: 20000 });

export type StartLessonResult = {
  attempt: LessonAttempt;
  turns: AttemptTurn[];
  variant: LessonVariant;
  resumed: boolean;
};

export type LessonStartError = "subscription_required" | "prerequisite_not_validated" | "lesson_unavailable" | "unknown";

export function lessonStartError(e: any): LessonStartError {
  const msg = String(e?.message ?? "");
  if (/subscription_required/.test(msg)) return "subscription_required";
  if (/prerequisite_not_validated/.test(msg)) return "prerequisite_not_validated";
  if (/lesson_unavailable|variant_missing/.test(msg)) return "lesson_unavailable";
  return "unknown";
}

export async function startOrResumeLesson(lessonId: string): Promise<StartLessonResult> {
  const res: any = await startOrResumeLessonFn({ lessonId });
  return res.data as StartLessonResult;
}

// Persistance d'un tour : ne bloque jamais la conversation (échec → warn, le tour reste à l'écran).
export async function recordLessonTurn(attemptId: string, turn: AttemptTurn): Promise<void> {
  try {
    await recordLessonTurnFn({ attemptId, turn });
  } catch (e) {
    console.warn("recordLessonTurn échoué:", e);
  }
}

export type TransferInput = { responseId: string; promptVersion: "1:primary" | "1:alternative"; text: string; modality: Modality };

export async function updateAttemptState(attemptId: string, state: AttemptState, transfer?: TransferInput): Promise<void> {
  try {
    await updateAttemptStateFn({ attemptId, state, ...(transfer ? { transfer } : {}) });
  } catch (e) {
    console.warn("updateAttemptState échoué:", e);
  }
}

// Évaluation finale groupée (serveur) : validation, XP, badge. Idempotent : rappeler renvoie le résultat stocké.
export async function finalizeAttempt(attemptId: string): Promise<AttemptResult> {
  const res: any = await finalizeAttemptFn({ attemptId });
  return res.data as AttemptResult;
}

// Après un achat : fait vérifier le droit par le serveur auprès de RevenueCat (le webhook peut arriver avec un délai).
export async function syncLearningEntitlement(): Promise<void> {
  try {
    await syncEntitlementFn({});
  } catch (e) {
    console.warn("syncEntitlement échoué:", e);
  }
}

// Un tour de conversation de leçon (voix ou texte). clientTurnId rend l'appel idempotent (double tap, retry réseau).
export async function lessonTurn(input: {
  attemptId: string;
  clientTurnId: string;
  audioBase64?: string;
  mimeType?: string;
  text?: string;
  voice: string;
  speakingRate: number;
}): Promise<LessonTurnResponse> {
  const res: any = await lessonTurnFn(input);
  return res.data as LessonTurnResponse;
}
