// Initialisation RevenueCat — idempotente, appelable plusieurs fois sans risque.
import Purchases, { LOG_LEVEL } from "react-native-purchases";
import { ENTITLEMENT_ID } from "./entitlement";

const API_KEY = "goog_mbYyguNKVUYBQbUUqStkNBNkMja"; // ← ta clé publique Android RevenueCat

let configured = false;

export function configurePurchases() {
  if (configured) return;
  configured = true;
  Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: API_KEY });
}



export async function restorePurchasesFlow(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  return info.entitlements.active[ENTITLEMENT_ID] != null;
}