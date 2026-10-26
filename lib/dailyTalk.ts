// Le point du jour — appels serveur (dailyTalkStart / dailyTalkTurn / dailyTalkEnd) et adaptateur vers l'écran de conversation.
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, functions } from "./firebase";
import type { LessonTurnResponse, LessonVariant, AttemptTurn } from "./learningPath/types";

const startFn = httpsCallable(functions, "dailyTalkStart", { timeout: 40000 });
const turnFn = httpsCallable(functions, "dailyTalkTurn", { timeout: 70000 });
const endFn = httpsCallable(functions, "dailyTalkEnd", { timeout: 30000 });

export type DailyTalkTurn = { index: number; user: string; coach: string; coachFr: string; coaching: { explanationFr: string; targetPhraseEn: string } | null; modality: "voice" | "text" };
export type DailyTalkResult = { phraseEn: string; phraseFr: string; reusedPhrases: string[]; missedPhrases: string[]; moveLabelFr: string; turns: number; regime: "A" | "B" | "C"; xpGained: number; at: number };
export type DailyTalkSession = {
  sessionId: string; resumed: boolean; state: "active" | "ended"; turns: DailyTalkTurn[]; maxTurns: number;
  regime: "A" | "B" | "C"; reuseTotal: number; reuseDone: number; openingEn: string; openingFr: string; moveLabelFr: string; result: DailyTalkResult | null;
};

// Clé du jour en heure locale (la session est « celle du jour » pour l'utilisateur, pas en UTC)
export function todayDateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// État du jour pour l'accueil : "todo" | "in_progress" | "done" (lecture directe, learning/* est lisible par le client)
export async function getDailyTalkStatus(): Promise<"todo" | "in_progress" | "done"> {
  const uid = auth.currentUser?.uid;
  if (!uid) return "todo";
  try {
    const snap = await getDoc(doc(db, `users/${uid}/learning/dailyTalk/sessions/${todayDateKey()}`));
    const d = snap.data();
    if (!d) return "todo";
    return d.state === "ended" ? "done" : "in_progress";
  } catch { return "todo"; }
}

export function warmDailyTalk(): void {
  startFn({ warmup: true }).catch(() => {});
  turnFn({ warmup: true }).catch(() => {});
}

export async function dailyTalkStart(voice: string): Promise<DailyTalkSession> {
  const res: any = await startFn({ dateKey: todayDateKey(), voice });
  return res.data as DailyTalkSession;
}

export async function dailyTalkEnd(sessionId: string): Promise<DailyTalkResult> {
  const res: any = await endFn({ sessionId });
  return res.data as DailyTalkResult;
}

export function dailyTalkStartError(e: any): "subscription_required" | "unknown" {
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  if (code.includes("permission-denied") || msg.includes("subscription_required")) return "subscription_required";
  return "unknown";
}

// --- Adaptateur : l'écran LessonConversation attend une variante et des réponses « leçon » ---
export function dailyVariant(s: DailyTalkSession): LessonVariant {
  return {
    id: `daily-${s.sessionId}`, lessonId: "daily", contentVersion: 1, practiceLevel: "B1" as any, titleFr: "Le point du jour", objectiveFr: "",
    coachRole: "a friendly English coach having a short daily chat with the learner about their life", userRole: "themselves",
    openingEn: s.openingEn, followUpsEn: [], difficultyFollowUpEn: "", easierVariantHintFr: "", fallbackFeedbackFr: "",
    requiredCriteria: [], miniLesson: { explanationFr: "", examplesEn: [], optional: true }, supports: ["translate", "sentence_starter", "listen_model", "text_mode"],
    microExercise: { promptFr: "", expectedSemanticCriteria: [], sampleAnswerEn: "", alternativePromptFr: "" },
    maxUsefulTurns: s.maxTurns,
  } as unknown as LessonVariant;
}

export function dailyTurnsAsAttemptTurns(turns: DailyTalkTurn[]): AttemptTurn[] {
  return turns.map((t) => ({
    index: t.index, user: t.user, coach: t.coach, modality: t.modality, supportUsed: "none",
    feedbackFr: t.coaching?.explanationFr ?? "", correction: t.coaching ? { has_errors: true, targetPhraseEn: t.coaching.targetPhraseEn } : null,
    pronunciation: null, observedCriteria: [], nextAction: "ask_targeted_question", targetCriterionId: null,
    coaching: t.coaching ? { ...t.coaching, requiresRetry: false, reason: "" } : null, at: 0,
  } as unknown as AttemptTurn));
}

// Un tour du point du jour, renvoyé dans la forme attendue par LessonConversation
export async function dailyTurnAsLessonTurn(input: {
  attemptId: string; clientTurnId: string; audioBase64?: string; mimeType?: string; text?: string; voice: string; speakingRate: number; audioFormat?: "mp3" | "pcm24k";
}): Promise<LessonTurnResponse> {
  const { attemptId, ...rest } = input;
  const res: any = await turnFn({ sessionId: attemptId, ...rest });
  const d = res.data;
  if (d.heardNothing) return d as LessonTurnResponse;
  return {
    turnIndex: d.turnIndex, transcript: d.transcript, reply_en: d.reply_en, reply_fr: d.reply_fr, hard_words: [],
    nextAction: d.isLast ? "propose_completion" : "ask_targeted_question", targetCriterionId: null,
    coaching: d.coaching ? { ...d.coaching, requiresRetry: false, reason: "" } : null,
    observedCriteria: [], coveredCriteria: [], allCovered: false, atCap: d.isLast,
    closingIn: null, minTurns: undefined,
    replyAudioBase64: d.replyAudioBase64 ?? null, coachingAudioFrBase64: null, coachingAudioEnBase64: null,
    replyPcmChunks: d.replyPcmChunks ?? null, coachingFrPcmChunks: null, coachingEnPcmChunks: null,
    // spécifique point du jour
    reuseDone: d.reuseDone, reuseTotal: d.reuseTotal, isLast: d.isLast,
  } as unknown as LessonTurnResponse;
}
