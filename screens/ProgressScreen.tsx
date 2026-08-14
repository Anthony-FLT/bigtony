import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { loadMomentum, Momentum } from "../lib/progress";
import { SCENARIOS, Scenario } from "../lib/scenarios";

export default function ProgressScreen({
  refreshKey,
  onResume,
  onGoLabo,
  onGoFavorites,
}: {
  refreshKey: number;
  onResume: (s: Scenario) => void;
  onGoLabo: () => void;
  onGoFavorites: () => void;
}) {
  const [m, setM] = useState<Momentum | null>(null);

  useEffect(() => {
    setM(null);
    loadMomentum().then(setM);
  }, [refreshKey]);

  if (!m) {
    return <View style={styles.center}><ActivityIndicator size="large" color={T.abricotDeep} /></View>;
  }

  const lastScenario = SCENARIOS.find((s) => s.id === m.lastScenario) ?? null;

  // Aucune séance encore
  if (m.sessionCount === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.head}><Text style={styles.h1}>Ton élan</Text></View>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Tout commence par une première conversation.</Text>
          <Text style={styles.emptyBody}>Reviens ici après ta première séance — on gardera le fil de tes progrès.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.head}><Text style={styles.h1}>Ton élan</Text></View>

      {/* Streak en vedette */}
      <View style={styles.streakCard}>
        <View style={styles.streakLeft}>
          <Text style={styles.streakNum}>{m.streak}</Text>
          <Text style={styles.streakUnit}>{m.streak > 1 ? "jours d'affilée" : "jour"}</Text>
        </View>
        <View style={styles.streakBlob} />
        <Text style={styles.streakMsg}>
          {m.streak === 0
            ? "Reprends aujourd'hui pour relancer ta série."
            : m.streak < 3
            ? "Beau début. Reviens demain pour l'entretenir."
            : "Tu tiens le rythme. Ne lâche rien."}
        </Text>
      </View>

      {/* Reprendre là où on s'est arrêté */}
      {lastScenario && (
        <Pressable style={styles.resumeCard} onPress={() => onResume(lastScenario)}>
          <Text style={styles.resumeK}>REPRENDS OÙ TU T'ES ARRÊTÉ</Text>
          <Text style={styles.resumeTitle}>{lastScenario.title}</Text>
          {m.topWeakWord && (
            <Text style={styles.resumeSub}>La dernière fois, « {m.topWeakWord} » te résistait encore.</Text>
          )}
          <View style={styles.resumeBtn}>
            <Feather name="mic" size={16} color={T.night} />
            <Text style={styles.resumeBtnText}>Reprendre cette scène</Text>
          </View>
        </Pressable>
      )}

      {/* Mot à retravailler → Labo */}
      {m.topWeakWord && (
        <Pressable style={styles.laboCard} onPress={onGoLabo}>
          <View style={styles.laboIcon}><Feather name="target" size={20} color={T.abricotDeep} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.laboTitle}>Travaille « {m.topWeakWord} » au Labo</Text>
            <Text style={styles.laboSub}>Le son qui te trahit le plus. On le corrige ?</Text>
          </View>
          <Feather name="chevron-right" size={20} color="#D9B78E" />
        </Pressable>
      )}

      {/* Favoris */}
      <Pressable style={styles.favCard} onPress={onGoFavorites}>
        <View style={styles.favIcon}><Feather name="star" size={20} color={T.abricotDeep} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.favTitle}>Tes mots favoris</Text>
          <Text style={styles.favSub}>
            {m.favoritesCount > 0 ? `${m.favoritesCount} mot${m.favoritesCount > 1 ? "s" : ""} à réviser` : "Ajoute des mots pendant tes conversations"}
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color="#D9B78E" />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  center: { flex: 1, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 16 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },

  emptyCard: { backgroundColor: T.card, borderRadius: 22, padding: 22, marginHorizontal: 26 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: T.night, lineHeight: 25 },
  emptyBody: { fontSize: 15, fontWeight: "600", color: T.inkSoft, lineHeight: 22, marginTop: 8 },

  streakCard: { backgroundColor: T.night, borderRadius: 24, padding: 22, marginHorizontal: 26, marginBottom: 14, overflow: "hidden" },
  streakLeft: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  streakNum: { color: T.abricot, fontSize: 52, fontWeight: "800", letterSpacing: -1.5 },
  streakUnit: { color: "#fff", fontSize: 18, fontWeight: "800" },
  streakBlob: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: T.abricot, opacity: 0.14, right: -30, top: -30 },
  streakMsg: { color: "#9DB0D4", fontSize: 14, fontWeight: "600", lineHeight: 20, marginTop: 8 },

  resumeCard: { backgroundColor: T.card, borderRadius: 22, padding: 18, marginHorizontal: 26, marginBottom: 14 },
  resumeK: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 6 },
  resumeTitle: { color: T.night, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  resumeSub: { color: T.inkSoft, fontSize: 14, fontWeight: "600", lineHeight: 20, marginTop: 4 },
  resumeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, padding: 13, marginTop: 14 },
  resumeBtnText: { color: T.night, fontSize: 14, fontWeight: "800" },

  laboCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 20, padding: 16, marginHorizontal: 26, marginBottom: 14 },
  laboIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  laboTitle: { color: T.night, fontSize: 15, fontWeight: "800" },
  laboSub: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },

  favCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 20, padding: 16, marginHorizontal: 26 },
  favIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  favTitle: { color: T.night, fontSize: 15, fontWeight: "800" },
  favSub: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },
});