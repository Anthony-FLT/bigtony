import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { isDailyDone } from "../lib/daily";
import { computeStreak, milestoneReached } from "../lib/streak";
import { loadProfile, Profile, saveMilestone } from "../lib/profile";
import { Modal } from "react-native";
import { getDailyExpression, Expression } from "../lib/expression";

export default function HomeScreen({
  refreshKey,
  onStartDaily,
  onGoLabo,
  onGoScenarios,
}: {
  refreshKey: number;
  onStartDaily: () => void;
  onGoLabo: () => void;
  onGoScenarios: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dailyDone, setDailyDone] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [celebrate, setCelebrate] = useState<number | null>(null);
  const [expr, setExpr] = useState<Expression | null>(null);

  useEffect(() => {
    setDailyDone(null);
    (async () => {
      const [p, done, s] = await Promise.all([loadProfile(), isDailyDone(), computeStreak()]);
      setProfile(p);
      setDailyDone(done);
      setStreak(s);

      // Palier de streak franchi et pas encore fêté ?
      const reached = milestoneReached(s);
      if (reached && (p?.lastMilestone ?? 0) < reached) {
        setCelebrate(reached);
        saveMilestone(reached);
      }

      getDailyExpression().then(setExpr)
    })();
  }, [refreshKey]);

  const hello = profile?.name ? `Salut ${profile.name}` : "Salut";
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.top}>
        <View>
          <Text style={styles.date}>{today.charAt(0).toUpperCase() + today.slice(1)}</Text>
          <Text style={styles.hello}>{hello}</Text>
        </View>
        {streak > 0 && (
          <View style={styles.streakPill}>
            <Feather name="zap" size={14} color={T.abricotDeep} />
            <Text style={styles.streakPillText}>{streak}</Text>
          </View>
        )}
      </View>

      {/* Discussion du jour — la vedette */}
      {dailyDone === null ? (
        <View style={[styles.dailyCard, { alignItems: "center" }]}>
          <ActivityIndicator color={T.abricot} />
        </View>
      ) : dailyDone ? (
        <View style={styles.dailyDoneCard}>
          <View style={styles.dailyDoneIcon}><Feather name="check" size={26} color={T.night} /></View>
          <Text style={styles.dailyDoneTitle}>Discussion du jour terminée</Text>
          <Text style={styles.dailyDoneSub}>Beau travail. Reviens demain pour continuer ta série.</Text>
        </View>
      ) : (
        <Pressable style={styles.dailyCard} onPress={onStartDaily}>
          <View style={styles.dailyBlob} />
          <Text style={styles.dailyK}>TA DISCUSSION DU JOUR</Text>
          <Text style={styles.dailyTitle}>Une conversation surprise t'attend</Text>
          <Text style={styles.dailySub}>Thème choisi pour toi. Tu ne sais pas encore de quoi on va parler.</Text>
          <View style={styles.dailyBtn}>
            <Feather name="mic" size={18} color={T.night} />
            <Text style={styles.dailyBtnText}>Commencer</Text>
          </View>
        </Pressable>
      )}

      {/* Labo */}
      <Pressable style={styles.rowCard} onPress={onGoLabo}>
        <View style={styles.rowIcon}><Feather name="target" size={20} color={T.abricotDeep} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Le labo</Text>
          <Text style={styles.rowSub}>Travaille ta prononciation, son par son</Text>
        </View>
        <Feather name="chevron-right" size={20} color="#D9B78E" />
      </Pressable>

      {/* Scénarios — premium pendant l'essai */}
      <Pressable style={styles.rowCard} onPress={onGoScenarios}>
        <View style={styles.rowIcon}><Feather name="message-circle" size={20} color={T.abricotDeep} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Discussions à thème</Text>
          <Text style={styles.rowSub}>Choisis ta scène, ou crée la tienne</Text>
        </View>
        <View style={styles.lockPill}>
          <Feather name="lock" size={12} color={T.abricotDeep} />
          <Text style={styles.lockText}>Premium</Text>
        </View>
      </Pressable>

      {/* Expression du jour */}
      {expr && (
        <View style={styles.exprCard}>
          <Text style={styles.exprK}>EXPRESSION DU JOUR</Text>
          <Text style={styles.exprEn}>{expr.en}</Text>
          <Text style={styles.exprFr}>{expr.fr}</Text>
          <Text style={styles.exprExample}>“{expr.example_en}”</Text>
          <Text style={styles.exprExampleFr}>{expr.example_fr}</Text>
        </View>
      )}
      <Modal visible={celebrate !== null} transparent animationType="fade">
        <View style={styles.celebrateOverlay}>
          <View style={styles.celebrateCard}>
            <View style={styles.celebrateIcon}>
              <Feather name="zap" size={44} color={T.night} />
            </View>
            <Text style={styles.celebrateNum}>{celebrate}</Text>
            <Text style={styles.celebrateUnit}>jours d'affilée</Text>
            <Text style={styles.celebrateMsg}>
              {celebrate === 3 ? "Trois jours de suite. L'habitude est en train de naître."
                : celebrate === 7 ? "Une semaine entière ! Tu tiens vraiment le rythme."
                : celebrate === 14 ? "Deux semaines. Parler anglais devient un réflexe."
                : "Trente jours. Regarde le chemin parcouru — tu n'es plus la même personne à l'oral."}
            </Text>
            <Pressable onPress={() => setCelebrate(null)} style={styles.celebrateBtn}>
              <Text style={styles.celebrateBtnText}>Continuer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  top: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { color: T.inkSoft, fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
  hello: { color: T.night, fontSize: 24, fontWeight: "800", marginTop: 2, letterSpacing: -0.4 },
  streakPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: T.chipAbricot, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12 },
  streakPillText: { color: T.abricotDeep, fontSize: 15, fontWeight: "800" },

  dailyCard: { backgroundColor: T.night, borderRadius: 26, padding: 22, marginHorizontal: 26, marginBottom: 14, overflow: "hidden", minHeight: 180, justifyContent: "center" },
  dailyBlob: { position: "absolute", width: 140, height: 140, borderRadius: 70, backgroundColor: T.abricot, opacity: 0.9, right: -34, bottom: -44 },
  dailyK: { color: "#9DB0D4", fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  dailyTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8, maxWidth: 230, lineHeight: 28 },
  dailySub: { color: "#9DB0D4", fontSize: 14, fontWeight: "600", marginTop: 6, maxWidth: 230, lineHeight: 20 },
  dailyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, padding: 14, marginTop: 18 },
  dailyBtnText: { color: T.night, fontSize: 15, fontWeight: "800" },

  dailyDoneCard: { backgroundColor: T.card, borderRadius: 26, padding: 22, marginHorizontal: 26, marginBottom: 14, alignItems: "center" },
  dailyDoneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  dailyDoneTitle: { color: T.night, fontSize: 18, fontWeight: "800" },
  dailyDoneSub: { color: T.inkSoft, fontSize: 14, fontWeight: "600", textAlign: "center", lineHeight: 20, marginTop: 6 },

  rowCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 20, padding: 16, marginHorizontal: 26, marginBottom: 14 },
  rowIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: T.night, fontSize: 15, fontWeight: "800" },
  rowSub: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },
  lockPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: T.chipAbricot, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 9 },
  lockText: { color: T.abricotDeep, fontSize: 11, fontWeight: "800" },

  exprCard: { backgroundColor: T.miel, borderRadius: 22, padding: 18, marginHorizontal: 26 },
  exprK: { color: "#7A4A17", fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 6 },
  exprEn: { color: T.night, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  exprFr: { color: "#7A4A17", fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 5 },
  exprExample: { color: T.night, fontSize: 14, fontWeight: "700", fontStyle: "italic", marginTop: 10, lineHeight: 20 },
  exprExampleFr: { color: "#7A4A17", fontSize: 12.5, fontWeight: "600", marginTop: 3, lineHeight: 18 },

  celebrateOverlay: { flex: 1, backgroundColor: "rgba(27,42,74,0.85)", alignItems: "center", justifyContent: "center", padding: 36 },
  celebrateCard: { backgroundColor: T.cream, borderRadius: 26, padding: 28, width: "100%", alignItems: "center" },
  celebrateIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  celebrateNum: { color: T.night, fontSize: 56, fontWeight: "800", letterSpacing: -2, lineHeight: 60 },
  celebrateUnit: { color: T.abricotDeep, fontSize: 18, fontWeight: "800", marginTop: 2 },
  celebrateMsg: { color: T.inkSoft, fontSize: 15, fontWeight: "600", textAlign: "center", lineHeight: 22, marginTop: 14, marginBottom: 22 },
  celebrateBtn: { backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", alignSelf: "stretch" },
  celebrateBtnText: { color: T.night, fontSize: 15, fontWeight: "800" },
  
});