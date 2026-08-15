import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SCENARIOS, Scenario, ScenarioCategory } from "../lib/scenarios";
import { T } from "../lib/theme";

const CATEGORIES: { key: ScenarioCategory; label: string; chip: "a" | "b" }[] = [
  { key: "pro", label: "Au travail", chip: "a" },
  { key: "voyage", label: "En voyage", chip: "b" },
  { key: "quotidien", label: "Au quotidien", chip: "b" },
];

const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  "entretien-embauche": "briefcase",
  "point-hebdo-teams": "monitor",
  "presentation-pro": "clipboard",
  "negociation-salaire": "dollar-sign",
  "arrivee-hotel": "home",
  "aeroport-controle": "send",
  "restaurant-commande": "coffee",
  "rencontre-inconnu": "users",
  "cafe-ami": "message-circle",
  "demander-chemin": "map-pin",
};

export default function ScenariosScreen({
  onSelect,
  onCreateCustom,
  onBack
}: {
  onSelect: (s: Scenario) => void;
  onCreateCustom: () => void;
   onBack: () => void;
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

      {/* Créer sa propre scène */}
      <Pressable onPress={onCreateCustom} style={styles.customCard}>
        <View style={styles.customIcon}><Feather name="plus" size={22} color={T.night} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.customTitle}>Crée ta propre scène</Text>
          <Text style={styles.customDesc}>Décris la situation que tu veux travailler</Text>
        </View>
      </Pressable>

      {CATEGORIES.map(({ key, label, chip }) => {
        const items = SCENARIOS.filter((s) => s.category === key);
        if (items.length === 0) return null;
        return (
          <View key={key}>
            <Text style={styles.grp}>{label.toUpperCase()}</Text>
            {items.map((s) => (
              <Pressable key={s.id} onPress={() => onSelect(s)} style={styles.card}>
                <View style={[styles.chip, chip === "a" ? styles.chipA : styles.chipB]}>
                  <Feather name={ICONS[s.id] ?? "message-circle"} size={22} color={chip === "a" ? T.abricotDeep : T.night} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{s.title}</Text>
                  <Text style={styles.cardDesc}>{s.description}</Text>
                </View>
                <Feather name="chevron-right" size={20} color="#D9B78E" />
              </Pressable>
            ))}
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

  customCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.miel, borderRadius: 20, padding: 16, marginHorizontal: 26, marginBottom: 20 },
  customIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(27,42,74,0.12)", alignItems: "center", justifyContent: "center" },
  customTitle: { color: T.night, fontSize: 16, fontWeight: "800" },
  customDesc: { color: "#7A4A17", fontSize: 13, fontWeight: "600", marginTop: 2 },

  grp: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginHorizontal: 26, marginBottom: 12, marginTop: 10 },
  card: { marginHorizontal: 26, marginBottom: 12, backgroundColor: T.card, borderRadius: 22, padding: 16, flexDirection: "row", alignItems: "center", gap: 15 },
  chip: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  chipA: { backgroundColor: T.chipAbricot },
  chipB: { backgroundColor: T.chipBlue },
  cardTitle: { fontSize: 17, fontWeight: "800", color: T.night },
  cardDesc: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },
});