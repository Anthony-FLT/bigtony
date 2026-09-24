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
  | "daily_expression_favorite";

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

export function logPaywallShown(source: PaywallSource) { log("paywall_shown", { source }); }
export function logPaywallDismissed(source?: PaywallSource) { log("paywall_dismissed", source ? { source } : undefined); }

export function logPurchaseStart(plan: PlanId) { log("purchase_start", { plan }); }
export function logPurchaseComplete(plan: PlanId) { log("purchase_complete", { plan }); }
export function logPurchaseFailed(plan: PlanId, reason?: string) { log("purchase_failed", { plan, reason: reason ?? "unknown" }); }
export function logPurchaseRestored() { log("purchase_restored"); }