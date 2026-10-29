// DiscoveryCafeScreen — écran 07 de l'onboarding : la conversation découverte « Commander un café » (leçon C00-L01,
// même moteur que les leçons : startOrResumeLesson → LessonConversation → finalizeAttempt). Le bilan (écran 08) est rendu par OnboardingFlow.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Image } from "react-native";
import { StatusBar } from "expo-status-bar";
import LessonConversation, { ConversationEnd } from "../lesson/LessonConversation";
import { startOrResumeLesson, finalizeAttempt, lessonStartError, warmLessonTurn, warmFinalizeAttempt } from "../../lib/learningPath/attempts";
import type { AttemptResult, AttemptTurn, LessonAttempt, LessonVariant } from "../../lib/learningPath/types";
import { useAvatarSession } from "../../lib/liveAvatar/useAvatarSession";
import { warmAvatar } from "../../lib/liveAvatar/session";
import { LessonCoach } from "../../lib/learningPath/coaches";
import { DISCOVERY_LESSON_ID } from "../../lib/learningPath/discovery";
import { logLessonStarted, logLessonAttemptEnd, logLessonInterrupted, logAvatarSessionRequested, logAvatarSessionReady, logAvatarSessionFailed, logAvatarSessionStopped, logAvatarFallback } from "../../lib/analytics";
import { O, PrimaryCta } from "../../components/onbUi";

type Phase = "loading" | "error" | "conversation" | "validating";

export default function DiscoveryCafeScreen({ coach, level, speechRate, onDone, onBack }: {
  coach: LessonCoach;
  level: string;
  speechRate: number;
  onDone: (result: AttemptResult, end: ConversationEnd | null) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<LessonAttempt | null>(null);
  const [variant, setVariant] = useState<LessonVariant | null>(null);
  const [turns, setTurns] = useState<AttemptTurn[]>([]);
  const endRef = useRef<ConversationEnd | null>(null);
  const startedAtRef = useRef(0);
  const finalizeRef = useRef<Promise<AttemptResult> | null>(null);

  const ctx = () => ({ lessonId: DISCOVERY_LESSON_ID, attemptId: attempt?.id ?? "", coachId: coach.id, mode: "unknown" as const });
  const avatar = useAvatarSession({
    attemptId: attempt?.id ?? null,
    coachId: coach.id,
    onRequested: () => logAvatarSessionRequested(ctx()),
    onReady: (ms) => logAvatarSessionReady(ctx(), ms),
    onFailed: (r) => logAvatarSessionFailed(ctx(), r),
    onFallback: (r) => logAvatarFallback(ctx(), r),
    onStopped: (r, s) => logAvatarSessionStopped(ctx(), r, s),
  });
  const lessonCtx = () => ({ lessonId: DISCOVERY_LESSON_ID, attemptId: attempt?.id ?? "", contentVersion: variant?.contentVersion ?? 0, level: variant?.practiceLevel ?? "", flowVersion: "onboarding_v2" });

  useEffect(() => {
    let cancelled = false;
    warmAvatar(); warmLessonTurn(); warmFinalizeAttempt();
    (async () => {
      try {
        const r = await startOrResumeLesson(DISCOVERY_LESSON_ID, { voice: coach.voice, isFirstLesson: true });
        if (cancelled) return;
        setAttempt(r.attempt); setVariant(r.variant); setTurns(r.turns);
        if (r.resumed && (r.attempt.state === "validating" || r.attempt.state === "evaluating")) { runFinalize(r.attempt.id); return; }
        startedAtRef.current = Date.now();
        avatar.start(r.attempt.id, coach.id);
        setPhase("conversation");
        if (!r.resumed) logLessonStarted({ lessonId: DISCOVERY_LESSON_ID, attemptId: r.attempt.id, contentVersion: r.variant.contentVersion, level: r.variant.practiceLevel, flowVersion: "onboarding_v2" });
      } catch (e: any) {
        const code = lessonStartError(e);
        setErrorMsg(code === "lesson_unavailable" ? "La conversation découverte n'est pas disponible pour l'instant." : "Impossible de lancer la conversation. Vérifie ta connexion et réessaie.");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const startFinalize = (attemptId: string) => {
    if (!finalizeRef.current) { finalizeRef.current = finalizeAttempt(attemptId); finalizeRef.current.catch(() => { finalizeRef.current = null; }); }
    return finalizeRef.current;
  };
  const runFinalize = async (attemptId: string) => {
    avatar.stop("USER_CLOSED");
    setPhase("validating");
    try {
      const r = await startFinalize(attemptId);
      const active = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      logLessonAttemptEnd(lessonCtx(), r.kind, endRef.current?.turns ?? turns.length, active, endRef.current?.coachingUsed ?? false);
      onDone(r, endRef.current);
    } catch (e) {
      console.warn("finalizeAttempt (café) échoué:", e);
      setErrorMsg("Le bilan n'a pas pu être calculé. Vérifie ta connexion et réessaie."); setPhase("error");
    }
  };

  if (phase === "loading" || phase === "error") {
    return (
      <View style={st.center}>
        <StatusBar style="dark" />
        <Image source={coach.poster} style={st.poster} resizeMode="cover" />
        {phase === "loading" ? (
          <>
            <ActivityIndicator color={O.primary} style={{ marginTop: 18 }} />
            <Text style={st.loading}>{coach.displayName} prépare le café…</Text>
          </>
        ) : (
          <>
            <Text style={st.error}>{errorMsg}</Text>
            <PrimaryCta label={attempt ? "Réessayer" : "Retour"} onPress={() => (attempt ? runFinalize(attempt.id) : onBack())} style={{ alignSelf: "stretch", marginTop: 18 }} />
          </>
        )}
      </View>
    );
  }

  if (!attempt || !variant) return null;
  return (
    <View style={{ flex: 1, backgroundColor: O.bg }}>
      <StatusBar style="dark" />
      <LessonConversation
        key={attempt.id}
        attemptId={attempt.id}
        variant={variant}
        level={level}
        initialTurns={turns}
        initialCovered={attempt.coveredCriteria ?? []}
        initialRetry={attempt.state === "coaching_retry"}
        voice={coach.voice}
        speakingRate={speechRate}
        validating={phase === "validating"}
        avatar={avatar}
        coachId={coach.id}
        openingOverride={attempt.briefingEn || undefined}
        firstQuestion={attempt.firstQuestionEn || undefined}
        onClosingStarted={() => startFinalize(attempt.id)}
        onCompleted={(end) => { endRef.current = end; runFinalize(attempt.id); }}
        onBack={(coveredCount, turn) => { avatar.stop("USER_CLOSED"); logLessonInterrupted(lessonCtx(), attempt.state, coveredCount, turn); onBack(); }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, backgroundColor: O.bg, alignItems: "center", justifyContent: "center", padding: 32 },
  poster: { width: 120, height: 120, borderRadius: 60 },
  loading: { color: O.muted, fontSize: 15, fontWeight: "700", marginTop: 12 },
  error: { color: O.ink, fontSize: 16, lineHeight: 24, textAlign: "center", marginTop: 18 },
});
