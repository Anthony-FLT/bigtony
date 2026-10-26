// LessonConversation — écran 2 (maquette 20/10) : « Sam · Ton coach IA », compteur d'objectifs, lignes d'objectifs,
// bulles, carte « Le conseil de Sam », carte « Je n'ai rien entendu », aides (Aide-moi à dire / Un exemple),
// composer : clavier · micro · rejouer. Chaque réponse envoyée = un tour (lessonTurn), le serveur décide de la suite.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, TextInput, Linking, AccessibilityInfo, Modal, Keyboard, Animated, Easing } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useAudioRecorder, useAudioRecorderState, useAudioPlayer, RecordingPresets, AudioModule, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../lib/firebase";
import { L, Icon, RoundButton, ListenButton } from "../../components/lessonUi";
import { lessonTurn } from "../../lib/learningPath/attempts";
import { avatarSpeech } from "../../lib/liveAvatar/session";
import type { AttemptTurn, Coaching, LessonTurnResponse, LessonVariant } from "../../lib/learningPath/types";
import CoachVideo from "../../components/CoachVideo";
import TypingDots from "../../components/TypingDots";
import { COACHES } from "../../lib/learningPath/coaches";
import { pcmChunksToWavBase64, type AvatarController } from "../../lib/liveAvatar/useAvatarSession";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });
const translateToEnglish = httpsCallable(functions, "translateToEnglish", { timeout: 30000 });
const suggestExample = httpsCallable(functions, "suggestExample", { timeout: 30000 });
const MIN_RECORDING_MS = 800;

type Msg =
  | { kind: "coach"; id: string; text: string; fr?: string; audio?: string | null; pcm?: string[] | null }
  | { kind: "user"; id: string; text: string }
  | { kind: "coaching"; id: string; coaching: Coaching; original: string; audioFr?: string | null; audioEn?: string | null; pcmFr?: string[] | null; pcmEn?: string[] | null }
  | { kind: "nothing"; id: string };

// Audio local : MP3 tel quel, ou segments PCM (coach vidéo) convertis en WAV
const localAudio = (mp3?: string | null, pcm?: string[] | null) => mp3 ?? (pcm && pcm.length ? pcmChunksToWavBase64(pcm) : null);

type Composer = "ready" | "recording" | "processing" | "speaking" | "retry" | "validating";
export type ConversationEnd = { turns: number; coachingUsed: boolean };

function friendlyError(e: any): string {
  const msg = String(e?.message ?? e ?? "");
  if (/coach_unavailable|\b503\b|UNAVAILABLE|overloaded/i.test(msg)) return "Ton coach est très sollicité en ce moment. Réessaie dans un instant.";
  if (/network|timeout|Failed to fetch|ECONN|offline|deadline/i.test(msg)) return "Connexion interrompue. Vérifie ta connexion et réessaie.";
  if (/attempt_not_active/.test(msg)) return "Cette leçon est déjà terminée. Reviens au parcours.";
  return "Une erreur est survenue. Réessaie dans un instant.";
}

function messagesFromTurns(turns: AttemptTurn[]): Msg[] {
  const out: Msg[] = [];
  for (const t of turns) {
    out.push({ kind: "user", id: `u${t.index}`, text: t.user });
    if (t.coaching) out.push({ kind: "coaching", id: `k${t.index}`, coaching: t.coaching, original: t.user });
    if (t.coach) out.push({ kind: "coach", id: `c${t.index}`, text: t.coach });
  }
  return out;
}

// Contexte passé aux aides (traduction / exemple) : rôle et relances de la variante
function lessonContext(v: LessonVariant): string {
  return `${v.coachRole}. The learner plays: ${v.userRole}. Short guided lesson; the coach already said: "${v.openingEn}".`;
}

// Mise en évidence des mots corrigés : mots de la phrase cible absents de la phrase d'origine
function CorrectedPhrase({ original, target }: { original: string; target: string }) {
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
  const orig = new Set(original.split(/\s+/).map(norm).filter(Boolean));
  const tokens = target.split(/(\s+)/);
  return (
    <Text style={styles.coachingPhrase}>
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok) || !tok) return tok;
        const changed = !orig.has(norm(tok));
        return <Text key={i} style={changed ? styles.coachingChanged : undefined}>{tok}</Text>;
      })}
    </Text>
  );
}

export default function LessonConversation({ attemptId, variant, level, initialTurns, initialCovered, initialRetry, voice, speakingRate, validating, onCompleted, onBack, onCoachingShown, onObjectiveCovered, onCoachingRetryDone, avatar, coachId = "us_male", intro, onClosingStarted, daily, openingOverride }: {
  attemptId: string;
  avatar?: AvatarController; // coach vidéo (LiveAvatar) — absent ou "off" : leçon audio inchangée
  coachId?: string;
  intro?: string; // première leçon : le coach se présente avant l'ouverture (repli si pas d'ouverture générée)
  openingOverride?: string; // ouverture générée par le serveur (bonjour + direction de la leçon + première question)
  variant: LessonVariant;
  level: string;
  initialTurns: AttemptTurn[];
  initialCovered: string[];
  initialRetry: boolean;
  voice: string;
  speakingRate: number;
  validating: boolean;
  onCompleted: (end: ConversationEnd) => void;
  onClosingStarted?: () => void; // le coach commence sa phrase de clôture : le bilan peut démarrer en parallèle
  // Point du jour : pas d'objectifs, un compteur d'échanges et une pastille « phrase à replacer » ; les tours passent par turnFn
  daily?: { maxTurns: number; reuseTotal: number; reuseDone: number; turnFn: typeof lessonTurn };
  onBack: (covered: number, turn: number) => void;
  onCoachingShown?: (requiresRetry: boolean) => void;
  onObjectiveCovered?: (criterionId: string, turn: number, support: string) => void;
  onCoachingRetryDone?: (covered: boolean) => void;
}) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 80);
  const player = useAudioPlayer();
  // Première leçon : l'intro salue et présente déjà le coach → on retire le « Hi, I'm Sam. » de l'ouverture pour ne pas le dire deux fois
  // Le catalogue écrit « Sam » : on y met le prénom du coach choisi
  const coachDisplayName = (COACHES as Record<string, { displayName: string }>)[coachId]?.displayName ?? "Sam";
  const openingRaw = variant.openingEn.replace(/\bSam\b/g, coachDisplayName);
  const openingBody = intro ? openingRaw.replace(/^\s*(hi|hello|hey)[\s,!.]*(i'?m|i am|my name is)\s+[A-Z][a-z]+[.!,]?\s*/i, "").replace(/^\s*(hi|hello|hey)[\s,!.]+/i, "") : openingRaw;
  const isFresh = initialTurns.length === 0 && !initialRetry;
  // Nouvelle tentative avec ouverture générée : deux messages — le contexte de la leçon, puis la première question
  // Si l'ouverture générée contient déjà la première question (anciennes tentatives), on la retire : elle est dans la 2e bulle
  const briefingText = openingOverride && isFresh ? (openingOverride.includes(openingRaw) ? openingOverride.replace(openingRaw, "").trim() || null : openingOverride) : null;
  const openingText = briefingText
    ? openingRaw
    : intro && isFresh ? `${intro} ${openingBody.charAt(0).toUpperCase()}${openingBody.slice(1)}` : openingRaw;
  // Textes dits à l'arrivée sur l'écran : [contexte,] ouverture — ou la dernière réplique du coach en cas de reprise
  const lastResumed = [...messagesFromTurns(initialTurns)].reverse().find((m) => m.kind === "coach")?.text;
  const arrivalTexts: { id: string; text: string }[] = lastResumed
    ? [{ id: "resumed", text: lastResumed }]
    : [...(briefingText ? [{ id: "br", text: briefingText }] : []), { id: "op", text: openingText }];
  const arrivalText = arrivalTexts[arrivalTexts.length - 1].text;
  const [messages, setMessages] = useState<Msg[]>(() => [
    ...(briefingText ? [{ kind: "coach", id: "br", text: briefingText, audio: null } as Msg] : []),
    { kind: "coach", id: "op", text: openingText, audio: null },
    ...messagesFromTurns(initialTurns),
  ]);
  const [covered, setCovered] = useState<Set<string>>(() => new Set(initialCovered));
  const [closingIn, setClosingIn] = useState<number | null>(null); // échanges restants une fois tout couvert
  const [turnsDone, setTurnsDone] = useState(initialTurns.length);
  const [reuseDone, setReuseDone] = useState(daily?.reuseDone ?? 0);
  const [target, setTarget] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer>(initialRetry ? "retry" : "ready");
  const [channel, setChannel] = useState<"voice" | "text">("voice");
  const coachName = (COACHES as any)[coachId]?.displayName ?? "Sam";
  const [micDenied, setMicDenied] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [coachReduced, setCoachReduced] = useState(false);
  const [objectivesOpen, setObjectivesOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const s1 = Keyboard.addListener("keyboardDidShow", () => { setKeyboardOpen(true); setObjectivesOpen(false); });
    const s2 = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => { s1.remove(); s2.remove(); };
  }, []);
  const [frFor, setFrFor] = useState<Record<string, string>>({});
  const [busyFor, setBusyFor] = useState<Record<string, boolean>>({});
  // Aides
  const [showHelp, setShowHelp] = useState(false);
  const [helpInput, setHelpInput] = useState("");
  const [helpResult, setHelpResult] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [example, setExample] = useState<{ en: string; fr: string } | null>(null);
  const [exampleBusy, setExampleBusy] = useState(false);

  const turnCountRef = useRef(initialTurns.length);
  const coachingUsedRef = useRef(initialTurns.some((t) => !!t.coaching?.requiresRetry));
  const retryPendingRef = useRef(initialRetry);
  const clientTurnIdRef = useRef<string | null>(null);
  const recordStartRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const queueRef = useRef<string[]>([]);
  const onQueueEndRef = useRef<(() => void) | null>(null);
  const lastCoachAudioRef = useRef<{ text: string; audio: string | null; pcm: string[] | null }>({ text: arrivalText, audio: null, pcm: null });
  const openingSaidRef = useRef(false); // ouverture déjà dite (local ou avatar)
  const avatarOn = !!avatar && avatar.status !== "off";
  const avatarRef = useRef(avatar); avatarRef.current = avatar;
  const avatarActive = () => !!avatarRef.current?.isActive;
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotionRef.current = v; }).catch(() => {});
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { setMicDenied(true); setChannel("text"); }
    })();
    // Ouverture lue à voix haute au premier affichage (pas en reprise)
    // À l'arrivée, le coach redit systématiquement sa dernière réplique (ouverture ou reprise) — sauf si l'avatar va le faire
    if (!avatarOn) { openingSaidRef.current = true; speakArrival(); }
    return () => { try { player.pause(); } catch {} };
  }, []);
  useEffect(() => { if (validating) setComposer("validating"); }, [validating]);
  // Plus de vidéo (mode audio) : le bloc coach passe en ligne réduite, l'écran revient à la conversation
  useEffect(() => { if (avatar?.status === "audio_only") setCoachReduced(true); }, [avatar?.status]);
  // Coach vidéo prêt : il dit l'ouverture (une seule fois, pas en reprise). Si la vidéo échoue avant : lecture locale, une fois.
  useEffect(() => {
    if (!avatar || openingSaidRef.current) return;
    if (avatar.status === "off" || avatar.status === "audio_only") { openingSaidRef.current = true; speakArrival(); return; }
    if (avatar.status !== "ready") return;
    openingSaidRef.current = true;
    (async () => {
      try {
        const pcms = await Promise.all(arrivalTexts.map((t) => avatarSpeech(t.text, "en", voice, speakingRate)));
        const last = pcms[pcms.length - 1];
        lastCoachAudioRef.current = { text: arrivalText, audio: null, pcm: last };
        setMessages((m) => m.map((x) => { const i = arrivalTexts.findIndex((t) => x.kind === "coach" && x.id === t.id); return i >= 0 ? { ...x, pcm: pcms[i] } : x; }));
        avatarSay(pcms);
      } catch (e) { console.warn("ouverture avatar échouée:", e); }
    })();
  }, [avatar?.status]);
  // Lecture locale des textes d'arrivée (pas d'avatar) : les deux bulles à la suite
  const speakArrival = async () => {
    stopAudio();
    try {
      const audios = await Promise.all(arrivalTexts.map((t) => translateText({ text: t.text, mode: "speak", voice, speakingRate }).then((r: any) => r.data?.audioBase64 as string | null)));
      const last = audios[audios.length - 1];
      if (last) lastCoachAudioRef.current.audio = last;
      playQueue(audios);
    } catch (e) { console.warn("Lecture de l'ouverture échouée:", e); }
  };
  useEffect(() => {
    if (composer !== "recording") { setRecordingSeconds(0); return; }
    const start = Date.now();
    const id = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(id);
  }, [composer]);

  // ---------- Audio (file d'attente, jamais superposé) ----------
  useEffect(() => {
    const sub = player.addListener("playbackStatusUpdate", (st: any) => { if (st?.didJustFinish) playNext(); });
    return () => sub.remove();
  }, [player]);
  const playNext = () => {
    const next = queueRef.current.shift();
    if (!next) {
      const cb = onQueueEndRef.current; onQueueEndRef.current = null;
      setComposer((c) => (c === "speaking" ? "ready" : c));
      cb?.();
      return;
    }
    (async () => {
      try {
        const p = FileSystem.cacheDirectory + `lesson_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, next, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
      } catch (e) { console.warn("Lecture audio échouée:", e); playNext(); }
    })();
  };
  const playQueue = (items: (string | null | undefined)[], onEnd?: () => void) => {
    queueRef.current = items.filter((x): x is string => !!x);
    onQueueEndRef.current = onEnd ?? null;
    if (queueRef.current.length === 0) { onEnd?.(); return; }
    setComposer((c) => (c === "ready" ? "speaking" : c));
    playNext();
  };
  const stopAudio = () => {
    if (avatarRef.current?.status === "talking") avatarRef.current.interrupt();
    queueRef.current = [];
    const cb = onQueueEndRef.current; onQueueEndRef.current = null;
    try { player.pause(); } catch {}
    setComposer((c) => (c === "speaking" ? "ready" : c));
    cb?.();
  };
  const speak = async (key: string, text: string) => {
    setBusyFor((b) => ({ ...b, [key]: true }));
    try {
      const res: any = await translateText({ text, mode: "speak", voice, speakingRate });
      if (res.data?.audioBase64) { if (key === "last") lastCoachAudioRef.current.audio = res.data.audioBase64; playQueue([res.data.audioBase64]); }
    } catch (e) { console.warn("Écoute échouée:", e); }
    finally { setBusyFor((b) => ({ ...b, [key]: false })); }
  };
  const replayLast = () => {
    stopAudio();
    const last = lastCoachAudioRef.current;
    if (avatarActive() && last.pcm) { avatarSay([last.pcm]); return; }
    const a = localAudio(last.audio, last.pcm);
    if (a) playQueue([a]); else speak("last", last.text);
  };
  const listen = (m: Msg) => {
    stopAudio();
    if (m.kind === "coach") {
      if (avatarActive() && m.pcm) { avatarSay([m.pcm]); return; }
      const a = localAudio(m.audio, m.pcm);
      if (a) playQueue([a]); else speak(m.id, m.text);
    } else if (m.kind === "coaching") {
      if (avatarActive() && (m.pcmFr || m.pcmEn)) { avatarSay([m.pcmFr, m.pcmEn]); return; }
      if (m.audioFr || m.audioEn) playQueue([m.audioFr, m.audioEn]); else speak(m.id, m.coaching.targetPhraseEn);
    }
  };
  // Énoncés joués par l'avatar (une seule sortie audio : pas de lecture locale en parallèle)
  const avatarSay = async (utterances: (string[] | null | undefined)[], onEnd?: () => void) => {
    const a = avatarRef.current;
    if (!a) { onEnd?.(); return; }
    setComposer((c) => (c === "ready" ? "speaking" : c));
    await a.speak(utterances);
    setComposer((c) => (c === "speaking" ? "ready" : c));
    onEnd?.();
  };
  const translate = async (m: Extract<Msg, { kind: "coach" }>) => {
    if (frFor[m.id]) { setFrFor((f) => ({ ...f, [m.id]: "" })); return; }
    if (m.fr) { setFrFor((f) => ({ ...f, [m.id]: m.fr! })); return; }
    setBusyFor((b) => ({ ...b, [`tr-${m.id}`]: true }));
    try {
      const res: any = await translateText({ text: m.text, mode: "sentence" });
      setFrFor((f) => ({ ...f, [m.id]: res.data?.translation || "(traduction indisponible)" }));
    } catch { setFrFor((f) => ({ ...f, [m.id]: "(traduction indisponible)" })); }
    finally { setBusyFor((b) => ({ ...b, [`tr-${m.id}`]: false })); }
  };

  // ---------- Aides ----------
  const runHelp = async () => {
    const text = helpInput.trim();
    if (!text || helpBusy) return;
    setHelpBusy(true); setHelpResult("");
    try { const res: any = await translateToEnglish({ text, level }); setHelpResult(res.data?.english ?? ""); }
    catch { setHelpResult(""); }
    finally { setHelpBusy(false); }
  };
  const runExample = async () => {
    setExampleBusy(true); setExample(null);
    try {
      const history = messages.filter((m) => m.kind === "coach" || m.kind === "user").reduce<{ user: string; coach: string }[]>((acc, m) => {
        if (m.kind === "coach") acc.push({ user: "", coach: m.text });
        else if (acc.length) acc[acc.length - 1].user = m.text;
        return acc;
      }, []);
      const res: any = await suggestExample({ history, scenarioId: null, level, sceneContext: null, customContext: lessonContext(variant) });
      setExample({ en: res.data?.example_en ?? "", fr: res.data?.example_fr ?? "" });
    } catch { setExample(null); }
    finally { setExampleBusy(false); }
  };

  // ---------- Tour ----------
  const applyResponse = (d: LessonTurnResponse, wasRetry: boolean) => {
    const idx = d.turnIndex;
    const add: Msg[] = [{ kind: "user", id: `u${idx}`, text: d.transcript }];
    // Le WAV local n'est construit qu'au moment de jouer sans avatar (jamais d'avance : coûteux et inutile en mode vidéo)
    const frLocal = d.coachingAudioFrBase64 ?? null, enLocal = d.coachingAudioEnBase64 ?? null, replyLocal = d.replyAudioBase64 ?? null;
    if (d.coaching) add.push({ kind: "coaching", id: `k${idx}`, coaching: d.coaching, original: d.transcript, audioFr: frLocal, audioEn: enLocal, pcmFr: d.coachingFrPcmChunks, pcmEn: d.coachingEnPcmChunks });
    if (d.reply_en) { add.push({ kind: "coach", id: `c${idx}`, text: d.reply_en, fr: d.reply_fr, audio: replyLocal, pcm: d.replyPcmChunks ?? null }); lastCoachAudioRef.current = { text: d.reply_en, audio: replyLocal, pcm: d.replyPcmChunks ?? null }; }
    setMessages((m) => [...m.filter((x) => x.kind !== "nothing"), ...add]);
    turnCountRef.current = idx + 1; setTurnsDone(idx + 1);
    if (typeof (d as any).reuseDone === "number") setReuseDone((d as any).reuseDone);
    const newly = d.coveredCriteria.filter((id) => !covered.has(id));
    setCovered(new Set(d.coveredCriteria));
    setClosingIn(typeof d.closingIn === "number" ? d.closingIn : null);
    newly.forEach((id) => onObjectiveCovered?.(id, idx + 1, wasRetry ? "coaching" : "none"));
    if (wasRetry) onCoachingRetryDone?.(newly.length > 0 || d.allCovered);
    setTarget(d.nextAction === "ask_targeted_question" ? d.targetCriterionId : null);
    if (d.coaching) onCoachingShown?.(d.coaching.requiresRetry);
    // Le conseil n'est pas lu à voix haute : seule la réplique du coach est jouée (conversation naturelle), la carte se lit.
    const pcms = [d.replyPcmChunks];
    const viaAvatar = avatarActive() && pcms.some((p) => p && p.length);
    const audios = viaAvatar ? [] : [localAudio(replyLocal, d.replyPcmChunks)];
    avatarRef.current?.setThinking(false);
    const play = (onEnd?: () => void) => {
      if (viaAvatar) avatarSay(pcms, onEnd); else playQueue(audios, onEnd);
    };
    if (d.nextAction === "coach_retry") {
      coachingUsedRef.current = true; retryPendingRef.current = true;
      setComposer("speaking"); play(() => { setComposer("retry"); avatarRef.current?.setBusy(false); });
    } else if (d.nextAction === "propose_completion") {
      retryPendingRef.current = false;
      // Avec l'avatar, speak_ended précède la fin réelle de la vidéo (latence de transport) : on laisse 1,5 s avant de couper
      setComposer("validating"); onClosingStarted?.();
      play(() => setTimeout(() => onCompleted({ turns: idx + 1, coachingUsed: coachingUsedRef.current }), viaAvatar ? 1500 : 0));
    } else {
      retryPendingRef.current = false;
      setComposer("ready"); play(() => avatarRef.current?.setBusy(false));
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduceMotionRef.current }), 120);
  };
  const send = async (payload: { audioBase64?: string; text?: string }) => {
    setError(null);
    setComposer("processing");
    const wasRetry = retryPendingRef.current;
    if (!clientTurnIdRef.current) clientTurnIdRef.current = `${attemptId}-${turnCountRef.current}-${Date.now()}`;
    avatarRef.current?.stopListening();
    avatarRef.current?.setThinking(true);
    try {
      const tSend = Date.now();
      const d = await (daily?.turnFn ?? lessonTurn)({ attemptId, clientTurnId: clientTurnIdRef.current, mimeType: "audio/mp4", voice, speakingRate, audioFormat: avatarOn ? "pcm24k" : "mp3", ...payload });
      if (__DEV__) console.log("LESSON TIMINGS", JSON.stringify({ roundtrip_ms: Date.now() - tSend, ...((d as any).timings ?? {}) }));
      if (d.heardNothing) {
        avatarRef.current?.setThinking(false); avatarRef.current?.setBusy(false);
        setMessages((m) => [...m.filter((x) => x.kind !== "nothing"), { kind: "nothing", id: `n${Date.now()}` }]);
        setComposer(wasRetry ? "retry" : "ready");
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduceMotionRef.current }), 120);
        return;
      }
      clientTurnIdRef.current = null; setPendingText(null);
      applyResponse(d, wasRetry);
    } catch (e: any) { setError(friendlyError(e)); setComposer(wasRetry ? "retry" : "ready"); avatarRef.current?.setThinking(false); avatarRef.current?.setBusy(false); }
  };
  const startRecording = async () => {
    if (composer !== "ready" && composer !== "retry" && !(composer === "speaking" && avatarActive())) return;
    // Parler pendant que le coach parle : interruption + purge, puis posture d'écoute
    if (avatarActive()) { avatarRef.current?.interrupt(); avatarRef.current?.startListening(); avatarRef.current?.setBusy(true); }
    stopAudio(); setError(null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(); recorder.record();
      recordStartRef.current = Date.now(); setComposer("recording");
    } catch (e: any) { setError(friendlyError(e)); }
  };
  const cancelRecording = async () => {
    try { await recorder.stop(); await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {}
    avatarRef.current?.stopListening(); avatarRef.current?.setBusy(false);
    setComposer(retryPendingRef.current ? "retry" : "ready");
  };
  const stopAndSend = async () => {
    if (composer !== "recording") return;
    setComposer("processing");
    try {
      await recorder.stop(); await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - recordStartRef.current < MIN_RECORDING_MS) { setComposer(retryPendingRef.current ? "retry" : "ready"); return; }
      const uri = recorder.uri; if (!uri) throw new Error("Aucun enregistrement produit");
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await send({ audioBase64 });
    } catch (e: any) { setError(friendlyError(e)); setComposer(retryPendingRef.current ? "retry" : "ready"); }
  };
  const sendText = () => {
    const text = (pendingText ?? textInput).trim();
    if (!text || composer === "processing") return;
    if (avatarActive()) { avatarRef.current?.interrupt(); avatarRef.current?.setBusy(true); }
    setPendingText(text); setTextInput(""); send({ text });
  };

  // ---------- Rendu ----------
  const objectives = useMemo(() => variant.requiredCriteria.map((c) => ({ id: c.id, label: c.descriptionFr, state: covered.has(c.id) ? "covered" : target === c.id ? "current" : "todo" })), [variant, covered, target]);
  // Animation quand un objectif passe au vert : le segment pulse et une pastille « Objectif atteint » apparaît un instant
  const segScale = useRef<Record<string, Animated.Value>>({}).current;
  const segAnim = (id: string) => (segScale[id] ??= new Animated.Value(1));
  const toast = useRef(new Animated.Value(0)).current;
  const [toastText, setToastText] = useState("");
  const prevCoveredRef = useRef<Set<string>>(new Set(initialCovered));
  useEffect(() => {
    const newly = [...covered].filter((id) => !prevCoveredRef.current.has(id));
    prevCoveredRef.current = new Set(covered);
    if (newly.length === 0) return;
    if (reduceMotionRef.current) return;
    newly.forEach((id) => {
      const v = segAnim(id);
      Animated.sequence([
        Animated.timing(v, { toValue: 1.9, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(v, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]).start();
    });
    const allDone = covered.size >= variant.requiredCriteria.length;
    setToastText(allDone ? "Tous les objectifs atteints !" : newly.length > 1 ? `${newly.length} objectifs atteints` : "Objectif atteint");
    toast.setValue(0);
    Animated.sequence([
      Animated.spring(toast, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(toast, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [covered]);
  const connecting = !!avatar && avatar.status === "connecting";
  const composerLabel =
    connecting ? "Patiente un instant…" :
    composer === "recording" ? "Je t'écoute… Touche pour envoyer" :
    composer === "processing" ? "Je prépare ma réponse…" :
    composer === "speaking" ? (avatarActive() ? "Touche pour l'interrompre et répondre" : `${coachName} te répond…`) :
    composer === "retry" ? "À toi de réessayer" :
    composer === "validating" ? "Je prépare ton bilan…" :
    "Touche pour parler";
  const micDisabled = composer === "processing" || composer === "validating" || connecting;
  const level01 = typeof recorderState.metering === "number" ? Math.max(0, Math.min(1, (recorderState.metering + 55) / 55)) : 0.15;
  const coveredCount = objectives.filter((o) => o.state === "covered").length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View style={styles.container}>
        <View style={styles.header}>
          <RoundButton icon="retour" label="Retour" onPress={() => { stopAudio(); onBack(covered.size, turnCountRef.current); }} size={44} iconSize={20} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerName}>{coachName} <Text style={styles.headerRole}>· Ton coach IA</Text></Text>
          </View>
          {daily ? (
            <View style={styles.counter}><Text style={styles.counterText}>{Math.min(turnsDone, daily.maxTurns)}/{daily.maxTurns}</Text></View>
          ) : (
            <View style={[styles.counter, coveredCount === objectives.length && styles.counterDone]}>
              <Text style={[styles.counterText, coveredCount === objectives.length && { color: L.success }]}>{coveredCount}/{objectives.length}</Text>
            </View>
          )}
        </View>

        {__DEV__ && avatar && avatar.status === "off" && avatar.offReason ? <Text style={{ color: L.textSecondary, fontSize: 12, marginBottom: 6 }}>Vidéo non lancée : {avatar.offReason}</Text> : null}
        {avatar && avatarOn && <CoachVideo avatar={avatar} coachId={coachId} reduced={coachReduced} onToggle={() => setCoachReduced((v) => !v)} hidden={keyboardOpen} />}

        {/* Point du jour : progression des échanges + phrase(s) à replacer (sans dire laquelle) */}
        {daily && (
          <View style={[styles.objBar, daily.reuseTotal > 0 && reuseDone >= daily.reuseTotal && styles.objBarDone]} accessibilityLabel={`Échange ${turnsDone} sur ${daily.maxTurns}`}>
            <View style={styles.segments}>
              {Array.from({ length: daily.maxTurns }).map((_, i) => <View key={i} style={[styles.segment, i < turnsDone && { backgroundColor: L.success }, i === turnsDone && { backgroundColor: L.accentDeep }]} />)}
            </View>
            <View style={styles.objLine}>
              {daily.reuseTotal > 0 && reuseDone >= daily.reuseTotal ? <Icon name="check" size={20} /> : <Icon name="fleche" size={20} tint={L.accentDeep} />}
              <Text style={[styles.objText, daily.reuseTotal > 0 && reuseDone >= daily.reuseTotal && { color: L.success }]} numberOfLines={1}>
                {daily.reuseTotal > 0
                  ? (reuseDone >= daily.reuseTotal ? (daily.reuseTotal > 1 ? "Phrases replacées, bravo" : "Phrase replacée, bravo") : `${daily.reuseTotal - reuseDone} phrase${daily.reuseTotal - reuseDone > 1 ? "s" : ""} de tes leçons à replacer`)
                  : (daily.maxTurns - turnsDone <= 1 ? "Dernier échange" : `Discussion libre · ${daily.maxTurns - turnsDone} échanges`)}
              </Text>
            </View>
          </View>
        )}
        {/* Barre d'objectifs compacte : 3 segments + objectif en cours, dépliable */}
        {!daily && <Pressable onPress={() => setObjectivesOpen((v) => !v)} style={[styles.objBar, coveredCount === objectives.length && styles.objBarDone]} accessibilityRole="button" accessibilityLabel={`Objectifs ${coveredCount} sur ${objectives.length}`}>
          <View style={styles.segments}>
            {objectives.map((o) => <Animated.View key={o.id} style={[styles.segment, o.state === "covered" && { backgroundColor: L.success }, o.state === "current" && { backgroundColor: L.accentDeep }, { transform: [{ scaleY: segAnim(o.id) }] }]} />)}
          </View>
          <Animated.View pointerEvents="none" style={[styles.objToast, { opacity: toast, transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [8, -22] }) }, { scale: toast.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}>
            <View style={styles.objToastCheck}><Icon name="check" size={12} tint="#fff" /></View>
            <Text style={styles.objToastText}>{toastText}</Text>
          </Animated.View>
          {!objectivesOpen ? (
            <View style={styles.objLine}>
              {coveredCount === objectives.length ? <Icon name="check" size={20} /> : <Icon name="fleche" size={20} tint={L.accentDeep} />}
              <Text style={[styles.objText, coveredCount === objectives.length && { color: L.success }]} numberOfLines={1}>
                {coveredCount === objectives.length
                  ? (closingIn === null ? "Tous les objectifs sont couverts" : closingIn <= 0 ? "Objectifs couverts · dernier échange" : `Objectifs couverts · encore ${closingIn} échange${closingIn > 1 ? "s" : ""}`)
                  : (objectives.find((o) => o.state === "current") ?? objectives.find((o) => o.state === "todo"))?.label}
              </Text>
              <Icon name="chevron" size={18} style={{ transform: [{ rotate: "90deg" }] }} />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {objectives.map((o) => (
                <View key={o.id} style={styles.objLine} accessibilityLabel={`${o.label} : ${o.state === "covered" ? "couvert" : o.state === "current" ? "en cours" : "à faire"}`}>
                  {o.state === "covered" ? <Icon name="check" size={20} /> : o.state === "current" ? <Icon name="fleche" size={20} tint={L.accentDeep} /> : <View style={styles.objDot} />}
                  <Text style={[styles.objText, o.state === "covered" && { color: L.success }, o.state === "todo" && { color: L.textSecondary }]}>{o.label}</Text>
                </View>
              ))}
              <Icon name="chevron" size={18} style={{ transform: [{ rotate: "-90deg" }], alignSelf: "flex-end" }} />
            </View>
          )}
        </Pressable>}

        {error && (
          <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
            {pendingText && composer !== "processing" ? <Pressable onPress={sendText} style={styles.retryLink}><Text style={styles.retryLinkText}>Réessayer</Text></Pressable> : null}
          </View>
        )}

        <View style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !reduceMotionRef.current })}>
          {messages.map((m) => {
            if (m.kind === "coach" && m.id === "op" && connecting) return null;
            if (m.kind === "user") return <View key={m.id} style={styles.userBubble}><Text style={styles.userText}>{m.text}</Text></View>;
            if (m.kind === "nothing") {
              return (
                <View key={m.id} style={styles.nothingCard}>
                  <View style={styles.nothingIcon}><Icon name="micro" size={22} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nothingTitle}>Je n'ai rien entendu de clair</Text>
                    <Text style={styles.nothingSub}>Rapproche-toi du micro et parle un peu plus fort, puis réessaie.</Text>
                  </View>
                </View>
              );
            }
            if (m.kind === "coaching") {
              return (
                <View key={m.id} style={styles.coachingCard} accessibilityLabel={`Le conseil de ${coachName}. ${m.coaching.explanationFr} ${m.coaching.targetPhraseEn}`}>
                  <View style={styles.coachingHead}><Icon name="etoile" size={20} /><Text style={styles.coachingTitle}>Le conseil de {coachName}</Text></View>
                  <Text style={styles.coachingExplanation}>{m.coaching.explanationFr}</Text>
                  <CorrectedPhrase original={m.original} target={m.coaching.targetPhraseEn} />
                  {m.coaching.requiresRetry && <Text style={styles.coachingInvite}>À toi : dis-la à ta façon.</Text>}
                  <ListenButton onPress={() => listen(m)} busy={busyFor[m.id]} style={{ marginTop: 12 }} />
                </View>
              );
            }
            return (
              <View key={m.id} style={styles.coachBubble}>
                <Text style={styles.coachText}>{m.text}</Text>
                {frFor[m.id] ? <Text style={styles.coachFr}>{frFor[m.id]}</Text> : null}
                <View style={styles.msgActions}>
                  <Pressable onPress={() => listen(m)} style={styles.msgAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Écouter">
                    {busyFor[m.id] ? <ActivityIndicator size="small" color={L.textSecondary} /> : <><Icon name="ecouter" size={18} /><Text style={styles.msgActionText}>Écouter</Text></>}
                  </Pressable>
                  <Pressable onPress={() => translate(m)} style={styles.msgAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Traduire">
                    {busyFor[`tr-${m.id}`] ? <ActivityIndicator size="small" color={L.textSecondary} /> : <><Icon name="traduire" size={18} /><Text style={styles.msgActionText}>{frFor[m.id] ? "Masquer" : "Traduire"}</Text></>}
                  </Pressable>
                </View>
              </View>
            );
          })}
          {connecting && messages.length <= 1 && <Text style={styles.arriving}>{coachName} arrive et va lancer la conversation.</Text>}
          {pendingText && composer === "processing" ? <View style={styles.userBubble}><Text style={styles.userText}>{pendingText}</Text></View> : null}
          {composer === "processing" && <View style={[styles.coachBubble, styles.typingBubble]}><TypingDots /></View>}
          {composer === "validating" && <View style={styles.typing}><ActivityIndicator size="small" color={L.textSecondary} /><Text style={styles.typingText}>Je prépare ton bilan…</Text></View>}
        </ScrollView>
        {/* Aides flottantes (à droite du fil) : « Aide-moi à dire » et « Un exemple » */}
        {composer !== "validating" && (
          <View style={styles.floatCol} pointerEvents="box-none">
            <RoundButton icon="aide" label="Aide-moi à dire" onPress={() => { setHelpInput(""); setHelpResult(""); setShowHelp(true); }} disabled={micDisabled} size={46} iconSize={20} style={styles.floatBtn} />
            <RoundButton icon="exemple" label="Un exemple" onPress={() => { setShowExample(true); runExample(); }} disabled={micDisabled} size={46} iconSize={20} style={styles.floatBtn} />
          </View>
        )}
        </View>

        {composer !== "validating" && (
          <View style={styles.composer}>

            {channel === "voice" ? (
              composer === "recording" ? (
                <View style={styles.recRow}>
                  <RoundButton icon="fermer" label="Annuler l'enregistrement" onPress={cancelRecording} tint={L.danger} />
                  <View style={styles.micZone}>
                    <View style={styles.waveRow}>{Array.from({ length: 18 }).map((_, i) => <View key={i} style={[styles.waveBar, { height: 4 + ((i * 7) % 10 + 6) * level01 * 2 }]} />)}</View>
                    <Pressable onPress={stopAndSend} style={[styles.micHalo, styles.micHaloActive]} accessibilityRole="button" accessibilityLabel="Arrêter et envoyer">
                      <View style={[styles.mic, styles.micActive]}><Icon name="envoyer" size={30} tint="#fff" /></View>
                    </Pressable>
                    <Text style={styles.composerLabel}>{Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")} · Appuie pour envoyer</Text>
                  </View>
                  <View style={{ width: 52 }} />
                </View>
              ) : (
                <View style={styles.recRow}>
                  <RoundButton icon="clavier" label="Répondre au clavier" onPress={() => setChannel("text")} />
                  <View style={styles.micZone}>
                    <Pressable onPress={startRecording} disabled={micDisabled} style={[styles.micHalo, micDisabled && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Parler" accessibilityState={{ disabled: micDisabled }}>
                      <View style={[styles.mic, (composer === "processing" || connecting) && styles.micIdle]}><Icon name="micro" size={30} tint="#fff" /></View>
                    </Pressable>
                    <Text style={styles.composerLabel}>{composerLabel}</Text>
                  </View>
                  {composer === "speaking"
                    ? <RoundButton icon="fermer" label="Arrêter la lecture" onPress={stopAudio} />
                    : <RoundButton icon="rejouer" label={`Réécouter ${coachName}`} onPress={replayLast} disabled={micDisabled} />}
                </View>
              )
            ) : (
              <View>
                {micDenied && (
                  <Pressable onPress={() => Linking.openSettings()} style={styles.micDeniedRow} accessibilityRole="button">
                    <Text style={styles.micDeniedText}>Micro refusé — tu peux écrire, ou autoriser le micro dans les réglages.</Text>
                  </Pressable>
                )}
                {composer === "retry" && <Text style={[styles.composerLabel, { marginBottom: 8 }]}>À toi de réessayer</Text>}
                <View style={styles.inputRow}>
                  {!micDenied && <RoundButton icon="micro" label="Répondre à la voix" onPress={() => { if (composer !== "processing") setChannel("voice"); }} />}
                  <TextInput style={styles.textInput} value={textInput} onChangeText={setTextInput} placeholder="Écris ta réponse en anglais…" placeholderTextColor={L.textSecondary} multiline editable={composer !== "processing"} accessibilityLabel="Ta réponse en anglais" />
                  <Pressable onPress={sendText} disabled={composer === "processing" || !textInput.trim()} style={[styles.sendBtn, (composer === "processing" || !textInput.trim()) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Envoyer">
                    <Icon name="envoyer" size={22} tint="#fff" />
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Aide-moi à dire */}
        <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
          <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>Comment le dire en anglais</Text>
                <RoundButton icon="fermer" label="Fermer" onPress={() => setShowHelp(false)} size={40} iconSize={16} />
              </View>
              <Text style={styles.sheetHint}>Écris en français ce que tu veux dire. {coachName} te montre comment le dire, à toi de le formuler ensuite.</Text>
              <TextInput style={styles.sheetInput} value={helpInput} onChangeText={setHelpInput} placeholder="Ex : Je travaille dans une banque…" placeholderTextColor={L.textSecondary} multiline />
              <Pressable onPress={runHelp} disabled={helpBusy || !helpInput.trim()} style={[styles.sheetBtn, (helpBusy || !helpInput.trim()) && { opacity: 0.4 }]} accessibilityRole="button">
                {helpBusy ? <ActivityIndicator color={L.textPrimary} /> : <Text style={styles.sheetBtnText}>Traduire</Text>}
              </Pressable>
              {helpResult ? (
                <View style={styles.sheetResult}>
                  <Text style={styles.sheetResultText}>{helpResult}</Text>
                  <ListenButton onPress={() => speak("help", helpResult)} busy={busyFor["help"]} style={{ marginTop: 10, backgroundColor: L.accentSoft }} />
                </View>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Un exemple */}
        <Modal visible={showExample} transparent animationType="fade" onRequestClose={() => setShowExample(false)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>Une idée de réponse</Text>
                <RoundButton icon="fermer" label="Fermer" onPress={() => setShowExample(false)} size={40} iconSize={16} />
              </View>
              <Text style={styles.sheetHint}>Inspire-t'en, puis dis-le avec tes mots.</Text>
              {exampleBusy ? <ActivityIndicator color={L.accentDeep} style={{ marginVertical: 20 }} /> : example?.en ? (
                <View style={styles.sheetResult}>
                  <Text style={styles.sheetResultText}>{example.en}</Text>
                  {example.fr ? <Text style={styles.sheetResultFr}>{example.fr}</Text> : null}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    <ListenButton onPress={() => speak("example", example.en)} busy={busyFor["example"]} style={{ backgroundColor: L.accentSoft }} />
                    <Pressable onPress={runExample} style={styles.sheetLink} accessibilityRole="button"><Icon name="rejouer" size={16} /><Text style={styles.sheetLinkText}>Autre idée</Text></Pressable>
                  </View>
                </View>
              ) : <Text style={styles.sheetHint}>Impossible de générer un exemple pour l'instant. Réessaie.</Text>}
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background, paddingHorizontal: L.gutter, paddingTop: 46 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  headerName: { color: L.textPrimary, fontSize: 18, fontWeight: "700" },
  headerRole: { color: L.textSecondary, fontSize: 14, fontWeight: "500" },
  counter: { backgroundColor: L.accentSoft, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12, minWidth: 52, alignItems: "center" },
  counterDone: { backgroundColor: L.successSoft },
  counterText: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },

  objBar: { backgroundColor: L.surface, borderRadius: 16, borderWidth: 1, borderColor: L.border, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  objBarDone: { backgroundColor: L.successSoft, borderColor: L.successSoft },
  segments: { flexDirection: "row", gap: 6, marginBottom: 6 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: L.border },
  objLine: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  objToast: { position: "absolute", top: 0, right: 12, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: L.success, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  objToastCheck: { width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  objToastText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  typingBubble: { paddingVertical: 12, paddingHorizontal: 18, alignSelf: "flex-start" },
  objDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#C9C2D6" },
  objText: { flex: 1, color: L.textPrimary, fontSize: 15.5, fontWeight: "700", lineHeight: 21 },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 6 },
  errorText: { flex: 1, color: L.danger, fontSize: 14, fontWeight: "600" },
  retryLink: { minHeight: 40, justifyContent: "center", paddingHorizontal: 8 },
  retryLinkText: { color: L.primary, fontWeight: "700" },

  scrollContent: { paddingTop: 4, paddingBottom: 8 },
  floatCol: { position: "absolute", right: 0, bottom: 6, gap: 8 },
  floatBtn: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  coachBubble: { backgroundColor: L.surface, borderRadius: L.radiusCard, borderTopLeftRadius: 8, padding: 14, marginBottom: 10, marginRight: 56, alignSelf: "flex-start", maxWidth: "100%" },
  coachText: { color: L.textPrimary, fontSize: 16, lineHeight: 23 },
  coachFr: { color: L.textSecondary, fontSize: 13.5, fontStyle: "italic", lineHeight: 19, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: L.border },
  msgActions: { flexDirection: "row", gap: 16, marginTop: 6 },
  msgAction: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  msgActionText: { color: L.textSecondary, fontSize: 13.5, fontWeight: "700" },
  userBubble: { backgroundColor: L.accentSoft, borderRadius: L.radiusCard, borderTopRightRadius: 8, padding: 14, marginBottom: 10, marginLeft: 24, marginRight: 56, alignSelf: "flex-end", maxWidth: "100%" },
  userText: { color: L.textPrimary, fontSize: 16, fontWeight: "700", lineHeight: 23 },

  coachingCard: { backgroundColor: L.lavender, borderRadius: L.radiusCard, padding: 14, marginBottom: 10, marginRight: 56 },
  coachingHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  coachingTitle: { color: L.lavenderText, fontSize: 15, fontWeight: "700" },
  coachingExplanation: { color: L.textPrimary, fontSize: 14.5, lineHeight: 21 },
  coachingPhrase: { color: L.textPrimary, fontSize: 17, fontWeight: "700", lineHeight: 25, marginTop: 8 },
  coachingChanged: { color: L.success, backgroundColor: "#DDF3E7" },
  coachingInvite: { color: L.textSecondary, fontSize: 14, fontWeight: "600", marginTop: 6 },

  nothingCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: L.yellow, borderRadius: L.radiusCard, padding: 16, marginBottom: 12, opacity: 0.95 },
  nothingIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center" },
  nothingTitle: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  nothingSub: { color: L.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2 },

  typing: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  typingText: { color: L.textSecondary, fontSize: 14, fontWeight: "600" },

  composer: { paddingTop: 2, paddingBottom: 6 },
  recRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  micZone: { flex: 1, alignItems: "center" },
  micHalo: { width: 76, height: 76, borderRadius: 38, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center" },
  micHaloActive: { backgroundColor: "#FBE3E0" },
  mic: { width: 60, height: 60, borderRadius: 30, backgroundColor: L.accentDeep, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: L.danger },
  micIdle: { backgroundColor: "#D9D3CB" },
  arriving: { color: L.textSecondary, fontSize: 15, textAlign: "center", marginTop: 24 },
  composerLabel: { color: L.textSecondary, fontSize: 13, fontWeight: "700", marginTop: 2, textAlign: "center" },
  waveRow: { flexDirection: "row", alignItems: "center", gap: 3, height: 28, justifyContent: "center", marginBottom: 6 },
  waveBar: { width: 3, borderRadius: 1.5, backgroundColor: L.accentDeep },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  textInput: { flex: 1, backgroundColor: L.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: L.textPrimary, maxHeight: 120, minHeight: 52 },
  sendBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: L.accentDeep, alignItems: "center", justifyContent: "center" },
  micDeniedRow: { marginBottom: 8, minHeight: 36, justifyContent: "center" },
  micDeniedText: { color: L.textSecondary, fontSize: 13, fontWeight: "600" },

  overlay: { flex: 1, backgroundColor: "rgba(25,41,71,0.6)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: L.background, borderRadius: 24, padding: 20 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  sheetTitle: { color: L.textPrimary, fontSize: 19, fontWeight: "700" },
  sheetHint: { color: L.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  sheetInput: { backgroundColor: L.surface, borderRadius: 16, padding: 14, fontSize: 16, color: L.textPrimary, minHeight: 70, maxHeight: 140, textAlignVertical: "top" },
  sheetBtn: { backgroundColor: L.accentDeep, borderRadius: 16, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 12 },
  sheetBtnText: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  sheetResult: { backgroundColor: L.surface, borderRadius: 16, padding: 14, marginTop: 14 },
  sheetResultText: { color: L.textPrimary, fontSize: 17, fontWeight: "700", lineHeight: 24 },
  sheetResultFr: { color: L.textSecondary, fontSize: 14, fontStyle: "italic", lineHeight: 20, marginTop: 6 },
  sheetLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 46, paddingHorizontal: 8 },
  sheetLinkText: { color: L.textSecondary, fontSize: 14, fontWeight: "700" },
});
