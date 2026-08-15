// Accès binaire : premium (abonné — essai natif 3 j inclus) ou verrouillé.
import Purchases from "react-native-purchases";
import { configurePurchases } from "./purchases";

export type Access = { premium: boolean };
export const ENTITLEMENT_ID = "Elan Pro"; // identifier EXACT de l'entitlement RevenueCat
export async function getAccess(): Promise<Access> {
  try {
    configurePurchases(); // défensif : garantit l'init quel que soit l'ordre d'appel
    const info = await Purchases.getCustomerInfo();
    console.log("ENTITLEMENTS:", JSON.stringify(info.entitlements.active));
    return { premium: info.entitlements.active[ENTITLEMENT_ID] != null };
  } catch (e) {
    console.warn("getAccess échoué:", e);
    return { premium: false };
  }
}