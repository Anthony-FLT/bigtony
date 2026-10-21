// Suivi des events produit (Firebase Analytics) — usage pendant l'essai freemium,
// atterrissages sur le paywall (avec leur source), et conversion.
import { getAnalytics, logEvent } from "@react-native-firebase/analytics";

const analyticsInstance = getAnalytics();

export type PaywallSource =
  | "scenarios"
  | "custom_scene"
  | "daily_conversation"
  | "daily_hub"
  | "labo_add_word"
  | "welcome_already_used"
  | "daily_expression_favorite"
  | "gift"
  | "learning_path_after_lesson_1" // bilan de la première leçon du parcours (CTA « Débloquer ma prochaine leçon »)
  | "learning_path_map"; // carte du parcours : leçon publiée mais réservée à l'abonnement

export type ExerciseType = "reading" | "translation" | "listening";
export type PlanId = "monthly" | "yearly";

function log(name: string, params?: Record<string, any>) {
  try {
    logEvent(analyticsInstance, name, params);
  } catch (e) {
    console.warn(`analytics ${name} échoué:`, e);
  }
}

export function logOnboardingComplete() { log("onboarding_complete"); }
export function logOnboardingTestSkipped() { log("onboarding_test_skipped"); }

export function logWelcomeConversationStart() { log("welcome_conversation_start"); }
export function logWelcomeConversationAbandon() { log("welcome_conversation_abandon"); }
export function logWelcomeConversationComplete() { log("welcome_conversation_complete"); }

export function logTrialExerciseStart(type: ExerciseType) { log("trial_exercise_start", { type }); }

export function logGiftRevealShown() { log("gift_reveal_shown"); }
export function logGiftDeclined() { log("gift_declined"); }

export function logHubCompleteShown() { log("hub_complete_shown"); }
export function logRatingShown() { log("rating_shown"); }
export function logRatingSubmitted(stars: number) { log("rating_submitted", { stars }); }
export function logStoreReviewOpened() { log("store_review_opened"); }

export function logPaywallShown(source: PaywallSource) { log("paywall_shown", { source }); }
export function logPaywallDismissed(source?: PaywallSource) { log("paywall_dismissed", source ? { source } : undefined); }

// Paramètres communs aux events d'achat (Firebase limite les valeurs texte à 100 caractères)
export type PurchaseExtra = {
  gift?: boolean; // achat fait via l'offre cadeau
  offerId?: string; // option d'abonnement achetée (ex. "yearly:cadeau-50")
  sandbox?: boolean; // achat de test (compte testeur de licence), lu depuis RevenueCat
  errorCode?: string; // code d'erreur RevenueCat (ex. PURCHASE_INVALID_ERROR)
  errorDetail?: string; // message détaillé renvoyé par Google Play
};

const cut = (s: string) => String(s).slice(0, 100);

function purchaseParams(plan: PlanId, extra?: PurchaseExtra) {
  const p: Record<string, any> = { plan, gift: extra?.gift ? 1 : 0 };
  if (extra?.offerId) p.offer_id = cut(extra.offerId);
  if (extra?.sandbox !== undefined) p.sandbox = extra.sandbox ? 1 : 0;
  if (extra?.errorCode) p.error_code = cut(extra.errorCode);
  if (extra?.errorDetail) p.error_detail = cut(extra.errorDetail);
  return p;
}

export function logPurchaseStart(plan: PlanId, extra?: PurchaseExtra) { log("purchase_start", purchaseParams(plan, extra)); }
export function logPurchaseComplete(plan: PlanId, extra?: PurchaseExtra) { log("purchase_complete", purchaseParams(plan, extra)); }
export function logPurchaseFailed(plan: PlanId, reason?: string, extra?: PurchaseExtra) {
  log("purchase_failed", { ...purchaseParams(plan, extra), reason: cut(reason ?? "unknown") });
}
// Raison donnée par l'utilisateur après avoir fermé la feuille Google Play (micro-question, une fois par utilisateur)
export type CancelReason = "price" | "try_more" | "not_now" | "other";
export function logPurchaseCancelReason(reason: CancelReason, plan: PlanId, gift: boolean) {
  log("purchase_cancel_reason", { reason, plan, gift: gift ? 1 : 0 });
}
export function logPurchaseRestored() { log("purchase_restored"); }
// ---- Parcours d'apprentissage (leçons) — jamais de texte de conversation ni d'audio dans les events ----
type LessonCtx = { lessonId: string; attemptId: string; contentVersion: number; level: string; flowVersion: string };
export function logLessonMissionShown(c: LessonCtx) { log("lesson_mission_shown", c); }
export function logLessonStarted(c: LessonCtx) { log("lesson_started", c); }
export function logLessonObjectiveCovered(c: LessonCtx, criterionId: string, turn: number, support: string) {
  log("lesson_objective_covered", { ...c, criterion_id: cut(criterionId), turn, support });
}
export function logLessonCoachingShown(c: LessonCtx, requiresRetry: boolean) { log("lesson_coaching_shown", { ...c, requires_retry: requiresRetry ? 1 : 0 }); }
export function logLessonCoachingRetryDone(c: LessonCtx, covered: boolean) { log("lesson_coaching_retry_done", { ...c, covered: covered ? 1 : 0 }); }
export function logLessonAttemptEnd(c: LessonCtx, kind: string, turns: number, activeSeconds: number, supportUsed: boolean) {
  log("lesson_attempt_end", { ...c, kind, turns, active_seconds: Math.round(activeSeconds), support_used: supportUsed ? 1 : 0 });
}
export function logLessonInterrupted(c: LessonCtx, lastState: string, coveredCount: number, turn: number) {
  log("lesson_interrupted", { ...c, last_state: lastState, covered_count: coveredCount, turn });
}
export function logLessonNextClick(c: LessonCtx, destination: "lesson" | "paywall") { log("lesson_next_click", { ...c, destination }); }
