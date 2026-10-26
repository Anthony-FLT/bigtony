// ScenariosScreen — maquette du 26/10 : liste verticale par catégorie (image à gauche, titre, sous-titre, cadenas),
// carte « Crée ta propre scène », rappel en bas. Pas de barre de recherche. Logique (premium, scène perso, sélection) inchangée.
import { useRef } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Animated, Image } from "react-native";
import { SCENARIOS, Scenario, ScenarioCategory } from "../lib/scenarios";
import { L, Icon, RoundButton } from "../components/lessonUi";

// Illustrations (.png) — chemins statiques exigés par Metro
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

const CATEGORIES: { key: ScenarioCategory; label: string; emoji: string; bg: string }[] = [
  { key: "voyage", label: "En voyage", emoji: "✈️", bg: L.lavender },
  { key: "pro", label: "Au travail", emoji: "💼", bg: L.accentSoft },
  { key: "quotidien", label: "Au quotidien", emoji: "🏠", bg: L.successSoft },
];

// Léger effet de pression
function Pressy({ onPress, style, children, label }: { onPress: () => void; style?: any; children: React.ReactNode; label?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityRole="button" accessibilityLabel={label}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function SceneRow({ s, premium, onPress }: { s: Scenario; premium: boolean; onPress: () => void }) {
  const source = ILLUSTRATIONS[s.id];
  return (
    <Pressy onPress={onPress} style={styles.row} label={s.title}>
      <View style={styles.rowImg}>{source ? <Image source={source} style={styles.fill} resizeMode="cover" /> : <View style={[styles.fill, { backgroundColor: L.border }]} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
        <Text style={styles.rowDesc} numberOfLines={2}>{s.description}</Text>
      </View>
      <View style={styles.rowBadge}>{premium ? <Icon name="chevron" size={16} /> : <Icon name="cadenas" size={16} />}</View>
    </Pressy>
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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <RoundButton icon="retour" label="Retour" onPress={onBack} size={44} iconSize={20} style={{ marginBottom: 12 }} />
        <Text style={styles.h1}>Une situation. À toi de parler.</Text>
        <Text style={styles.sub}>Entraîne-toi pour les moments qui comptent.</Text>
      </View>

      {/* Scène personnalisée */}
      <Pressy onPress={premium ? onCreateCustom : onLocked} style={styles.customCard} label="Crée ta propre scène">
        <View style={styles.customIcon}><Text style={styles.customPlus}>+</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.customTitle}>Crée ta propre scène</Text>
          <Text style={styles.customDesc}>Une situation à toi, un échange sur mesure.</Text>
        </View>
        <View style={[styles.rowBadge, { backgroundColor: "rgba(255,255,255,0.7)" }]}>{premium ? <Icon name="chevron" size={16} /> : <Icon name="cadenas" size={16} />}</View>
      </Pressy>

      {CATEGORIES.map(({ key, label, emoji, bg }) => {
        const items = SCENARIOS.filter((s) => s.category === key);
        if (items.length === 0) return null;
        return (
          <View key={key} style={{ marginTop: 18 }}>
            <View style={styles.grpRow}>
              <View style={[styles.grpIcon, { backgroundColor: bg }]}><Text style={styles.grpEmoji}>{emoji}</Text></View>
              <Text style={styles.grp}>{label}</Text>
              <Text style={styles.grpCount}>{items.length} scène{items.length > 1 ? "s" : ""}</Text>
            </View>
            {items.map((s) => (
              <SceneRow key={s.id} s={s} premium={premium} onPress={() => (premium ? onSelect(s) : onLocked())} />
            ))}
          </View>
        );
      })}

      <View style={styles.hint}>
        <Text style={styles.hintEmoji}>💡</Text>
        <Text style={styles.hintText}>Choisis une scène pour découvrir la situation.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  head: { paddingTop: 52, paddingHorizontal: L.gutter, paddingBottom: 16 },
  h1: { fontSize: 26, fontWeight: "800", color: L.textPrimary, letterSpacing: -0.4 },
  sub: { color: L.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 6 },

  customCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.accentSoft, borderRadius: 18, padding: 12, marginHorizontal: L.gutter },
  customIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: L.accentDeep, alignItems: "center", justifyContent: "center" },
  customPlus: { color: "#fff", fontSize: 26, fontWeight: "700", lineHeight: 30 },
  customTitle: { color: L.textPrimary, fontSize: 15.5, fontWeight: "800" },
  customDesc: { color: L.textSecondary, fontSize: 12.5, marginTop: 2 },

  grpRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: L.gutter, marginBottom: 10 },
  grpIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  grpEmoji: { fontSize: 15 },
  grp: { flex: 1, color: L.textPrimary, fontSize: 16, fontWeight: "800" },
  grpCount: { color: L.textSecondary, fontSize: 12.5, fontWeight: "600" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 18, padding: 10, marginHorizontal: L.gutter, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  rowImg: { width: 86, height: 68, borderRadius: 12, overflow: "hidden", backgroundColor: L.border },
  fill: { width: "100%", height: "100%" },
  rowTitle: { color: L.textPrimary, fontSize: 15.5, fontWeight: "800" },
  rowDesc: { color: L.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  rowBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: L.background, alignItems: "center", justifyContent: "center" },

  hint: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: L.lavender, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginHorizontal: L.gutter, marginTop: 10 },
  hintEmoji: { fontSize: 14 },
  hintText: { flex: 1, color: L.textPrimary, fontSize: 13, fontWeight: "600" },
});
