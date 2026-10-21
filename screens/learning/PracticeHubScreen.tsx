// PracticeHubScreen — onglet « Pratiquer » de la cohorte learning_path_v1 : scènes, Labo, révision.
import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from "react-native";
import { L, ILL, Icon } from "../../components/lessonUi";

export default function PracticeHubScreen({ premium, laboCount, onGoScenarios, onGoLabo, onGoFavorites }: {
  premium: boolean;
  laboCount: number; // mots à travailler au Labo
  onGoScenarios: () => void;
  onGoLabo: () => void;
  onGoFavorites: () => void;
}) {
  const rows = [
    { key: "scenes", img: ILL.micro, bg: "#FDE7D2", title: "Une scène au choix", sub: "Entretien, voyage, quotidien… ou ta propre scène", onPress: onGoScenarios, lock: !premium },
    { key: "labo", img: ILL.cible, bg: "#E7E3FB", title: "Labo de prononciation", sub: laboCount > 0 ? `${laboCount} mot${laboCount > 1 ? "s" : ""} à polir` : "Les mots qui t'ont fait trébucher", onPress: onGoLabo, lock: false },
    { key: "words", img: ILL.crayon, bg: "#FBE4A8", title: "Réviser mes mots", sub: "Ton dictionnaire personnel", onPress: onGoFavorites, lock: false },
  ];
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Pratiquer</Text>
      <Text style={styles.sub}>Entre deux leçons, entraîne-toi comme tu veux.</Text>
      {rows.map((r) => (
        <Pressable key={r.key} onPress={r.onPress} style={[styles.row, { backgroundColor: r.bg }]} accessibilityRole="button" accessibilityLabel={r.title}>
          <Image source={r.img} style={styles.img} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{r.title}</Text>
            <Text style={styles.rowSub}>{r.sub}</Text>
          </View>
          {r.lock ? <View style={styles.lock}><Icon name="cadenas" size={12} tint="#fff" /></View> : <Icon name="chevron" size={20} />}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  content: { paddingHorizontal: L.gutter, paddingTop: 52, paddingBottom: 32 },
  title: { fontSize: 30, fontWeight: "700", color: L.textPrimary, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: L.textSecondary, marginTop: 4, marginBottom: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 22, padding: 16, marginBottom: 12, minHeight: 96 },
  img: { width: 64, height: 58 },
  rowTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "700" },
  rowSub: { color: L.textSecondary, fontSize: 13.5, marginTop: 3, lineHeight: 18 },
  lock: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(25,41,71,0.85)", alignItems: "center", justifyContent: "center" },
});
