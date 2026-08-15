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
    { id: "yearly", title: "Annuel", per: "/an", note: "3 jours gratuits · soit 8,33 €/mois", badge: "LE PLUS POPULAIRE · −58 %" },
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
        <Text style={styles.h1}>Ton anglais mérite mieux{"\n"}que trois jours.</Text>

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
          return (
            <Pressable key={p.id} onPress={() => setSelected(p.id)} style={[styles.plan, isSel && styles.planSel]}>
              {p.badge && <View style={styles.badge}><Text style={styles.badgeText}>{p.badge}</Text></View>}
              <View style={styles.planRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planTitle}>{p.title}</Text>
                  {p.note ? <Text style={styles.planNote}>{p.note}</Text> : null}
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
          {selected === "yearly"
            ? "3 jours d'essai gratuit, puis abonnement renouvelé automatiquement chaque année. Annule pendant l'essai dans le Play Store : tu ne paieras rien."
            : `Abonnement renouvelé automatiquement (${selected === "weekly" ? "chaque semaine" : "chaque mois"}). Annulable à tout moment dans le Play Store, en un clic.`}
        </Text>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable onPress={buy} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={T.night} /> : (
            <Text style={styles.ctaText}>{selected === "yearly" ? "Commencer mes 3 jours gratuits" : "Continuer"}</Text>
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