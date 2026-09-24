import { useRef } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SCENARIOS, Scenario, ScenarioCategory } from "../lib/scenarios";
import { T } from "../lib/theme";

// Illustrations (SVG importés directement grâce à react-native-svg-transformer)
import EntretienEmbaucheImg from "../assets/scenes/01-entretien-embauche.svg";
import PointHebdoVisioImg from "../assets/scenes/02-point-hebdo-visio.svg";
import PresenterProjetImg from "../assets/scenes/03-presenter-projet.svg";
import NegocierSalaireImg from "../assets/scenes/04-negocier-salaire.svg";
import ArriveeHotelImg from "../assets/scenes/05-arrivee-hotel.svg";
import ControleAeroportImg from "../assets/scenes/06-controle-aeroport.svg";
import CommanderRestaurantImg from "../assets/scenes/07-commander-restaurant.svg";
import RencontrerQuelquunImg from "../assets/scenes/08-rencontrer-quelquun.svg";
import CafeEntreAmisImg from "../assets/scenes/09-cafe-entre-amis.svg";
import DemanderCheminImg from "../assets/scenes/10-demander-chemin.svg";

// Correspondance id de scénario -> illustration (les noms de fichiers ne correspondent pas tous aux ids)
const ILLUSTRATIONS: Record<string, React.ComponentType<any>> = {
  "entretien-embauche": EntretienEmbaucheImg,
  "point-hebdo-teams": PointHebdoVisioImg,
  "presentation-pro": PresenterProjetImg,
  "negociation-salaire": NegocierSalaireImg,
  "arrivee-hotel": ArriveeHotelImg,
  "aeroport-controle": ControleAeroportImg,
  "restaurant-commande": CommanderRestaurantImg,
  "rencontre-inconnu": RencontrerQuelquunImg,
  "cafe-ami": CafeEntreAmisImg,
  "demander-chemin": DemanderCheminImg,
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
  const Illustration = ILLUSTRATIONS[s.id];
  return (
    <View style={[styles.card, { width }]}>
      <View style={[styles.cardImg, { height: imgHeight }]}>
        {Illustration ? (
          <Illustration width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
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
