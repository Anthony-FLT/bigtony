// PaywallScreen — maquette du 29/10 (écrans 09 et 14) : logo, « Continue à prendre la parole. », encart coach + 3 promesses,
// « À suivre » (présentation après le café, prochaine leçon après la présentation), offres Annuel / Mensuel, CTA, mentions.
// Un seul composant, deux contextes (after_coffee | after_presentation). Logique RevenueCat inchangée (offres, essai réel, cadeau, achat, restauration).
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Animated, Image, Linking, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { configurePurchases } from "../lib/purchases";
import { ENTITLEMENT_ID } from "../lib/entitlement";
import { findGiftOption } from "../lib/giftOffer";
import { logPurchaseStart, logPurchaseComplete, logPurchaseFailed, logPurchaseRestored, logPaywallDismissed } from "../lib/analytics";
import { loadProfile } from "../lib/profile";
import { getLearningPath } from "../lib/learningPath/path";
import { LESSONS } from "../lib/learningPath/catalog";
import { coachForVoice, LessonCoach } from "../lib/learningPath/coaches";
import { O, IMAGES, OnbIcon, Chip } from "../components/onbUi";

type PlanId = "monthly" | "yearly";
export type PaywallContext = "after_coffee" | "after_presentation";

// Prix de secours si le store est injoignable (affichage seulement, l'achat exige le vrai package)
const FALLBACK = { monthly: "4,99 €", yearly: "49,99 €" };
// Pages légales (mêmes liens que les paramètres)
const TERMS_URL = "https://erbol-1307.web.app/cgu.html";
const PRIVACY_URL = "https://erbol-1307.web.app/confidentialite.html";
const BRAND_ICON = require("../assets/icon.png");
const WHERE: Record<string, string> = { voyage: "ton prochain voyage", travail: "ton travail", etudes: "tes études", quotidien: "ton quotidien" };

async function scheduleTrialReminder(trialDays: number) {
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    const inDays = Math.max(1, trialDays - 2);
    const date = new Date(Date.now() + inDays * 24 * 60 * 60 * 1000);
    date.setHours(10, 0, 0, 0);
    await Notifications.scheduleNotificationAsync({
      identifier: "trial-reminder",
      content: { title: "Ton essai se termine dans 2 jours", body: "Tu peux continuer, ou résilier depuis Google Play avant la facturation." },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  } catch (e) { console.warn("Rappel d'essai non programmé:", e); }
}

// — Détection de l'essai gratuit, sans rien écrire en dur —
function periodUnitToDays(n: any, unit: any): number | null {
  const num = typeof n === "number" ? n : parseInt(n, 10);
  if (!num || !unit) return null;
  const u = String(unit).toUpperCase();
  if (u.startsWith("DAY")) return num;
  if (u.startsWith("WEEK")) return num * 7;
  if (u.startsWith("MONTH")) return num * 30;
  if (u.startsWith("YEAR")) return num * 365;
  return null;
}

function iso8601ToDays(iso: any): number | null {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/);
  if (!m) return null;
  const y = parseInt(m[1] || "0", 10);
  const mo = parseInt(m[2] || "0", 10);
  const w = parseInt(m[3] || "0", 10);
  const d = parseInt(m[4] || "0", 10);
  const days = y * 365 + mo * 30 + w * 7 + d;
  return days > 0 ? days : null;
}

// Prix d'appel du mensuel (ex. 4,99 € le 1er mois) : phase payante située avant le prix de base, sur 1 mois.
function introPriceFor(pkg: PurchasesPackage | null): { priceString: string; micros: number } | null {
  const opts = (pkg?.product as any)?.subscriptionOptions;
  if (!Array.isArray(opts)) return null;
  for (const o of opts) {
    if (Array.isArray(o?.tags) && o.tags.includes("rc-ignore-offer")) continue;
    const phases: any[] = o?.pricingPhases ?? [];
    if (phases.length < 2) continue;
    const intro = phases.slice(0, -1).find((ph) => Number(ph?.price?.amountMicros ?? 0) > 0);
    if (!intro) continue;
    const bp = intro.billingPeriod;
    const days = iso8601ToDays(typeof bp === "string" ? bp : bp?.iso8601) ?? periodUnitToDays(bp?.value, bp?.unit);
    if (days !== 30 || Number(intro.billingCycleCount ?? 1) > 1) continue;
    const micros = Number(intro.price.amountMicros);
    return { priceString: intro.price.formatted ?? `${(micros / 1_000_000).toFixed(2).replace(".", ",")} €`, micros };
  }
  return null;
}

// Nombre de jours d'essai gratuit disponible pour ce package (ou null si aucun).
function trialDaysFor(pkg: PurchasesPackage | null): number | null {
  if (!pkg) return null;
  const product: any = pkg.product;
  const intro = product?.introductoryPrice;
  if (intro && (intro.price === 0 || intro.amountMicros === 0 || intro.priceString === "0")) {
    const d = periodUnitToDays(intro.periodNumberOfUnits, intro.periodUnit) ?? iso8601ToDays(intro.period);
    if (d) return d;
  }
  const opts = product?.subscriptionOptions;
  if (Array.isArray(opts)) {
    for (const o of opts) {
      const phases = o?.pricingPhases ?? [];
      const free = phases.find((ph: any) => { const micros = ph?.price?.amountMicros; return micros === 0 || micros === "0"; });
      if (free) {
        const bp = free.billingPeriod;
        const d = iso8601ToDays(typeof bp === "string" ? bp : bp?.iso8601) ?? periodUnitToDays(bp?.value, bp?.unit);
        if (d) return d;
      }
    }
  }
  return null;
}


export default function PaywallScreen({
  onClose,
  dismissable = true,
  onPurchased,
  closeDelayMs = 0,
  context,
  planLabel,
  giftOfferId,
  giftExpiresAt,
}: {
  onClose: () => void;
  dismissable?: boolean;
  onPurchased: () => void;
  closeDelayMs?: number; // la croix n'apparaît qu'après ce délai
  context?: PaywallContext; // after_coffee : « À suivre » = présentation ; sinon prochaine leçon réservée à l'abonnement
  planLabel?: string; // conservé pour compatibilité (plus affiché)
  giftOfferId?: string; // offre Play « developer determined » (ex. "cadeau-50") : mode cadeau, annuel seul
  giftExpiresAt?: number; // fin de l'offre cadeau (timestamp ms)
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<PlanId>("yearly");
  const [pkgs, setPkgs] = useState<Record<PlanId, PurchasesPackage | null>>({ monthly: null, yearly: null });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [coach, setCoach] = useState<LessonCoach>(() => coachForVoice(null));
  const [profileReady, setProfileReady] = useState(false);
  const [where, setWhere] = useState(WHERE.voyage);
  const [goalKey, setGoalKey] = useState("voyage");
  const [nextLesson, setNextLesson] = useState<{ title: string; sub: string } | null>(null);
  const [remindTrial, setRemindTrial] = useState(true);

  // Coach, objectif et « À suivre » (présentation après le café ; sinon prochaine leçon réservée à l'abonnement)
  useEffect(() => {
    loadProfile().then((p) => {
      setCoach(coachForVoice(p?.voice));
      const g = p?.goals?.[0] ?? "voyage";
      setGoalKey(g); setWhere(WHERE[g] ?? WHERE.voyage);
    }).catch(() => {}).finally(() => setProfileReady(true));
    if (context === "after_coffee") {
      setNextLesson({ title: LESSONS[0]?.titleFr ?? "Fais ta première présentation", sub: "" });
      return;
    }
    getLearningPath(false).then((view) => {
      const n = view.nodes.find((x) => x.access === "subscription_required" && x.pedagogical !== "hidden_preview" && x.pedagogical !== "validated");
      if (n) setNextLesson({ title: n.lesson.titleFr, sub: n.variant ? n.variant.objectiveFr : "" });
    }).catch(() => {});
  }, [context]);

  useEffect(() => {
    if (!giftExpiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [giftExpiresAt]);

  const [canClose, setCanClose] = useState(closeDelayMs <= 0);
  const closeOpacity = useRef(new Animated.Value(closeDelayMs <= 0 ? 1 : 0)).current;
  useEffect(() => {
    if (closeDelayMs <= 0) return;
    const t = setTimeout(() => { setCanClose(true); Animated.timing(closeOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start(); }, closeDelayMs);
    return () => clearTimeout(t);
  }, [closeDelayMs, closeOpacity]);

  useEffect(() => {
    const timeout = setTimeout(() => setLoaded(true), 5000);
    (async () => {
      try {
        configurePurchases();
        const offerings = await Purchases.getOfferings();
        const av = offerings.current?.availablePackages ?? [];
        const find = (t: string) => av.find((p) => p.packageType === t) ?? null;
        setPkgs({ yearly: find("ANNUAL"), monthly: find("MONTHLY") });
      } catch (e) {
        console.warn("getOfferings échoué:", e);
      } finally {
        clearTimeout(timeout);
        setLoaded(true);
      }
    })();
    return () => clearTimeout(timeout);
  }, []);

  const price = (id: PlanId) => pkgs[id]?.product.priceString ?? FALLBACK[id];
  const yearTrial = trialDaysFor(pkgs.yearly);
  const monthTrial = trialDaysFor(pkgs.monthly);
  const monthIntro = introPriceFor(pkgs.monthly);

  const numeric = (id: PlanId, fallback: number) => { const p: any = pkgs[id]?.product; return typeof p?.price === "number" ? p.price : fallback; };
  const currency = ((pkgs.yearly?.product as any)?.currencyCode as string) ?? "EUR";
  const money = (v: number) => {
    try { return v.toLocaleString("fr-FR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch { return `${v.toFixed(2)} €`; }
  };
  const yearlyValue = numeric("yearly", 49.99);

  // — Mode cadeau —
  const giftOption: any = giftOfferId ? findGiftOption(pkgs.yearly?.product, giftOfferId) : null;
  const giftPhase: any = giftOption ? giftOption.introPhase ?? giftOption.pricingPhases?.[0] ?? null : null;
  const giftMicros = Number(giftPhase?.price?.amountMicros ?? 0);
  const giftRemaining = giftExpiresAt ? giftExpiresAt - now : Infinity;
  const isGift = !!giftOption && giftMicros > 0 && giftRemaining > 0;
  const giftClock = Number.isFinite(giftRemaining)
    ? `${String(Math.floor(Math.max(0, giftRemaining) / 60000)).padStart(2, "0")}:${String(Math.floor((Math.max(0, giftRemaining) % 60000) / 1000)).padStart(2, "0")}`
    : "";
  const giftValue = giftMicros / 1_000_000;
  const giftPrice: string = giftPhase?.price?.formatted ?? money(giftValue);
  const giftDiscount = isGift ? Math.round((1 - giftValue / yearlyValue) * 100) : 0;

  const handleClose = () => { logPaywallDismissed(isGift ? "gift" : undefined); onClose(); };

  const buy = async () => {
    const pkg = pkgs[selected];
    if (!pkg) { Alert.alert("Connexion au store impossible", "Vérifie ta connexion internet et réessaie dans un instant."); return; }
    setBusy(true);
    const offerId: string | undefined = isGift ? giftOption?.id : (pkg.product as any)?.defaultOption?.id;
    const base = { gift: isGift, offerId };
    logPurchaseStart(selected, base);
    try {
      const { customerInfo } = isGift ? await Purchases.purchaseSubscriptionOption(giftOption) : await Purchases.purchasePackage(pkg);
      const ent = customerInfo.entitlements.active[ENTITLEMENT_ID];
      if (ent) {
        logPurchaseComplete(selected, { ...base, sandbox: !!(ent as any).isSandbox });
        const trial = selected === "yearly" ? yearTrial : monthTrial;
        if (!isGift && trial && remindTrial) scheduleTrialReminder(trial);
        onPurchased();
      }
      else logPurchaseFailed(selected, "entitlement_inactive", base);
    } catch (e: any) {
      logPurchaseFailed(selected, e.userCancelled ? "user_cancelled" : (e.message ?? String(e)), {
        ...base, errorCode: e.readableErrorCode ?? (e.code !== undefined ? String(e.code) : undefined), errorDetail: e.underlyingErrorMessage,
      });
      if (!e.userCancelled) Alert.alert("Achat impossible", e.message ?? String(e));
    } finally { setBusy(false); }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const info = await Purchases.restorePurchases();
      if (info.entitlements.active[ENTITLEMENT_ID]) { logPurchaseRestored(); onPurchased(); }
      else Alert.alert("Aucun achat trouvé", "Aucun abonnement actif n'est associé à ton compte Google.");
    } catch (e: any) { Alert.alert("Restauration impossible", e.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const yearSel = isGift || selected === "yearly";
  const monthSel = selected === "monthly";
  const activeTrial = !isGift ? (selected === "yearly" ? yearTrial : monthTrial) : null;

  const ctaLabel = isGift
    ? `Profiter de -${giftDiscount} %`
    : selected === "yearly" && yearTrial ? `Commencer mes ${yearTrial} jours gratuits`
    : selected === "monthly" && monthIntro ? `Commencer à ${monthIntro.priceString}`
    : "Débloquer mon parcours";

  const legalText = isGift
    ? `${giftPrice} pour la 1re année, puis ${price("yearly")}/an. Renouvellement automatique. Résiliable dans les réglages du store. Offre valable uniquement sur cet écran.`
    : selected === "yearly"
    ? yearTrial
      ? `0 € aujourd'hui. ${yearTrial} jours gratuits, puis ${price("yearly")} facturés par an. Renouvellement automatique. Résiliable dans les réglages du store.`
      : `${price("yearly")} facturés par an. Renouvellement automatique. Résiliable dans les réglages du store.`
    : monthIntro
    ? `${monthIntro.priceString} le premier mois, puis ${price("monthly")} par mois. Renouvellement automatique. Résiliable dans les réglages du store.`
    : `${price("monthly")} facturés par mois. Renouvellement automatique. Résiliable dans les réglages du store.`;

  const nextImage = context === "after_coffee" ? IMAGES.scenePresentation : goalKey === "voyage" ? IMAGES.sceneHotel : IMAGES.scenePresentation;
  const nextCaption = context === "after_coffee" ? `Présente-toi et fais connaissance avec ${coach.displayName}.` : (nextLesson?.sub || `Continue avec ${coach.displayName}, à ton rythme.`);

  return (
    <View style={styles.container}>
      {!loaded || !profileReady ? (
        <View style={styles.loading}><ActivityIndicator color={O.primary} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: O.gutter, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
          {/* Logo + fermer */}
          <View style={styles.topRow}>
            <View style={{ width: 40 }} />
            <View style={styles.brandRow}>
              <Image source={BRAND_ICON} style={styles.brandIcon} />
              <View><Text style={styles.brandName}>d<Text style={{ color: O.primary }}>é</Text>clic</Text><Text style={styles.brandSub}>ANGLAIS</Text></View>
            </View>
            {dismissable ? (
              <Animated.View style={{ opacity: closeOpacity }} pointerEvents={canClose ? "auto" : "none"}>
                <Pressable onPress={handleClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Fermer"><OnbIcon name="close" size={20} /></Pressable>
              </Animated.View>
            ) : <View style={{ width: 40 }} />}
          </View>
          {isGift && (
            <View style={styles.giftPill}><OnbIcon name="gift" size={14} tint={O.primary} /><Text style={styles.giftText}>Ton cadeau · expire dans {giftClock}</Text></View>
          )}

          <Text style={styles.h1}>{isGift ? `Ton cadeau : -${giftDiscount} % sur ta 1re année` : "Continue à prendre la parole."}</Text>
          <Text style={styles.sub}>Retrouve {coach.displayName} dans les situations de {where}.</Text>

          {/* Encart coach + promesses */}
          <View style={styles.promise}>
            <Image source={coach.poster} style={styles.promiseAvatar} resizeMode="cover" />
            <View style={{ flex: 1, gap: 8 }}>
              {["Un parcours adapté à ton objectif", "Des conseils sur tes propres phrases", "Des aides quand tu bloques"].map((t) => (
                <View key={t} style={styles.promiseRow}><View style={styles.promiseCheck}><OnbIcon name="check" size={12} tint="#fff" /></View><Text style={styles.promiseText}>{t}</Text></View>
              ))}
            </View>
          </View>

          {/* À suivre */}
          {nextLesson ? (
            <>
              <Text style={styles.nextK}>À suivre : {nextLesson.title.charAt(0).toLowerCase() + nextLesson.title.slice(1)}</Text>
              <View style={styles.nextCard}>
                <Image source={nextImage} style={styles.nextImg} resizeMode="cover" />
                <Text style={styles.nextCaption}>{nextCaption}</Text>
              </View>
            </>
          ) : null}

          {/* Offres */}
          <View style={styles.plans}>
            <Pressable onPress={() => setSelected("yearly")} style={[styles.plan, yearSel && styles.planSel]} accessibilityRole="radio" accessibilityState={{ checked: yearSel }}>
              <View style={styles.planHead}><Text style={styles.planTitle}>Annuel</Text><View style={[styles.radio, yearSel && styles.radioOn]}>{yearSel && <OnbIcon name="check" size={14} tint="#fff" />}</View></View>
              <Text style={styles.planPrice}>{isGift ? giftPrice : price("yearly")}<Text style={styles.planPer}> / an</Text></Text>
              <Text style={styles.planNote}>{isGift ? `puis ${price("yearly")}/an` : yearTrial ? `${yearTrial} jours gratuits` : `Soit environ ${money(yearlyValue / 12)} / mois`}</Text>
            </Pressable>
            {!isGift && (
              <Pressable onPress={() => setSelected("monthly")} style={[styles.plan, monthSel && styles.planSel]} accessibilityRole="radio" accessibilityState={{ checked: monthSel }}>
                <View style={styles.planHead}><Text style={styles.planTitle}>Mensuel</Text><View style={[styles.radio, monthSel && styles.radioOn]}>{monthSel && <OnbIcon name="check" size={14} tint="#fff" />}</View></View>
                <Text style={styles.planPrice}>{price("monthly")}<Text style={styles.planPer}> / mois</Text></Text>
                <Text style={styles.planNote}>{monthIntro ? `${monthIntro.priceString} le 1er mois` : monthTrial ? `${monthTrial} jours offerts` : "Sans engagement"}</Text>
              </Pressable>
            )}
          </View>

          {/* Essai gratuit réel (store) : déroulé + rappel avant la fin */}
          {activeTrial ? (
            <View style={styles.trialCard}>
              {[
                { icon: "check" as const, bg: O.mint, title: "Aujourd'hui", desc: "Accès complet, 0 € prélevé." },
                { icon: "warning" as const, bg: "#FFE4CC", title: `Jour ${Math.max(1, activeTrial - 2)}`, desc: remindTrial ? "On te prévient par notification." : "Fin d'essai dans 2 jours." },
                { icon: "sparkles" as const, bg: O.lavender, title: `Jour ${activeTrial}`, desc: `${selected === "yearly" ? price("yearly") + "/an" : price("monthly") + "/mois"}, sauf si tu résilies avant.` },
              ].map((s, i, arr) => (
                <View key={s.title} style={styles.trialRow}>
                  <View style={{ alignItems: "center" }}>
                    <View style={[styles.trialIcon, { backgroundColor: s.bg }]}><OnbIcon name={s.icon} size={15} /></View>
                    {i < arr.length - 1 && <View style={styles.trialLine} />}
                  </View>
                  <View style={{ flex: 1, paddingBottom: i < arr.length - 1 ? 12 : 0 }}>
                    <Text style={styles.trialTitle}>{s.title}</Text>
                    <Text style={styles.trialDesc}>{s.desc}</Text>
                  </View>
                </View>
              ))}
              <View style={styles.remindRow}>
                <Text style={styles.remindText}>M'avertir avant la fin de l'essai</Text>
                <Switch value={remindTrial} onValueChange={setRemindTrial} trackColor={{ true: O.primary, false: O.border }} thumbColor="#fff" />
              </View>
            </View>
          ) : null}

          <Pressable onPress={buy} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
            {busy ? <ActivityIndicator color={O.ink} /> : <Text style={styles.ctaText}>{ctaLabel}</Text>}
          </Pressable>
          <Text style={styles.legal}>{legalText}</Text>

          <View style={styles.linksRow}>
            <Pressable onPress={restore} disabled={busy} hitSlop={8}><Text style={styles.link}>Restaurer mes achats</Text></Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={8}><Text style={styles.link}>Conditions</Text></Pressable>
              <Text style={styles.link}>·</Text>
              <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={8}><Text style={styles.link}>Confidentialité</Text></Pressable>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: O.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon: { width: 34, height: 34, borderRadius: 10 },
  brandName: { fontSize: 20, fontWeight: "800", color: O.ink, letterSpacing: -0.6, lineHeight: 22 },
  brandSub: { fontSize: 8.5, fontWeight: "800", color: O.muted, letterSpacing: 3 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  giftPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", backgroundColor: "#FFE4CC", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginTop: 10 },
  giftText: { color: O.primary, fontSize: 13, fontWeight: "800" },
  h1: { fontSize: 25, fontWeight: "800", color: O.ink, letterSpacing: -0.5, lineHeight: 31, textAlign: "center", marginTop: 14 },
  sub: { color: O.muted, fontSize: 15, lineHeight: 21, fontWeight: "600", textAlign: "center", marginTop: 6, paddingHorizontal: 10 },
  promise: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: O.navy, borderRadius: 22, padding: 16, marginTop: 18 },
  promiseAvatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: "rgba(255,255,255,0.3)" },
  promiseRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  promiseCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: O.success, alignItems: "center", justifyContent: "center" },
  promiseText: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "700" },
  nextK: { color: O.ink, fontSize: 16, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  nextCard: { backgroundColor: O.surface, borderRadius: 22, padding: 10, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  nextImg: { width: "100%", aspectRatio: 2.4, borderRadius: 16 },
  nextCaption: { color: O.muted, fontSize: 13.5, fontWeight: "600", lineHeight: 19, marginTop: 10, marginHorizontal: 4, marginBottom: 2 },
  plans: { flexDirection: "row", gap: 10, marginTop: 18 },
  plan: { flex: 1, backgroundColor: O.surface, borderRadius: 20, padding: 14, borderWidth: 2, borderColor: "transparent", minWidth: 0 },
  planSel: { borderColor: O.primary, backgroundColor: "#FFF7EE" },
  planHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planTitle: { color: O.ink, fontSize: 15, fontWeight: "800" },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: O.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: O.primary, borderColor: O.primary },
  planPrice: { color: O.ink, fontSize: 22, fontWeight: "800", marginTop: 8, letterSpacing: -0.4 },
  planPer: { color: O.muted, fontSize: 13, fontWeight: "700" },
  planNote: { color: O.muted, fontSize: 12, fontWeight: "600", marginTop: 4 },
  trialCard: { backgroundColor: O.surface, borderRadius: 18, padding: 14, marginTop: 12 },
  trialRow: { flexDirection: "row", gap: 12 },
  trialIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  trialLine: { width: 2, flex: 1, minHeight: 10, backgroundColor: O.border, marginVertical: 3 },
  trialTitle: { color: O.ink, fontSize: 14.5, fontWeight: "800" },
  trialDesc: { color: O.muted, fontSize: 13, lineHeight: 18, marginTop: 1 },
  remindRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: O.border, marginTop: 12, paddingTop: 10 },
  remindText: { color: O.ink, fontSize: 14.5, fontWeight: "700" },
  cta: { backgroundColor: O.primary, borderRadius: O.radiusButton, minHeight: 56, alignItems: "center", justifyContent: "center", marginTop: 16 },
  ctaText: { color: O.ink, fontSize: 17, fontWeight: "800" },
  legal: { color: O.muted, fontSize: 11.5, lineHeight: 16, textAlign: "center", marginTop: 12, paddingHorizontal: 6 },
  linksRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  link: { color: O.muted, fontSize: 12.5, fontWeight: "700", textDecorationLine: "underline" },
});
