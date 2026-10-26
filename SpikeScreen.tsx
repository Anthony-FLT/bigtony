// SpikeScreen.tsx — conversation à thème (scènes, conversation libre, bienvenue) dans le design des leçons :
// en-tête avec l'image du thème + progression, bulles claires, carte « Le conseil de … », aides flottantes,
// composer clavier · micro · réécouter. Pas de coach vidéo ici. Logique inchangée (voix/texte, correction, favoris, bilan).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, TextInput, Animated, Image, Linking } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Feather } from "@expo/vector-icons";
import { useAudioRecorder, useAudioRecorderState, useAudioPlayer, RecordingPresets, AudioModule, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "./lib/firebase";
import DailySceneImg from "./assets/hub/daily-scene-aleatoire.svg";
import { Scenario } from "./lib/scenarios";
import { L, Icon, RoundButton, ListenButton, PrimaryButton } from "./components/lessonUi";
import TypingDots from "./components/TypingDots";
import { coachForVoice } from "./lib/learningPath/coaches";
import { startSession, addTurn, closeSession, SessionTurn } from "./lib/sessions";
import { loadProfile, markFirstSessionDone, markTranslateHintSeen, VoiceKey, saveSpeechRate } from "./lib/profile";
import { logWelcomeConversationAbandon, logWelcomeConversationComplete } from "./lib/analytics";
import { labelForRate, nextRate } from "./lib/speech";
import { Level } from "./lib/level";
import { addFavorite } from "./lib/favorites";
import { addSpeakingSeconds } from "./lib/speakingTime";
import DebriefView from "./components/DebriefView";
import type { Correction } from "./components/CorrectionCard";
import { StatusBar } from "expo-status-bar";
import type { LessonVariant, AttemptTurn, ObservedCriterion, SupportKind } from "./lib/learningPath/types";

// Illustrations des scènes (.png nommées d'après l'id du scénario — Metro exige des chemins statiques dans require()).
// La conversation libre (daily/welcome) reste illustrée en SVG (DailySceneImg).
const SCENE_ILLUSTRATIONS: Record<string, any> = {
  // Pro
  "entretien-embauche": require("./assets/scenes/entretien-embauche.png"),
  "point-hebdo-teams": require("./assets/scenes/point-hebdo-teams.png"),
  "presentation-pro": require("./assets/scenes/presentation-pro.png"),
  "negociation-salaire": require("./assets/scenes/negociation-salaire.png"),
  "premier-jour-travail": require("./assets/scenes/premier-jour-travail.png"),
  "expliquer-metier": require("./assets/scenes/expliquer-metier.png"),
  "desaccord-reunion": require("./assets/scenes/desaccord-reunion.png"),
  "annoncer-retard-projet": require("./assets/scenes/annoncer-retard-projet.png"),
  // Voyage
  "arrivee-hotel": require("./assets/scenes/arrivee-hotel.png"),
  "aeroport-controle": require("./assets/scenes/aeroport-controle.png"),
  "restaurant-commande": require("./assets/scenes/restaurant-commande.png"),
  "bagage-perdu": require("./assets/scenes/bagage-perdu.png"),
  "train-annule": require("./assets/scenes/train-annule.png"),
  "location-voiture": require("./assets/scenes/location-voiture.png"),
  "probleme-chambre": require("./assets/scenes/probleme-chambre.png"),
  "allergie-restaurant": require("./assets/scenes/allergie-restaurant.png"),
  "reserver-activite": require("./assets/scenes/reserver-activite.png"),
  "trajet-taxi": require("./assets/scenes/trajet-taxi.png"),
  // Quotidien
  "rencontre-inconnu": require("./assets/scenes/rencontre-inconnu.png"),
  "cafe-ami": require("./assets/scenes/cafe-ami.png"),
  "demander-chemin": require("./assets/scenes/demander-chemin.png"),
  "se-presenter": require("./assets/scenes/se-presenter.png"),
  "parler-proches": require("./assets/scenes/parler-proches.png"),
  "loisirs-passions": require("./assets/scenes/loisirs-passions.png"),
  "raconter-weekend": require("./assets/scenes/raconter-weekend.png"),
  "decrire-journee": require("./assets/scenes/decrire-journee.png"),
  "organiser-sortie": require("./assets/scenes/organiser-sortie.png"),
  "retour-achat": require("./assets/scenes/retour-achat.png"),
  "prendre-rendez-vous": require("./assets/scenes/prendre-rendez-vous.png"),
  "mot-oublie": require("./assets/scenes/mot-oublie.png"),
};

const spikeTurn = httpsCallable(functions, "spikeTurn", { timeout: 70000 });
const chatTurn = httpsCallable(functions, "chatTurn", { timeout: 40000 });
const sessionDebrief = httpsCallable(functions, "sessionDebrief", { timeout: 70000 });
const scenarioOpening = httpsCallable(functions, "scenarioOpening", { timeout: 30000 });
const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });
const welcomeOpening = httpsCallable(functions, "welcomeOpening", { timeout: 30000 });
const dailyOpening = httpsCallable(functions, "dailyOpening", { timeout: 30000 });
const translateToEnglish = httpsCallable(functions, "translateToEnglish", { timeout: 30000 });
const suggestExample = httpsCallable(functions, "suggestExample", { timeout: 30000 });

const WELCOME_TURN_CONTEXT = "You are simply a warm, friendly, encouraging English coach meeting the learner on their very first day — you are NOT a character in a scene and there is NO scenario or story. Just be yourself and put them at ease. Your only goal is to help them introduce themselves and talk about their life: ask ONE simple question at a time about who they are (what they do, where they live, what they like, their day). Warmly react to each answer with a short encouraging word, then ask the next easy question. Never make it complex or serious — keep it light, kind and reassuring.";
const MIN_RECORDING_MS = 800;
const FIRST_SESSION_LIMIT = 10;
const SCENARIO_LIMIT = 8;
const WELCOME_LIMIT = 5;

type Channel = "voice" | "text";
type HardWord = { word: string; fr: string };

type Pronunciation = {
  pronScore: number; accuracyScore: number; fluencyScore: number;
  azureText: string; weakWords: { word: string; score: number }[];
} | null;

type Turn = {
  user: string;
  coach: string;
  coachFr: string;
  hardWords: HardWord[];
  misheard: { said: string; heard: string }[];
  feedback: string | null;
  pronunciation: Pronunciation;
  correction: Correction | null;
  observedCriteria?: ObservedCriterion[]; // mode leçon (hérité)
};

// Mode leçon hérité (ancien parcours) : conservé pour compatibilité, le nouveau parcours passe par LessonConversation.
export type LessonConversation = {
  attemptId: string;
  variant: LessonVariant;
  resumeTurns: AttemptTurn[];
  turnLimit: number;
  onTurn: (turn: AttemptTurn) => void;
  onEnd: () => void;
};

function buildLessonContext(v: LessonVariant): string {
  const followUps = v.followUpsEn.map((q) => `"${q}"`).join(", ");
  return `${v.coachRole}. The learner plays: ${v.userRole}. This is a short guided lesson of at most ${v.maxUsefulTurns} exchanges; stay warm and simple. You already opened with: "${v.openingEn}". Natural follow-up questions to use when they fit: ${followUps}. Only if the learner is clearly comfortable, you may ask: "${v.difficultyFollowUpEn}".`;
}

function attemptTurnToTurn(t: AttemptTurn): Turn {
  return {
    user: t.user, coach: t.coach, coachFr: "", hardWords: [], misheard: [],
    feedback: t.feedbackFr || null, pronunciation: null,
    correction: (t.correction as unknown as Correction) ?? null,
    observedCriteria: t.observedCriteria,
  };
}

type Opening = { context_fr: string; reply_en: string; reply_fr: string; hardWords: HardWord[] } | null;
type Debrief = { points_forts: string[]; axe: string; message_fr: string } | null;
type WordPopup = { word: string; fr: string; loading: boolean } | null;

function parseObserved(raw: any): ObservedCriterion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ok = new Set(["not_observed", "emerging", "achieved"]);
  return raw
    .filter((o) => o && typeof o.criterion_id === "string" && ok.has(o.status))
    .map((o) => ({ criterionId: o.criterion_id, statusCandidate: o.status, support: "none" as SupportKind, confidence: (["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low") }));
}

// Transforme une erreur technique en message clair pour l'utilisateur (jamais de JSON brut à l'écran).
function friendlyError(e: any): string {
  const msg = String(e?.message ?? e ?? "");
  if (/\b503\b|UNAVAILABLE|high demand|overloaded|try again later/i.test(msg))
    return "Le coach est très sollicité en ce moment. Réessaie dans un instant.";
  if (/network|timeout|Failed to fetch|ECONN|internet|offline|deadline/i.test(msg))
    return "Connexion interrompue. Vérifie ta connexion et réessaie.";
  return "Une erreur est survenue. Réessaie dans un instant.";
}

// Phrase corrigée : les mots absents de la phrase d'origine sont surlignés en vert (même rendu que la leçon)
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

const correctedText = (c: Correction) => c.corrected.map((t) => t.text).join(" ");

// Nombre d'échanges minimum dans la conversation de présentation pour recevoir le cadeau en la quittant
const GIFT_MIN_TURNS = 1;

export default function SpikeScreen({ scenario, onExit, daily, welcome, premium, lesson }: { scenario: Scenario; onExit: (offerGift?: boolean) => void; daily?: boolean; welcome?: boolean; premium?: boolean; lesson?: LessonConversation }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 80);
  const player = useAudioPlayer();
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const isDailyIllustration = daily || welcome;
  const scenePngSource = isDailyIllustration ? null : SCENE_ILLUSTRATIONS[scenario.id];
  const hasIllustration = isDailyIllustration || !!scenePngSource;
  const [turns, setTurns] = useState<Turn[]>(() => (lesson ? lesson.resumeTurns.map(attemptTurnToTurn) : []));
  const supportRef = useRef<SupportKind>("none");
  const [opening, setOpening] = useState<Opening>(null);
  const [debrief, setDebrief] = useState<Debrief>(null);
  const [status, setStatus] = useState<"opening" | "idle" | "recording" | "processing" | "debriefing">("opening");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("B1");
  const [voiceKey, setVoiceKey] = useState<VoiceKey>("us-male");
  const [speechRate, setSpeechRate] = useState<number>(0.95);
  const [isFirstSession, setIsFirstSession] = useState(false);
  const [bubbleFr, setBubbleFr] = useState<Record<string, string>>({});
  const [bubbleLoading, setBubbleLoading] = useState<Record<string, boolean>>({});
  const [listenLoading, setListenLoading] = useState<Record<string, boolean>>({});
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState<string | null>(null);
  const favFlashAnim = useRef(new Animated.Value(0)).current;
  const [firstSessionCongrats, setFirstSessionCongrats] = useState(false);
  const [showTranslateHint, setShowTranslateHint] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  // Canal de conversation
  const [channel, setChannel] = useState<Channel>("voice");
  const [showChannelChoice, setShowChannelChoice] = useState(true);
  const [textInput, setTextInput] = useState("");
  const [pendingUserText, setPendingUserText] = useState("");
  // Aides : traduire (FR→EN) + réponse d'exemple
  const [showTranslate, setShowTranslate] = useState(false);
  const [translateInput, setTranslateInput] = useState("");
  const [translateResult, setTranslateResult] = useState("");
  const [translateLoading, setTranslateLoading] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [exampleData, setExampleData] = useState<{ en: string; fr: string } | null>(null);
  const [exampleLoading, setExampleLoading] = useState(false);
  const recordStartRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const debriefingRef = useRef(false);
  const lastCoachRef = useRef<{ text: string; audio: string | null }>({ text: "", audio: null });
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const coachName = coachForVoice(voiceKey).displayName;
  const sessionLimit = lesson ? lesson.turnLimit : welcome ? WELCOME_LIMIT : (isFirstSession ? FIRST_SESSION_LIMIT : SCENARIO_LIMIT);
  const reachedLimit = turns.length >= sessionLimit;
  const title = lesson ? lesson.variant.titleFr : daily ? "Conversation libre" : scenario.title;

  useEffect(() => {
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { setMicDenied(true); setChannel("text"); }
    })();
  }, []);

  useEffect(() => {
    loadProfile().then((p) => {
      if (p?.level) setLevel(p.level);
      if (p?.voice) setVoiceKey(p.voice);
      if (p?.speechRate) setSpeechRate(p.speechRate);
      if (p && !p.firstSessionDone) setIsFirstSession(true);
      if (p && !p.translateHintSeen) setShowTranslateHint(true);
    });
  }, []);

  // Le hint "Touche un mot pour le traduire" disparaît tout seul après quelques secondes.
  useEffect(() => {
    if (!showTranslateHint) return;
    const t = setTimeout(() => { setShowTranslateHint(false); markTranslateHintSeen(); }, 4500);
    return () => clearTimeout(t);
  }, [showTranslateHint]);

  // Chronomètre pendant l'enregistrement.
  useEffect(() => {
    if (status !== "recording") { setRecordingSeconds(0); return; }
    const start = Date.now();
    const id = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(id);
  }, [status]);

  // État « le coach parle » (pour le bouton Arrêter / Réécouter du composer)
  useEffect(() => {
    const sub = player.addListener("playbackStatusUpdate", (st: any) => { if (st?.didJustFinish) setSpeaking(false); });
    return () => { sub.remove(); try { player.pause(); } catch {} };
  }, [player]);

  const playBase64 = async (base64: string) => {
    const p = FileSystem.cacheDirectory + `reply_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(p, base64, { encoding: FileSystem.EncodingType.Base64 });
    player.replace(p);
    player.play();
    setSpeaking(true);
  };
  const stopAudio = () => { try { player.pause(); } catch {} setSpeaking(false); };

  // Lit une phrase anglaise à voix haute via translateText mode "speak".
  const playText = async (key: string, text: string) => {
    setListenLoading((p) => ({ ...p, [key]: true }));
    try {
      const res: any = await translateText({ text, mode: "speak", voice: voiceKey, speakingRate: speechRate });
      if (res.data?.audioBase64) {
        if (text === lastCoachRef.current.text) lastCoachRef.current.audio = res.data.audioBase64;
        await playBase64(res.data.audioBase64);
      }
    } catch (e) { console.warn("Écoute échouée:", e); }
    finally { setListenLoading((p) => ({ ...p, [key]: false })); }
  };
  // Réécouter la dernière réplique du coach (audio déjà reçu si possible, sinon synthèse)
  const replayLast = () => {
    const last = lastCoachRef.current;
    if (!last.text) return;
    stopAudio();
    if (last.audio) playBase64(last.audio); else playText("last", last.text);
  };

  // Accès rapide : fait défiler les 4 vitesses et enregistre le choix (réglage global).
  const cycleRate = async () => {
    const r = nextRate(speechRate);
    setSpeechRate(r);
    await saveSpeechRate(r);
  };

  const historyPayload = () => ({
    history: [
      ...(opening ? [{ user: "", coach: opening.reply_en }] : []),
      ...turns.map((t) => ({ user: t.user, coach: t.coach })),
    ],
    scenarioId: (daily || welcome || lesson) ? null : scenario.id,
    level,
    sceneContext: (welcome || lesson) ? null : (opening?.context_fr ?? null),
    customContext: lesson ? buildLessonContext(lesson.variant) : welcome ? WELCOME_TURN_CONTEXT : (scenario.custom ?? null),
  });

  // Aide — Traduire (FR→EN)
  const openTranslate = () => { setTranslateInput(""); setTranslateResult(""); setShowTranslate(true); };
  const runTranslate = async () => {
    const text = translateInput.trim();
    if (!text || translateLoading) return;
    setTranslateLoading(true); setTranslateResult("");
    try {
      const res: any = await translateToEnglish({ text, level });
      setTranslateResult(res.data?.english ?? "");
      if (supportRef.current === "none") supportRef.current = "hint";
    } catch (e) { console.warn("Traduction échouée:", e); setTranslateResult(""); }
    finally { setTranslateLoading(false); }
  };

  // Aide — Réponse d'exemple (selon le contexte)
  const openExample = () => { supportRef.current = "model"; setExampleData(null); setShowExample(true); runExample(); };
  const runExample = async () => {
    setExampleLoading(true); setExampleData(null);
    try {
      const res: any = await suggestExample(historyPayload());
      setExampleData({ en: res.data?.example_en ?? "", fr: res.data?.example_fr ?? "" });
    } catch (e) { console.warn("Exemple échoué:", e); setExampleData(null); }
    finally { setExampleLoading(false); }
  };

  // Le choix du canal déclenche le chargement de l'ouverture (et joue l'audio seulement en mode voix).
  const chooseChannel = (c: Channel) => {
    setChannel(c);
    setShowChannelChoice(false);
    loadOpening(c);
  };

  const loadOpening = async (ch: Channel) => {
    if (lesson) {
      const v = lesson.variant;
      setOpening({ context_fr: v.objectiveFr, reply_en: v.openingEn, reply_fr: "", hardWords: [] });
      lastCoachRef.current = { text: v.openingEn, audio: null };
      if (ch === "voice" && turns.length === 0) playText("op", v.openingEn);
      setStatus("idle");
      return;
    }
    try {
      let res: any;
      if (welcome) {
        const p = await loadProfile();
        res = await welcomeOpening({
          level: p?.level ?? "B1", name: p?.name ?? null, interests: p?.interests ?? [], goals: p?.goals ?? [], job: p?.job ?? null,
          voice: p?.voice ?? "us-male", speakingRate: speechRate,
        });
      } else if (daily) {
        const p = await loadProfile();
        res = await dailyOpening({
          level: p?.level ?? "B1", interests: p?.interests ?? [], goals: p?.goals ?? [], job: p?.job ?? null,
          voice: p?.voice ?? "us-male", speakingRate: speechRate,
        });
      } else {
        res = await scenarioOpening({ scenarioId: scenario.id, level, customContext: scenario.custom ?? null, voice: voiceKey, speakingRate: speechRate });
      }
      setOpening({
        context_fr: res.data.context_fr,
        reply_en: res.data.reply_en,
        reply_fr: res.data.reply_fr ?? "",
        hardWords: res.data.hard_words ?? [],
      });
      lastCoachRef.current = { text: res.data.reply_en, audio: res.data.replyAudioBase64 ?? null };
      if (ch === "voice" && res.data.replyAudioBase64) playBase64(res.data.replyAudioBase64);
    } catch (e: any) {
      const msg = String(e?.message || "");
      setError(msg.includes("UNSAFE_CONTEXT") ? "Ce contexte n'est pas approprié pour une scène. Essaie autre chose." : friendlyError(e));
    } finally {
      setStatus("idle");
    }
  };

  const persistTurn = async (turn: Turn, index: number) => {
    if (lesson) {
      lesson.onTurn({
        id: `t${String(index).padStart(2, "0")}`,
        index,
        user: turn.user,
        coach: turn.coach,
        modality: channel,
        supportUsed: supportRef.current,
        at: Date.now(),
        feedbackFr: turn.feedback ?? "",
        correction: (turn.correction as unknown as Record<string, unknown>) ?? null,
        pronunciation: turn.pronunciation
          ? { pronScore: turn.pronunciation.pronScore, accuracyScore: turn.pronunciation.accuracyScore, fluencyScore: turn.pronunciation.fluencyScore }
          : null,
        observedCriteria: (turn.observedCriteria ?? []).map((o) => ({ ...o, support: supportRef.current })),
      });
      supportRef.current = "none";
      return;
    }
    try {
      let sid = sessionId;
      if (!sid) { sid = await startSession(daily ? "daily" : scenario.id, daily ? "daily" : "scenario"); setSessionId(sid); }
      const st: SessionTurn = { user: turn.user, coach: turn.coach, feedback: turn.feedback ?? "", pronunciation: turn.pronunciation, at: Date.now() };
      await addTurn(sid, st);
    } catch (e) { console.warn("Persistance du tour échouée:", e); }
  };

  // Ajoute le tour, persiste, scrolle et gère la fin de séance (commun voix + texte).
  const finalizeTurn = (newTurn: Turn) => {
    const nextCount = turns.length + 1;
    setTurns((prev) => [...prev, newTurn]);
    persistTurn(newTurn, nextCount - 1);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    if (nextCount >= sessionLimit) {
      setStatus("idle");
      if (lesson) return;
      if (isFirstSession || welcome) setTimeout(() => setFirstSessionCongrats(true), 800);
      else setTimeout(() => runDebrief(), 800);
    }
  };

  const startRecording = async () => {
    if (status !== "idle" || reachedLimit) return;
    stopAudio(); setError(null); setHint(null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setStatus("recording");
    } catch (e: any) { setError(friendlyError(e)); setStatus("idle"); }
  };

  const cancelRecording = async () => {
    if (status !== "recording") return;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) { console.warn("Annulation échouée:", e); }
    setStatus("idle");
  };

  const stopAndSend = async () => {
    if (status !== "recording") return;
    setStatus("processing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - recordStartRef.current < MIN_RECORDING_MS) {
        setHint("Touche le micro et parle, je t'écoute.");
        setStatus("idle"); return;
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("Aucun enregistrement produit");
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      addSpeakingSeconds((Date.now() - recordStartRef.current) / 1000).catch(() => {});

      const willBeLast = turns.length + 1 >= sessionLimit;
      const res: any = await spikeTurn({
        audioBase64, mimeType: "audio/mp4",
        ...historyPayload(),
        isLastTurn: willBeLast,
        voice: voiceKey, speakingRate: speechRate,
        ...(lesson ? { lessonCriteria: lesson.variant.requiredCriteria } : {}),
      });
      if (__DEV__) console.log("TIMINGS:", JSON.stringify(res.data.timings));
      const d = res.data;
      if (!d.transcript) { setHint(d.feedback_fr || "Je n'ai rien entendu, réessaie."); return; }
      lastCoachRef.current = { text: d.reply_en, audio: d.replyAudioBase64 ?? null };
      if (d.replyAudioBase64) playBase64(d.replyAudioBase64); // audio lancé sans attendre la fin

      finalizeTurn({
        user: d.transcript,
        coach: d.reply_en,
        coachFr: d.reply_fr ?? "",
        hardWords: d.hard_words ?? [],
        misheard: d.misheard ?? [],
        feedback: d.feedback_fr ?? null,
        pronunciation: d.pronunciation ?? null,
        correction: d.correction ?? null,
        observedCriteria: parseObserved(d.observed_criteria),
      });
    } catch (e: any) { setError(friendlyError(e)); }
    finally { setStatus((s) => (s === "processing" ? "idle" : s)); }
  };

  const sendText = async () => {
    const text = textInput.trim();
    if (!text || status === "processing" || reachedLimit) return;
    stopAudio();
    setTextInput("");
    setPendingUserText(text);
    setStatus("processing");
    setError(null); setHint(null);
    try {
      const willBeLast = turns.length + 1 >= sessionLimit;
      const res: any = await chatTurn({
        text,
        ...historyPayload(),
        isLastTurn: willBeLast,
        ...(lesson ? { lessonCriteria: lesson.variant.requiredCriteria } : {}),
      });
      if (__DEV__) console.log("CHAT TIMINGS:", JSON.stringify(res.data.timings));
      const d = res.data;
      setPendingUserText("");
      lastCoachRef.current = { text: d.reply_en, audio: null };
      finalizeTurn({
        user: text,
        coach: d.reply_en,
        coachFr: d.reply_fr ?? "",
        hardWords: d.hard_words ?? [],
        misheard: [],
        feedback: d.feedback_fr ?? null,
        pronunciation: null,
        correction: d.correction ?? null,
        observedCriteria: parseObserved(d.observed_criteria),
      });
    } catch (e: any) { setError(friendlyError(e)); setPendingUserText(""); }
    finally { setStatus((s) => (s === "processing" ? "idle" : s)); }
  };

  // La flèche retour sort sans rien marquer, SAUF pour la démo freemium (welcome, non premium).
  const handleBack = () => {
    stopAudio();
    if (welcome && !premium && turns.length > 0) { setShowExitConfirm(true); return; }
    onExit();
  };
  const confirmExit = () => {
    setShowExitConfirm(false);
    logWelcomeConversationAbandon();
    markFirstSessionDone().catch(() => {});
    onExit(turns.length >= GIFT_MIN_TURNS);
  };

  const runDebrief = async () => {
    setFirstSessionCongrats(false);
    if (turns.length === 0 || debriefingRef.current) return;
    debriefingRef.current = true;
    setStatus("debriefing"); setError(null);
    try {
      if (isFirstSession) markFirstSessionDone();
      if (welcome) logWelcomeConversationComplete();
      const res: any = await sessionDebrief({ turns: turns.map((t) => ({ user: t.user, coach: t.coach, pronunciation: t.pronunciation })) });
      setDebrief(res.data);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      if (sessionId) {
        const st: SessionTurn[] = turns.map((t) => ({ user: t.user, coach: t.coach, feedback: t.feedback ?? "", pronunciation: t.pronunciation, at: 0 }));
        closeSession(sessionId, res.data, st).catch((e) => console.warn("Clôture échouée:", e));
      }
    } catch (e: any) { setError(friendlyError(e)); }
    finally { setStatus("idle"); debriefingRef.current = false; }
  };

  const addWordToFav = async (w: HardWord) => {
    await addFavorite(w.word, w.fr, scenario.id);
    setWordPopup(null);
    setSelectedWordKey(null);
    setFavFlash(w.word);
    favFlashAnim.setValue(0);
    Animated.sequence([
      Animated.spring(favFlashAnim, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }),
      Animated.delay(1300),
      Animated.timing(favFlashAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setFavFlash(null));
  };

  const onWordTap = async (raw: string, knownFr: string, key: string) => {
    const word = raw.replace(/[^A-Za-z'-]/g, "");
    if (!word) return;
    if (showTranslateHint) { setShowTranslateHint(false); markTranslateHintSeen(); }
    setSelectedWordKey(key);
    if (knownFr) { setWordPopup({ word, fr: knownFr, loading: false }); return; }
    setWordPopup({ word, fr: "", loading: true });
    try {
      const res: any = await translateText({ text: word, mode: "word" });
      setWordPopup({ word, fr: res.data.translation || "", loading: false });
    } catch { setWordPopup({ word, fr: "", loading: false }); }
  };

  const toggleBubble = async (key: string, text: string) => {
    if (bubbleFr[key]) { setBubbleFr((p) => ({ ...p, [key]: "" })); return; }
    setBubbleLoading((p) => ({ ...p, [key]: true }));
    try {
      const res: any = await translateText({ text, mode: "sentence" });
      setBubbleFr((p) => ({ ...p, [key]: res.data.translation || "(traduction indisponible)" }));
    } catch { setBubbleFr((p) => ({ ...p, [key]: "(traduction indisponible)" })); }
    finally { setBubbleLoading((p) => ({ ...p, [key]: false })); }
  };

  // Texte du coach : chaque mot est touchable (traduction), les mots difficiles sont soulignés
  const renderBubbleText = (text: string, hardWords: HardWord[], bubbleKey: string) => {
    const hardMap: Record<string, string> = {};
    hardWords.forEach((h) => { hardMap[h.word.toLowerCase().replace(/[^a-z]/g, "")] = h.fr; });
    const tokens = text.split(/(\s+)/);
    return (
      <Text style={styles.coachText}>
        {tokens.map((tok, i) => {
          if (/^\s+$/.test(tok)) return tok;
          const clean = tok.toLowerCase().replace(/[^a-z]/g, "");
          const isHard = clean in hardMap;
          const wordKey = `${bubbleKey}-${i}`;
          const isSelected = selectedWordKey === wordKey;
          return (
            <Text key={i} onPress={() => onWordTap(tok, hardMap[clean] ?? "", wordKey)} style={[isHard && styles.hardWord, isSelected && styles.selectedWord]}>
              {tok}
            </Text>
          );
        })}
      </Text>
    );
  };

  const renderCoachBubble = (text: string, hardWords: HardWord[], key: string) => (
    <View style={styles.coachBubble}>
      {renderBubbleText(text, hardWords, key)}
      {bubbleFr[key] ? <Text style={styles.coachFr}>{bubbleFr[key]}</Text> : null}
      <View style={styles.msgActions}>
        <Pressable onPress={() => { stopAudio(); playText(key, text); }} style={styles.msgAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Écouter">
          {listenLoading[key] ? <ActivityIndicator size="small" color={L.textSecondary} /> : <><Icon name="ecouter" size={18} /><Text style={styles.msgActionText}>Écouter</Text></>}
        </Pressable>
        <Pressable onPress={() => toggleBubble(key, text)} style={styles.msgAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Traduire">
          {bubbleLoading[key] ? <ActivityIndicator size="small" color={L.textSecondary} /> : <><Icon name="traduire" size={18} /><Text style={styles.msgActionText}>{bubbleFr[key] ? "Masquer" : "Traduire"}</Text></>}
        </Pressable>
      </View>
    </View>
  );

  // Carte « Le conseil de … » : uniquement quand il y a quelque chose à corriger (comme en leçon)
  const renderCoaching = (t: Turn, i: number) => {
    if (!t.correction?.has_errors) return null;
    const target = correctedText(t.correction);
    const key = `k${i}`;
    return (
      <View style={styles.coachingCard} accessibilityLabel={`Le conseil de ${coachName}. ${t.feedback ?? ""} ${target}`}>
        <View style={styles.coachingHead}><Icon name="etoile" size={20} /><Text style={styles.coachingTitle}>Le conseil de {coachName}</Text></View>
        {t.feedback ? <Text style={styles.coachingExplanation}>{t.feedback}</Text> : null}
        <CorrectedPhrase original={t.user} target={target} />
        <ListenButton onPress={() => { stopAudio(); playText(key, target); }} busy={listenLoading[key]} style={{ marginTop: 12 }} />
      </View>
    );
  };

  const sceneImage = (style: any) => !hasIllustration ? null : (
    <View style={style}>
      {isDailyIllustration
        ? <DailySceneImg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        : <Image source={scenePngSource} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
    </View>
  );

  const busy = status === "processing" || status === "debriefing" || status === "opening";
  const level01 = typeof recorderState.metering === "number" ? Math.max(0, Math.min(1, (recorderState.metering + 55) / 55)) : 0.15;
  const composerLabel =
    status === "processing" ? "Je prépare ma réponse…" :
    speaking ? `${coachName} te répond…` :
    "Touche pour parler";
  const remaining = Math.max(0, sessionLimit - turns.length);
  const progressText = reachedLimit ? "Scène terminée" : remaining === 1 ? "Dernier échange" : `${remaining} échanges`;

  return (
  <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <View style={styles.container}>
      <StatusBar style="dark" />
      {/* En-tête : retour · titre · vitesse · terminer */}
      <View style={styles.header}>
        <RoundButton icon="retour" label="Retour" onPress={handleBack} size={44} iconSize={20} />
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {!showChannelChoice && (
          <Pressable onPress={cycleRate} hitSlop={8} style={styles.speedPill} accessibilityRole="button" accessibilityLabel={`Vitesse ${labelForRate(speechRate)}`}>
            <Feather name="sliders" size={13} color={L.accentDeep} />
            <Text style={styles.speedPillText}>{labelForRate(speechRate)}</Text>
          </Pressable>
        )}
        {turns.length > 0 && !debrief && !lesson && (
          <RoundButton icon="fermer" label="Terminer et voir mon bilan" onPress={runDebrief} disabled={status !== "idle"} size={44} iconSize={18} />
        )}
      </View>

      {/* Carte du thème : image + contexte de la scène + progression des échanges */}
      {!showChannelChoice && (
        <Pressable onPress={() => setSceneOpen((v) => !v)} style={[styles.sceneBar, reachedLimit && styles.sceneBarDone]} accessibilityRole="button" accessibilityLabel={`${lesson ? "Ton objectif" : "La scène"} : ${opening?.context_fr ?? ""}`}>
          <View style={styles.sceneRow}>
            {sceneImage(styles.sceneThumb)}
            <View style={{ flex: 1 }}>
              <Text style={styles.sceneK}>{lesson ? "Ton objectif" : daily ? "Discussion" : "La scène"} · <Text style={reachedLimit ? { color: L.success } : undefined}>{progressText}</Text></Text>
              {opening
                ? <Text style={styles.sceneText} numberOfLines={sceneOpen ? undefined : 2}>{opening.context_fr}</Text>
                : <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}><ActivityIndicator size="small" color={L.textSecondary} /><Text style={styles.sceneWait}>{coachName} prépare la scène…</Text></View>}
            </View>
            <Icon name="chevron" size={18} style={{ transform: [{ rotate: sceneOpen ? "-90deg" : "90deg" }] }} />
          </View>
          <View style={styles.segments}>
            {Array.from({ length: sessionLimit }).map((_, i) => <View key={i} style={[styles.segment, i < turns.length && { backgroundColor: L.success }, i === turns.length && !reachedLimit && { backgroundColor: L.accentDeep }]} />)}
          </View>
        </Pressable>
      )}

      {error ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text> : null}
      {hint ? <Text style={styles.hintText}>{hint}</Text> : null}
      {favFlash && (
        <Animated.View style={[styles.favBadge, { opacity: favFlashAnim, transform: [{ scale: favFlashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}>
          <View style={styles.favBadgeIcon}><Icon name="check" size={12} tint="#fff" /></View>
          <Text style={styles.favBadgeText}>« {favFlash} » ajouté à ton dictionnaire</Text>
        </Animated.View>
      )}

      <View style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {status === "opening" && !showChannelChoice && (
            <View style={[styles.coachBubble, styles.typingBubble]}><TypingDots /></View>
          )}

          {opening && renderCoachBubble(opening.reply_en, opening.hardWords, "op")}

          {turns.map((t, i) => (
            <View key={i}>
              <View style={styles.userBubble}><Text style={styles.userText}>{t.user}</Text></View>
              {renderCoaching(t, i)}
              {renderCoachBubble(t.coach, t.hardWords, `t${i}`)}
            </View>
          ))}

          {pendingUserText ? <View style={styles.userBubble}><Text style={styles.userText}>{pendingUserText}</Text></View> : null}
          {status === "processing" && <View style={[styles.coachBubble, styles.typingBubble]}><TypingDots /></View>}
          {status === "debriefing" && <View style={styles.typing}><ActivityIndicator size="small" color={L.textSecondary} /><Text style={styles.typingText}>Je prépare ton bilan…</Text></View>}

          {debrief && <DebriefView debrief={debrief} />}
        </ScrollView>

        {/* Aides flottantes : « Aide-moi à dire » et « Un exemple » */}
        {opening && !debrief && !reachedLimit && !showChannelChoice && (
          <View style={styles.floatCol} pointerEvents="box-none">
            <RoundButton icon="aide" label="Aide-moi à dire" onPress={openTranslate} disabled={busy} size={46} iconSize={20} style={styles.floatBtn} />
            <RoundButton icon="exemple" label="Un exemple" onPress={openExample} disabled={busy} size={46} iconSize={20} style={styles.floatBtn} />
          </View>
        )}
      </View>

      {/* Composer */}
      {debrief ? (
        <PrimaryButton label="Terminer" onPress={() => onExit(true)} arrow={false} style={{ marginBottom: 8 }} />
      ) : reachedLimit ? (
        <PrimaryButton label={lesson ? "Continuer la leçon" : "Voir mon bilan"} onPress={() => (lesson ? lesson.onEnd() : setFirstSessionCongrats(true))} disabled={status === "debriefing"} style={{ marginBottom: 8 }} />
      ) : showChannelChoice ? null : (
        <View style={styles.composer}>
          {channel === "voice" ? (
            status === "recording" ? (
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
                  <Pressable onPress={startRecording} disabled={busy} style={[styles.micHalo, busy && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Parler" accessibilityState={{ disabled: busy }}>
                    <View style={[styles.mic, busy && styles.micIdle]}><Icon name="micro" size={30} tint="#fff" /></View>
                  </Pressable>
                  <Text style={styles.composerLabel}>{composerLabel}</Text>
                </View>
                {speaking
                  ? <RoundButton icon="fermer" label="Arrêter la lecture" onPress={stopAudio} />
                  : <RoundButton icon="rejouer" label={`Réécouter ${coachName}`} onPress={replayLast} disabled={busy || !lastCoachRef.current.text} />}
              </View>
            )
          ) : (
            <View>
              {micDenied && (
                <Pressable onPress={() => Linking.openSettings()} style={styles.micDeniedRow} accessibilityRole="button">
                  <Text style={styles.micDeniedText}>Micro refusé — tu peux écrire, ou autoriser le micro dans les réglages.</Text>
                </Pressable>
              )}
              <View style={styles.inputRow}>
                {!micDenied && <RoundButton icon="micro" label="Répondre à la voix" onPress={() => { if (status === "idle") setChannel("voice"); }} />}
                <TextInput
                  style={styles.textInput}
                  value={textInput}
                  onChangeText={setTextInput}
                  placeholder="Écris ta réponse en anglais…"
                  placeholderTextColor={L.textSecondary}
                  multiline
                  editable={status !== "processing"}
                  accessibilityLabel="Ta réponse en anglais"
                />
                <Pressable onPress={sendText} disabled={status === "processing" || !textInput.trim()} style={[styles.sendBtn, (status === "processing" || !textInput.trim()) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Envoyer">
                  <Icon name="envoyer" size={22} tint="#fff" />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {showTranslateHint && opening && !showChannelChoice && (
        <View style={styles.hintBanner} pointerEvents="none">
          <Icon name="traduire" size={16} tint={L.lavenderText} />
          <Text style={styles.hintBannerText}>Touche un mot pour le traduire</Text>
        </View>
      )}

      {/* Démo freemium : confirmation avant de quitter */}
      <Modal visible={showExitConfirm} transparent animationType="fade" onRequestClose={() => setShowExitConfirm(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowExitConfirm(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Ta conversation sera perdue</Text>
            <Text style={[styles.sheetHint, { marginTop: 6 }]}>Tu es sur ta conversation de présentation gratuite, elle ne peut se faire qu'une fois. Es-tu sûr de vouloir quitter maintenant ?</Text>
            <Pressable onPress={confirmExit} style={[styles.sheetBtn, { backgroundColor: L.danger }]} accessibilityRole="button">
              <Text style={[styles.sheetBtnText, { color: "#fff" }]}>Quitter quand même</Text>
            </Pressable>
            <Pressable onPress={() => setShowExitConfirm(false)} style={styles.sheetCancel} accessibilityRole="button">
              <Text style={styles.sheetCancelText}>Continuer la conversation</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Choix du canal au lancement */}
      <Modal visible={showChannelChoice} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {sceneImage(styles.choiceImg)}
            <Text style={[styles.sheetTitle, { textAlign: "center", marginTop: hasIllustration ? 14 : 0 }]}>Comment veux-tu t'entraîner ?</Text>
            <Text style={[styles.sheetHint, { textAlign: "center", marginTop: 6 }]}>Tu pourras changer à tout moment pendant la conversation.</Text>
            <Pressable style={styles.choiceBtn} onPress={() => chooseChannel("voice")} accessibilityRole="button">
              <View style={styles.choiceIcon}><Icon name="micro" size={22} tint={L.accentDeep} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceBtnTitle}>À l'oral</Text>
                <Text style={styles.choiceBtnDesc}>Parle à voix haute, comme dans la vraie vie</Text>
              </View>
              <Icon name="chevron" size={16} />
            </Pressable>
            <Pressable style={styles.choiceBtn} onPress={() => chooseChannel("text")} accessibilityRole="button">
              <View style={[styles.choiceIcon, { backgroundColor: L.lavender }]}><Icon name="clavier" size={22} tint={L.lavenderText} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceBtnTitle}>À l'écrit</Text>
                <Text style={styles.choiceBtnDesc}>Tape tes réponses, sans faire de bruit</Text>
              </View>
              <Icon name="chevron" size={16} />
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Aide-moi à dire */}
      <Modal visible={showTranslate} transparent animationType="fade" onRequestClose={() => setShowTranslate(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Comment le dire en anglais</Text>
              <RoundButton icon="fermer" label="Fermer" onPress={() => setShowTranslate(false)} size={40} iconSize={16} />
            </View>
            <Text style={styles.sheetHint}>Écris en français ce que tu veux dire. {coachName} te montre comment le dire, à toi de le formuler ensuite.</Text>
            <TextInput style={styles.sheetInput} value={translateInput} onChangeText={setTranslateInput} placeholder="Ex : Je voudrais réserver une table pour deux…" placeholderTextColor={L.textSecondary} multiline />
            <Pressable onPress={runTranslate} disabled={translateLoading || !translateInput.trim()} style={[styles.sheetBtn, (translateLoading || !translateInput.trim()) && { opacity: 0.4 }]} accessibilityRole="button">
              {translateLoading ? <ActivityIndicator color={L.textPrimary} /> : <Text style={styles.sheetBtnText}>Traduire</Text>}
            </Pressable>
            {translateResult ? (
              <View style={styles.sheetResult}>
                <Text style={styles.sheetResultText}>{translateResult}</Text>
                <ListenButton onPress={() => playText("modal-translate", translateResult)} busy={listenLoading["modal-translate"]} style={{ marginTop: 10, backgroundColor: L.accentSoft }} />
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
            <Text style={styles.sheetHint}>Inspire-t'en, puis dis-le ou écris-le avec tes mots.</Text>
            {exampleLoading ? <ActivityIndicator color={L.accentDeep} style={{ marginVertical: 20 }} /> : exampleData?.en ? (
              <View style={styles.sheetResult}>
                <Text style={styles.sheetResultText}>{exampleData.en}</Text>
                {exampleData.fr ? <Text style={styles.sheetResultFr}>{exampleData.fr}</Text> : null}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                  <ListenButton onPress={() => playText("modal-example", exampleData.en)} busy={listenLoading["modal-example"]} style={{ backgroundColor: L.accentSoft }} />
                  <Pressable onPress={runExample} style={styles.sheetLink} accessibilityRole="button"><Icon name="rejouer" size={16} /><Text style={styles.sheetLinkText}>Autre idée</Text></Pressable>
                </View>
              </View>
            ) : <Text style={styles.sheetHint}>Impossible de générer un exemple pour l'instant. Réessaie.</Text>}
          </View>
        </View>
      </Modal>

      {/* Mot touché : traduction + ajout au dictionnaire */}
      <Modal visible={!!wordPopup} transparent animationType="fade" onRequestClose={() => setWordPopup(null)}>
        <Pressable style={styles.overlay} onPress={() => { setWordPopup(null); setSelectedWordKey(null); }}>
          <Pressable style={[styles.sheet, { alignItems: "center" }]} onPress={() => {}}>
            <Text style={styles.wordEn}>{wordPopup?.word}</Text>
            {wordPopup?.loading ? (
              <ActivityIndicator color={L.accentDeep} style={{ marginTop: 10 }} />
            ) : wordPopup?.fr ? (
              <>
                <Text style={styles.wordFr}>{wordPopup.fr}</Text>
                <View style={styles.wordBtnRow}>
                  <ListenButton onPress={() => playText(`pop-${wordPopup!.word}`, wordPopup!.word)} busy={listenLoading[`pop-${wordPopup!.word}`]} style={{ backgroundColor: L.accentSoft }} />
                  <Pressable onPress={() => addWordToFav({ word: wordPopup!.word, fr: wordPopup!.fr })} style={styles.wordFavBtn} accessibilityRole="button">
                    <Icon name="etoile" size={18} tint={L.textPrimary} />
                    <Text style={styles.wordFavText}>Garder ce mot</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.wordFrMuted}>Traduction indisponible</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Première conversation terminée */}
      <Modal visible={firstSessionCongrats} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { alignItems: "center" }]}>
            <View style={styles.congratsIcon}><Icon name="etoile" size={36} tint="#fff" /></View>
            <Text style={[styles.sheetTitle, { fontSize: 24, textAlign: "center" }]}>Félicitations !</Text>
            <Text style={[styles.sheetHint, { textAlign: "center", marginTop: 8, fontSize: 15 }]}>Tu viens de faire tes premiers pas en anglais. Ça se fête ! Voyons ce que ça donne.</Text>
            <PrimaryButton label="Voir mon bilan" onPress={runDebrief} style={{ alignSelf: "stretch" }} />
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
  headerTitle: { flex: 1, color: L.textPrimary, fontSize: 18, fontWeight: "700" },
  speedPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: L.accentSoft, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 10 },
  speedPillText: { color: L.accentDeep, fontSize: 13, fontWeight: "800" },

  // Carte du thème
  sceneBar: { backgroundColor: L.surface, borderRadius: 16, borderWidth: 1, borderColor: L.border, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  sceneBarDone: { backgroundColor: L.successSoft, borderColor: L.successSoft },
  sceneRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sceneThumb: { width: 52, height: 52, borderRadius: 14, overflow: "hidden", backgroundColor: L.border },
  sceneK: { color: L.textSecondary, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  sceneText: { color: L.textPrimary, fontSize: 14.5, fontWeight: "600", lineHeight: 20, marginTop: 2 },
  sceneWait: { color: L.textSecondary, fontSize: 14, fontWeight: "600" },
  segments: { flexDirection: "row", gap: 4, marginTop: 8 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: L.border },

  errorText: { color: L.danger, fontSize: 14, fontWeight: "600", marginVertical: 6 },
  hintText: { color: L.textSecondary, fontSize: 14, fontWeight: "600", marginVertical: 6 },
  favBadge: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", backgroundColor: L.success, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, marginVertical: 6 },
  favBadgeIcon: { width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  favBadgeText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  scrollContent: { paddingTop: 4, paddingBottom: 8 },
  floatCol: { position: "absolute", right: 0, bottom: 6, gap: 8 },
  floatBtn: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },

  coachBubble: { backgroundColor: L.surface, borderRadius: L.radiusCard, borderTopLeftRadius: 8, padding: 14, marginBottom: 10, marginRight: 56, alignSelf: "flex-start", maxWidth: "100%" },
  typingBubble: { paddingVertical: 12, paddingHorizontal: 18 },
  coachText: { color: L.textPrimary, fontSize: 16, lineHeight: 23 },
  hardWord: { color: L.accentDeep, textDecorationLine: "underline", fontWeight: "700" },
  selectedWord: { backgroundColor: L.accentSoft, borderRadius: 4 },
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
  composerLabel: { color: L.textSecondary, fontSize: 13, fontWeight: "700", marginTop: 2, textAlign: "center" },
  waveRow: { flexDirection: "row", alignItems: "center", gap: 3, height: 28, justifyContent: "center", marginBottom: 6 },
  waveBar: { width: 3, borderRadius: 1.5, backgroundColor: L.accentDeep },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  textInput: { flex: 1, backgroundColor: L.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: L.textPrimary, maxHeight: 120, minHeight: 52 },
  sendBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: L.accentDeep, alignItems: "center", justifyContent: "center" },
  micDeniedRow: { marginBottom: 8, minHeight: 36, justifyContent: "center" },
  micDeniedText: { color: L.textSecondary, fontSize: 13, fontWeight: "600" },

  hintBanner: { position: "absolute", bottom: 130, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: L.lavender, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16 },
  hintBannerText: { color: L.lavenderText, fontSize: 13, fontWeight: "800" },

  // Feuilles (aides, mot, choix du canal, confirmation, félicitations)
  overlay: { flex: 1, backgroundColor: "rgba(25,41,71,0.6)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: L.background, borderRadius: 24, padding: 20 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  sheetTitle: { color: L.textPrimary, fontSize: 19, fontWeight: "700" },
  sheetHint: { color: L.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  sheetInput: { backgroundColor: L.surface, borderRadius: 16, padding: 14, fontSize: 16, color: L.textPrimary, minHeight: 70, maxHeight: 140, textAlignVertical: "top" },
  sheetBtn: { backgroundColor: L.accentDeep, borderRadius: 16, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 12 },
  sheetBtnText: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  sheetCancel: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: 4 },
  sheetCancelText: { color: L.accentDeep, fontSize: 15, fontWeight: "800" },
  sheetResult: { backgroundColor: L.surface, borderRadius: 16, padding: 14, marginTop: 14 },
  sheetResultText: { color: L.textPrimary, fontSize: 17, fontWeight: "700", lineHeight: 24 },
  sheetResultFr: { color: L.textSecondary, fontSize: 14, fontStyle: "italic", lineHeight: 20, marginTop: 6 },
  sheetLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 46, paddingHorizontal: 8 },
  sheetLinkText: { color: L.textSecondary, fontSize: 14, fontWeight: "700" },

  choiceImg: { height: 110, borderRadius: 18, overflow: "hidden", backgroundColor: L.border },
  choiceBtn: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: L.surface, borderRadius: 16, padding: 14, marginBottom: 10 },
  choiceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center" },
  choiceBtnTitle: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  choiceBtnDesc: { color: L.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },

  wordEn: { color: L.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  wordFr: { color: L.accentDeep, fontSize: 18, fontWeight: "700", marginTop: 6 },
  wordFrMuted: { color: L.textSecondary, fontSize: 14, fontWeight: "600", marginTop: 6, textAlign: "center" },
  wordBtnRow: { flexDirection: "row", gap: 10, marginTop: 18, alignSelf: "stretch" },
  wordFavBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: L.accentDeep, borderRadius: 16, minHeight: 48, paddingHorizontal: 14 },
  wordFavText: { color: L.textPrimary, fontSize: 14.5, fontWeight: "800" },

  congratsIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: L.success, alignItems: "center", justifyContent: "center", marginBottom: 16 },
});
