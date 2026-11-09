// Initialisation RevenueCat — idempotente, appelable plusieurs fois sans risque.
import Purchases, { LOG_LEVEL } from "react-native-purchases";
import { ENTITLEMENT_ID } from "./entitlement";
import { Platform } from "react-native";

const GOOGLE_API_KEY = "goog_mbYyguNKVUYBQbUUqStkNBNkMja"; // ← ta clé publique Android RevenueCat
const APPLE_API_KEY = "appl_RPpRXKQCEgvDTYTakNtuNMfSZoK"; // ← ta clé publique iOS RevenueCat

let configured = false;

export function configurePurchases() {
  if (configured) return;
  configured = true;
  Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: Platform.OS === "ios" ? APPLE_API_KEY : GOOGLE_API_KEY });
}

export async function restorePurchasesFlow(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  return info.entitlements.active[ENTITLEMENT_ID] != null;
}