import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal, Image, Animated, Easing } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { PaywallSource } from "../lib/analytics";
import { getTodayDailySession, isDailyDone } from "../lib/daily";
import { computeStreak, milestoneReached } from "../lib/streak";
import { loadProfile, Profile, saveMilestone } from "../lib/profile";
import { getDailyExpression, Expression } from "../lib/expression";
import { getChallengesDone, HUB_CHALLENGES } from "../lib/dailyChallenges";
import { addFavorite, removeFavorite, listFavorites } from "../lib/favorites";
import WeekStrip from "../components/WeekStrip";
import { listPracticeWords } from "../lib/practiceWords";
import { getWeekActivity } from "../lib/streak";
import DebriefView from "../components/DebriefView";

const CHAT_IMG = require("../assets/illustrations/chat-bubbles.png");
const TARGET_IMG = require("../assets/illustrations/target.png");
const MIC_IMG = require("../assets/illustrations/mic.png");
const WORDS_IMG = require("../assets/illustrations/words.png");

// Cache mémoire de l'expression du jour : conservé tant que l'app tourne, renouvelé chaque jour.
// Un retour sur l'accueil l'affiche instantanément, sans nouvel appel.
let exprCache: { day: string; expr: Expression; fav: boolean } | null = null;
const todayKey = () => new Date().toDateString();
const exprCacheFresh = () => exprCache !== null && exprCache.day === todayKey();

// 3 respirations (≈ 7 s) à chaque affichage tant que `active` est vrai, puis retour à la taille normale
const BREATH_SCALE = 1.07;
function useBreath(active: boolean) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (!active) return;
    const anim = Animated.sequence([
      Animated.delay(600),
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        { iterations: 3 }
      ),
    ]);
    anim.start();
    return () => {
      anim.stop();
      v.setValue(0);
    };
  }, [active, v]);
  return v.interpolate({ inputRange: [0, 1], outputRange: [1, BREATH_SCALE] });
}

// Squelette de la card « Expression du jour » : mêmes dimensions, barres qui pulsent
function ExprSkeleton() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });

  return (
    <View style={styles.exprCard}>
      <Text style={styles.exprK}>EXPRESSION DU JOUR</Text>
      <Animated.View style={{ opacity }}>
        <View style={[styles.skelBar, { width: "62%", height: 22, marginTop: 8 }]} />
        <View style={[styles.skelBar, { width: "45%", height: 14, marginTop: 8 }]} />
        <View style={[styles.skelBar, { width: "92%", height: 13, marginTop: 14 }]} />
        <View style={[styles.skelBar, { width: "74%", height: 13, marginTop: 7 }]} />
      </Animated.View>
    </View>
  );
}

export default function HomeScreen({
  refreshKey,
  premium,
  firstSessionDone,
  trialExercisesDone,
  onStartWelcome,
  onStartDaily,
  onGoLabo,
  onGoScenarios,
  onGoDailyHub,
  onGoFavorites,
  onShowPaywall,
}: {
  refreshKey: number;
  premium: boolean;
  firstSessionDone: boolean;
  trialExercisesDone: { reading?: boolean; translation?: boolean; listening?: boolean };
  onStartWelcome: () => void;
  onStartDaily: () => void;
  onGoLabo: () => void;
  onGoScenarios: () => void;
  onGoDailyHub: () => void;
  onGoFavorites: () => void;
  onShowPaywall: (source: PaywallSource) => void;
}) {
  const allTrialExercisesUsed = !!(trialExercisesDone.reading && trialExercisesDone.translation && trialExercisesDone.listening);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dailyDone, setDailyDone] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [celebrate, setCelebrate] = useState<number | null>(null);
  const [expr, setExpr] = useState<Expression | null>(() => (exprCacheFresh() ? exprCache!.expr : null));
  const [exprFav, setExprFav] = useState(() => (exprCacheFresh() ? exprCache!.fav : false));
  const [exprLoading, setExprLoading] = useState(() => !exprCacheFresh());
  const [week, setWeek] = useState<boolean[]>(new Array(7).fill(false));
  const [laboCount, setLaboCount] = useState(0);
  const [hubDone, setHubDone] = useState(0);
  const [showDebrief, setShowDebrief] = useState(false);
  const [todaySession, setTodaySession] = useState<any | null>(null);

  // Respirations d'incitation : d'abord la conversation de présentation, puis les Défis du jour
  const anyTrialExerciseDone = !!(trialExercisesDone.reading || trialExercisesDone.translation || trialExercisesDone.listening);
  const welcomeScale = useBreath(!premium && !firstSessionDone);
  const hubScale = useBreath(firstSessionDone && !anyTrialExerciseDone && hubDone === 0);

  useEffect(() => {
    setDailyDone(null);
    (async () => {
      const [p, done, s] = await Promise.all([loadProfile(), isDailyDone(), computeStreak()]);
      setProfile(p);
      setDailyDone(done);
      setStreak(s);

      const reached = milestoneReached(s);
      if (reached && (p?.lastMilestone ?? 0) < reached) {
        setCelebrate(reached);
        saveMilestone(reached);
      }

      getWeekActivity().then(setWeek);
      getTodayDailySession().then(setTodaySession);
      getChallengesDone().then((d) => setHubDone(HUB_CHALLENGES.reduce((n, c) => n + (d[c] ? 1 : 0), 0)));
      listPracticeWords().then((ws: any[]) => setLaboCount(ws.filter((w) => !w.mastered).length)).catch(() => {});
    })();
  }, [refreshKey]);

  // Expression du jour : lancée tout de suite (sans attendre le profil), servie depuis le cache si possible
  useEffect(() => {
    const isFav = (list: any[], e: Expression) => list.some((x) => x.word.toLowerCase() === e.en.toLowerCase());

    if (exprCacheFresh()) {
      const cached = exprCache!;
      setExpr(cached.expr);
      setExprFav(cached.fav);
      setExprLoading(false);
      // L'étoile peut avoir changé ailleurs (dictionnaire) : on la resynchronise en arrière-plan
      listFavorites()
        .then((f) => {
          const fav = isFav(f, cached.expr);
          if (exprCache) exprCache.fav = fav;
          setExprFav(fav);
        })
        .catch(() => {});
      return;
    }

    setExprLoading(true);
    getDailyExpression()
      .then(async (e) => {
        let fav = false;
        if (e) {
          fav = await listFavorites().then((f) => isFav(f, e)).catch(() => false);
          exprCache = { day: todayKey(), expr: e, fav };
        }
        setExpr(e);
        setExprFav(fav);
      })
      .catch(() => {})
      .finally(() => setExprLoading(false));
  }, [refreshKey]);

  const toggleExprFav = async () => {
    if (!expr) return;
    if (!premium) { onShowPaywall("daily_expression_favorite"); return; }
    if (exprFav) { await removeFavorite(expr.en); setExprFav(false); if (exprCache) exprCache.fav = false; }
    else { await addFavorite(expr.en, expr.fr); setExprFav(true); if (exprCache) exprCache.fav = true; }
  };

  const total = HUB_CHALLENGES.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>

      {/* ===== Bandeau bleu enveloppant : en-tête + discussion du jour ===== */}
      <View style={styles.banner}>
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Salut {profile?.name ?? ""} </Text>
            <Text style={styles.helloSub}>Prêt à parler anglais aujourd'hui ?</Text>
            <WeekStrip days={week} goal={profile?.weeklyGoal ?? 3} dark />
          </View>
          <View style={styles.streakPill}>
            <Feather name="zap" size={16} color={T.abricot} />
            <Text style={styles.streakNum}>{streak}</Text>
            <Text style={styles.streakUnit}>jour{streak > 1 ? "s" : ""}</Text>
            <Text style={styles.streakLabel}>série actuelle</Text>
          </View>
        </View>

        {/* Discussion du jour — la vedette */}
        {!premium ? (
          !firstSessionDone ? (
            <Animated.View style={{ transform: [{ scale: welcomeScale }] }}>
            <Pressable style={styles.dailyCard} onPress={onStartWelcome}>
              <View style={styles.dailyBlob} />
              <Image source={CHAT_IMG} style={styles.dailyImg} resizeMode="contain" />
              <View style={styles.dailyKRow}>
                <Feather name="gift" size={14} color={T.abricot} />
                <Text style={styles.dailyK}>UN CADEAU SURPRISE T'ATTEND À LA FIN</Text>
              </View>
              <Text style={styles.dailyTitle}>Ta conversation de présentation t'attend</Text>
              <Text style={styles.dailySub}>Découvre le coach IA, sans engagement.</Text>
              <View style={styles.dailyBtn}>
                <Feather name="mic" size={18} color={T.night} />
                <Text style={styles.dailyBtnText}>Commencer</Text>
              </View>
            </Pressable>
            </Animated.View>
          ) : (
            <Pressable style={styles.dailyCard} onPress={() => onShowPaywall("welcome_already_used")}>
              <View style={styles.dailyBlob} />
              <Image source={CHAT_IMG} style={styles.dailyImg} resizeMode="contain" />
              <View style={styles.dailyKRow}>
                <Feather name="unlock" size={14} color={T.abricot} />
                <Text style={styles.dailyK}>TU AS TESTÉ L'APP</Text>
              </View>
              <Text style={styles.dailyTitle}>Débloque un accès illimité</Text>
              <Text style={styles.dailySub}>Discussions, Labo, favoris — tout, chaque jour.</Text>
              <View style={styles.dailyBtn}>
                <Feather name="unlock" size={18} color={T.night} />
                <Text style={styles.dailyBtnText}>Voir les offres</Text>
              </View>
            </Pressable>
          )
        ) : dailyDone === null ? (
          <View style={[styles.dailyCard, { alignItems: "center", justifyContent: "center" }]}>
            <ActivityIndicator color={T.abricot} />
          </View>
        ) : dailyDone ? (
          <View style={styles.dailyDoneCard}>
            <View style={styles.doneRow}>
              <View style={styles.dailyDoneIcon}><Feather name="check" size={20} color={T.night} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dailyDoneTitle}>Discussion du jour terminée</Text>
                <Text style={styles.dailyDoneSub}>Beau travail. Ta série continue.</Text>
              </View>
            </View>
            <Pressable style={styles.doneNext} onPress={onGoLabo}>
              <Feather name="target" size={16} color={T.abricotDeep} />
              <Text style={styles.doneNextText}>
                {laboCount > 0
                  ? `Continue sur ta lancée : ${laboCount} mot${laboCount > 1 ? "s" : ""} à polir au Labo`
                  : "Continue sur ta lancée au Labo"}
              </Text>
              <Feather name="chevron-right" size={18} color={T.abricotDeep} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.dailyCard} onPress={onStartDaily}>
            <View style={styles.dailyBlob} />
            <Image source={CHAT_IMG} style={styles.dailyImg} resizeMode="contain" />
            <View style={styles.dailyKRow}>
              <Feather name="message-circle" size={14} color={T.abricot} />
              <Text style={styles.dailyK}>DISCUSSION DU JOUR</Text>
            </View>
            <Text style={styles.dailyTitle}>Une conversation surprise t'attend</Text>
            <Text style={styles.dailySub}>Choisis un thème et discute librement avec ton partenaire IA.</Text>
            <View style={styles.dailyBtn}>
              <Feather name="mic" size={18} color={T.night} />
              <Text style={styles.dailyBtnText}>Commencer</Text>
            </View>
          </Pressable>
        )}
      </View>

      {/* ===== Contenu (fond clair) ===== */}
      <Text style={styles.trainTitle}>S'entraîner</Text>
      <View style={styles.tileRow}>
        <Pressable style={[styles.tile, styles.tilePeach]} onPress={onGoScenarios}>
          <Image source={MIC_IMG} style={styles.tileImg} resizeMode="contain" />
          <Text style={styles.tileLabel}>Parler</Text>
          <Text style={styles.tileSub}>Une scène au choix</Text>
        </Pressable>
        <Pressable style={[styles.tile, styles.tileLavender]} onPress={onGoFavorites}>
          <Image source={WORDS_IMG} style={styles.tileImg} resizeMode="contain" />
          <Text style={styles.tileLabel}>Réviser</Text>
          <Text style={styles.tileSub}>Tes mots favoris</Text>
        </Pressable>
      </View>

      {/* Défis du jour */}
      <Animated.View style={{ transform: [{ scale: hubScale }] }}>
      <Pressable style={styles.hubCard} onPress={onGoDailyHub}>
        {!premium && allTrialExercisesUsed && <View style={styles.lockBadge}><Feather name="lock" size={12} color="#fff" /></View>}
        <Image source={TARGET_IMG} style={styles.hubImg} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.hubTitle}>Défis du jour</Text>
          <Text style={styles.hubSub}>
            {!premium && !allTrialExercisesUsed
              ? "3 exercices à l'essai, gratuitement"
              : hubDone > 0
              ? `${hubDone} / ${total} fait${hubDone > 1 ? "s" : ""} aujourd'hui${hubDone >= total ? " 🎉" : ""}`
              : "Lecture, traduction, écoute"}
          </Text>
        </View>
        {premium && (
          <View style={[styles.ringBadge, hubDone >= total && styles.ringBadgeDone]}>
            {hubDone >= total ? (
              <Feather name="check" size={22} color={T.night} />
            ) : (
              <Text style={styles.ringText}>{hubDone}/{total}</Text>
            )}
          </View>
        )}
      </Pressable>
      </Animated.View>

      {/* Expression du jour (squelette pendant le premier chargement) */}
      {!expr && exprLoading && <ExprSkeleton />}
      {expr && (
        <View style={styles.exprCard}>
          <Pressable onPress={toggleExprFav} hitSlop={8} style={styles.exprStar}>
            <Feather name="star" size={17} color={exprFav ? T.abricotDeep : T.inkSoft} />
          </Pressable>
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

      <Modal visible={showDebrief} animationType="slide" onRequestClose={() => setShowDebrief(false)}>
        <View style={{ flex: 1, backgroundColor: T.cream }}>
          <Pressable onPress={() => setShowDebrief(false)} hitSlop={12} style={{ paddingTop: 56, paddingHorizontal: 26 }}>
            <Feather name="x" size={24} color={T.night} />
          </Pressable>
          <ScrollView contentContainerStyle={{ padding: 26, paddingBottom: 40 }}>
            {todaySession?.debrief && <DebriefView debrief={todaySession.debrief} />}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },

  banner: { backgroundColor: T.night, paddingTop: 46, paddingHorizontal: 26, paddingBottom: 14, borderBottomLeftRadius: 40, borderBottomRightRadius: 40 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  hello: { fontSize: 25, fontWeight: "800", color: "#fff", letterSpacing: -0.4 },
  helloSub: { fontSize: 14, fontWeight: "600", color: "#9DB0D4", marginTop: 4 },
  streakPill: { alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 18, paddingVertical: 10, paddingHorizontal: 13, minWidth: 64 },
  streakNum: { fontSize: 22, fontWeight: "800", color: "#fff", marginTop: 3 },
  streakUnit: { fontSize: 12, fontWeight: "700", color: "#fff" },
  streakLabel: { fontSize: 10, fontWeight: "600", color: "#9DB0D4", marginTop: 2 },

  dailyCard: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 24, padding: 20, marginTop: 16, overflow: "hidden", minHeight: 180, justifyContent: "center" },
  dailyImg: { position: "absolute", width: 150, height: 150, right: -18, bottom: -6 },
  dailyBlob: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: T.abricot, right: -45, bottom: -70 },
  dailyKRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dailyK: { color: T.abricot, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  dailyTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8, maxWidth: 215, lineHeight: 28 },
  dailySub: { color: "#9DB0D4", fontSize: 14, fontWeight: "600", marginTop: 6, maxWidth: 215, lineHeight: 20 },
  dailyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, padding: 14, marginTop: 18, alignSelf: "flex-start", paddingHorizontal: 28 },
  dailyBtnText: { color: T.night, fontSize: 15, fontWeight: "800" },

  dailyDoneCard: { backgroundColor: T.card, borderRadius: 24, padding: 20, marginTop: 20 },
  dailyDoneIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center" },
  dailyDoneTitle: { color: T.night, fontSize: 17, fontWeight: "800" },
  dailyDoneSub: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", lineHeight: 19, marginTop: 3 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  doneNext: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: T.chipAbricot },
  doneNextText: { flex: 1, fontSize: 13.5, fontWeight: "700", color: T.abricotDeep, lineHeight: 18 },

  trainTitle: { fontSize: 18, fontWeight: "800", color: T.night, marginTop: 16, marginBottom: 12, marginHorizontal: 26 },
  tileRow: { flexDirection: "row", gap: 12, marginHorizontal: 26 },
  tile: { flex: 1, borderRadius: 20, padding: 16, alignItems: "flex-start" },
  tilePeach: { backgroundColor: "#F8E4CF" },
  tileLavender: { backgroundColor: "#E7E3FB" },
  tileImg: { width: 66, height: 60, marginBottom: 8 },
  tileLabel: { fontSize: 15.5, fontWeight: "800", color: T.night },
  tileSub: { fontSize: 12, fontWeight: "600", color: T.inkSoft, marginTop: 2 },

  hubCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: T.night, borderRadius: 20, padding: 16, marginHorizontal: 26, marginTop: 14 },
  hubImg: { width: 46, height: 46 },
  hubTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  hubSub: { color: "#9DB0D4", fontSize: 13, fontWeight: "600", marginTop: 2 },
  ringBadge: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: T.abricot, alignItems: "center", justifyContent: "center" },
  lockBadge: { position: "absolute", top: 10, right: 10, zIndex: 2, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(27,42,74,0.85)", alignItems: "center", justifyContent: "center" },
  ringBadgeDone: { backgroundColor: T.abricot },
  ringText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  skelBar: { backgroundColor: "rgba(255, 255, 255, 0.55)", borderRadius: 7 },
  exprCard: { backgroundColor: T.miel, borderRadius: 22, padding: 18, marginHorizontal: 26, marginTop: 22 },
  exprStar: { position: "absolute", top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center", zIndex: 2 },
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
