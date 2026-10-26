// PaywallScreen — maquette du 23/10 : « Débloque la suite de ton parcours », visuel du coach, prochaine leçon,
// 3 arguments, offres Annuel / Mensuel, CTA. La logique RevenueCat (offres, essai, offre cadeau, achat, restauration) est inchangée.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Animated, Image, Linking, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { configurePurchases } from "../lib/purchases";
import { ENTITLEMENT_ID } from "../lib/entitlement";
import { findGiftOption } from "../lib/giftOffer";
import { logPurchaseStart, logPurchaseComplete, logPurchaseFailed, logPurchaseRestored, logPaywallDismissed } from "../lib/analytics";
import { loadProfile } from "../lib/profile";
import { getLearningPath } from "../lib/learningPath/path";
import { coachForVoice, LessonCoach } from "../lib/learningPath/coaches";
import { L, Icon, IconName } from "../components/lessonUi";

type PlanId = "monthly" | "yearly";

// Prix de secours si le store est injoignable (affichage seulement, l'achat exige le vrai package)
const FALLBACK = { monthly: "9,99 €", yearly: "49,99 €" };
// À renseigner : pages Conditions / Confidentialité
const TERMS_URL = "https://declic-anglais.fr/conditions";
const PRIVACY_URL = "https://declic-anglais.fr/confidentialite";

const ICONS = {
  selected: require("../assets/paywall/ic_paywall_offre_selectionnee_check.png"),
  close: require("../assets/paywall/ic_paywall_fermer.png"),
};

const BENEFITS: { icon: IconName; bg: string; title: string; desc: string }[] = [
  { icon: "niveau", bg: L.accentSoft, title: "Des leçons adaptées à ton niveau", desc: "Un parcours conçu pour toi." },
  { icon: "etoile", bg: L.successSoft, title: "Un coach qui explique et te corrige", desc: "Des explications claires et un retour personnalisé." },
  { icon: "micro", bg: L.lavender, title: "Conversations et exercices quotidiens", desc: "Entraîne-toi sur des situations concrètes." },
];

const GREEN = "#2E9E6B";
// Point de comparaison : un cours particulier d'anglais, ~30 €/h, 1 h par semaine
const PRIVATE_LESSON_PER_MONTH = 120;

// Rappel local avant la fin de l'essai (J-2), si l'utilisateur l'a demandé
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
  planLabel,
  giftOfferId,
  giftExpiresAt,
}: {
  onClose: () => void;
  dismissable?: boolean;
  onPurchased: () => void;
  closeDelayMs?: number; // la croix n'apparaît qu'après ce délai
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
  const [nextLesson, setNextLesson] = useState<{ title: string; sub: string } | null>(null);
  const [remindTrial, setRemindTrial] = useState(true);

  // Coach du profil + prochaine leçon réservée à l'abonnement
  useEffect(() => {
    loadProfile().then((p) => setCoach(coachForVoice(p?.voice))).catch(() => {});
    getLearningPath(false).then((view) => {
      const n = view.nodes.find((x) => x.access === "subscription_required" && x.pedagogical !== "hidden_preview" && x.pedagogical !== "validated");
      if (n) setNextLesson({ title: n.lesson.titleFr, sub: n.variant ? `${n.variant.titleFr} · ${n.variant.targetMinutes} min` : "" });
    }).catch(() => {});
  }, []);

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
  const monthlyValue = numeric("monthly", 9.99);
  const discount = Math.round((1 - yearlyValue / (monthlyValue * 12)) * 100);

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
  // Ancre : combien de fois moins cher qu'un cours particulier (sur la base du prix mensualisé de l'annuel)
  const perMonth = yearlyValue / 12;
  const cheaperFactor = perMonth > 0 ? Math.floor(PRIVATE_LESSON_PER_MONTH / perMonth) : 0;
  const activeTrial = !isGift ? (selected === "yearly" ? yearTrial : monthTrial) : null;

  const ctaLabel = isGift
    ? `Profiter de -${giftDiscount} %`
    : selected === "yearly" && yearTrial ? `Commencer mes ${yearTrial} jours gratuits`
    : selected === "monthly" && monthIntro ? `Commencer à ${monthIntro.priceString}`
    : "Débloquer mon parcours";

  const legalText = isGift
    ? `${giftPrice} pour la 1re année, puis ${price("yearly")}/an, renouvellement automatique. Résiliation depuis Google Play. Offre valable uniquement sur cet écran.`
    : selected === "yearly"
    ? yearTrial
      ? `0 € aujourd'hui. ${yearTrial} jours gratuits, puis ${price("yearly")}/an. Renouvellement automatique. Résiliation depuis Google Play.`
      : `${price("yearly")} aujourd'hui, puis par an. Renouvellement automatique. Résiliation depuis Google Play.`
    : monthIntro
    ? `${monthIntro.priceString} le premier mois, puis ${price("monthly")}/mois. Renouvellement automatique. Résiliation depuis Google Play.`
    : `${price("monthly")} aujourd'hui, puis par mois. Renouvellement automatique. Résiliation depuis Google Play.`;

  return (
    <View style={styles.container}>
      {!loaded ? (
        <View style={styles.loading}><ActivityIndicator color={L.primary} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
          {/* Bandeau + fermer */}
          <View style={styles.topRow}>
            {isGift ? (
              <View style={[styles.pill, { backgroundColor: L.accentSoft }]}>
                <MaterialCommunityIcons name="gift-outline" size={14} color={L.accentDeep} />
                <Text style={[styles.pillText, { color: L.accentDeep }]}>Ton cadeau · expire dans {giftClock}</Text>
              </View>
            ) : (
              <View style={styles.pill}>
                <Icon name="etoile" size={14} tint={GREEN} />
                <Text style={styles.pillText}>Une étape de plus !</Text>
              </View>
            )}
            {dismissable && (
              <Animated.View style={{ opacity: closeOpacity }} pointerEvents={canClose ? "auto" : "none"}>
                <Pressable onPress={handleClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Fermer">
                  <Image source={ICONS.close} style={styles.closeIcon} />
                </Pressable>
              </Animated.View>
            )}
          </View>

          {/* Titre + visuel du coach */}
          <View style={styles.heroRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.h1}>{isGift ? `Ton cadeau : -${giftDiscount} % sur ta 1re année` : "Débloque la suite de ton parcours"}</Text>
              <Text style={styles.sub}>Progresse à ton rythme, avec {coach.displayName}.</Text>
              {!isGift && cheaperFactor >= 2 && (
                <Text style={styles.anchor}>{money(perMonth)}/mois, soit {cheaperFactor} fois moins cher qu'un cours particulier.</Text>
              )}
            </View>
            <Image source={coach.paywall} style={styles.hero} resizeMode="contain" />
          </View>

          {/* Prochaine leçon (si une leçon est réservée à l'abonnement) */}
          <View style={styles.nextCard}>
            <View style={styles.nextIcon}><Icon name="cadenas" size={22} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextK}>{nextLesson ? "TA PROCHAINE LEÇON" : "TOUT DÉCLIC ANGLAIS"}</Text>
              <Text style={styles.nextTitle}>{nextLesson ? nextLesson.title : "Sans limite"}</Text>
              {nextLesson?.sub ? <Text style={styles.nextSub}>{nextLesson.sub}</Text> : !nextLesson ? <Text style={styles.nextSub}>Leçons, scènes, point du jour, exercices.</Text> : null}
            </View>
          </View>

          {/* Arguments */}
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefitRow}>
              <View style={[styles.benefitIconBox, { backgroundColor: b.bg }]}><Icon name={b.icon} size={22} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}

          {/* Annuel */}
          <Pressable onPress={() => setSelected("yearly")} style={[styles.plan, yearSel && styles.planSel]} accessibilityRole="button" accessibilityState={{ selected: yearSel }}>
            {(isGift ? giftDiscount : discount) > 0 && (
              <View style={styles.discountPill}><Text style={styles.discountText}>−{isGift ? giftDiscount : discount} %</Text></View>
            )}
            {yearSel ? <Image source={ICONS.selected} style={styles.checkIcon} /> : <View style={styles.radio} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>Annuel</Text>
              <Text style={styles.planNote}>
                {isGift ? `${giftPrice} la 1re année, puis ${price("yearly")}/an` : yearTrial ? `${yearTrial} jours gratuits · soit ${money(yearlyValue / 12)}/mois` : `Soit ${money(yearlyValue / 12)}/mois`}
              </Text>
            </View>
            <Text style={styles.planPrice}>{isGift ? giftPrice : price("yearly")}<Text style={styles.planPer}>/an</Text></Text>
          </Pressable>

          {/* Mensuel (masqué en mode cadeau) */}
          {!isGift && (
            <Pressable onPress={() => setSelected("monthly")} style={[styles.plan, monthSel && styles.planSel]} accessibilityRole="button" accessibilityState={{ selected: monthSel }}>
              {monthSel ? <Image source={ICONS.selected} style={styles.checkIcon} /> : <View style={styles.radio} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>Mensuel</Text>
                {(monthIntro || monthTrial) ? <Text style={styles.planNote}>{monthIntro ? `${monthIntro.priceString} le 1er mois` : `${monthTrial} jours offerts`}</Text> : null}
              </View>
              <Text style={styles.planPrice}>{price("monthly")}<Text style={styles.planPer}>/mois</Text></Text>
            </Pressable>
          )}

          {/* Essai gratuit : comment ça se passe + rappel avant la fin */}
          {activeTrial ? (
            <View style={styles.trialCard}>
              {[
                { icon: "check" as IconName, bg: L.successSoft, title: "Aujourd'hui", desc: `Accès complet, 0 € prélevé.` },
                { icon: "attention" as IconName, bg: L.accentSoft, title: `Jour ${Math.max(1, activeTrial - 2)}`, desc: remindTrial ? "On te prévient par notification." : "Fin d'essai dans 2 jours." },
                { icon: "etoile" as IconName, bg: L.lavender, title: `Jour ${activeTrial}`, desc: `${selected === "yearly" ? price("yearly") + "/an" : price("monthly") + "/mois"}, sauf si tu résilies avant.` },
              ].map((s, i, arr) => (
                <View key={s.title} style={styles.trialRow}>
                  <View style={{ alignItems: "center" }}>
                    <View style={[styles.trialIcon, { backgroundColor: s.bg }]}><Icon name={s.icon} size={16} /></View>
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
                <Switch value={remindTrial} onValueChange={setRemindTrial} trackColor={{ true: L.accentDeep, false: L.border }} thumbColor="#fff" />
              </View>
            </View>
          ) : null}

          <Text style={styles.legal}>{legalText}</Text>

          <Pressable onPress={buy} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : (
              <View style={styles.ctaRow}>
                <Text style={styles.ctaText}>{ctaLabel}</Text>
                <Icon name="fleche" size={18} tint="#fff" />
              </View>
            )}
          </Pressable>

          <Pressable onPress={restore} disabled={busy} hitSlop={8} style={{ alignSelf: "center", marginTop: 14 }}>
            <Text style={styles.restore}>Restaurer mes achats</Text>
          </Pressable>
          <View style={styles.linksRow}>
            <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={8}><Text style={styles.link}>Conditions</Text></Pressable>
            <Text style={styles.linkDot}>·</Text>
            <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={8}><Text style={styles.link}>Confidentialité</Text></Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: L.successSoft, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  pillText: { color: GREEN, fontSize: 13, fontWeight: "800" },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: L.surface, alignItems: "center", justifyContent: "center" },
  closeIcon: { width: 16, height: 16 },

  heroRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 10 },
  h1: { fontSize: 27, fontWeight: "800", color: L.textPrimary, letterSpacing: -0.5, lineHeight: 32 },
  sub: { color: L.textSecondary, fontSize: 14.5, lineHeight: 20, marginTop: 6 },
  hero: { width: 132, height: 128, marginTop: -8, marginRight: -10 },

  nextCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 20, padding: 14, marginTop: 10, marginBottom: 14, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  nextIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: L.lavender, alignItems: "center", justifyContent: "center" },
  nextK: { color: L.accentDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  nextTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "800", marginTop: 2 },
  nextSub: { color: L.textSecondary, fontSize: 13, marginTop: 2 },

  benefitRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  benefitIconBox: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  benefitTitle: { color: L.textPrimary, fontSize: 15, fontWeight: "800" },
  benefitDesc: { color: L.textSecondary, fontSize: 13, marginTop: 1 },

  plan: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 18, padding: 14, marginTop: 10, borderWidth: 2, borderColor: "transparent" },
  planSel: { borderColor: L.accentDeep, backgroundColor: "#FFF4EA" },
  discountPill: { position: "absolute", top: -10, right: 14, backgroundColor: L.accentDeep, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 9 },
  discountText: { color: "#fff", fontSize: 11.5, fontWeight: "800" },
  planTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "800" },
  planNote: { color: L.textSecondary, fontSize: 12.5, marginTop: 2 },
  planPrice: { color: L.textPrimary, fontSize: 17, fontWeight: "800" },
  planPer: { color: L.textSecondary, fontSize: 13, fontWeight: "700" },
  checkIcon: { width: 24, height: 24 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: L.border },

  anchor: { color: L.accentDeep, fontSize: 13.5, fontWeight: "800", lineHeight: 19, marginTop: 8 },
  trialCard: { backgroundColor: L.surface, borderRadius: 18, padding: 14, marginTop: 12 },
  trialRow: { flexDirection: "row", gap: 12 },
  trialIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  trialLine: { width: 2, flex: 1, minHeight: 10, backgroundColor: L.border, marginVertical: 3 },
  trialTitle: { color: L.textPrimary, fontSize: 14.5, fontWeight: "800" },
  trialDesc: { color: L.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 1 },
  remindRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: L.border, marginTop: 12, paddingTop: 10 },
  remindText: { color: L.textPrimary, fontSize: 14.5, fontWeight: "700" },
  legal: { color: L.textSecondary, fontSize: 11.5, lineHeight: 16, textAlign: "center", marginTop: 14 },
  cta: { backgroundColor: L.accentDeep, borderRadius: 18, padding: 18, alignItems: "center", minHeight: 56, justifyContent: "center", marginTop: 12 },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  restore: { color: L.textSecondary, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
  linksRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 10 },
  link: { color: L.textSecondary, fontSize: 12.5, fontWeight: "600" },
  linkDot: { color: L.textSecondary },
});
