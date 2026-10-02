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
  | "gift";

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
export function logPurchaseRestored() { log("purchase_restored"); }