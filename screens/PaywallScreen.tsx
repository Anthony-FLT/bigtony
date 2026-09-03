import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { T } from "../lib/theme";
import { configurePurchases } from "../lib/purchases";
import { ENTITLEMENT_ID } from "../lib/entitlement";

type PlanId = "weekly" | "monthly" | "yearly";

// Prix de secours si le store est injoignable (affichage seulement, l'achat exige le vrai package)
const FALLBACK = { weekly: "4,99 €", monthly: "19,99 €", yearly: "99,99 €" };

const BENEFITS = [
  "Discussions à thème illimitées, dans toutes les situations",
  "Ta propre scène : décris-la, on la joue",
  "Tes mots favoris, gardés et travaillés",
  "Discussion du jour et Labo à volonté",
];

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
}: {
  onClose: () => void;
  dismissable?: boolean;
  onPurchased: () => void;
}) {
  const [selected, setSelected] = useState<PlanId>("yearly");
  const [pkgs, setPkgs] = useState<Record<PlanId, PurchasesPackage | null>>({ weekly: null, monthly: null, yearly: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        configurePurchases();
        const offerings = await Purchases.getOfferings();
        const av = offerings.current?.availablePackages ?? [];
       
        const find = (t: string) => av.find((p) => p.packageType === t) ?? null;
        setPkgs({ yearly: find("ANNUAL"), monthly: find("MONTHLY"), weekly: find("WEEKLY") });
      } catch (e) {
        console.warn("getOfferings échoué:", e);
      }
    })();
  }, []);

  const price = (id: PlanId) => pkgs[id]?.product.priceString ?? FALLBACK[id];
  const trialDays = (id: PlanId) => trialDaysFor(pkgs[id]);
  const perLabel = (id: PlanId) => (id === "yearly" ? "/an" : id === "weekly" ? "/semaine" : "/mois");
  const selTrial = trialDays(selected);

  const buy = async () => {
    const pkg = pkgs[selected];
    if (!pkg) {
      Alert.alert("Connexion au store impossible", "Vérifie ta connexion internet et réessaie dans un instant.");
      return;
    }
    setBusy(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) onPurchased();
    } catch (e: any) {
      if (!e.userCancelled) Alert.alert("Achat impossible", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const info = await Purchases.restorePurchases();
      if (info.entitlements.active[ENTITLEMENT_ID]) onPurchased();
      else Alert.alert("Aucun achat trouvé", "Aucun abonnement actif n'est associé à ton compte Google.");
    } catch (e: any) {
      Alert.alert("Restauration impossible", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const PLANS: { id: PlanId; title: string; per: string; note?: string; badge?: string }[] = [
    { id: "yearly", title: "Annuel", per: "/an", note: "soit 8,33 €/mois", badge: "LE PLUS POPULAIRE · −58 %" },
    { id: "monthly", title: "Mensuel", per: "/mois" },
    { id: "weekly", title: "Hebdo", per: "/semaine", note: "Sans engagement, pour essayer" },
  ];

  return (
    <View style={styles.container}>
      {dismissable && (
        <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
          <Feather name="x" size={22} color={T.night} />
        </Pressable>
      )}

      <ScrollView contentContainerStyle={{ padding: 26, paddingTop: 70, paddingBottom: 150 }}>
        <Text style={styles.k}>PASSE EN ILLIMITÉ</Text>
        <Text style={styles.h1}>Ton anglais mérite{"\n"}un vrai coach.</Text>

        <View style={{ marginTop: 18, marginBottom: 22 }}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Feather name="check" size={16} color={T.menthe} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {PLANS.map((p) => {
          const isSel = selected === p.id;
          const td = trialDays(p.id);
          const note = [td ? `${td} jours offerts` : null, p.note].filter(Boolean).join(" · ");
          return (
            <Pressable key={p.id} onPress={() => setSelected(p.id)} style={[styles.plan, isSel && styles.planSel]}>
              {p.badge && <View style={styles.badge}><Text style={styles.badgeText}>{p.badge}</Text></View>}
              <View style={styles.planRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planTitle}>{p.title}</Text>
                  {note ? <Text style={styles.planNote}>{note}</Text> : null}
                </View>
                <Text style={styles.planPrice}>{price(p.id)}<Text style={styles.planPer}>{p.per}</Text></Text>
                <View style={[styles.radio, isSel && styles.radioSel]}>
                  {isSel && <Feather name="check" size={13} color={T.night} />}
                </View>
              </View>
            </Pressable>
          );
        })}

        <Text style={styles.legal}>
          {selTrial
            ? `${selTrial} jours gratuits, puis ${price(selected)}${perLabel(selected)}, renouvellement automatique. Annule à tout moment dans le Play Store : si tu annules pendant l'essai, tu ne paieras rien.`
            : selected === "yearly"
            ? "Abonnement renouvelé automatiquement chaque année. Annulable à tout moment dans le Play Store, en un clic."
            : `Abonnement renouvelé automatiquement (${selected === "weekly" ? "chaque semaine" : "chaque mois"}). Annulable à tout moment dans le Play Store, en un clic.`}
        </Text>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable onPress={buy} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={T.night} /> : (
            <Text style={styles.ctaText}>{selTrial ? `Commencer mes ${selTrial} jours gratuits` : selected === "yearly" ? "S'abonner" : "Continuer"}</Text>
          )}
        </Pressable>
        <Pressable onPress={restore} disabled={busy} hitSlop={8}>
          <Text style={styles.restore}>Restaurer mes achats</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  close: { position: "absolute", top: 52, right: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: T.card, alignItems: "center", justifyContent: "center" },
  k: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  h1: { fontSize: 27, fontWeight: "800", color: T.night, letterSpacing: -0.5, lineHeight: 33, marginTop: 8 },
  benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 9 },
  benefitText: { color: T.night, fontSize: 14.5, fontWeight: "600", lineHeight: 20, flex: 1 },
  plan: { backgroundColor: T.card, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 2, borderColor: "transparent" },
  planSel: { borderColor: T.abricot },
  badge: { alignSelf: "flex-start", backgroundColor: T.abricot, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8, marginBottom: 8 },
  badgeText: { color: T.night, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  planTitle: { color: T.night, fontSize: 17, fontWeight: "800" },
  planNote: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600", marginTop: 2 },
  planPrice: { color: T.night, fontSize: 19, fontWeight: "800" },
  planPer: { color: T.inkSoft, fontSize: 13, fontWeight: "700" },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: T.creamLine, alignItems: "center", justifyContent: "center" },
  radioSel: { backgroundColor: T.abricot, borderColor: T.abricot },
  legal: { color: T.inkSoft, fontSize: 12, fontWeight: "600", lineHeight: 17, marginTop: 6 },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: T.cream, paddingHorizontal: 26, paddingBottom: 28, paddingTop: 10, alignItems: "center", gap: 12 },
  cta: { backgroundColor: T.abricot, borderRadius: 16, padding: 17, alignItems: "center", alignSelf: "stretch", minHeight: 55, justifyContent: "center" },
  ctaText: { color: T.night, fontSize: 16, fontWeight: "800" },
  restore: { color: T.inkSoft, fontSize: 13, fontWeight: "700" },
});