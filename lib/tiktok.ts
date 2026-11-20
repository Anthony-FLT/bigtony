// Suivi des campagnes TikTok Ads (SDK TikTok Business) : dit à TikTok quelles installations, inscriptions et abonnements
// viennent de ses publicités, pour qu'il puisse optimiser les campagnes. Appelé uniquement depuis lib/analytics.ts.
// Le SDK envoie tout seul l'installation et l'ouverture de l'app ; les achats sont envoyés à la main (RevenueCat gère la facturation).
import { Platform } from "react-native";
import { TikTokBusiness } from "react-native-tiktok-business-sdk";

// ▼▼▼ À REMPLIR — TikTok Ads Manager > Tools > Events Manager > l'app > Settings ▼▼▼
// tiktokAppId : le « TikTok App ID » (une suite de chiffres) ; accessToken : la clé affichée au même endroit (App Secret / Access Token).
// Une app TikTok par plateforme, donc deux jeux de valeurs. Tant qu'un champ est vide, le suivi reste éteint sur cette plateforme.
const CONFIG = {
  ios: { appId: "6831227791", tiktokAppId: "7710203731069239303", accessToken: "TTbfbJe3f4omXHVrZNCo2uc8PbJMh1Db" },
  android: { appId: "fr.elanapp.english", tiktokAppId: "7689476054416392213", accessToken: "TTt8jpSNolfwHa9SzPqBcZqKb3UlHZEt" },
};
// ▲▲▲

export type TikTokEvent = "Registration" | "CompleteTutorial" | "Subscribe";

let ready: Promise<boolean> | null = null;

// Démarre le SDK une seule fois. Ne lève jamais d'erreur : un souci de suivi ne doit pas gêner l'app.
// Sur iPhone, le SDK affiche à ce moment-là la demande d'autorisation de suivi d'Apple.
export function initTikTok(): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    const c = Platform.OS === "ios" ? CONFIG.ios : Platform.OS === "android" ? CONFIG.android : null;
    if (!c || !c.tiktokAppId || !c.accessToken) return false;
    try {
      await TikTokBusiness.initializeSdk(c.appId, c.tiktokAppId, c.accessToken, __DEV__, { disablePaymentTracking: true });
      return true;
    } catch (e) {
      console.warn("TikTok SDK non démarré:", e);
      return false;
    }
  })();
  return ready;
}

export function tiktokEvent(name: TikTokEvent) {
  initTikTok().then((ok) => {
    if (!ok) return;
    TikTokBusiness.trackEvent(name as any).catch((e: any) => console.warn(`TikTok ${name} échoué:`, e));
  });
}
