import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Animated, Easing, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { T } from "../lib/theme";
import { configurePurchases } from "../lib/purchases";
import { ENTITLEMENT_ID } from "../lib/entitlement";
import { findGiftOption } from "../lib/giftOffer";
import { logPurchaseStart, logPurchaseComplete, logPurchaseFailed, logPurchaseRestored, logPaywallDismissed } from "../lib/analytics";

type PlanId = "monthly" | "yearly";

// Prix de secours si le store est injoignable (affichage seulement, l'achat exige le vrai package)
const FALLBACK = { monthly: "19,99 €", yearly: "49,99 €" };

const ICONS = {
  conversations: require("../assets/paywall/ic_paywall_conversations_illimitees.png"),
  correction: require("../assets/paywall/ic_paywall_correction_chaque_phrase.png"),
  labo: require("../assets/paywall/ic_paywall_labo_prononciation.png"),
  defis: require("../assets/paywall/ic_paywall_defis_quotidiens.png"),
  today: require("../assets/paywall/ic_paywall_timeline_aujourdhui_acces.png"),
  reminder: require("../assets/paywall/ic_paywall_timeline_jour5_rappel.png"),
  billing: require("../assets/paywall/ic_paywall_timeline_jour7_abonnement.png"),
  planReady: require("../assets/paywall/ic_paywall_plan_pret_check.png"),
  selected: require("../assets/paywall/ic_paywall_offre_selectionnee_check.png"),
  close: require("../assets/paywall/ic_paywall_fermer.png"),
  shield: require("../assets/paywall/ic_paywall_annulation_garantie.png"),
};

const BENEFITS = [
  { icon: ICONS.conversations, title: "Conversations illimitées", desc: "Toutes les scènes, et même la tienne" },
  { icon: ICONS.correction, title: "Corrigé à chaque phrase", desc: "Avec la bonne version à écouter" },
  { icon: ICONS.labo, title: "Labo de prononciation", desc: "Tes mots difficiles, un par un" },
  { icon: ICONS.defis, title: "3 défis chaque jour", desc: "Lecture, traduction, écoute" },
];

const GREEN = "#2E9E6B";

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

// Nombre de jours d'essai gratuit disponible pour ce package (ou null si aucun).
function trialDaysFor(pkg: PurchasesPackage | null): number | null {
  if (!pkg) return null;
  const product: any = pkg.product;

  // 1 — introductoryPrice (surtout iOS, parfois renseigné ailleurs)
  const intro = product?.introductoryPrice;
  if (intro && (intro.price === 0 || intro.amountMicros === 0 || intro.priceString === "0")) {
    const d = periodUnitToDays(intro.periodNumberOfUnits, intro.periodUnit) ?? iso8601ToDays(intro.period);
    if (d) return d;
  }

  // 2 — Android : subscriptionOptions → phase de prix gratuite (amountMicros === 0)
  const opts = product?.subscriptionOptions;
  if (Array.isArray(opts)) {
    for (const o of opts) {
      const phases = o?.pricingPhases ?? [];
      const free = phases.find((ph: any) => {
        const micros = ph?.price?.amountMicros;
        return micros === 0 || micros === "0";
      });
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
  planLabel?: string; // ex. "A2 → B2" : affiche le badge « Ton plan … est prêt »
  giftOfferId?: string; // offre Play « developer determined » (ex. "cadeau-50") : mode cadeau, annuel seul
  giftExpiresAt?: number; // fin de l'offre cadeau (timestamp ms) : compte à rebours, puis retour au paywall classique
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<PlanId>("yearly");
  const [pkgs, setPkgs] = useState<Record<PlanId, PurchasesPackage | null>>({ monthly: null, yearly: null });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false); // offres (et essai gratuit) récupérées
  const [now, setNow] = useState(Date.now());

  // Compte à rebours de l'offre cadeau
  useEffect(() => {
    if (!giftExpiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [giftExpiresAt]);

  // Croix : apparition en fondu après closeDelayMs
  const [canClose, setCanClose] = useState(closeDelayMs <= 0);
  const closeOpacity = useRef(new Animated.Value(closeDelayMs <= 0 ? 1 : 0)).current;
  useEffect(() => {
    if (closeDelayMs <= 0) return;
    const t = setTimeout(() => {
      setCanClose(true);
      Animated.timing(closeOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }, closeDelayMs);
    return () => clearTimeout(t);
  }, [closeDelayMs, closeOpacity]);

  // Timeline : les 3 pastilles sont grisées, puis se colorent et gonflent l'une après l'autre
  const steps = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!loaded) return;
    Animated.sequence([
      Animated.delay(500),
      Animated.stagger(
        1000,
        steps.map((v) => Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }))
      ),
    ]).start();
  }, [steps, loaded]);

  // Badge « 7 jours gratuits » : légère respiration
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [breath]);
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });

  useEffect(() => {
    // Filet de sécurité : si le store ne répond pas, on affiche quand même (prix de secours) au bout de 5 s
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
  const trialDays = (id: PlanId) => trialDaysFor(pkgs[id]);
  const perLabel = (id: PlanId) => (id === "yearly" ? "/an" : "/mois");
  const selTrial = trialDays(selected);
  const yearTrial = trialDays("yearly");
  const monthTrial = trialDays("monthly");

  // Prix numériques (repli sur les prix de secours si le store est injoignable)
  const numeric = (id: PlanId, fallback: number) => {
    const p: any = pkgs[id]?.product;
    return typeof p?.price === "number" ? p.price : fallback;
  };
  const currency = ((pkgs.yearly?.product as any)?.currencyCode as string) ?? "EUR";
  const money = (v: number) => {
    try {
      return v.toLocaleString("fr-FR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return `${v.toFixed(2)} €`;
    }
  };
  const yearlyValue = numeric("yearly", 49.99);
  const monthlyValue = numeric("monthly", 19.99);
  const discount = Math.round((1 - yearlyValue / (monthlyValue * 12)) * 100);

  // — Mode cadeau : offre réduite sur l'annuel, trouvée par son identifiant d'offre Play ou son tag —
  const yearlyOptions: any[] = (pkgs.yearly?.product as any)?.subscriptionOptions ?? [];
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

  // Diagnostic temporaire : liste des offres annuelles vues par l'app (à retirer une fois l'offre cadeau validée)
  useEffect(() => {
    if (!giftOfferId || !loaded) return;
    console.log("[cadeau] offres annuelles :", JSON.stringify(yearlyOptions.map((o) => ({ id: o?.id, tags: o?.tags }))));
  }, [giftOfferId, loaded]);

  // Fermer en mode cadeau = renoncer définitivement à l'offre : on le dit clairement
  // En mode cadeau, fermer ne fait pas perdre l'offre : elle reste accessible depuis l'icône cadeau de l'accueil
  const handleClose = () => {
    logPaywallDismissed(isGift ? "gift" : undefined);
    onClose();
  };

  const buy = async () => {
    const pkg = pkgs[selected];
    if (!pkg) {
      Alert.alert("Connexion au store impossible", "Vérifie ta connexion internet et réessaie dans un instant.");
      return;
    }
    setBusy(true);
    // Identifiant de l'option achetée : l'offre cadeau, ou l'option par défaut du produit
    const offerId: string | undefined = isGift ? giftOption?.id : (pkg.product as any)?.defaultOption?.id;
    const base = { gift: isGift, offerId };
    logPurchaseStart(selected, base);
    try {
      const { customerInfo } = isGift
        ? await Purchases.purchaseSubscriptionOption(giftOption)
        : await Purchases.purchasePackage(pkg);
      const ent = customerInfo.entitlements.active[ENTITLEMENT_ID];
      if (ent) {
        logPurchaseComplete(selected, { ...base, sandbox: !!(ent as any).isSandbox });
        onPurchased();
      } else {
        // Achat terminé côté store mais abonnement non activé : sans ce log, rien n'était enregistré
        logPurchaseFailed(selected, "entitlement_inactive", base);
      }
    } catch (e: any) {
      logPurchaseFailed(selected, e.userCancelled ? "user_cancelled" : (e.message ?? String(e)), {
        ...base,
        errorCode: e.readableErrorCode ?? (e.code !== undefined ? String(e.code) : undefined),
        errorDetail: e.underlyingErrorMessage,
      });
      if (!e.userCancelled) Alert.alert("Achat impossible", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const info = await Purchases.restorePurchases();
      if (info.entitlements.active[ENTITLEMENT_ID]) { logPurchaseRestored(); onPurchased(); }
      else Alert.alert("Aucun achat trouvé", "Aucun abonnement actif n'est associé à ton compte Google.");
    } catch (e: any) {
      Alert.alert("Restauration impossible", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const timeline = yearTrial
    ? [
        { icon: ICONS.today, bg: T.abricot, title: "Aujourd'hui", text: "Accès complet, 0 €" },
        { icon: ICONS.reminder, bg: T.miel, title: `Jour ${Math.max(1, yearTrial - 2)}`, text: "On te prévient par notification" },
        { icon: ICONS.billing, bg: T.chipAbricot, title: `Jour ${yearTrial}`, text: "Début de l'abonnement, sauf si tu annules" },
      ]
    : null;

  const yearSel = isGift || selected === "yearly";
  const showTrial = isGift ? null : selTrial;
  const monthSel = selected === "monthly";

  return (
    <View style={styles.container}>
      {dismissable && (
        <Animated.View style={[styles.closeWrap, { top: insets.top + 14, opacity: closeOpacity }]} pointerEvents={canClose ? "auto" : "none"}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.close}>
            <Image source={ICONS.close} style={styles.closeIcon} />
          </Pressable>
        </Animated.View>
      )}

      {!loaded ? (
        <View style={styles.loading}>
          <ActivityIndicator color={T.abricot} size="large" />
        </View>
      ) : (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 22, paddingBottom: insets.bottom + 20 }}>
        {isGift ? (
          <View style={[styles.planReady, styles.giftBadge]}>
            <MaterialCommunityIcons name="gift-outline" size={15} color={T.abricotDeep} />
            <Text style={[styles.planReadyText, { color: T.abricotDeep }]}>Ton cadeau · expire dans {giftClock}</Text>
          </View>
        ) : planLabel ? (
          <View style={styles.planReady}>
            <Image source={ICONS.planReady} style={styles.planReadyIcon} />
            <Text style={styles.planReadyText}>Ton plan {planLabel} est prêt</Text>
          </View>
        ) : null}

        <Text style={styles.h1}>{isGift ? "Ton cadeau :" : yearTrial ? "Essaie Déclic" : "Passe à Déclic"}</Text>
        <Text style={[styles.h1, { color: T.abricotDeep }]}>
          {isGift ? `-${giftDiscount} % sur ta 1re année.` : yearTrial ? `${yearTrial} jours gratuits.` : "en illimité."}
        </Text>

        <View style={{ marginTop: 18 }}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefitRow}>
              <View style={styles.benefitIconBox}>
                <Image source={b.icon} style={styles.benefitIcon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {timeline && !isGift && (
          <View style={styles.howCard}>
            <Text style={styles.howK}>COMMENT ÇA MARCHE</Text>
            {timeline.map((t, i) => {
              const v = steps[i];
              const last = i === timeline.length - 1;
              return (
                <View key={t.title} style={styles.tlRow}>
                  <View style={styles.tlLeft}>
                    <Animated.View style={[styles.tlDotWrap, { transform: [{ scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.18, 1] }) }] }]}>
                      <View style={[styles.tlDot, styles.tlDotOff]}>
                        <Image source={t.icon} style={[styles.tlIcon, { tintColor: "#B9B0A6" }]} />
                      </View>
                      <Animated.View style={[styles.tlDot, styles.tlDotOn, { backgroundColor: t.bg, opacity: v }]}>
                        <Image source={t.icon} style={styles.tlIcon} />
                      </Animated.View>
                    </Animated.View>
                    {!last && (
                      <View style={styles.tlLine}>
                        <Animated.View style={[styles.tlLineFill, { opacity: steps[i + 1] }]} />
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tlText, !last && { paddingBottom: 22 }]}>
                    <Text style={styles.tlTitle}>{t.title}</Text> · {t.text}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Annuel */}
        <Pressable onPress={() => setSelected("yearly")} style={[styles.plan, styles.planYearly, yearSel && styles.planSel]}>
          <Animated.View style={[styles.trialPill, { transform: [{ scale: breathScale }] }]}>
            <Text style={styles.trialPillText}>{isGift ? "OFFRE CADEAU" : yearTrial ? `${yearTrial} JOURS GRATUITS` : "LE PLUS POPULAIRE"}</Text>
          </Animated.View>
          {(isGift ? giftDiscount : discount) > 0 && (
            <View style={styles.discountPill}>
              <Text style={styles.discountText}>-{isGift ? giftDiscount : discount} %</Text>
            </View>
          )}
          <View style={styles.planRow}>
            <Text style={styles.planTitle}>Annuel</Text>
            {yearSel ? <Image source={ICONS.selected} style={styles.checkIcon} /> : <View style={styles.radio} />}
          </View>
          <View style={styles.yearlyPriceRow}>
            <Text style={styles.yearlyBigPrice}>{money((isGift ? giftValue : yearlyValue) / 12)}</Text>
            <Text style={styles.yearlyBigPer}>/mois</Text>
          </View>
          {isGift ? (
            <Text style={styles.planNote}>
              {giftPrice} la 1re année au lieu de <Text style={styles.strike}>{price("yearly")}</Text>, puis {price("yearly")} par an
            </Text>
          ) : (
            <Text style={styles.planNote}>
              {yearTrial ? `0 € pendant ${yearTrial} jours, puis ${price("yearly")} par an` : `Soit ${price("yearly")} par an, facturé en une fois`}
            </Text>
          )}
        </Pressable>

        {/* Mensuel (masqué en mode cadeau) */}
        {!isGift && (
        <Pressable onPress={() => setSelected("monthly")} style={[styles.plan, monthSel && styles.planSel]}>
          <View style={styles.planRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>Mensuel</Text>
              <Text style={styles.planNote}>{monthTrial ? `${monthTrial} jours offerts` : "Sans essai gratuit"}</Text>
            </View>
            <Text style={styles.planPrice}>{price("monthly")}<Text style={styles.planPer}>/mois</Text></Text>
            {monthSel ? <Image source={ICONS.selected} style={styles.checkIcon} /> : <View style={styles.radio} />}
          </View>
        </Pressable>
        )}

        <Text style={styles.legal}>
          {isGift
            ? `${giftPrice} pour la 1re année, puis ${price("yearly")}/an, renouvellement automatique. Annulable à tout moment dans le Play Store. Offre valable uniquement sur cet écran.`
            : showTrial
            ? `${selTrial} jours gratuits, puis ${price(selected)}${perLabel(selected)}, renouvellement automatique. Annule à tout moment dans le Play Store : si tu annules pendant l'essai, tu ne paieras rien.`
            : yearSel
            ? "Abonnement renouvelé automatiquement chaque année. Annulable à tout moment dans le Play Store, en un clic."
            : "Abonnement renouvelé automatiquement chaque mois. Annulable à tout moment dans le Play Store, en un clic."}
        </Text>

        <View style={styles.bottomBar}>
        <Pressable onPress={buy} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={T.night} /> : (
            <Text style={styles.ctaText}>{isGift ? `Profiter de -${giftDiscount} %` : showTrial ? `Commencer mes ${selTrial} jours gratuits` : "S'abonner"}</Text>
          )}
        </Pressable>
        <View style={styles.guarantee}>
          <Image source={ICONS.shield} style={styles.guaranteeIcon} />
          <Text style={styles.guaranteeText}>
            {isGift ? "Offre unique · Annulable en 1 clic sur Google Play" : showTrial ? "0 € aujourd'hui · Annulable en 1 clic sur Google Play" : "Annulable en 1 clic sur Google Play"}
          </Text>
        </View>
        <Pressable onPress={restore} disabled={busy} hitSlop={8} style={{ marginTop: 4 }}>
          <Text style={styles.restore}>Restaurer mes achats</Text>
        </Pressable>
        </View>
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  closeWrap: { position: "absolute", right: 18, zIndex: 10 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#EFE6DC", alignItems: "center", justifyContent: "center" },
  closeIcon: { width: 16, height: 16 },

  planReady: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "#DDF3E7", borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 18 },
  planReadyIcon: { width: 14, height: 14 },
  giftBadge: { backgroundColor: T.chipAbricot },
  strike: { textDecorationLine: "line-through" },
  planReadyText: { color: GREEN, fontSize: 13, fontWeight: "800" },

  h1: { fontSize: 29, fontWeight: "800", color: T.night, letterSpacing: -0.6, lineHeight: 34 },

  benefitRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  benefitIconBox: { width: 38, height: 38, borderRadius: 11, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  benefitIcon: { width: 20, height: 20 },
  benefitTitle: { color: T.night, fontSize: 15, fontWeight: "800" },
  benefitDesc: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600", marginTop: 1 },

  howCard: { backgroundColor: T.card, borderRadius: 22, padding: 18, marginTop: 8, marginBottom: 18 },
  howK: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 14 },
  tlRow: { flexDirection: "row", gap: 12 },
  tlLeft: { alignItems: "center", width: 30 },
  tlDotWrap: { width: 30, height: 30 },
  tlDot: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  tlDotOff: { backgroundColor: "#EFE9E3" },
  tlDotOn: { position: "absolute", top: 0, left: 0 },
  tlIcon: { width: 16, height: 16 },
  tlLine: { flex: 1, width: 3, borderRadius: 2, backgroundColor: "#EFE9E3", marginVertical: 3, overflow: "hidden" },
  tlLineFill: { flex: 1, backgroundColor: T.abricot, opacity: 0.5 },
  tlText: { flex: 1, color: T.inkSoft, fontSize: 13.5, fontWeight: "600", lineHeight: 20, paddingTop: 5 },
  tlTitle: { color: T.night, fontWeight: "800" },

  plan: { backgroundColor: T.card, borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 2, borderColor: "transparent" },
  planYearly: { paddingTop: 22, marginTop: 12 },
  planSel: { borderColor: T.abricot },
  trialPill: { position: "absolute", top: -13, left: 14, backgroundColor: T.night, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10 },
  trialPillText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  discountPill: { position: "absolute", top: -11, right: 14, backgroundColor: "#7ED3A4", borderRadius: 10, paddingVertical: 3, paddingHorizontal: 9 },
  discountText: { color: T.night, fontSize: 11.5, fontWeight: "800" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "space-between" },
  planTitle: { color: T.night, fontSize: 17, fontWeight: "800" },
  yearlyPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 4 },
  yearlyBigPrice: { color: T.night, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  yearlyBigPer: { color: T.inkSoft, fontSize: 15, fontWeight: "700" },
  planNote: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600", marginTop: 4 },
  planPrice: { color: T.night, fontSize: 17, fontWeight: "800" },
  planPer: { color: T.inkSoft, fontSize: 12.5, fontWeight: "700" },
  checkIcon: { width: 24, height: 24 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: T.creamLine },

  legal: { color: T.inkSoft, fontSize: 11.5, fontWeight: "600", lineHeight: 16, marginTop: 2 },
  restore: { color: T.inkSoft, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },

  bottomBar: { marginTop: 20, alignItems: "center", gap: 12 },
  cta: { backgroundColor: T.abricot, borderRadius: 18, padding: 18, alignItems: "center", alignSelf: "stretch", minHeight: 56, justifyContent: "center" },
  ctaText: { color: T.night, fontSize: 16.5, fontWeight: "800" },
  guarantee: { flexDirection: "row", alignItems: "center", gap: 6 },
  guaranteeIcon: { width: 14, height: 14 },
  guaranteeText: { color: GREEN, fontSize: 12.5, fontWeight: "800" },
});
