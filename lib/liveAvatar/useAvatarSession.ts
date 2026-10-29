// Cycle de vie du coach vidéo pendant une leçon : démarrage au « C'est parti », une session pour toute la leçon,
// arrêt avant le bilan / à la sortie / en arrière-plan / sur inactivité / sur « Continuer sans vidéo ».
// Toute défaillance → mode audio (lecture locale), la tentative continue à l'identique.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { startAvatarSession, stopAvatarSession, avatarStartError, AvatarCommandClient, AvatarCredentials } from "./session";

export type AvatarStatus = "off" | "connecting" | "ready" | "listening" | "thinking" | "talking" | "audio_only";
export type AvatarStopReason = "USER_CLOSED" | "USER_DISCONNECTED" | "IDLE_TIMEOUT" | "SERVER_ERROR";

const CONNECT_TIMEOUT_MS = 12000;
const IDLE_TIMEOUT_MS = 60000;

export type AvatarController = {
  status: AvatarStatus;
  creds: AvatarCredentials | null;
  fallbackReason: string | null;
  offReason: string | null; // pourquoi la vidéo n'a pas démarré (statut "off" silencieux) — diagnostic
  isActive: boolean; // vidéo + WebSocket prêts : l'audio du coach passe par l'avatar
  start: (scope?: string, coachId?: string) => Promise<void>; // scope : id de tentative ou "daily:AAAA-MM-JJ" — passé explicitement, ne dépend pas d'un re-rendu
  stop: (reason?: AvatarStopReason) => Promise<void>;
  continueWithoutVideo: () => void;
  speak: (utterances: (string[] | null | undefined)[]) => Promise<void>; // énoncés successifs, chacun = segments PCM
  interrupt: () => void;
  startListening: () => void;
  stopListening: () => void;
  setThinking: (on: boolean) => void;
  setBusy: (on: boolean) => void; // enregistrement / traitement en cours : pas de coupure pour inactivité
  onRoomConnected: () => void;
  onRoomFailed: (reason: string) => void;
};

export function useAvatarSession(opts: {
  attemptId: string | null;
  coachId: string;
  onReady?: (connectMs: number) => void;
  onFailed?: (reason: string) => void;
  onFallback?: (reason: string) => void;
  onStopped?: (reason: string, seconds: number) => void;
  onRequested?: () => void;
}): AvatarController {
  const [status, setStatus] = useState<AvatarStatus>("off");
  const [creds, setCreds] = useState<AvatarCredentials | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [offReason, setOffReason] = useState<string | null>(null);
  const clientRef = useRef<AvatarCommandClient | null>(null);
  const credsRef = useRef<AvatarCredentials | null>(null);
  const startedAtRef = useRef(0);
  const t0Ref = useRef(0);
  const roomReadyRef = useRef(false);
  const wsReadyRef = useRef(false);
  const busyRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<AvatarStatus>("off");
  const tearingDownRef = useRef(false);
  const optsRef = useRef(opts); optsRef.current = opts;

  const set = (s: AvatarStatus) => { statusRef.current = s; setStatus(s); };

  const clearTimers = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    idleTimer.current = null; maxTimer.current = null;
  };

  const teardown = useCallback(async (reason: AvatarStopReason, fallback: string | null) => {
    // Réentrance : client.close() émet "disconnected" de façon synchrone → onState → teardown. On vide les refs AVANT de fermer,
    // et un second appel pendant la fermeture ne fait rien (sinon récursion infinie → "Maximum call stack size exceeded").
    if (tearingDownRef.current) return;
    tearingDownRef.current = true;
    clearTimers();
    const c = credsRef.current;
    const client = clientRef.current;
    clientRef.current = null; credsRef.current = null; setCreds(null);
    roomReadyRef.current = false; wsReadyRef.current = false;
    try { client?.close(); } catch {}
    tearingDownRef.current = false;
    if (fallback) { setFallbackReason(fallback); set("audio_only"); optsRef.current.onFallback?.(fallback); }
    else set("off");
    if (c) {
      const seconds = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      await stopAvatarSession(c.sessionId, reason);
      optsRef.current.onStopped?.(reason, seconds);
    }
  }, []);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (busyRef.current || !credsRef.current) { armIdle(); return; }
      teardown("IDLE_TIMEOUT", "idle_timeout");
    }, IDLE_TIMEOUT_MS);
  }, [teardown]);

  const checkReady = useCallback(() => {
    if (roomReadyRef.current && wsReadyRef.current && credsRef.current && statusRef.current === "connecting") {
      set("ready");
      if (__DEV__) console.log("AVATAR TIMINGS", JSON.stringify({ server_ms: serverMsRef.current, connect_ms: Date.now() - t0Ref.current - serverMsRef.current, total_ms: Date.now() - t0Ref.current }));
      optsRef.current.onReady?.(Date.now() - t0Ref.current);
      armIdle();
    }
  }, [armIdle]);

  const serverMsRef = useRef(0); // durée de l'appel startAvatarSession (diagnostic)
  // scope : id de tentative ou "daily:…" ; coachId : coach explicite (évite toute course avec le re-rendu après loadProfile)
  const start = useCallback(async (scope?: string, coachId?: string) => {
    const attemptId = scope ?? optsRef.current.attemptId;
    if (!attemptId) { setOffReason("no_attempt_id"); console.warn("avatar.start: pas d'attemptId au moment de l'appel"); return; }
    if (credsRef.current || statusRef.current === "connecting") return;
    setOffReason(null);
    set("connecting"); setFallbackReason(null);
    t0Ref.current = Date.now();
    optsRef.current.onRequested?.();
    let c: AvatarCredentials;
    try {
      c = await startAvatarSession(coachId ?? optsRef.current.coachId, attemptId);
      serverMsRef.current = Date.now() - t0Ref.current;
    } catch (e: any) {
      const code = avatarStartError(e);
      optsRef.current.onFailed?.(code);
      // Flag désactivé / pas pilote / coach absent : silencieux (mode audio normal). Budget ou fournisseur : fallback annoncé.
      if (code === "avatar_disabled" || code === "avatar_not_pilot" || code === "coach_not_configured") { setOffReason(code); console.warn("avatar.start refusé:", code); set("off"); return; }
      setFallbackReason(code); set("audio_only"); optsRef.current.onFallback?.(code);
      return;
    }
    if (!c.wsUrl || !c.livekitUrl || !c.livekitClientToken) {
      await stopAvatarSession(c.sessionId, "SERVER_ERROR");
      optsRef.current.onFailed?.("missing_credentials");
      setFallbackReason("missing_credentials"); set("audio_only"); optsRef.current.onFallback?.("missing_credentials");
      return;
    }
    credsRef.current = c; setCreds(c);
    startedAtRef.current = Date.now();
    // Garde-fou local : la session s'arrête côté fournisseur à max_session_duration ; on bascule juste avant
    maxTimer.current = setTimeout(() => teardown("USER_CLOSED", "max_duration"), Math.max(10, c.maxSessionSeconds - 5) * 1000);
    const client = new AvatarCommandClient(c.wsUrl, CONNECT_TIMEOUT_MS);
    clientRef.current = client;
    client.onState((s) => {
      if (s === "disconnected" || s === "error") {
        if (credsRef.current && statusRef.current !== "off") teardown("USER_DISCONNECTED", s === "error" ? "ws_error" : "ws_disconnected");
      }
    });
    try {
      await client.connect();
      wsReadyRef.current = true;
      checkReady();
    } catch (e: any) {
      teardown("SERVER_ERROR", "connect_timeout");
    }
  }, [teardown, checkReady]);

  const stop = useCallback(async (reason: AvatarStopReason = "USER_CLOSED") => {
    if (!credsRef.current && statusRef.current !== "connecting") { if (statusRef.current !== "off") set("off"); return; }
    await teardown(reason, null);
  }, [teardown]);

  const continueWithoutVideo = useCallback(() => { teardown("USER_CLOSED", "user_choice"); }, [teardown]);

  // Arrière-plan → arrêt ; démontage → arrêt
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active" && credsRef.current) teardown("USER_DISCONNECTED", "background"); });
    return () => { sub.remove(); if (credsRef.current) teardown("USER_DISCONNECTED", null); };
  }, [teardown]);

  const isActive = status === "ready" || status === "listening" || status === "thinking" || status === "talking";

  const isActiveNow = () => ["ready", "listening", "thinking", "talking"].includes(statusRef.current);
  const speak = useCallback(async (utterances: (string[] | null | undefined)[]) => {
    const client = clientRef.current;
    if (!client || !isActiveNow()) return;
    armIdle();
    for (const u of utterances) {
      if (!u || !u.length) continue;
      if (!clientRef.current) return;
      set("talking");
      await client.speak(u);
    }
    if (credsRef.current && statusRef.current === "talking") set("ready");
    armIdle();
  }, [armIdle]);

  const interrupt = useCallback(() => { clientRef.current?.interrupt(); if (credsRef.current) set("ready"); }, []);
  const startListening = useCallback(() => { if (!clientRef.current) return; clientRef.current.startListening(); set("listening"); armIdle(); }, [armIdle]);
  const stopListening = useCallback(() => { if (!clientRef.current) return; clientRef.current.stopListening(); if (statusRef.current === "listening") set("ready"); armIdle(); }, [armIdle]);
  const setThinking = useCallback((on: boolean) => { if (!credsRef.current) return; if (on) set("thinking"); else if (statusRef.current === "thinking") set("ready"); }, []);
  const setBusy = useCallback((on: boolean) => { busyRef.current = on; if (!on) armIdle(); }, [armIdle]);
  const onRoomConnected = useCallback(() => { roomReadyRef.current = true; checkReady(); }, [checkReady]);
  const onRoomFailed = useCallback((reason: string) => { if (credsRef.current) teardown("SERVER_ERROR", reason); }, [teardown]);

  return useMemo(() => ({
    status, creds, fallbackReason, offReason, isActive,
    start, stop, continueWithoutVideo, speak, interrupt, startListening, stopListening, setThinking, setBusy, onRoomConnected, onRoomFailed,
  }), [status, creds, fallbackReason, offReason, isActive, start, stop, continueWithoutVideo, speak, interrupt, startListening, stopListening, setThinking, setBusy, onRoomConnected, onRoomFailed]);
}

// PCM 16 bits 24 kHz mono (segments base64) → WAV base64, pour la lecture locale (fallback) avec expo-audio.
// Travaille en octets et encode par tranches (multiples de 3) : pas de chaîne géante, pas de RangeError Hermes.
export function pcmChunksToWavBase64(chunks: string[], sampleRate = 24000): string {
  const bins = chunks.map(base64ToBytes);
  const dataLen = bins.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) out[o + i] = t.charCodeAt(i); };
  str(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, dataLen, true);
  let off = 44;
  for (const b of bins) { out.set(b, off); off += b.length; }
  return bytesToBase64(out);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const STEP = 3 * 1024; // multiple de 3 → les morceaux base64 se concatènent tels quels
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += STEP) {
    const end = Math.min(i + STEP, bytes.length);
    let bin = "";
    for (let j = i; j < end; j++) bin += String.fromCharCode(bytes[j]); // pas de fromCharCode.apply : Hermes limite la profondeur de pile native
    parts.push(btoa(bin));
  }
  return parts.join("");
}
