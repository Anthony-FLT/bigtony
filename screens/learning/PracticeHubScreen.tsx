// PracticeHubScreen — onglet « Pratiquer » (maquette du 17/11) : les entraînements libres.
// « À toi de parler » ouvre la page des situations (scénarios, scène perso, point du jour) ;
// « Travaille les mots qui comptent » regroupe le labo de prononciation et le dictionnaire personnel.
// Les actus du jour sont sur l'accueil, pas ici.
import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { L } from "../../components/lessonUi";

const THEMES: { icon: any; label: string }[] = [
  { icon: require("../../assets/icons/ic_voyage.png"), label: "Voyage" },
  { icon: require("../../assets/icons/ic_travail.png"), label: "Travail" },
  { icon: require("../../assets/icons/ic_quotidien.png"), label: "Quotidien" },
];

export default function PracticeHubScreen({ laboCount, onGoScenarios, onGoLabo, onGoFavorites }: {
  premium?: boolean; // conservé pour App.tsx ; l'accès se décide dans la page des situations
  laboCount: number; // mots à travailler au Labo
  onGoScenarios: () => void;
  onGoLabo: () => void;
  onGoFavorites: () => void;
}) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title} accessibilityRole="header">Pratiquer</Text>
      <Text style={styles.sub}>Un peu d'anglais, à ta façon.</Text>

      <Text style={styles.section} accessibilityRole="header">À toi de parler</Text>
      <Pressable onPress={onGoScenarios} style={styles.talkCard} accessibilityRole="button" accessibilityLabel="Choisir une situation : voyage, travail ou quotidien">
        <View style={styles.talkHead}>
          <View style={[styles.iconBox, { backgroundColor: "#FDDCBE" }]}><Feather name="mic" size={26} color={L.textPrimary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.talkTitle}>Une situation, à toi de parler.</Text>
            <Text style={styles.rowSub}>Voyage, travail, quotidien… entraîne-toi avec ton coach.</Text>
          </View>
        </View>
        <View style={styles.themes}>
          {THEMES.map((t, i) => (
            <View key={t.label} style={[styles.theme, i > 0 && styles.themeDivider]}>
              <Image source={t.icon} style={styles.themeIcon} resizeMode="contain" />
              <Text style={styles.themeLabel} maxFontSizeMultiplier={1.3}>{t.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>Choisir une situation</Text>
          <Feather name="arrow-right" size={18} color={L.textPrimary} />
        </View>
      </Pressable>

      <Text style={[styles.section, { marginTop: 30 }]} accessibilityRole="header">Travaille les mots qui comptent</Text>
      <Pressable onPress={onGoLabo} style={styles.row} accessibilityRole="button" accessibilityLabel="Mieux prononcer">
        <View style={[styles.iconBox, { backgroundColor: L.lavender }]}><Feather name="volume-2" size={24} color={L.textPrimary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle}>Mieux prononcer</Text>
          <Text style={styles.rowSub}>{laboCount > 0 ? `${laboCount} mot${laboCount > 1 ? "s" : ""} à travailler.` : "Écoute un mot, puis entraîne-toi à le dire."}</Text>
        </View>
        <Feather name="chevron-right" size={22} color={L.textPrimary} />
      </Pressable>
      <Pressable onPress={onGoFavorites} style={styles.row} accessibilityRole="button" accessibilityLabel="Revoir mes mots">
        <View style={[styles.iconBox, { backgroundColor: L.yellow }]}><Feather name="bookmark" size={24} color={L.textPrimary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle}>Revoir mes mots</Text>
          <Text style={styles.rowSub}>Retrouve et révise ton vocabulaire enregistré.</Text>
        </View>
        <Feather name="chevron-right" size={22} color={L.textPrimary} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  content: { paddingHorizontal: L.gutter, paddingTop: 52, paddingBottom: 32 },
  title: { fontSize: 32, fontWeight: "800", color: L.textPrimary, letterSpacing: -0.6 },
  sub: { fontSize: 16, color: L.textSecondary, marginTop: 4, marginBottom: 26 },
  section: { color: L.textPrimary, fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 14 },

  talkCard: { backgroundColor: L.surface, borderRadius: 22, borderWidth: 1, borderColor: L.border, padding: 14 },
  talkHead: { flexDirection: "row", alignItems: "center", gap: 14 },
  talkTitle: { color: L.textPrimary, fontSize: 18, fontWeight: "800", lineHeight: 23 },
  themes: { flexDirection: "row", marginTop: 16, marginBottom: 16 },
  theme: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 4 },
  themeDivider: { borderLeftWidth: 1, borderLeftColor: L.border },
  themeIcon: { width: 30, height: 30 },
  themeLabel: { color: L.textSecondary, fontSize: 14.5, fontWeight: "500" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: L.accentDeep, borderRadius: 16, minHeight: 50, paddingHorizontal: 16 },
  ctaText: { color: L.textPrimary, fontSize: 16.5, fontWeight: "800" },

  row: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: L.surface, borderRadius: 20, borderWidth: 1, borderColor: L.border, padding: 14, minHeight: 88, marginBottom: 12 },
  iconBox: { width: 54, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "800" },
  rowSub: { color: L.textSecondary, fontSize: 14, lineHeight: 19, marginTop: 3 },
});
