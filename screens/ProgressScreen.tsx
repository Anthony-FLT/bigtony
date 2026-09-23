import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { computeStreak, getWeekActivity, getWeeklyGoalStatus, STREAK_MILESTONES } from "../lib/streak";
import { getChallengeStats } from "../lib/dailyChallenges";
import { getWeekSpeakingMinutes } from "../lib/speakingTime";
import { getProgressStats, TroubleWord } from "../lib/progressstats";
import { listFavorites } from "../lib/favorites";
import { loadProfile } from "../lib/profile";
import { Scenario } from "../lib/scenarios";
import WeekStrip from "../components/WeekStrip";
import { SkeletonHeader, SkeletonBox } from "../components/Skeleton";

type Data = {
  streak: number;
  weekActivity: boolean[];
  weeklyGoal: number;
  todayDone: number;
  weekDone: number;
  weekConversations: number;
  weekNewWords: number;
  dictionaryTotal: number;
  speakingPerDay: number[];
  speakingTotalMinutes: number;
  topTroubleWord: TroubleWord;
};

const DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export default function ProgressScreen({
  refreshKey,
  onResume,
  onGoLabo,
  onGoFavorites,
}: {
  refreshKey: number;
  onResume?: (s: Scenario) => void;
  onGoLabo: () => void;
  onGoFavorites: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [period, setPeriod] = useState<"semaine" | "mois">("semaine");

  useEffect(() => {
    setData(null);
    (async () => {
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);

      const [profile, streak, weekActivity, challengeStats, speaking, progressStats, favorites] = await Promise.all([
        loadProfile(),
        computeStreak(),
        getWeekActivity(),
        getChallengeStats(),
        getWeekSpeakingMinutes(),
        getProgressStats(),
        listFavorites(),
      ]);
      const weeklyGoal = profile?.weeklyGoal ?? 3;
      const goalStatus = await getWeeklyGoalStatus(weeklyGoal);
      const weekNewWords = favorites.filter((f) => {
        const t = (f.addedAt as any)?.toDate ? (f.addedAt as any).toDate() : null;
        return t && t >= monday;
      }).length;

      setData({
        streak,
        weekActivity,
        weeklyGoal: goalStatus.goal,
        todayDone: challengeStats.todayDone,
        weekDone: challengeStats.weekDone,
        weekConversations: progressStats.weekConversations,
        weekNewWords,
        dictionaryTotal: favorites.length,
        speakingPerDay: speaking.perDay,
        speakingTotalMinutes: speaking.totalMinutes,
        topTroubleWord: progressStats.topTroubleWord,
      });
    })();
  }, [refreshKey]);

  if (!data) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.head}><Text style={styles.h1}>Tes progrès</Text></View>
        <View style={{ paddingHorizontal: 26 }}>
          <SkeletonHeader message="Chargement de tes progrès…" />
          <SkeletonBox height={160} radius={24} style={{ marginBottom: 14 }} />
          <SkeletonBox height={140} radius={22} style={{ marginBottom: 14 }} />
          <SkeletonBox height={140} radius={20} style={{ marginBottom: 14 }} />
        </View>
      </ScrollView>
    );
  }

  const nextMilestone = STREAK_MILESTONES.find((m) => m > data.streak) ?? STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
  const prevMilestone = STREAK_MILESTONES.filter((m) => m <= data.streak).pop() ?? 0;
  const milestoneProgress = Math.max(0, Math.min(1, (data.streak - prevMilestone) / (nextMilestone - prevMilestone || 1)));
  const maxSpeakMinutes = Math.max(1, ...data.speakingPerDay);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={styles.head}>
        <Text style={styles.h1}>Tes progrès</Text>
        <View style={styles.periodToggle}>
          <Pressable onPress={() => setPeriod("semaine")} style={[styles.periodPill, period === "semaine" && styles.periodPillOn]}>
            <Text style={[styles.periodText, period === "semaine" && styles.periodTextOn]}>Semaine</Text>
          </Pressable>
          <Pressable onPress={() => setPeriod("mois")} style={[styles.periodPill, period === "mois" && styles.periodPillOn]}>
            <Text style={[styles.periodText, period === "mois" && styles.periodTextOn]}>Mois</Text>
          </Pressable>
        </View>
      </View>

      {period === "mois" ? (
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>La vue mensuelle arrive bientôt.</Text>
        </View>
      ) : (
        <>
          {/* Streak + objectif de la semaine */}
          <View style={styles.streakCard}>
            <View style={styles.streakBlob} />
            <View style={styles.streakTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.streakK}>TA SÉRIE</Text>
                <View style={styles.streakRow}>
                  <Text style={styles.streakNum}>{data.streak}</Text>
                  <Text style={styles.streakUnit}>jour{data.streak > 1 ? "s" : ""}</Text>
                </View>
                <Text style={styles.streakMsg}>
                  {data.streak === 0
                    ? "Reprends aujourd'hui pour relancer ta série."
                    : data.streak < 3
                    ? "Beau début. Reviens demain pour l'entretenir."
                    : "Tu tiens le rythme. Ne lâche rien."}
                </Text>
              </View>
              <View style={styles.flameBadge}>
                <MaterialCommunityIcons name="fire" size={26} color={T.abricot} />
              </View>
            </View>
            <WeekStrip days={data.weekActivity} goal={data.weeklyGoal} dark />
          </View>

          {/* Cette semaine — 4 statistiques */}
          <Text style={styles.sectionK}>CETTE SEMAINE</Text>
          <View style={styles.statGrid}>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: "#FBE9C7" }]}><Feather name="award" size={17} color="#B0821A" /></View>
              <Text style={styles.statNum}>{data.todayDone}<Text style={styles.statDenom}>/3</Text></Text>
              <Text style={styles.statLabel}>défis faits aujourd'hui</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: "#DFF3E4" }]}><Feather name="zap" size={17} color="#2E7D53" /></View>
              <Text style={styles.statNum}>{data.weekDone}</Text>
              <Text style={styles.statLabel}>défis cette semaine</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: T.chipAbricot }]}><Feather name="message-circle" size={17} color={T.abricotDeep} /></View>
              <Text style={styles.statNum}>{data.weekConversations}</Text>
              <Text style={styles.statLabel}>conversation{data.weekConversations > 1 ? "s" : ""}</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: "#E9E3FB" }]}><Feather name="book-open" size={17} color="#5B3FA6" /></View>
              <Text style={styles.statNum}>{data.weekNewWords}</Text>
              <Text style={styles.statLabel}>mot{data.weekNewWords > 1 ? "s" : ""} dans ton dictionnaire</Text>
            </View>
          </View>

          {/* Temps de parole */}
          <View style={styles.speakCard}>
            <View style={styles.speakHead}>
              <Text style={styles.speakTitle}>Temps de parole</Text>
              <Text style={styles.speakTotal}>{data.speakingTotalMinutes} min <Text style={styles.speakTotalMuted}>au total</Text></Text>
            </View>
            <View style={styles.speakChart}>
              {data.speakingPerDay.map((min, i) => (
                <View key={i} style={styles.speakBarWrap}>
                  {min > 0 && <Text style={styles.speakBarLabel}>{min} min</Text>}
                  <View style={[styles.speakBar, { height: Math.max(4, (min / maxSpeakMinutes) * 60) }]} />
                </View>
              ))}
            </View>
            <View style={styles.speakDayRow}>
              {DAY_LABELS.map((l, i) => <Text key={i} style={styles.speakDayLabel}>{l}</Text>)}
            </View>
          </View>

          {/* À travailler */}
          <Text style={styles.sectionK}>À TRAVAILLER</Text>
          {data.topTroubleWord && (
            <Pressable style={styles.troubleCard} onPress={onGoLabo}>
              <View style={styles.troubleWordBox}><Text style={styles.troubleWordText}>{data.topTroubleWord.word}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.troubleTitle}>Le mot qui te résiste le plus</Text>
                <Text style={styles.troubleSub}>On le corrige ensemble au Labo ?</Text>
              </View>
              <View style={styles.goBadge}><Text style={styles.goBadgeText}>Go</Text></View>
            </Pressable>
          )}
          <Pressable style={styles.dictCard} onPress={onGoFavorites}>
            <View style={styles.dictIcon}><Feather name="star" size={18} color={T.abricotDeep} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dictTitle}>Mon dictionnaire</Text>
              <Text style={styles.dictSub}>{data.dictionaryTotal} mot{data.dictionaryTotal > 1 ? "s" : ""} gardé{data.dictionaryTotal > 1 ? "s" : ""}</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#D9B78E" />
          </Pressable>

          {/* Prochain palier */}
          <Text style={styles.sectionK}>PROCHAIN PALIER</Text>
          <View style={styles.milestoneCard}>
            <View style={styles.milestoneIcon}><MaterialCommunityIcons name="medal-outline" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <View style={styles.milestoneTopRow}>
                <Text style={styles.milestoneTitle}>{nextMilestone} jours de suite</Text>
                <Text style={styles.milestoneFrac}>{data.streak}/{nextMilestone}</Text>
              </View>
              <View style={styles.milestoneTrack}>
                <View style={[styles.milestoneFill, { width: `${milestoneProgress * 100}%` }]} />
              </View>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingHorizontal: 26, paddingBottom: 16 },
  h1: { fontSize: 26, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  periodToggle: { flexDirection: "row", backgroundColor: T.card, borderRadius: 12, padding: 3, gap: 2 },
  periodPill: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 9 },
  periodPillOn: { backgroundColor: "#FFFFFF" },
  periodText: { color: T.inkSoft, fontSize: 13, fontWeight: "700" },
  periodTextOn: { color: T.night },

  comingSoon: { backgroundColor: T.card, borderRadius: 20, padding: 30, marginHorizontal: 26, alignItems: "center" },
  comingSoonText: { color: T.inkSoft, fontSize: 14.5, fontWeight: "600", textAlign: "center" },

  streakCard: { backgroundColor: T.night, borderRadius: 24, padding: 20, marginHorizontal: 26, marginBottom: 14, overflow: "hidden" },
  streakBlob: { position: "absolute", top: -30, right: -30, width: 130, height: 130, borderRadius: 65, backgroundColor: "rgba(245,183,136,0.12)" },
  streakTop: { flexDirection: "row", alignItems: "flex-start" },
  streakK: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  streakRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 },
  streakNum: { color: T.abricot, fontSize: 42, fontWeight: "800", letterSpacing: -1.2 },
  streakUnit: { color: "#fff", fontSize: 16, fontWeight: "800" },
  streakMsg: { color: "#9DB0D4", fontSize: 13.5, fontWeight: "600", lineHeight: 19, marginTop: 6 },
  flameBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },

  sectionK: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginHorizontal: 26, marginTop: 6, marginBottom: 10 },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginHorizontal: 26, marginBottom: 8 },
  statCard: { width: "47%", backgroundColor: T.card, borderRadius: 18, padding: 16 },
  statIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  statNum: { color: T.night, fontSize: 26, fontWeight: "800", letterSpacing: -0.6 },
  statDenom: { color: T.inkSoft, fontSize: 15, fontWeight: "700" },
  statLabel: { color: T.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 3, lineHeight: 16 },

  speakCard: { backgroundColor: T.card, borderRadius: 20, padding: 18, marginHorizontal: 26, marginTop: 8, marginBottom: 20 },
  speakHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  speakTitle: { color: T.night, fontSize: 15.5, fontWeight: "800" },
  speakTotal: { color: T.night, fontSize: 14, fontWeight: "800" },
  speakTotalMuted: { color: T.inkSoft, fontSize: 12, fontWeight: "600" },
  speakChart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 78, marginTop: 18, paddingTop: 16 },
  speakBarWrap: { flex: 1, alignItems: "center" },
  speakBarLabel: { position: "absolute", top: -16, fontSize: 10, fontWeight: "800", color: T.abricotDeep },
  speakBar: { width: 14, borderRadius: 5, backgroundColor: T.abricot },
  speakDayRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, borderTopWidth: 1, borderTopColor: T.creamLine, paddingTop: 8 },
  speakDayLabel: { flex: 1, textAlign: "center", color: T.inkSoft, fontSize: 11.5, fontWeight: "700" },

  troubleCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.night, borderRadius: 20, padding: 16, marginHorizontal: 26, marginBottom: 10 },
  troubleWordBox: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minWidth: 60, alignItems: "center" },
  troubleWordText: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  troubleTitle: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  troubleSub: { color: "#9DB0D4", fontSize: 12.5, fontWeight: "600", marginTop: 2 },
  goBadge: { backgroundColor: T.abricot, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 14 },
  goBadgeText: { color: T.night, fontSize: 13, fontWeight: "800" },

  dictCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 20, padding: 16, marginHorizontal: 26, marginBottom: 20 },
  dictIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  dictTitle: { color: T.night, fontSize: 15, fontWeight: "800" },
  dictSub: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },

  milestoneCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.miel, borderRadius: 20, padding: 16, marginHorizontal: 26 },
  milestoneIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(27,42,74,0.18)", alignItems: "center", justifyContent: "center" },
  milestoneTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  milestoneTitle: { color: T.night, fontSize: 15, fontWeight: "800" },
  milestoneFrac: { color: "#7A4A17", fontSize: 12.5, fontWeight: "700" },
  milestoneTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.5)", marginTop: 8, overflow: "hidden" },
  milestoneFill: { height: 8, borderRadius: 4, backgroundColor: T.night },
});
