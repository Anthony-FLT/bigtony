// Écran de test LiveAvatar (étape A) — développement uniquement, réservé aux comptes pilotes.
// Vérifie : création de session (sandbox), vidéo du coach, énoncé EN puis FR, écoute, interruption, arrêt, délais.
// Nécessite un build de développement (LiveKit n'existe pas dans Expo Go).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, AppState, ActivityIndicator } from "react-native";
import { AudioSession, LiveKitRoom, useTracks, VideoTrack, isTrackReference, useRoomContext } from "@livekit/react-native";
import { Track, RoomEvent } from "livekit-client";
import { L, RoundButton } from "../../components/lessonUi";
import { startAvatarSession, stopAvatarSession, avatarSpeech, avatarStartError, AvatarCommandClient, AvatarCredentials, AvatarState } from "../../lib/liveAvatar/session";

const COACH_ID = "us_male";
const EN_SENTENCE = "Hi, I'm Sam. Nice to meet you! What do you do?";
const FR_SENTENCE = "Pour parler de ton métier, tu peux dire : I am a developer.";

type Log = { t: number; msg: string };

export default function AvatarTestScreen({ onBack }: { onBack: () => void }) {
  const [creds, setCreds] = useState<AvatarCredentials | null>(null);
  const [starting, setStarting] = useState(false);
  const [wsState, setWsState] = useState<AvatarState>("disconnected");
  const [roomState, setRoomState] = useState("idle");
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<AvatarCommandClient | null>(null);
  const t0Ref = useRef(0);

  const log = (msg: string) => setLogs((l) => [...l.slice(-40), { t: Date.now(), msg }]);

  useEffect(() => {
    AudioSession.startAudioSession();
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") stop("USER_DISCONNECTED"); });
    return () => { sub.remove(); stop("USER_DISCONNECTED"); AudioSession.stopAudioSession(); };
  }, []);

  const start = async () => {
    if (starting || creds) return;
    setStarting(true); t0Ref.current = Date.now();
    try {
      const c = await startAvatarSession(COACH_ID);
      log(`session ${c.reused ? "réutilisée" : "créée"} en ${Date.now() - t0Ref.current} ms · ws_url ${c.wsUrl ? "présent" : "ABSENT (changer config.mode)"} · max ${c.maxSessionSeconds}s`);
      setCreds(c);
      if (c.wsUrl) {
        const client = new AvatarCommandClient(c.wsUrl);
        clientRef.current = client;
        client.onState((s, d) => { setWsState(s); if (d) log(`ws: ${s} (${d})`); });
        try { await client.connect(); log(`ws connecté en ${client.timings.connectMs} ms`); }
        catch (e: any) { log(`ws échec: ${e?.message}`); }
      }
    } catch (e: any) {
      log(`démarrage refusé: ${avatarStartError(e)} — ${String(e?.message ?? "").slice(0, 120)}`);
    } finally { setStarting(false); }
  };

  const stop = async (reason: "USER_CLOSED" | "USER_DISCONNECTED" = "USER_CLOSED") => {
    clientRef.current?.close(); clientRef.current = null;
    const id = creds?.sessionId;
    setCreds(null); setWsState("disconnected");
    if (id) { await stopAvatarSession(id, reason); log(`session arrêtée (${reason})`); }
  };

  const say = async (text: string, lang: "en" | "fr") => {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy(true);
    const t = Date.now();
    try {
      const chunks = await avatarSpeech(text, lang, creds?.coach.voice ?? "us-male");
      const ttsMs = Date.now() - t;
      log(`TTS ${lang}: ${chunks.length} segment(s) en ${ttsMs} ms`);
      const before = client.timings.firstSpeakStartedMs;
      const t2 = Date.now();
      await client.speak(chunks);
      const started = client.timings.firstSpeakStartedMs;
      log(`énoncé ${lang} terminé · délai envoi→parole ${started && started !== before ? started - t2 : "?"} ms · total depuis clic ${Date.now() - t} ms`);
    } catch (e: any) { log(`énoncé échec: ${e?.message}`); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <RoundButton icon="retour" label="Retour" onPress={() => { stop(); onBack(); }} />
        <Text style={styles.title}>Avatar test</Text>
        <Text style={[styles.badge, wsState === "connected" || wsState === "talking" || wsState === "listening" ? styles.badgeOk : null]}>{wsState}</Text>
      </View>

      <View style={styles.video}>
        {creds?.livekitUrl && creds.livekitClientToken ? (
          <LiveKitRoom serverUrl={creds.livekitUrl} token={creds.livekitClientToken} connect audio={false} video={false}
            onConnected={() => { setRoomState("connected"); log(`LiveKit connecté (${Date.now() - t0Ref.current} ms depuis le clic)`); }}
            onDisconnected={() => { setRoomState("disconnected"); log("LiveKit déconnecté"); }}
            onError={(e: any) => log(`LiveKit erreur: ${e?.message}`)}>
            <AvatarView onInfo={log} />
          </LiveKitRoom>
        ) : (
          <View style={styles.poster}>{starting ? <ActivityIndicator color={L.accentDeep} /> : <Text style={styles.posterText}>Portrait (aucune session)</Text>}</View>
        )}
      </View>
      <Text style={styles.meta}>LiveKit : {roomState}{creds ? ` · session ${creds.sessionId.slice(0, 8)}…` : ""}</Text>

      <View style={styles.row}>
        <Btn label="Démarrer" onPress={start} disabled={!!creds || starting} />
        <Btn label="Arrêter" onPress={() => stop()} disabled={!creds} danger />
      </View>
      <View style={styles.row}>
        <Btn label="Phrase EN" onPress={() => say(EN_SENTENCE, "en")} disabled={wsState === "disconnected" || wsState === "connecting" || busy} />
        <Btn label="Phrase FR" onPress={() => say(FR_SENTENCE, "fr")} disabled={wsState === "disconnected" || wsState === "connecting" || busy} />
      </View>
      <View style={styles.row}>
        <Btn label="Écoute" onPress={() => clientRef.current?.startListening()} disabled={wsState === "disconnected"} />
        <Btn label="Fin écoute" onPress={() => clientRef.current?.stopListening()} disabled={wsState === "disconnected"} />
        <Btn label="Interrompre" onPress={() => { clientRef.current?.interrupt(); log("interrupt envoyé"); }} disabled={wsState !== "talking"} />
      </View>

      <ScrollView style={styles.logs} contentContainerStyle={{ paddingBottom: 24 }}>
        {logs.map((l, i) => <Text key={i} style={styles.logLine}>{new Date(l.t).toLocaleTimeString()} — {l.msg}</Text>)}
      </ScrollView>
    </View>
  );
}

// Affiche la piste vidéo du participant avatar (distant), pas la première piste trouvée
function AvatarView({ onInfo }: { onInfo: (m: string) => void }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera, Track.Source.Unknown], { onlySubscribed: true });
  useEffect(() => {
    const onJoin = (p: any) => onInfo(`participant distant: ${p?.identity}`);
    room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => { room.off(RoomEvent.ParticipantConnected, onJoin); };
  }, [room]);
  const remoteVideo = tracks.find((t) => isTrackReference(t) && t.participant.identity !== room.localParticipant.identity && t.publication?.kind === "video");
  if (!remoteVideo || !isTrackReference(remoteVideo)) return <View style={styles.poster}><Text style={styles.posterText}>En attente de la vidéo du coach…</Text></View>;
  return <VideoTrack trackRef={remoteVideo} style={{ flex: 1 }} objectFit="cover" />;
}

function Btn({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, danger && styles.btnDanger, disabled && { opacity: 0.4 }]} accessibilityRole="button">
      <Text style={[styles.btnText, danger && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background, paddingHorizontal: 20, paddingTop: 52 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: L.textPrimary },
  badge: { backgroundColor: L.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: "700", color: L.textSecondary },
  badgeOk: { backgroundColor: L.successSoft, color: L.success },
  video: { height: 220, borderRadius: 22, overflow: "hidden", backgroundColor: "#E3E1EE" },
  poster: { flex: 1, alignItems: "center", justifyContent: "center" },
  posterText: { color: L.textSecondary, fontSize: 14, fontWeight: "600" },
  meta: { color: L.textSecondary, fontSize: 12, marginTop: 6, marginBottom: 10 },
  row: { flexDirection: "row", gap: 8, marginBottom: 8 },
  btn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  btnDanger: { backgroundColor: L.danger },
  btnText: { color: L.textPrimary, fontSize: 14, fontWeight: "700" },
  logs: { flex: 1, backgroundColor: L.surface, borderRadius: 16, padding: 12, marginTop: 6 },
  logLine: { color: L.textPrimary, fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
});
