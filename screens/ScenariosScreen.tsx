// ScenariosScreen — maquette du 26/10 : liste verticale par catégorie (image à gauche, titre, sous-titre, cadenas),
// cartes « Le point du jour » et « Crée ta propre scène » en tête (maquette du 17/11), rappel en bas. Pas de barre de recherche. Logique (premium, scène perso, sélection) inchangée.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Animated, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SCENARIOS, Scenario, ScenarioCategory } from "../lib/scenarios";
import { L, Icon, RoundButton } from "../components/lessonUi";
import { getDailyTalkStatus } from "../lib/dailyTalk";
import { loadProfile } from "../lib/profile";
import { coachForVoice } from "../lib/learningPath/coaches";

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

const CATEGORIES: { key: ScenarioCategory; label: string; icon: any }[] = [
  { key: "voyage", label: "En voyage", icon: require("../assets/icons/ic_voyage.png") },
  { key: "pro", label: "Au travail", icon: require("../assets/icons/ic_travail.png") },
  { key: "quotidien", label: "Au quotidien", icon: require("../assets/icons/ic_quotidien.png") },
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
      {premium ? <Feather name="chevron-right" size={22} color={L.textPrimary} /> : <Icon name="cadenas" size={16} />}
    </Pressy>
  );
}

export default function ScenariosScreen({
  premium,
  onSelect,
  onCreateCustom,
  onBack,
  onLocked,
  onGoDailyTalk,
}: {
  premium: boolean;
  onSelect: (s: Scenario) => void;
  onCreateCustom: () => void;
  onBack: () => void;
  onLocked: () => void;
  onGoDailyTalk: () => void; // « Le point du jour » : ouvert à tous, le serveur décide de l'accès (1 par semaine sans abonnement)
}) {
  const [dailyStatus, setDailyStatus] = useState<"todo" | "in_progress" | "done">("todo");
  const [coachName, setCoachName] = useState(coachForVoice(null).displayName);
  useEffect(() => {
    getDailyTalkStatus().then(setDailyStatus).catch(() => {});
    loadProfile().then((p) => setCoachName(coachForVoice(p?.voice).displayName)).catch(() => {});
  }, []);
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <RoundButton icon="retour" label="Retour" onPress={onBack} size={44} iconSize={20} style={{ marginBottom: 12 }} />
        <Text style={styles.h1}>Une situation. À toi de parler.</Text>
        <Text style={styles.sub}>Entraîne-toi pour les moments qui comptent.</Text>
      </View>

      {/* Le point du jour : discussion quotidienne avec le coach, ouverte à tous (le serveur décide de l'accès) */}
      <Pressy onPress={onGoDailyTalk} style={[styles.topCard, { backgroundColor: dailyStatus === "done" ? L.successSoft : "#FDE0C6" }]} label={`Le point du jour avec ${coachName}`}>
        <View style={styles.topIcon}><Feather name="mic" size={26} color={L.textPrimary} /></View>
        <View style={[styles.topDivider, { backgroundColor: dailyStatus === "done" ? "#BFE3CF" : "#F2B98A" }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Le point du jour</Text>
          <Text style={styles.topDesc}>{dailyStatus === "done" ? "Fait pour aujourd'hui" : dailyStatus === "in_progress" ? "En cours · reprendre" : `3 min de discussion libre avec ${coachName}`}</Text>
        </View>
        <View style={styles.topBadge}><Feather name={dailyStatus === "done" ? "check" : "chevron-right"} size={20} color={L.textPrimary} /></View>
      </Pressy>

      {/* Scène personnalisée */}
      <Pressy onPress={premium ? onCreateCustom : onLocked} style={[styles.topCard, { backgroundColor: L.lavender }]} label="Crée ta propre scène">
        <View style={[styles.topIcon, styles.customIcon]}><Feather name="plus" size={26} color="#fff" /></View>
        <View style={[styles.topDivider, { backgroundColor: "#CFC8F0" }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Crée ta propre scène</Text>
          <Text style={styles.topDesc}>Une situation à toi, un échange sur mesure.</Text>
        </View>
        <View style={styles.topBadge}>{premium ? <Feather name="chevron-right" size={20} color={L.textPrimary} /> : <Icon name="cadenas" size={16} />}</View>
      </Pressy>

      {CATEGORIES.map(({ key, label, icon }) => {
        const items = SCENARIOS.filter((s) => s.category === key);
        if (items.length === 0) return null;
        return (
          <View key={key} style={{ marginTop: 18 }}>
            <View style={styles.grpRow}>
              <Image source={icon} style={styles.grpIcon} resizeMode="contain" />
              <Text style={styles.grp}>{label}</Text>
              <View style={styles.grpCount}><Text style={styles.grpCountText}>{items.length} scène{items.length > 1 ? "s" : ""}</Text></View>
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

  // Cartes du haut : point du jour (pêche) et scène personnalisée (lavande)
  topCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, padding: 14, minHeight: 78, marginHorizontal: 12, marginBottom: 10 },
  topIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  customIcon: { borderRadius: 13, backgroundColor: L.accentDeep },
  topDivider: { width: 1, alignSelf: "stretch", marginVertical: 4 },
  topTitle: { color: L.textPrimary, fontSize: 18, fontWeight: "800" },
  topDesc: { color: L.textSecondary, fontSize: 14, lineHeight: 19, marginTop: 2 },
  topBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },

  grpRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: L.gutter, marginTop: 6, marginBottom: 12 },
  grpIcon: { width: 28, height: 28 },
  grp: { flex: 1, color: L.textPrimary, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  grpCount: { backgroundColor: L.accentSoft, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  grpCountText: { color: L.accentText, fontSize: 13, fontWeight: "800" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 20, borderWidth: 1, borderColor: L.border, padding: 10, paddingRight: 14, marginHorizontal: 12, marginBottom: 10 },
  rowImg: { width: 108, height: 76, borderRadius: 14, overflow: "hidden", backgroundColor: L.border },
  fill: { width: "100%", height: "100%" },
  rowTitle: { color: L.textPrimary, fontSize: 16.5, fontWeight: "800" },
  rowDesc: { color: L.textSecondary, fontSize: 13.5, lineHeight: 18, marginTop: 3 },

  hint: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: L.lavender, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginHorizontal: L.gutter, marginTop: 10 },
  hintEmoji: { fontSize: 14 },
  hintText: { flex: 1, color: L.textPrimary, fontSize: 13, fontWeight: "600" },
});
