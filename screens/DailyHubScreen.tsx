// Défis du jour : hub des exercices quotidiens (lecture, traduction, écoute).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { getChallengesDone, HUB_CHALLENGES, ChallengeType } from "../lib/dailyChallenges";
import { markTrialExerciseUsed } from "../lib/profile";

import TuileLecture from "../assets/hub/tuile-lecture.svg";
import TuileTraduction from "../assets/hub/tuile-traduction.svg";
import TuileEcoute from "../assets/hub/tuile-ecoute.svg";
import TropheeJourneeComplete from "../assets/hub/trophee-journee-complete.svg";

// Libellés et icônes partagés entre les cartes et le stepper.
const LABEL: Record<ChallengeType, string> = { reading: "Lecture", translation: "Traduction", listening: "Écoute" };
const ICON: Record<ChallengeType, keyof typeof Feather.glyphMap> = { reading: "book-open", translation: "repeat", listening: "headphones" };
// Durées estimées — absentes du modèle de données actuel, valeurs proposées à ajuster si besoin.
const DURATION: Record<ChallengeType, string> = { reading: "≈ 3 min", translation: "≈ 4 min", listening: "≈ 3 min" };
const TILE: Record<ChallengeType, React.ComponentType<any>> = { reading: TuileLecture, translation: TuileTraduction, listening: TuileEcoute };
// Sous-titre affiché quand le défi n'est PAS fait — repris de la maquette pour traduction/écoute,
// proposé dans le même ton (impératif, 2e personne) pour la lecture (non visible sur la maquette, déjà "terminé" dedans).
const DESC: Record<ChallengeType, string> = {
  reading: "Lis un texte, à ton rythme",
  translation: "Traduis un court texte, à ta façon",
  listening: "Écoute et réponds aux questions",
};

// Légère animation de pression, cohérente avec le reste de l'app (ScenariosScreen).
function Pressy({ onPress, disabled, style, children }: { onPress?: () => void; disabled?: boolean; style?: any; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => !disabled && Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const onPressOut = () => !disabled && Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export default function DailyHubScreen({
  onBack,
  onOpenReading,
  onOpenTranslation,
  onOpenListening,
  premium,
  trialExercisesDone,
  onLocked,
}: {
  onBack: () => void;
  onOpenReading?: () => void;
  onOpenTranslation?: () => void;
  onOpenListening?: () => void;
  premium: boolean;
  trialExercisesDone: { reading?: boolean; translation?: boolean; listening?: boolean };
  onLocked: () => void;
}) {
  const [done, setDone] = useState<Record<ChallengeType, boolean> | null>(null);
  const [justUsed, setJustUsed] = useState<Partial<Record<ChallengeType, boolean>>>({});

  useEffect(() => {
    getChallengesDone().then(setDone);
  }, []);

  const doneCount = done ? HUB_CHALLENGES.reduce((n, c) => n + (done[c] ? 1 : 0), 0) : 0;
  const total = HUB_CHALLENGES.length;
  const allDone = done !== null && doneCount === total;
  // Le défi "en cours" = le premier non terminé, dans l'ordre du hub.
  const currentIndex = done ? HUB_CHALLENGES.findIndex((c) => !done[c]) : -1;

  const OPEN: Record<ChallengeType, (() => void) | undefined> = {
    reading: onOpenReading, translation: onOpenTranslation, listening: onOpenListening,
  };

  const isLocked = (c: ChallengeType) => !premium && (!!trialExercisesDone[c] || !!justUsed[c]);

  const handleOpen = (c: ChallengeType) => {
    if (premium) { OPEN[c]?.(); return; }
    if (trialExercisesDone[c] || justUsed[c]) { onLocked(); return; }
    setJustUsed((prev) => ({ ...prev, [c]: true }));
    markTrialExerciseUsed(c).catch(() => {});
    OPEN[c]?.();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}><Feather name="chevron-left" size={26} color={T.night} /></Pressable>
        <Text style={styles.headerTitle}>Défis du jour</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.lead}>Trois mini-jeux de quelques minutes. Commence par celui que tu veux.</Text>

        <View style={styles.progressCard}>
          <View style={styles.blobBehind} />
          <View style={styles.progressTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.progressNum}>
                {done === null ? "…" : allDone ? "Journée complète !" : `${doneCount} sur ${total}`}
              </Text>
              {done !== null && (
                <Text style={styles.progressLabel}>
                  {allDone ? "Bravo, reviens demain pour la suite." : `Encore ${total - doneCount} pour boucler ta journée`}
                </Text>
              )}
            </View>
            <View style={[styles.trophyBadge, allDone && styles.trophyBadgeOn]}>
              <TropheeJourneeComplete width={26} height={26} opacity={allDone ? 1 : 0.55} />
            </View>
          </View>

          {done !== null && (
            <View style={styles.stepper}>
              {HUB_CHALLENGES.map((c, i) => {
                const isDone = done[c];
                const isCurrent = i === currentIndex;
                const state = isDone ? "done" : isCurrent ? "current" : "upcoming";
                return (
                  <React.Fragment key={c}>
                    {i > 0 && (
                      done[HUB_CHALLENGES[i - 1]] ? (
                        <View style={[styles.connector, { backgroundColor: T.menthe }]} />
                      ) : (
                        <View style={[styles.connector, styles.connectorDashed]}>
                          {Array.from({ length: 5 }).map((_, k) => <View key={k} style={styles.dashSeg} />)}
                        </View>
                      )
                    )}
                    <View style={styles.stepDotWrap}>
                      <View style={[styles.stepDot, state === "done" && styles.stepDotDone, state === "current" && styles.stepDotCurrent, state === "upcoming" && styles.stepDotUpcoming]}>
                        {state === "done" ? (
                          <Feather name="check" size={18} color={T.night} />
                        ) : (
                          <Feather name={ICON[c]} size={17} color={state === "current" ? "#fff" : "rgba(255,255,255,0.4)"} />
                        )}
                      </View>
                      <Text style={[styles.stepLabel, state === "upcoming" && styles.stepLabelMuted]}>{LABEL[c]}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>

        {done === null ? (
          <ActivityIndicator color={T.abricot} style={{ marginTop: 30 }} />
        ) : (
          HUB_CHALLENGES.map((c) => {
            const isDone = done[c];
            const cardLocked = isLocked(c);
            const Tile = TILE[c];
            return (
              <Pressy key={c} onPress={() => handleOpen(c)} style={styles.card}>
                <View style={styles.tileWrap}>
                  <Tile width={68} height={68} />
                  {cardLocked && <View style={styles.tileLockOverlay}><Feather name="lock" size={16} color="#fff" /></View>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardOverline}>{LABEL[c].toUpperCase()} · {DURATION[c]}</Text>
                  <Text style={styles.cardTitle}>{LABEL[c]} du jour</Text>
                  <Text style={styles.cardSub}>{isDone ? "Terminé · bravo !" : cardLocked ? "Débloque l'accès illimité" : DESC[c]}</Text>
                </View>
                {isDone ? (
                  <View style={styles.doneBadge}><Feather name="check" size={18} color="#fff" /></View>
                ) : cardLocked ? (
                  <View style={styles.goBadge}><Feather name="lock" size={13} color={T.night} /></View>
                ) : (
                  <View style={styles.goBadge}>
                    <Text style={styles.goText}>Go</Text>
                    <Feather name="chevron-right" size={16} color={T.night} />
                  </View>
                )}
              </Pressy>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 56, paddingBottom: 8 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: T.night, letterSpacing: -0.3 },
  lead: { color: T.inkSoft, fontSize: 14, fontWeight: "600", lineHeight: 20, marginTop: 10, marginBottom: 18, paddingHorizontal: 6 },

  progressCard: { backgroundColor: T.night, borderRadius: 24, padding: 20, marginBottom: 18, overflow: "hidden" },
  blobBehind: { position: "absolute", top: -40, right: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(245,183,136,0.14)" },
  progressTop: { flexDirection: "row", alignItems: "flex-start" },
  progressNum: { color: "#fff", fontSize: 21, fontWeight: "800", letterSpacing: -0.4 },
  progressLabel: { color: "#9DB0D4", fontSize: 13, fontWeight: "700", marginTop: 4 },
  trophyBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  trophyBadgeOn: { backgroundColor: T.abricot },

  stepper: { flexDirection: "row", alignItems: "flex-start", marginTop: 22 },
  // Le connecteur est calé au centre vertical exact du rond (46px de haut, donc 23 - 1 de moitié de trait).
  connector: { flex: 1, height: 2, marginTop: 22 },
  connectorDashed: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "transparent" },
  dashSeg: { width: 5, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  stepDotWrap: { alignItems: "center", gap: 7 },
  stepDot: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  stepDotDone: { backgroundColor: T.menthe },
  stepDotCurrent: { backgroundColor: T.abricot },
  stepDotUpcoming: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.3)", borderStyle: "dashed" },
  stepLabel: { color: "#fff", fontSize: 12, fontWeight: "800" },
  stepLabelMuted: { color: "rgba(255,255,255,0.4)", fontWeight: "700" },

  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 22, padding: 18, marginBottom: 14 },
  tileWrap: { width: 68, height: 68, borderRadius: 18, overflow: "hidden" },
  tileLockOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(27,42,74,0.55)", alignItems: "center", justifyContent: "center" },
  cardOverline: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  cardTitle: { color: T.night, fontSize: 16.5, fontWeight: "800", marginTop: 3 },
  cardSub: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2, lineHeight: 18 },
  doneBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center" },
  goBadge: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
  goText: { color: T.night, fontSize: 14, fontWeight: "800" },
});
