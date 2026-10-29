// DailyTalkScreen — « Le point du jour » : discussion courte avec le coach vidéo (spec Point du jour).
// Chargement → conversation (écran de leçon en mode daily) → bilan léger (phrase du jour, phrases replacées, XP).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Image, ScrollView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../lib/firebase";
import { loadProfile } from "../../lib/profile";
import { L, ILL, RoundButton, Pill, PrimaryButton, ListenButton, SectionLabel } from "../../components/lessonUi";
import LessonConversation from "../lesson/LessonConversation";
import { dailyTalkStart, dailyTalkEnd, dailyTalkStartError, dailyVariant, dailyTurnsAsAttemptTurns, dailyTurnAsLessonTurn, warmDailyTalk, DailyTalkSession, DailyTalkResult } from "../../lib/dailyTalk";
import { useAvatarSession } from "../../lib/liveAvatar/useAvatarSession";
import { warmAvatar } from "../../lib/liveAvatar/session";
import { coachForVoice } from "../../lib/learningPath/coaches";
import { logDailyTalkStart, logDailyTalkEnd, logDailyTalkLocked, logAvatarSessionRequested, logAvatarSessionReady, logAvatarSessionFailed, logAvatarSessionStopped, logAvatarFallback } from "../../lib/analytics";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });
type Phase = "loading" | "error" | "conversation" | "ending" | "result";

export default function DailyTalkScreen({ onExit, onLocked }: { onExit: () => void; onLocked: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [session, setSession] = useState<DailyTalkSession | null>(null);
  const [result, setResult] = useState<DailyTalkResult | null>(null);
  const [voice, setVoice] = useState("us-male");
  const [speechRate, setSpeechRate] = useState(0.95);
  const [busy, setBusy] = useState(false);
  const player = useAudioPlayer();
  const endPromiseRef = useRef<Promise<DailyTalkResult> | null>(null);

  const coach = coachForVoice(voice);
  const avatarCtx = () => ({ lessonId: "daily", attemptId: session?.sessionId ?? "", coachId: coach.id, mode: "unknown" as const });
  const avatar = useAvatarSession({
    attemptId: session && session.state === "active" ? `daily:${session.sessionId}` : null,
    coachId: coach.id,
    onRequested: () => logAvatarSessionRequested(avatarCtx()),
    onReady: (ms) => logAvatarSessionReady(avatarCtx(), ms),
    onFailed: (r) => logAvatarSessionFailed(avatarCtx(), r),
    onFallback: (r) => logAvatarFallback(avatarCtx(), r),
    onStopped: (r, s) => logAvatarSessionStopped(avatarCtx(), r, s),
  });
  const dailyCtx = () => ({ sessionId: session?.sessionId ?? "", regime: session?.regime ?? "", coachId: coach.id });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await loadProfile();
        if (cancelled) return;
        const v = p?.voice || "us-male";
        setVoice(v); if (p?.speechRate) setSpeechRate(p.speechRate);
        warmDailyTalk(); warmAvatar();
        const s = await dailyTalkStart(v);
        if (cancelled) return;
        setSession(s);
        if (s.state === "ended" && s.result) { setResult(s.result); setPhase("result"); return; }
        logDailyTalkStart({ sessionId: s.sessionId, regime: s.regime, coachId: coachForVoice(v).id }, s.resumed);
        // La session vidéo démarre AVANT d'afficher la conversation (sinon l'ouverture est lue en local puis redite par l'avatar)
        avatar.start(`daily:${s.sessionId}`, coachForVoice(v).id); // périmètre et coach passés explicitement : pas de dépendance au re-rendu
        setPhase("conversation");
      } catch (e: any) {
        if (dailyTalkStartError(e) === "subscription_required") { logDailyTalkLocked(); onLocked(); return; }
        console.warn("dailyTalkStart échoué:", e);
        setErrorMsg("Impossible de lancer le point du jour. Vérifie ta connexion et réessaie.");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; try { player.pause(); } catch {} };
  }, []);

  const startEnd = (sessionId: string) => {
    if (!endPromiseRef.current) { endPromiseRef.current = dailyTalkEnd(sessionId); endPromiseRef.current.catch(() => { endPromiseRef.current = null; }); }
    return endPromiseRef.current;
  };
  const finish = async (sessionId: string, turns: number, coachingUsed: boolean) => {
    avatar.stop("USER_CLOSED");
    setPhase("ending");
    try {
      const r = await startEnd(sessionId);
      setResult(r); setPhase("result");
      logDailyTalkEnd(dailyCtx(), turns, coachingUsed, r.reusedPhrases.length);
    } catch (e) {
      console.warn("dailyTalkEnd échoué:", e);
      setErrorMsg("Le bilan n'a pas pu être enregistré. Réessaie."); setPhase("error");
    }
  };

  const listen = async (text: string) => {
    if (!text || busy) return;
    setBusy(true);
    try {
      const res: any = await translateText({ text, mode: "speak", voice, speakingRate: speechRate });
      if (res.data?.audioBase64) {
        const p = FileSystem.cacheDirectory + `daily_tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
      }
    } catch (e) { console.warn("Lecture échouée:", e); }
    finally { setBusy(false); }
  };

  if (phase === "loading" || phase === "ending") {
    return (
      <View style={styles.center}>
        <StatusBar style="dark" />
        <Image source={coach.poster} style={styles.loadingPoster} resizeMode="cover" />
        <ActivityIndicator color={L.primary} style={{ marginTop: 18 }} />
        <Text style={styles.loadingText}>{phase === "loading" ? `${coach.displayName} arrive…` : "On note ta phrase du jour…"}</Text>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.center}>
        <StatusBar style="dark" />
        <Text style={styles.errorText}>{errorMsg}</Text>
        <View style={{ height: 16 }} />
        <PrimaryButton label="Retour" onPress={onExit} arrow={false} />
      </View>
    );
  }

  if (phase === "conversation" && session) {
    return (
      <View style={{ flex: 1, backgroundColor: L.background }}>
        <StatusBar style="dark" />
        <LessonConversation
          attemptId={session.sessionId}
          variant={dailyVariant(session)}
          level="B1"
          initialTurns={dailyTurnsAsAttemptTurns(session.turns)}
          initialCovered={[]}
          initialRetry={false}
          voice={voice}
          speakingRate={speechRate}
          validating={false}
          avatar={avatar}
          coachId={coach.id}
          daily={{ maxTurns: session.maxTurns, reuseTotal: session.reuseTotal, reuseDone: session.reuseDone, turnFn: dailyTurnAsLessonTurn }}
          onClosingStarted={() => startEnd(session.sessionId)}
          onCompleted={(end) => finish(session.sessionId, end.turns, end.coachingUsed)}
          onBack={() => { avatar.stop("USER_CLOSED"); onExit(); }}
        />
      </View>
    );
  }

  // ---------------- Bilan léger ----------------
  const r = result!;
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <RoundButton icon="retour" label="Retour" onPress={onExit} size={44} iconSize={20} />
        <Text style={styles.headerTitle}>Le point du jour</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <Image source={ILL.medaille} style={{ width: 120, height: 120 }} resizeMode="contain" />
          <Text style={styles.title}>C'est fait pour aujourd'hui</Text>
          <View style={styles.pills}>
            <Pill icon="etoile" bg={L.accentSoft}>+{r.xpGained} XP</Pill>
            {r.moveLabelFr ? <Pill icon="check" bg={L.successSoft}>{r.moveLabelFr}</Pill> : null}
          </View>
        </View>

        {r.phraseEn ? (
          <View style={styles.card}>
            <SectionLabel>Ta phrase du jour</SectionLabel>
            <Text style={styles.phraseEn}>{r.phraseEn}</Text>
            {r.phraseFr ? <Text style={styles.phraseFr}>{r.phraseFr}</Text> : null}
            <View style={{ marginTop: 12 }}><ListenButton label="Écouter" onPress={() => listen(r.phraseEn)} busy={busy} /></View>
          </View>
        ) : null}

        {r.reusedPhrases.length > 0 && (
          <View style={styles.card}>
            <SectionLabel>Tu as replacé</SectionLabel>
            {r.reusedPhrases.map((p, i) => <Text key={i} style={styles.reused}>✓ {p}</Text>)}
          </View>
        )}
        {r.missedPhrases.length > 0 && (
          <View style={styles.card}>
            <SectionLabel>On y reviendra</SectionLabel>
            {r.missedPhrases.map((p, i) => <Text key={i} style={styles.missed}>{p}</Text>)}
          </View>
        )}

        <View style={{ marginTop: 20 }}>
          <PrimaryButton label="Retour à l'accueil" onPress={onExit} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background, paddingHorizontal: L.gutter, paddingTop: 46 },
  center: { flex: 1, backgroundColor: L.background, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingPoster: { width: 120, height: 120, borderRadius: 60 },
  loadingText: { color: L.textSecondary, fontSize: 15, fontWeight: "600", marginTop: 12 },
  errorText: { color: L.textPrimary, fontSize: 16, textAlign: "center", lineHeight: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  headerTitle: { color: L.textPrimary, fontSize: 18, fontWeight: "700" },
  title: { color: L.textPrimary, fontSize: 24, fontWeight: "800", marginTop: 10, textAlign: "center" },
  pills: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center" },
  card: { backgroundColor: L.surface, borderRadius: L.radiusCard, padding: 16, marginTop: 14 },
  phraseEn: { color: L.textPrimary, fontSize: 19, fontWeight: "700", lineHeight: 27, marginTop: 6 },
  phraseFr: { color: L.textSecondary, fontSize: 14.5, fontStyle: "italic", lineHeight: 20, marginTop: 6 },
  reused: { color: L.success, fontSize: 15.5, fontWeight: "700", lineHeight: 24 },
  missed: { color: L.textSecondary, fontSize: 15, lineHeight: 23 },
});
