// LessonScreen — une leçon du parcours (maquettes du 20/10) : chargement → mission → conversation → réussite.
// La validation et les XP sont décidés par le serveur (finalizeAttempt) ; cet écran orchestre et affiche.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Animated, AccessibilityInfo, Image, Easing } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../lib/firebase";
import { loadProfile } from "../../lib/profile";
import { computeStreak } from "../../lib/streak";
import { L, ILL, Icon, RoundButton, Pill, PrimaryButton, ListenButton, SectionLabel } from "../../components/lessonUi";
import LessonConversation, { ConversationEnd } from "./LessonConversation";
import { startOrResumeLesson, updateAttemptState, finalizeAttempt, syncLearningEntitlement, lessonStartError, LessonStartError, warmLessonTurn, warmFinalizeAttempt } from "../../lib/learningPath/attempts";
import { warmAvatar } from "../../lib/liveAvatar/session";
import { getChapter, getLesson, LESSONS, lessonsOfChapter } from "../../lib/learningPath/catalog";
import type { AttemptResult, AttemptTurn, LessonAttempt, LessonDefinition, LessonVariant } from "../../lib/learningPath/types";
import {
  logLessonMissionShown, logLessonStarted, logLessonObjectiveCovered, logLessonCoachingShown, logLessonCoachingRetryDone,
  logLessonAttemptEnd, logLessonInterrupted, logLessonNextClick,
  logAvatarSessionRequested, logAvatarSessionReady, logAvatarSessionFailed, logAvatarSessionStopped, logAvatarFallback,
} from "../../lib/analytics";
import { useAvatarSession } from "../../lib/liveAvatar/useAvatarSession";
import { coachForVoice } from "../../lib/learningPath/coaches";
import { coachIntroEn } from "../../lib/learningPath/intro";
import { O, IMAGES, OnbIcon, CoachMedallion, PrimaryCta, SecondaryLink } from "../../components/onbUi";
import SourceSheet from "../../components/SourceSheet";
type AttemptResultLike = Awaited<ReturnType<typeof finalizeAttempt>>;

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type Phase = "loading" | "error" | "mission" | "conversation" | "validating" | "success";
export type LessonExit = { reason: "back" } | { reason: "next_lesson"; nextLessonId: string } | { reason: "done" };

function nextLessonOf(lessonId: string): LessonDefinition | null {
  const cur = getLesson(lessonId);
  if (!cur) return null;
  const same = lessonsOfChapter(cur.chapterId).find((l) => l.order === cur.order + 1);
  if (same) return same;
  const chapters = [...new Set(LESSONS.map((l) => l.chapterId))];
  const nextChapterId = chapters[chapters.indexOf(cur.chapterId) + 1];
  return nextChapterId ? lessonsOfChapter(nextChapterId).find((l) => l.order === 1) ?? null : null;
}

// Squelette qui pulse (chargement)
function Skeleton({ lines, dots }: { lines: number; dots?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  return (
    <Animated.View style={[styles.skelCard, { opacity }]}>
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={styles.skelRow}>
          {dots && <View style={styles.skelDot} />}
          <View style={[styles.skelBar, { width: dots ? "100%" : `${[40, 85, 70][i % 3]}%` }]} />
        </View>
      ))}
    </Animated.View>
  );
}

export default function LessonScreen({ lessonId, premium, onExit, onLocked }: {
  lessonId: string;
  premium: boolean;
  onExit: (exit: LessonExit) => void;
  onLocked: (reason: LessonStartError) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<LessonAttempt | null>(null);
  const [variant, setVariant] = useState<LessonVariant | null>(null);
  const [turns, setTurns] = useState<AttemptTurn[]>([]);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [finalizeFailed, setFinalizeFailed] = useState(false);
  const [voice, setVoice] = useState("us-male");
  const [speechRate, setSpeechRate] = useState(0.95);
  const [level, setLevel] = useState("B1");
  const [flowVersion, setFlowVersion] = useState("legacy");
  const [profileBits, setProfileBits] = useState<{ name: string; goals: string[]; sourcePromptShown: boolean }>({ name: "", goals: [], sourcePromptShown: true });
  const [showSource, setShowSource] = useState(false); // écran 13 : question « comment as-tu découvert Déclic », une seule fois
  const [streak, setStreak] = useState(0);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const startedAtRef = useRef(0);
  const endRef = useRef<ConversationEnd | null>(null);
  const player = useAudioPlayer();
  const reveal = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(false);

  // Coach vidéo : une session par leçon, démarrée dès l'écran de mission (le temps de lecture sert à la connexion), arrêtée avant le bilan. Le serveur décide (flag, quotas).
  const coach = coachForVoice(voice);
  const coachId = coach.id;
  const avatarCtx = () => ({ lessonId, attemptId: attempt?.id ?? "", coachId, mode: "unknown" as const });
  const avatar = useAvatarSession({
    attemptId: attempt?.id ?? null,
    coachId,
    onRequested: () => logAvatarSessionRequested(avatarCtx()),
    onReady: (ms) => logAvatarSessionReady(avatarCtx(), ms),
    onFailed: (r) => logAvatarSessionFailed(avatarCtx(), r),
    onFallback: (r) => logAvatarFallback(avatarCtx(), r),
    onStopped: (r, sec) => logAvatarSessionStopped(avatarCtx(), r, sec),
  });

  const lesson = getLesson(lessonId);
  const chapter = lesson ? getChapter(lesson.chapterId) : null;
  const chapterLessons = lesson ? lessonsOfChapter(lesson.chapterId) : [];
  const next = nextLessonOf(lessonId);
  const ctx = () => ({ lessonId, attemptId: attempt?.id ?? "", contentVersion: variant?.contentVersion ?? 0, level: variant?.practiceLevel ?? "", flowVersion });

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotionRef.current = v; }).catch(() => {});
    return () => { try { player.pause(); } catch {} };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Dès l'arrivée : on préchauffe tout ce qui servira dans les secondes qui suivent (vidéo, TTS, premier tour)
    warmAvatar(); warmLessonTurn(); warmFinalizeAttempt();
    (async () => {
      try {
        // Profil et démarrage de la leçon EN PARALLÈLE (le serveur lit lui-même la voix du profil pour le briefing) ;
        // le profil (voix → coach vidéo) reste connu avant tout avatar.start()
        const startOpts = { isFirstLesson: LESSONS[0]?.id === lessonId };
        const profileP = loadProfile().catch(() => null);
        const startP = startOrResumeLesson(lessonId, startOpts).catch(async (e: any) => {
          if (lessonStartError(e) !== "subscription_required") throw e;
          await syncLearningEntitlement(); // juste après un achat, le webhook peut ne pas être passé
          return startOrResumeLesson(lessonId, startOpts);
        });
        const p = await profileP;
        if (cancelled) return;
        if (p?.voice) setVoice(p.voice);
        if (p?.speechRate) setSpeechRate(p.speechRate);
        if (p?.level) setLevel(p.level);
        if (p?.flowVersion) setFlowVersion(p.flowVersion);
        setProfileBits({ name: (p?.name ?? "").trim(), goals: Array.isArray(p?.goals) ? p!.goals : [], sourcePromptShown: p?.sourcePromptShown !== false });
        const r = await startP;
        if (cancelled) return;
        const startCoachId = coachForVoice(p?.voice).id;
        setAttempt(r.attempt); setVariant(r.variant); setTurns(r.turns);
        const st = r.resumed ? r.attempt.state : "briefing";
        if (st === "validating" || st === "evaluating") { runFinalize(r.attempt.id); return; }
        if (["conversation", "coaching_retry", "paused", "retry", "feedback"].includes(st)) {
          // Reprise : la session vidéo démarre AVANT d'afficher la conversation, sinon la réplique est lue en local sans attendre l'avatar
          startedAtRef.current = Date.now();
          avatar.start(r.attempt.id, startCoachId); // identifiant et coach passés explicitement : pas de dépendance au re-rendu
          setPhase("conversation");
          return;
        }
        setPhase("mission");
        // La session vidéo démarre pendant que l'utilisateur lit sa mission : à « C'est parti », le coach est déjà là
        avatar.start(r.attempt.id, startCoachId);
        logLessonMissionShown({ lessonId, attemptId: r.attempt.id, contentVersion: r.variant.contentVersion, level: r.variant.practiceLevel, flowVersion });
      } catch (e: any) {
        const code = lessonStartError(e);
        if (code === "subscription_required" || code === "prerequisite_not_validated") { onLocked(code); return; }
        setErrorMsg(code === "lesson_unavailable" ? "Cette leçon n'est pas encore disponible." : "Impossible de charger la leçon. Vérifie ta connexion et réessaie.");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  // Bilan lancé en avance (pendant la phrase de clôture du coach) : runFinalize réutilise la promesse en cours
  const finalizePromiseRef = useRef<{ attemptId: string; p: Promise<[AttemptResultLike, number]> } | null>(null);
  const startFinalize = (attemptId: string) => {
    if (finalizePromiseRef.current?.attemptId === attemptId) return finalizePromiseRef.current.p;
    const p = Promise.all([finalizeAttempt(attemptId), computeStreak().catch(() => 0)]) as Promise<[AttemptResultLike, number]>;
    finalizePromiseRef.current = { attemptId, p };
    p.catch(() => { finalizePromiseRef.current = null; }); // un échec ne doit pas être mis en cache
    return p;
  };
  const runFinalize = async (attemptId: string) => {
    avatar.stop("USER_CLOSED"); // la vidéo ne reste jamais ouverte pendant le bilan / le paywall
    setPhase("validating"); setFinalizeFailed(false);
    try {
      const [r, s] = await startFinalize(attemptId);
      setResult(r); setStreak(s); setPhase("success");
      const active = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      logLessonAttemptEnd(ctx(), r.kind, endRef.current?.turns ?? turns.length, active, endRef.current?.coachingUsed ?? r.kind === "validated_with_support");
      reveal.setValue(0);
      if (reduceMotionRef.current) reveal.setValue(1);
      else Animated.timing(reveal, { toValue: 1, duration: 650, useNativeDriver: true }).start();
    } catch (e) {
      console.warn("finalizeAttempt échoué:", e);
      setFinalizeFailed(true); setErrorMsg("Le bilan n'a pas pu être calculé. Vérifie ta connexion et réessaie."); setPhase("error");
    }
  };

  const speak = async (key: string, text: string) => {
    if (!text || busy[key]) return;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const res: any = await translateText({ text, mode: "speak", voice, speakingRate: speechRate });
      if (res.data?.audioBase64) {
        const p = FileSystem.cacheDirectory + `lesson_tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
      }
    } catch (e) { console.warn("Lecture échouée:", e); }
    finally { setBusy((b) => ({ ...b, [key]: false })); }
  };

  const header = (title: string, onBackPress: () => void, right?: React.ReactNode) => (
    <View style={styles.header}>
      <RoundButton icon="retour" label="Retour" onPress={onBackPress} />
      <Text style={styles.headerTitle} numberOfLines={2}>{title}</Text>
      {right}
    </View>
  );

  // ---------------- Chargement ----------------
  if (phase === "loading") {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        {header("Leçon", () => onExit({ reason: "back" }))}
        <View style={styles.loadingWrap}>
          <Image source={ILL.bulles} style={styles.loadingIll} resizeMode="contain" />
          <Text style={styles.loadingTitle}>On prépare ta leçon…</Text>
          <Text style={styles.loadingSub}>{coach.displayName} choisit les phrases adaptées à ton niveau.</Text>
        </View>
        <Skeleton lines={3} />
        <Skeleton lines={3} dots />
      </View>
    );
  }

  if (phase === "error" || !variant || !attempt || !lesson) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        {header("Leçon", () => onExit({ reason: "back" }))}
        <Text style={styles.error}>{errorMsg ?? "Une erreur est survenue."}</Text>
        {attempt && finalizeFailed ? <PrimaryButton label="Réessayer" onPress={() => runFinalize(attempt.id)} arrow={false} /> : null}
        <Pressable onPress={() => onExit({ reason: "back" })} style={styles.secondaryBtn} accessibilityRole="button"><Text style={styles.secondaryBtnText}>Retour</Text></Pressable>
      </View>
    );
  }

  // ---------------- Mission ----------------
  if (phase === "mission") {
    const objectives = variant.requiredCriteria.slice(0, 3);
    const example = variant.miniLesson.examplesEn.join(" ");
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <RoundButton icon="retour" label="Retour" onPress={() => { avatar.stop("USER_CLOSED"); onExit({ reason: "back" }); }} />
          <View style={{ flex: 1 }} />
          <Pill>Leçon {lesson.order} sur {chapterLessons.length}</Pill>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                {chapter && <SectionLabel color={L.accentText}>{chapter.titleFr.toUpperCase()}</SectionLabel>}
                <Text style={styles.missionTitle}>{lesson.titleFr}</Text>
                <Text style={styles.missionSubtitle}>{variant.titleFr}.</Text>
              </View>
              <Image source={ILL.bulles} style={styles.missionIll} resizeMode="contain" />
            </View>
            <View style={styles.pillRow}>
              <Pill icon="horloge">Environ {variant.targetMinutes} min</Pill>
              <Pill icon="micro" bg={L.lavender}>Avec {coach.displayName}</Pill>
            </View>
          </View>

          <View style={styles.card}>
            <SectionLabel style={{ marginBottom: 14 }}>TA MISSION</SectionLabel>
            {objectives.map((c, i) => (
              <View key={c.id} style={styles.missionRow}>
                <View style={styles.missionNumCol}>
                  <View style={styles.missionNum}><Text style={styles.missionNumText}>{i + 1}</Text></View>
                  {i < objectives.length - 1 && <View style={styles.missionDash} />}
                </View>
                <Text style={styles.missionText}>{c.descriptionFr}</Text>
              </View>
            ))}
          </View>

          {example ? (
            <View style={[styles.card, { backgroundColor: L.yellow }]}>
              <SectionLabel color={L.yellowText} style={{ marginBottom: 10 }}>EXEMPLE À T'INSPIRER</SectionLabel>
              <Text style={styles.exampleText}>{example}</Text>
              <ListenButton label="Écouter l'exemple" onPress={() => speak("example", example)} busy={busy["example"]} style={{ marginTop: 14 }} />
            </View>
          ) : null}

          <Text style={styles.guide}>{coach.displayName} te guide à chaque étape.</Text>
          <PrimaryButton
            label="C'est parti"
            onPress={() => { startedAtRef.current = Date.now(); updateAttemptState(attempt.id, "conversation"); logLessonStarted(ctx()); setPhase("conversation"); avatar.start(attempt.id); }}
          />
        </ScrollView>
      </View>
    );
  }

  // ---------------- Conversation (+ validation) ----------------
  if (phase === "conversation" || phase === "validating") {
    return (
      <View style={{ flex: 1, backgroundColor: L.background }}>
        <StatusBar style="dark" />
        <LessonConversation
          key={attempt.id}
          attemptId={attempt.id}
          variant={variant}
          level={level}
          initialTurns={turns}
          initialCovered={attempt.coveredCriteria ?? []}
          initialRetry={attempt.state === "coaching_retry"}
          voice={voice}
          speakingRate={speechRate}
          validating={phase === "validating"}
          avatar={avatar}
          coachId={coachId}
          intro={attempt.briefingEn ? undefined : LESSONS[0]?.id === lessonId ? coachIntroEn(coach, variant.practiceLevel) : undefined}
          openingOverride={attempt.briefingEn || undefined}
          firstQuestion={attempt.firstQuestionEn || undefined}
          onClosingStarted={() => startFinalize(attempt.id)}
          onCompleted={(end) => { endRef.current = end; runFinalize(attempt.id); }}
          onBack={(coveredCount, turn) => { avatar.stop("USER_CLOSED"); logLessonInterrupted(ctx(), attempt.state, coveredCount, turn); updateAttemptState(attempt.id, "paused"); onExit({ reason: "back" }); }}
          onCoachingShown={(r) => logLessonCoachingShown(ctx(), r)}
          onObjectiveCovered={(id, turn, support) => logLessonObjectiveCovered(ctx(), id, turn, support)}
          onCoachingRetryDone={(ok) => logLessonCoachingRetryDone(ctx(), ok)}
        />
      </View>
    );
  }

  // ---------------- Réussite ----------------
  if (!result) return null;
  const validated = result.kind !== "needs_practice";
  const nextPublished = !!next && next.published && !!getChapter(next.chapterId)?.published;
  const nextAccessible = !!next && (next.isFreeDiscovery || premium);
  const isFirstLesson = LESSONS[0]?.id === lessonId;
  const goNext = () => {
    if (!next || !nextPublished) { onExit({ reason: "done" }); return; }
    if (nextAccessible) { logLessonNextClick(ctx(), "lesson"); onExit({ reason: "next_lesson", nextLessonId: next.id }); }
    else { logLessonNextClick(ctx(), "paywall"); onLocked("subscription_required"); }
  };
  // « Terminer pour aujourd'hui » : question provenance (une seule fois), puis retour au parcours sans lancer de leçon
  const finishForToday = () => { if (!profileBits.sourcePromptShown) setShowSource(true); else onExit({ reason: "done" }); };

  const ctaLabel = !validated ? "Revoir cette leçon plus tard" : !next || !nextPublished ? "Retour au parcours" : "Continuer mon parcours";
  const achieved = result.criteria.filter((c) => c.status === "achieved");
  const remaining = result.criteria.filter((c) => c.status !== "achieved");

  const nextImage = next ? (profileBits.goals[0] === "voyage" ? IMAGES.sceneHotel : IMAGES.scenePresentation) : null;
  const successTitle = !validated ? "Presque ! On consolide" : isFirstLesson ? "Tu as parlé de toi en anglais." : result.kind === "validated_with_support" ? "Réussi, avec un coup de pouce !" : "Conversation réussie !";
  const successSub = isFirstLesson
    ? (profileBits.name ? `Deux conversations réalisées, ${profileBits.name}.` : "Deux conversations réalisées.")
    : (result.summaryFr || `Une conversation de plus avec ${coach.displayName}.`);
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.successHead, { opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <CoachMedallion source={coach.poster} check={validated} />
          <Text style={styles.successTitle} accessibilityRole="header">{successTitle}</Text>
          <Text style={styles.successSub}>{successSub}</Text>
          <View style={styles.pillRow}>
            {result.xpGained > 0 && <Pill icon="etoile">+{result.xpGained} XP</Pill>}
            <Pill icon="flamme">{streak} jour{streak > 1 ? "s" : ""}</Pill>
          </View>
        </Animated.View>

        <Text style={styles.sectionK}>{validated ? "Ce que tu as réussi" : "Où tu en es"}</Text>
        <View style={styles.card}>
          {achieved.map((c) => (
            <View key={c.id} style={styles.doneRow}><View style={styles.doneIcon}><OnbIcon name="check" size={14} tint="#fff" /></View><Text style={styles.doneText}>{c.doneFr}</Text></View>
          ))}
          {remaining.map((c) => (
            <View key={c.id} style={styles.doneRow}><View style={[styles.doneIcon, { backgroundColor: L.border }]}><OnbIcon name="circle" size={14} tint={L.textSecondary} /></View><Text style={[styles.doneText, { color: L.textSecondary }]}>{c.doneFr}</Text></View>
          ))}
        </View>

        {result.keyPhraseEn ? (
          <View style={styles.phraseCard}>
            <Text style={styles.phraseK}>Une phrase à réutiliser</Text>
            <View style={styles.phraseRow}>
              <Text style={styles.keyPhrase}>{result.keyPhraseEn}</Text>
              <Pressable onPress={() => speak("key", result.keyPhraseEn)} style={styles.phraseSpeaker} hitSlop={6} accessibilityRole="button" accessibilityLabel="Écouter la phrase">
                {busy["key"] ? <ActivityIndicator size="small" color={O.lavenderInk} /> : <OnbIcon name="volume" size={18} tint={O.lavenderInk} />}
              </Pressable>
            </View>
            {result.keyPhraseFr ? <Text style={styles.keyPhraseFr}>{result.keyPhraseFr}</Text> : null}
            <Pressable onPress={() => speak("key", result.keyPhraseEn)} style={styles.replay} hitSlop={6} accessibilityRole="button" accessibilityLabel="Réécouter la phrase">
              <OnbIcon name="replay" size={14} tint={O.lavenderInk} /><Text style={styles.replayText}>Réécouter</Text>
            </Pressable>
          </View>
        ) : null}

        {result.nextFocusFr ? (
          <View style={[styles.card, { backgroundColor: L.lavender }]}>
            <View style={styles.coachingHead}><Icon name="etoile" size={20} /><Text style={styles.coachingTitle}>Le conseil de {coach.displayName}</Text></View>
            <Text style={styles.coachingText}>{result.nextFocusFr}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionK}>La prochaine étape</Text>
        <View style={[styles.card, { padding: 10 }]}>
          {nextImage ? <Image source={nextImage} style={styles.nextImg} resizeMode="cover" /> : null}
          <View style={{ paddingHorizontal: 6, paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.nextTitle}>{next ? (nextPublished ? next.titleFr : "Bientôt disponible") : "Fin du parcours"}</Text>
              {next && nextPublished && !nextAccessible ? <OnbIcon name="lock" size={16} tint={L.textSecondary} /> : null}
            </View>
            <Text style={styles.nextDesc}>{next && nextPublished ? `Continue avec ${coach.displayName}, à ton rythme.` : "Reviens bientôt : d'autres situations arrivent."}</Text>
          </View>
        </View>

        <PrimaryCta label={ctaLabel} onPress={validated ? goNext : () => onExit({ reason: "done" })} style={{ marginTop: 18 }} />
        {validated && next && nextPublished && !nextAccessible && <Text style={styles.ctaNote}>Avec l'abonnement</Text>}
        <SecondaryLink label="Terminer pour aujourd'hui" onPress={finishForToday} />
      </ScrollView>
      <SourceSheet visible={showSource} coachAvatar={coach.poster} onDone={() => { setShowSource(false); onExit({ reason: "done" }); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background, paddingHorizontal: L.gutter, paddingTop: 52 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  headerTitle: { flex: 1, color: L.textSecondary, fontSize: 17, fontWeight: "700" },
  scrollContent: { paddingBottom: 32 },
  card: { backgroundColor: L.surface, borderRadius: L.radiusCard, padding: 20, marginBottom: 14 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },

  loadingWrap: { alignItems: "center", paddingVertical: 40 },
  loadingIll: { width: 200, height: 130, marginBottom: 20 },
  loadingTitle: { color: L.textPrimary, fontSize: 26, fontWeight: "700", letterSpacing: -0.3 },
  loadingSub: { color: L.textSecondary, fontSize: 16, lineHeight: 23, textAlign: "center", marginTop: 8, paddingHorizontal: 20 },
  skelCard: { backgroundColor: L.surface, borderRadius: L.radiusCard, padding: 20, marginBottom: 14, gap: 16 },
  skelRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  skelDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3E9DD" },
  skelBar: { height: 18, borderRadius: 9, backgroundColor: "#F3E9DD", flexShrink: 1 },

  missionTitle: { color: L.textPrimary, fontSize: 28, fontWeight: "700", lineHeight: 34, letterSpacing: -0.4, marginTop: 8 },
  missionSubtitle: { color: L.textSecondary, fontSize: 16, lineHeight: 23, marginTop: 8 },
  missionIll: { width: 92, height: 80 },
  missionRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  missionNumCol: { alignItems: "center", width: 32 },
  missionNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center" },
  missionNumText: { color: L.accentText, fontSize: 15, fontWeight: "700" },
  missionDash: { width: 2, flex: 1, minHeight: 22, backgroundColor: L.accentSoft, marginVertical: 4 },
  missionText: { flex: 1, color: L.textPrimary, fontSize: 18, fontWeight: "700", lineHeight: 26, paddingBottom: 18 },
  exampleText: { color: L.textPrimary, fontSize: 19, fontWeight: "700", lineHeight: 28 },
  guide: { color: L.textSecondary, fontSize: 15, textAlign: "center", marginVertical: 14 },

  secondaryBtn: { backgroundColor: L.surface, borderRadius: L.radiusButton, minHeight: L.buttonMinHeight, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryBtnText: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  error: { color: L.danger, fontSize: 15, fontWeight: "600", marginBottom: 20 },
  ctaNote: { color: L.textSecondary, fontSize: 14, textAlign: "center", marginTop: 10 },

  successHead: { alignItems: "center", marginBottom: 6, marginTop: 8 },
  successTitle: { color: L.textPrimary, fontSize: 26, fontWeight: "800", lineHeight: 32, textAlign: "center", letterSpacing: -0.4, marginTop: 8 },
  successSub: { color: L.textSecondary, fontSize: 15, fontWeight: "600", textAlign: "center", marginTop: 6 },
  sectionK: { color: L.textPrimary, fontSize: 16, fontWeight: "800", marginTop: 16, marginBottom: 8 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  doneIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: L.successFill, alignItems: "center", justifyContent: "center" },
  doneText: { flex: 1, color: L.textPrimary, fontSize: 15.5, fontWeight: "600", lineHeight: 21 },
  phraseCard: { backgroundColor: L.lavender, borderRadius: L.radiusCard, padding: 14, marginBottom: 14 },
  phraseK: { color: L.textPrimary, fontSize: 15, fontWeight: "800", marginBottom: 8 },
  phraseRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: L.surface, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  keyPhrase: { flex: 1, color: L.textPrimary, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  keyPhraseFr: { color: L.textSecondary, fontSize: 13.5, fontStyle: "italic", marginTop: 8, marginLeft: 4 },
  phraseSpeaker: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  replay: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: L.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginTop: 10, minHeight: 34 },
  replayText: { color: O.lavenderInk, fontSize: 13, fontWeight: "800" },
  nextImg: { width: "100%", aspectRatio: 2.6, borderRadius: 14 },
  nextTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "800" },
  nextDesc: { color: L.textSecondary, fontSize: 13.5, fontWeight: "600", lineHeight: 19, marginTop: 3 },
  coachingHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  coachingTitle: { color: L.lavenderText, fontSize: 16, fontWeight: "700" },
  coachingText: { color: L.textPrimary, fontSize: 16, lineHeight: 24 },

});
