import { useRef } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Animated, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SCENARIOS, Scenario, ScenarioCategory } from "../lib/scenarios";
import { T } from "../lib/theme";

// Illustrations (.png, nommées directement d'après l'id du scénario — Metro exige des chemins
// statiques dans require(), donc chaque entrée est écrite explicitement, pas générée dynamiquement).
const ILLUSTRATIONS: Record<string, any> = {
  // Pro
  "entretien-embauche": require("../assets/scenes/entretien-embauche.png"),
  "point-hebdo-teams": require("../assets/scenes/point-hebdo-teams.png"),
  "presentation-pro": require("../assets/scenes/presentation-pro.png"),
  "negociation-salaire": require("../assets/scenes/negociation-salaire.png"),
  "premier-jour-travail": require("../assets/scenes/premier-jour-travail.png"),
  "expliquer-metier": require("../assets/scenes/expliquer-metier.png"),
  "desaccord-reunion": require("../assets/scenes/desaccord-reunion.png"),
  "annoncer-retard-projet": require("../assets/scenes/annoncer-retard-projet.png"),
  // Voyage
  "arrivee-hotel": require("../assets/scenes/arrivee-hotel.png"),
  "aeroport-controle": require("../assets/scenes/aeroport-controle.png"),
  "restaurant-commande": require("../assets/scenes/restaurant-commande.png"),
  "bagage-perdu": require("../assets/scenes/bagage-perdu.png"),
  "train-annule": require("../assets/scenes/train-annule.png"),
  "location-voiture": require("../assets/scenes/location-voiture.png"),
  "probleme-chambre": require("../assets/scenes/probleme-chambre.png"),
  "allergie-restaurant": require("../assets/scenes/allergie-restaurant.png"),
  "reserver-activite": require("../assets/scenes/reserver-activite.png"),
  "trajet-taxi": require("../assets/scenes/trajet-taxi.png"),
  // Quotidien
  "rencontre-inconnu": require("../assets/scenes/rencontre-inconnu.png"),
  "cafe-ami": require("../assets/scenes/cafe-ami.png"),
  "demander-chemin": require("../assets/scenes/demander-chemin.png"),
  "se-presenter": require("../assets/scenes/se-presenter.png"),
  "parler-proches": require("../assets/scenes/parler-proches.png"),
  "loisirs-passions": require("../assets/scenes/loisirs-passions.png"),
  "raconter-weekend": require("../assets/scenes/raconter-weekend.png"),
  "decrire-journee": require("../assets/scenes/decrire-journee.png"),
  "organiser-sortie": require("../assets/scenes/organiser-sortie.png"),
  "retour-achat": require("../assets/scenes/retour-achat.png"),
  "prendre-rendez-vous": require("../assets/scenes/prendre-rendez-vous.png"),
  "mot-oublie": require("../assets/scenes/mot-oublie.png"),
};

const CATEGORIES: { key: ScenarioCategory; label: string }[] = [
  { key: "pro", label: "Au travail" },
  { key: "voyage", label: "En voyage" },
  { key: "quotidien", label: "Au quotidien" },
];

// Carte avec un léger effet de pression (scale + fondu) — animation par défaut,
// à ajuster si tu avais un autre effet en tête (ex. apparition échelonnée à l'ouverture).
function Pressy({ onPress, style, children }: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function SceneCard({ s, width, imgHeight, locked }: { s: Scenario; width: number; imgHeight: number; locked?: boolean }) {
  const source = ILLUSTRATIONS[s.id];
  return (
    <View style={[styles.card, { width }]}>
      <View style={[styles.cardImg, { height: imgHeight }]}>
        {source ? (
          <Image source={source} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <View style={styles.cardImgFallback} />
        )}
        {locked && (
          <View style={styles.lockOverlay}>
            <View style={styles.lockBadge}><Feather name="lock" size={13} color="#fff" /></View>
          </View>
        )}
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={1}>{s.title}</Text>
        <Text style={styles.cardDesc} numberOfLines={2}>{s.description}</Text>
      </View>
    </View>
  );
}

export default function ScenariosScreen({
  premium,
  onSelect,
  onCreateCustom,
  onBack,
  onLocked,
}: {
  premium: boolean;
  onSelect: (s: Scenario) => void;
  onCreateCustom: () => void;
  onBack: () => void;
  onLocked: () => void;
}) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={12} style={{ marginBottom: 12 }}>
          <Feather name="chevron-left" size={26} color={T.inkSoft} />
        </Pressable>
        <Text style={styles.h1}>Choisis ta scène</Text>
        <Text style={styles.sub}>Une situation réelle. Tu parles, on t'écoute, on te corrige avec douceur.</Text>
      </View>

      <Pressy onPress={premium ? onCreateCustom : onLocked} style={styles.customCard}>
        <View style={styles.customIcon}>
          <Feather name="plus" size={22} color={T.night} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.customTitle}>Crée ta propre scène</Text>
          <Text style={styles.customDesc}>Décris la situation que tu veux travailler</Text>
        </View>
        {!premium && <View style={styles.customLockBadge}><Feather name="lock" size={13} color="#fff" /></View>}
      </Pressy>

      {CATEGORIES.map(({ key, label }) => {
        const items = SCENARIOS.filter((s) => s.category === key);
        if (items.length === 0) return null;

        return (
          <View key={key}>
            <View style={styles.grpRow}>
              <Text style={styles.grp}>{label.toUpperCase()}</Text>
              <Text style={styles.grpCount}>{items.length} scène{items.length > 1 ? "s" : ""}</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 26, paddingRight: 12, gap: 14 }}
            >
              {items.map((s) => (
                <Pressy key={s.id} onPress={() => (premium ? onSelect(s) : onLocked())}>
                  <SceneCard s={s} width={210} imgHeight={140} locked={!premium} />
                </Pressy>
              ))}
            </ScrollView>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 22 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 8 },

  customCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.miel, borderRadius: 20, padding: 16, marginHorizontal: 26, marginBottom: 24 },
  customIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(27,42,74,0.12)", alignItems: "center", justifyContent: "center" },
  customTitle: { color: T.night, fontSize: 16, fontWeight: "800" },
  customDesc: { color: "#7A4A17", fontSize: 13, fontWeight: "600", marginTop: 2 },
  customLockBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(27,42,74,0.7)", alignItems: "center", justifyContent: "center" },

  grpRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginHorizontal: 26, marginBottom: 12, marginTop: 6 },
  grp: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1.4 },
  grpCount: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600" },

  card: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 8, paddingBottom: 13, marginBottom: 12, shadowColor: "#86604C", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  cardImg: { borderRadius: 16, overflow: "hidden", backgroundColor: T.creamLine },
  cardImgFallback: { flex: 1, backgroundColor: T.creamLine },
  lockOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(27,42,74,0.35)", alignItems: "flex-end", justifyContent: "flex-start", padding: 10 },
  lockBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(27,42,74,0.75)", alignItems: "center", justifyContent: "center" },
  cardText: { paddingHorizontal: 8, paddingTop: 9, gap: 3 },
  cardTitle: { fontSize: 15.5, fontWeight: "700", color: T.night },
  cardDesc: { fontSize: 12.5, lineHeight: 17, color: T.inkSoft },
});
