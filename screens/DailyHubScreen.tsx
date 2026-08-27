// Défis du jour : hub des exercices quotidiens (lecture, traduction, journal à venir).
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { getChallengesDone, HUB_CHALLENGES } from "../lib/dailyChallenges";

export default function DailyHubScreen({
  onBack,
  onOpenReading,
  onOpenTranslation,
  onOpenListening,
}: {
  onBack: () => void;
  onOpenReading?: () => void;
  onOpenTranslation?: () => void;
  onOpenListening?: () => void;
}) {
  const [done, setDone] = useState<{ reading: boolean; translation: boolean; listening: boolean } | null>(null);

  useEffect(() => {
    getChallengesDone().then(setDone);
  }, []);

  const doneCount = done ? HUB_CHALLENGES.reduce((n, c) => n + (done[c] ? 1 : 0), 0) : 0;
  const total = HUB_CHALLENGES.length;

  const Card = ({
    icon, title, sub, isDone, onPress,
  }: { icon: keyof typeof Feather.glyphMap; title: string; sub: string; isDone: boolean; onPress?: () => void }) => {
    const available = !!onPress;
    return (
      <Pressable style={styles.card} onPress={available ? onPress : undefined} disabled={!available}>
        <View style={[styles.cardIcon, isDone && styles.cardIconDone]}>
          <Feather name={isDone ? "check" : icon} size={22} color={isDone ? T.night : T.abricotDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{isDone ? "Terminé aujourd'hui" : sub}</Text>
        </View>
        {available ? (
          <Feather name="chevron-right" size={20} color={T.abricotDeep} />
        ) : (
          <View style={styles.soonBadge}><Text style={styles.soonText}>Bientôt</Text></View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}><Feather name="chevron-left" size={26} color={T.night} /></Pressable>
        <Text style={styles.headerTitle}>Défis du jour</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.lead}>Quelques exercices courts, à faire chaque jour. Choisis par où commencer.</Text>

        <View style={styles.progressCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.progressNum}>
              {done === null ? "…" : `${doneCount} sur ${total}`}
            </Text>
            <Text style={styles.progressLabel}>fait{doneCount > 1 ? "s" : ""} aujourd'hui</Text>
          </View>
          <View style={styles.progressDots}>
            {HUB_CHALLENGES.map((c) => (
              <View key={c} style={[styles.dot, done && done[c] && styles.dotOn]} />
            ))}
          </View>
        </View>

        {done === null ? (
          <ActivityIndicator color={T.abricot} style={{ marginTop: 30 }} />
        ) : (
          <>
            <Card
              icon="book-open"
              title="Lecture du jour"
              sub="Un court texte selon tes centres d'intérêt"
              isDone={done.reading}
              onPress={onOpenReading}
            />
            <Card
              icon="repeat"
              title="Traduction du jour"
              sub="Un court texte à traduire"
              isDone={done.translation}
              onPress={onOpenTranslation}
            />
            <Card
              icon="headphones"
              title="Écoute du jour"
              sub="Comprends un audio à l'oral"
              isDone={done.listening}
              onPress={onOpenListening}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: T.night, letterSpacing: -0.3 },
  lead: { color: T.inkSoft, fontSize: 14, fontWeight: "600", lineHeight: 20, marginTop: 8, marginBottom: 18, paddingHorizontal: 6 },

  progressCard: { flexDirection: "row", alignItems: "center", backgroundColor: T.night, borderRadius: 20, padding: 20, marginBottom: 18 },
  progressNum: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  progressLabel: { color: "#9DB0D4", fontSize: 13, fontWeight: "700", marginTop: 2 },
  progressDots: { flexDirection: "row", gap: 8 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.2)" },
  dotOn: { backgroundColor: T.abricot },

  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 18, padding: 16, marginBottom: 12 },
  cardIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  cardIconDone: { backgroundColor: T.menthe },
  cardTitle: { color: T.night, fontSize: 16, fontWeight: "800" },
  cardSub: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2, lineHeight: 18 },
  soonBadge: { backgroundColor: T.chipAbricot, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 9 },
  soonText: { color: T.abricotDeep, fontSize: 11, fontWeight: "800" },
});
