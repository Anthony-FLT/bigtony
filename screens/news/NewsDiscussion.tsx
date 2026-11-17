// NewsDiscussion — « En discuter avec ton coach » : la discussion d'une actu, sur le même moteur et le même écran que les leçons.
// chargement → conversation (3 objectifs : résumer, détail, avis) → bilan. Le serveur décide de la validation et des XP.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Animated, AccessibilityInfo, Image } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { Feather } from "@expo/vector-icons";
import { functions } from "../../lib/firebase";
import { loadProfile } from "../../lib/profile";
import { computeStreak } from "../../lib/streak";
import { L, ILL, Icon, RoundButton, Pill, PrimaryButton } from "../../components/lessonUi";
import { O, OnbIcon, CoachMedallion, PrimaryCta, SecondaryLink } from "../../components/onbUi";
import NewsTextSheet from "../../components/NewsTextSheet";
import LessonConversation, { ConversationEnd } from "../lesson/LessonConversation";
import { startOrResumeLesson, updateAttemptState, finalizeAttempt, syncLearningEntitlement, lessonStartError, warmLessonTurn, warmFinalizeAttempt } from "../../lib/learningPath/attempts";
import { warmAvatar } from "../../lib/liveAvatar/session";
import { useAvatarSession } from "../../lib/liveAvatar/useAvatarSession";
import { coachForVoice } from "../../lib/learningPath/coaches";
import type { AttemptResult, AttemptTurn, LessonAttempt, LessonVariant } from "../../lib/learningPath/types";
import type { NewsItem, NewsLevel } from "../../lib/news";
import {
  logNewsDiscussionStarted, logNewsDiscussionEnd, logNewsDiscussionInterrupted,
  logAvatarSessionRequested, logAvatarSessionReady, logAvatarSessionFailed, logAvatarSessionStopped, logAvatarFallback,
} from "../../lib/analytics";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type Phase = "loading" | "error" | "conversation" | "validating" | "success";
type NewsCtx = { news_id: string; rubrique: string; level: string; position: number };

export default function NewsDiscussion({ item, isLast, ctx, onBack, onLocked, onDiscussed, onNext, onFinish }: {
  item: NewsItem;
  isLast: boolean;
  ctx: NewsCtx;
  onBack: () => void; // retour au résultat du quiz
  onLocked: () => void; // abonnement requis (droit expiré entre-temps)
  onDiscussed: () => void; // discussion terminée : l'actu est marquée comme racontée
  onNext: () => void; // actu suivante
  onFinish: () => void; // retour à l'onglet Pratiquer
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
  const [streak, setStreak] = useState(0);
  const [showText, setShowText] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const startedAtRef = useRef(0);
  const endRef = useRef<ConversationEnd | null>(null);
  const reveal = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(false);
  const player = useAudioPlayer();

  const coach = coachForVoice(voice);
  const coachId = coach.id;
  const avatarCtx = () => ({ lessonId: item.id, attemptId: attempt?.id ?? "", coachId, mode: "unknown" as const });
  const avatar = useAvatarSession({
    attemptId: attempt?.id ?? null,
    coachId,
    onRequested: () => logAvatarSessionRequested(avatarCtx()),
    onReady: (ms) => logAvatarSessionReady(avatarCtx(), ms),
    onFailed: (r) => logAvatarSessionFailed(avatarCtx(), r),
    onFallback: (r) => logAvatarFallback(avatarCtx(), r),
    onStopped: (r, sec) => logAvatarSessionStopped(avatarCtx(), r, sec),
  });

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotionRef.current = v; }).catch(() => {});
    return () => { try { player.pause(); } catch {} };
  }, []);

  useEffect(() => {
    let cancelled = false;
    warmAvatar(); warmLessonTurn(); warmFinalizeAttempt();
    (async () => {
      try {
        const profileP = loadProfile().catch(() => null);
        const startP = startOrResumeLesson(item.id).catch(async (e: any) => {
          if (lessonStartError(e) !== "subscription_required") throw e;
          await syncLearningEntitlement(); // juste après un achat, le webhook peut ne pas être passé
          return startOrResumeLesson(item.id);
        });
        const p = await profileP;
        if (cancelled) return;
        if (p?.voice) setVoice(p.voice);
        if (p?.speechRate) setSpeechRate(p.speechRate);
        if (p?.level) setLevel(p.level);
        const r = await startP;
        if (cancelled) return;
        setAttempt(r.attempt); setVariant(r.variant); setTurns(r.turns);
        logNewsDiscussionStarted(ctx, r.resumed);
        if (r.resumed && (r.attempt.state === "validating" || r.attempt.state === "evaluating")) { runFinalize(r.attempt.id); return; }
        startedAtRef.current = Date.now();
        // La session vidéo démarre AVANT d'afficher la conversation, sinon l'ouverture est lue en local sans attendre le coach
        avatar.start(r.attempt.id, coachForVoice(p?.voice).id);
        setPhase("conversation");
      } catch (e: any) {
        if (cancelled) return;
        const code = lessonStartError(e);
        if (code === "subscription_required") { onLocked(); return; }
        setErrorMsg(code === "lesson_unavailable" ? "Cette actu n'est plus disponible. Choisis-en une autre." : "Impossible de lancer la discussion. Vérifie ta connexion et réessaie.");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  // Bilan lancé en avance (pendant la phrase de clôture du coach) : runFinalize réutilise la promesse en cours
  const finalizePromiseRef = useRef<{ attemptId: string; p: Promise<[AttemptResult, number]> } | null>(null);
  const startFinalize = (attemptId: string) => {
    if (finalizePromiseRef.current?.attemptId === attemptId) return finalizePromiseRef.current.p;
    const p = Promise.all([finalizeAttempt(attemptId), computeStreak().catch(() => 0)]) as Promise<[AttemptResult, number]>;
    finalizePromiseRef.current = { attemptId, p };
    p.catch(() => { finalizePromiseRef.current = null; }); // un échec ne doit pas être mis en cache
    return p;
  };
  const runFinalize = async (attemptId: string) => {
    avatar.stop("USER_CLOSED"); // la vidéo ne reste jamais ouverte pendant le bilan
    setPhase("validating"); setFinalizeFailed(false);
    try {
      const [r, s] = await startFinalize(attemptId);
      setResult(r); setStreak(s); setPhase("success");
      onDiscussed();
      const active = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      logNewsDiscussionEnd(ctx, r.kind, endRef.current?.turns ?? turns.length, active);
      reveal.setValue(0);
      if (reduceMotionRef.current) reveal.setValue(1);
      else Animated.timing(reveal, { toValue: 1, duration: 650, useNativeDriver: true }).start();
    } catch (e) {
      console.warn("finalizeAttempt (actu) échoué:", e);
      setFinalizeFailed(true); setErrorMsg("Le bilan n'a pas pu être calculé. Vérifie ta connexion et réessaie."); setPhase("error");
    }
  };

  const speak = async (text: string) => {
    if (!text || speaking) return;
    setSpeaking(true);
    try {
      const res: any = await translateText({ text, mode: "speak", voice, speakingRate: speechRate });
      if (res.data?.audioBase64) {
        const p = `${FileSystem.cacheDirectory}news_key_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
      }
    } catch (e) { console.warn("Lecture échouée:", e); }
    finally { setSpeaking(false); }
  };

  const header = (
    <View style={styles.header}>
      <RoundButton icon="retour" label="Retour" onPress={() => { avatar.stop("USER_CLOSED"); onBack(); }} />
      <Text style={styles.headerTitle} numberOfLines={2}>{item.titleEn}</Text>
    </View>
  );

  // ---------------- Chargement ----------------
  if (phase === "loading") {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        {header}
        <View style={styles.loadingWrap}>
          <Image source={ILL.bulles} style={styles.loadingIll} resizeMode="contain" />
          <Text style={styles.loadingTitle}>{coach.displayName} arrive…</Text>
          <Text style={styles.loadingSub}>Tu vas lui raconter cette actu en quelques phrases.</Text>
          <ActivityIndicator color={L.accentDeep} style={{ marginTop: 22 }} />
        </View>
      </View>
    );
  }

  if (phase === "error" || !variant || !attempt) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        {header}
        <Text style={styles.error}>{errorMsg ?? "Une erreur est survenue."}</Text>
        {attempt && finalizeFailed ? <PrimaryButton label="Réessayer" onPress={() => runFinalize(attempt.id)} arrow={false} /> : null}
        <Pressable onPress={onBack} style={styles.secondaryBtn} accessibilityRole="button"><Text style={styles.secondaryBtnText}>Retour</Text></Pressable>
      </View>
    );
  }

  // ---------------- Conversation (+ validation) ----------------
  if (phase === "conversation" || phase === "validating") {
    // Le texte rappelé est celui du niveau de la discussion (choisi par le serveur d'après le niveau de pratique)
    const reviewText = (item.levels[variant.practiceLevel as NewsLevel] ?? item.levels.B1).text;
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
          belowObjectives={
            <Pressable onPress={() => setShowText(true)} style={styles.review} accessibilityRole="button" accessibilityLabel="Revoir l'actu">
              <Feather name="file-text" size={18} color={O.lavenderInk} />
              <Text style={styles.reviewText}>Revoir l'actu</Text>
              <Feather name="chevron-down" size={18} color={O.lavenderInk} />
            </Pressable>
          }
          onClosingStarted={() => startFinalize(attempt.id)}
          onCompleted={(end) => { endRef.current = end; runFinalize(attempt.id); }}
          onBack={(coveredCount, turn) => { avatar.stop("USER_CLOSED"); logNewsDiscussionInterrupted(ctx, coveredCount, turn); updateAttemptState(attempt.id, "paused"); onBack(); }}
        />
        <NewsTextSheet visible={showText} item={item} text={reviewText} onClose={() => setShowText(false)} />
      </View>
    );
  }

  // ---------------- Bilan ----------------
  if (!result) return null;
  const validated = result.kind !== "needs_practice";
  const achieved = result.criteria.filter((c) => c.status === "achieved");
  const remaining = result.criteria.filter((c) => c.status !== "achieved");
  const title = !validated ? "Presque ! On consolide" : result.kind === "validated_with_support" ? "Actu racontée, avec un coup de pouce !" : "Tu viens de raconter une actu en anglais.";
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.successHead, { opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <CoachMedallion source={coach.poster} check={validated} />
          <Text style={styles.successTitle} accessibilityRole="header">{title}</Text>
          <Text style={styles.successSub}>{result.summaryFr || `Une conversation de plus avec ${coach.displayName}.`}</Text>
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
            <Text style={styles.phraseK}>Ta phrase, en mieux</Text>
            <View style={styles.phraseRow}>
              <Text style={styles.keyPhrase}>{result.keyPhraseEn}</Text>
              <Pressable onPress={() => speak(result.keyPhraseEn)} style={styles.phraseSpeaker} hitSlop={6} accessibilityRole="button" accessibilityLabel="Écouter la phrase">
                {speaking ? <ActivityIndicator size="small" color={O.lavenderInk} /> : <OnbIcon name="volume" size={18} tint={O.lavenderInk} />}
              </Pressable>
            </View>
            {result.keyPhraseFr ? <Text style={styles.keyPhraseFr}>{result.keyPhraseFr}</Text> : null}
          </View>
        ) : null}

        {result.nextFocusFr ? (
          <View style={[styles.card, { backgroundColor: L.lavender }]}>
            <View style={styles.coachingHead}><Icon name="etoile" size={20} /><Text style={styles.coachingTitle}>Le conseil de {coach.displayName}</Text></View>
            <Text style={styles.coachingText}>{result.nextFocusFr}</Text>
          </View>
        ) : null}

        <PrimaryCta label={isLast ? "Retour aux actus" : "Actu suivante"} onPress={isLast ? onFinish : onNext} style={{ marginTop: 18 }} />
        {!isLast ? <SecondaryLink label="Terminer pour aujourd'hui" onPress={onFinish} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background, paddingHorizontal: L.gutter, paddingTop: 52 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  headerTitle: { flex: 1, color: L.textSecondary, fontSize: 16, fontWeight: "700" },
  scrollContent: { paddingBottom: 32 },
  card: { backgroundColor: L.surface, borderRadius: L.radiusCard, padding: 20, marginBottom: 14 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },

  loadingWrap: { alignItems: "center", paddingVertical: 40 },
  loadingIll: { width: 200, height: 130, marginBottom: 20 },
  loadingTitle: { color: L.textPrimary, fontSize: 26, fontWeight: "700", letterSpacing: -0.3 },
  loadingSub: { color: L.textSecondary, fontSize: 16, lineHeight: 23, textAlign: "center", marginTop: 8, paddingHorizontal: 20 },

  secondaryBtn: { backgroundColor: L.surface, borderRadius: L.radiusButton, minHeight: L.buttonMinHeight, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryBtnText: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  error: { color: L.danger, fontSize: 15, fontWeight: "600", marginBottom: 20 },

  review: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: L.lavender, borderRadius: 16, minHeight: 44, paddingHorizontal: 14, marginBottom: 6 },
  reviewText: { flex: 1, color: O.lavenderInk, fontSize: 15.5, fontWeight: "800" },

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
  coachingHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  coachingTitle: { color: L.lavenderText, fontSize: 16, fontWeight: "700" },
  coachingText: { color: L.textPrimary, fontSize: 16, lineHeight: 24 },
});
