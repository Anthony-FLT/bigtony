// SpikeScreen.tsx — conversation voix OU texte : choix du canal, correction rouge/vert, favoris, plafond 1re séance.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Animated } from "react-native";
import { SkeletonCard, SkeletonLine, SkeletonBox } from "./components/Skeleton";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "./lib/firebase";
import { Scenario } from "./lib/scenarios";
import { T } from "./lib/theme";
import { startSession, addTurn, closeSession, SessionTurn } from "./lib/sessions";
import { loadProfile, markFirstSessionDone, markTranslateHintSeen, VoiceKey, saveSpeechRate } from "./lib/profile";
import { labelForRate, nextRate } from "./lib/speech";
import { Level } from "./lib/level";
import { addFavorite } from "./lib/favorites";
import { recordStumble } from "./lib/practiceWords";
import { addSpeakingSeconds } from "./lib/speakingTime";
import DebriefView from "./components/DebriefView";
import CorrectionCard, { Correction, PronStatus } from "./components/CorrectionCard";
import { StatusBar } from "expo-status-bar";

// Illustrations : scènes préenregistrées (mêmes visuels que l'écran de sélection) + une image générique pour la discussion du jour.
import EntretienEmbaucheImg from "./assets/scenes/01-entretien-embauche.svg";
import PointHebdoVisioImg from "./assets/scenes/02-point-hebdo-visio.svg";
import PresenterProjetImg from "./assets/scenes/03-presenter-projet.svg";
import NegocierSalaireImg from "./assets/scenes/04-negocier-salaire.svg";
import ArriveeHotelImg from "./assets/scenes/05-arrivee-hotel.svg";
import ControleAeroportImg from "./assets/scenes/06-controle-aeroport.svg";
import CommanderRestaurantImg from "./assets/scenes/07-commander-restaurant.svg";
import RencontrerQuelquunImg from "./assets/scenes/08-rencontrer-quelquun.svg";
import CafeEntreAmisImg from "./assets/scenes/09-cafe-entre-amis.svg";
import DemanderCheminImg from "./assets/scenes/10-demander-chemin.svg";
import DailySceneImg from "./assets/hub/daily-scene-aleatoire.svg";

const SCENE_ILLUSTRATIONS: Record<string, React.ComponentType<any>> = {
  "entretien-embauche": EntretienEmbaucheImg,
  "point-hebdo-teams": PointHebdoVisioImg,
  "presentation-pro": PresenterProjetImg,
  "negociation-salaire": NegocierSalaireImg,
  "arrivee-hotel": ArriveeHotelImg,
  "aeroport-controle": ControleAeroportImg,
  "restaurant-commande": CommanderRestaurantImg,
  "rencontre-inconnu": RencontrerQuelquunImg,
  "cafe-ami": CafeEntreAmisImg,
  "demander-chemin": DemanderCheminImg,
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
};

type Opening = { context_fr: string; reply_en: string; reply_fr: string; hardWords: HardWord[] } | null;
type Debrief = { points_forts: string[]; axe: string; message_fr: string } | null;
type WordPopup = { word: string; fr: string; loading: boolean } | null;

// Ne garde que les mots faibles réellement présents dans ce que l'utilisateur a dit.
function cleanWeakWords(weak: { word: string; score: number }[], said: string): string[] {
  const saidSet = new Set(said.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of weak) {
    const k = w.word.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (!k || seen.has(k) || !saidSet.has(k)) continue;
    seen.add(k);
    out.push(w.word);
    if (out.length >= 3) break;
  }
  return out;
}

// Trois points qui pulsent (bulle de frappe du coach).
function TypingDots() {
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;
  const d3 = useRef(new Animated.Value(0.3)).current;
  const dots = [d1, d2, d3];

  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 350, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={{ flexDirection: "row", gap: 5, paddingVertical: 4, paddingHorizontal: 2 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#F2ECE1", opacity: d, transform: [{ scale: d }] }} />
      ))}
    </View>
  );
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

export default function SpikeScreen({ scenario, onExit, daily, welcome }: { scenario: Scenario; onExit: () => void; daily?: boolean; welcome?: boolean }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  // metering: niveau sonore en direct pendant l'enregistrement, si le SDK le fournit (voir startRecording).
  // Repli propre si non disponible : recorderState.metering reste undefined, les barres restent au repos.
  const recorderState = useAudioRecorderState(recorder, 80);
  const player = useAudioPlayer();
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const SceneIllustration = (daily || welcome) ? DailySceneImg : SCENE_ILLUSTRATIONS[scenario.id];
  const [turns, setTurns] = useState<Turn[]>([]);
  const [opening, setOpening] = useState<Opening>(null);
  const [debrief, setDebrief] = useState<Debrief>(null);
  const [status, setStatus] = useState<"opening" | "idle" | "recording" | "processing" | "debriefing">("opening");
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
  // Canal de conversation
  const [channel, setChannel] = useState<Channel>("voice");
  const [showChannelChoice, setShowChannelChoice] = useState(true);
  const [textInput, setTextInput] = useState("");
  const [pendingUserText, setPendingUserText] = useState("");
  // Assistant : traduire (FR→EN) + réponse d'exemple
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

  const sessionLimit = welcome ? WELCOME_LIMIT : (isFirstSession ? FIRST_SESSION_LIMIT : SCENARIO_LIMIT);
  const capped = true;
  const reachedLimit = capped && turns.length >= sessionLimit;
  const chatGoal = capped ? sessionLimit : 8;
  const chatProgress = Math.min(100, Math.round((turns.length / chatGoal) * 100));

  useEffect(() => {
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) setError("Permission micro refusée");
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
    const t = setTimeout(() => {
      setShowTranslateHint(false);
      markTranslateHintSeen();
    }, 4500);
    return () => clearTimeout(t);
  }, [showTranslateHint]);

  // Chronomètre pendant l'enregistrement.
  useEffect(() => {
    if (status !== "recording") { setRecordingSeconds(0); return; }
    const start = Date.now();
    const id = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(id);
  }, [status]);

  // Poids fixes par barre (variation visuelle) — le niveau réel (metering) module leur hauteur en direct.
  const WAVE_BARS = 28;
  const waveWeights = useRef(Array.from({ length: WAVE_BARS }, () => 0.5 + Math.random() * 0.5)).current;

  const playBase64 = async (base64: string) => {
    const p = FileSystem.cacheDirectory + `reply_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(p, base64, { encoding: FileSystem.EncodingType.Base64 });
    player.replace(p);
    player.play();
  };

  // Lit une phrase anglaise à voix haute via translateText mode "speak" (bouton "écouter" en mode texte).
  const playText = async (key: string, text: string) => {
    setListenLoading((p) => ({ ...p, [key]: true }));
    try {
      const res: any = await translateText({ text, mode: "speak", voice: voiceKey, speakingRate: speechRate });
      if (res.data?.audioBase64) await playBase64(res.data.audioBase64);
    } catch (e) {
      console.warn("Écoute échouée:", e);
    } finally {
      setListenLoading((p) => ({ ...p, [key]: false }));
    }
  };

  // Lit la version corrigée à voix haute.
  const playCorrected = async (correction: Correction) => {
    const text = correction.corrected.map((t) => t.text).join(" ");
    try {
      const res: any = await translateText({ text, mode: "speak", voice: voiceKey, speakingRate: speechRate });
      if (res.data?.audioBase64) await playBase64(res.data.audioBase64);
    } catch (e) {
      console.warn("Lecture de la correction échouée:", e);
    }
  };

  // Accès rapide : fait défiler les 4 vitesses et enregistre le choix (réglage global).
  const cycleRate = async () => {
    const r = nextRate(speechRate);
    setSpeechRate(r);
    await saveSpeechRate(r);
  };

  // Assistant — Traduire (FR→EN)
  const openTranslate = () => { setTranslateInput(""); setTranslateResult(""); setShowTranslate(true); };
  const runTranslate = async () => {
    const text = translateInput.trim();
    if (!text || translateLoading) return;
    setTranslateLoading(true); setTranslateResult("");
    try {
      const res: any = await translateToEnglish({ text, level });
      setTranslateResult(res.data?.english ?? "");
    } catch (e) {
      console.warn("Traduction échouée:", e);
      setTranslateResult("");
    } finally {
      setTranslateLoading(false);
    }
  };

  // Assistant — Réponse d'exemple (selon le contexte)
  const openExample = () => { setExampleData(null); setShowExample(true); runExample(); };
  const runExample = async () => {
    setExampleLoading(true); setExampleData(null);
    try {
      const res: any = await suggestExample({
        history: [
          ...(opening ? [{ user: "", coach: opening.reply_en }] : []),
          ...turns.map((t) => ({ user: t.user, coach: t.coach })),
        ],
        scenarioId: (daily || welcome) ? null : scenario.id,
        level,
        sceneContext: welcome ? null : (opening?.context_fr ?? null),
        customContext: welcome ? WELCOME_TURN_CONTEXT : (scenario.custom ?? null),
      });
      setExampleData({ en: res.data?.example_en ?? "", fr: res.data?.example_fr ?? "" });
    } catch (e) {
      console.warn("Exemple échoué:", e);
      setExampleData(null);
    } finally {
      setExampleLoading(false);
    }
  };

  // Le choix du canal déclenche le chargement de l'ouverture (et joue l'audio seulement en mode voix).
  const chooseChannel = (c: Channel) => {
    setChannel(c);
    setShowChannelChoice(false);
    loadOpening(c);
  };

  const loadOpening = async (ch: Channel) => {
    try {
      let res: any;
      if (welcome) {
        const p = await loadProfile();
        res = await welcomeOpening({
          level: p?.level ?? "B1",
          name: p?.name ?? null,
          interests: p?.interests ?? [],
          goals: p?.goals ?? [],
          job: p?.job ?? null,
          voice: p?.voice ?? "us-male", speakingRate: speechRate,
        });
      } else if (daily) {
        const p = await loadProfile();
        res = await dailyOpening({
          level: p?.level ?? "B1",
          interests: p?.interests ?? [],
          goals: p?.goals ?? [],
          job: p?.job ?? null,
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
      if (ch === "voice") playBase64(res.data.replyAudioBase64);
    } catch (e: any) {
      const msg = String(e?.message || "");
      setError(msg.includes("UNSAFE_CONTEXT") ? "Ce contexte n'est pas approprié pour une scène. Essaie autre chose." : friendlyError(e));
    } finally {
      setStatus("idle");
    }
  };

  const persistTurn = async (turn: Turn) => {
    try {
      let sid = sessionId;
      if (!sid) { sid = await startSession(daily ? "daily" : scenario.id, daily ? "daily" : "scenario"); setSessionId(sid); }
      const st: SessionTurn = {
        user: turn.user, coach: turn.coach, feedback: turn.feedback ?? "",
        pronunciation: turn.pronunciation, at: Date.now(),
      };
      await addTurn(sid, st);
    } catch (e) { console.warn("Persistance du tour échouée:", e); }
  };

  // Ajoute le tour, gère les stumbles, la persistance, le scroll et la fin de séance (commun voix + texte).
  const finalizeTurn = (newTurn: Turn) => {
    const nextCount = turns.length + 1;
    setTurns((prev) => [...prev, newTurn]);
    for (const m of newTurn.misheard) recordStumble(m.said, m.heard);
    persistTurn(newTurn);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    if (nextCount >= sessionLimit) {
      setStatus("idle");
      if (isFirstSession || welcome) {
        setTimeout(() => setFirstSessionCongrats(true), 800);
      } else {
        setTimeout(() => runDebrief(), 800);
      }
    }
  };

  const startRecording = async () => {
    if (status !== "idle" || reachedLimit) return;
    setError(null); setHint(null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // isMeteringEnabled est réglé à la création du recorder (useAudioRecorder ci-dessus).
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setStatus("recording");
    } catch (e: any) { setError(friendlyError(e)); setStatus("idle"); }
  };

  // Annule l'enregistrement en cours (icône poubelle) — rien n'est envoyé.
  const cancelRecording = async () => {
    if (status !== "recording") return;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) { console.warn("Annulation échouée:", e); }
    setStatus("idle");
  };

  // Un tap démarre, un tap envoie (pas un "maintenir" : la carte d'enregistrement remplace le bouton
  // à l'écran, ce qui interromprait un geste de pression continue sur le même élément).
  const toggleRecording = () => {
    if (status === "idle") startRecording();
    else if (status === "recording") stopAndSend();
  };

  const stopAndSend = async () => {
    if (status !== "recording") return;
    setStatus("processing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - recordStartRef.current < MIN_RECORDING_MS) {
        setHint("Maintiens le bouton et parle — je t'écoute.");
        setStatus("idle"); return;
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("Aucun enregistrement produit");
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      // Temps de parole : durée réelle de ce tour, cumulée par jour (nouveau suivi, pas de rétroactif).
      addSpeakingSeconds((Date.now() - recordStartRef.current) / 1000).catch(() => {});

      const willBeLast = capped && turns.length + 1 >= sessionLimit;
      const res: any = await spikeTurn({
        audioBase64, mimeType: "audio/mp4",
        history: [
          ...(opening ? [{ user: "", coach: opening.reply_en }] : []),
          ...turns.map((t) => ({ user: t.user, coach: t.coach })),
        ],
        scenarioId: (daily || welcome) ? null : scenario.id,
        level,
        sceneContext: welcome ? null : (opening?.context_fr ?? null),
        customContext: welcome ? WELCOME_TURN_CONTEXT : (scenario.custom ?? null),
        isLastTurn: willBeLast,
        voice: voiceKey, speakingRate: speechRate,
      });
      console.log("TIMINGS:", JSON.stringify(res.data.timings));
      const d = res.data;
      playBase64(d.replyAudioBase64); // on lance l'audio SANS attendre qu'il finisse

      if (!d.transcript) { setHint(d.feedback_fr || "Je n'ai rien entendu — réessaie."); return; }

      finalizeTurn({
        user: d.transcript,
        coach: d.reply_en,
        coachFr: d.reply_fr ?? "",
        hardWords: d.hard_words ?? [],
        misheard: d.misheard ?? [],
        feedback: d.feedback_fr ?? null,
        pronunciation: d.pronunciation ?? null,
        correction: d.correction ?? null,
      });
    } catch (e: any) { setError(friendlyError(e)); }
    finally { setStatus((s) => (s === "processing" ? "idle" : s)); }
  };

  const sendText = async () => {
    const text = textInput.trim();
    if (!text || status === "processing" || reachedLimit) return;
    setTextInput("");            // vide l'input tout de suite
    setPendingUserText(text);    // affiche le message dans la conversation tout de suite
    setStatus("processing");
    setError(null); setHint(null);
    try {
      const willBeLast = capped && turns.length + 1 >= sessionLimit;
      const res: any = await chatTurn({
        text,
        history: [
          ...(opening ? [{ user: "", coach: opening.reply_en }] : []),
          ...turns.map((t) => ({ user: t.user, coach: t.coach })),
        ],
        scenarioId: (daily || welcome) ? null : scenario.id,
        level,
        sceneContext: welcome ? null : (opening?.context_fr ?? null),
        customContext: welcome ? WELCOME_TURN_CONTEXT : (scenario.custom ?? null),
        isLastTurn: willBeLast,
      });
      console.log("CHAT TIMINGS:", JSON.stringify(res.data.timings));
      const d = res.data;
      setPendingUserText("");     // le tour complet prend le relais
      finalizeTurn({
        user: text,
        coach: d.reply_en,
        coachFr: d.reply_fr ?? "",
        hardWords: d.hard_words ?? [],
        misheard: [],
        feedback: d.feedback_fr ?? null,
        pronunciation: null, // pas de prononciation en mode texte
        correction: d.correction ?? null,
      });
    } catch (e: any) { setError(friendlyError(e)); setPendingUserText(""); }
    finally { setStatus((s) => (s === "processing" ? "idle" : s)); }
  };

  const runDebrief = async () => {
    setFirstSessionCongrats(false);
    if (turns.length === 0 || debriefingRef.current) return;
    debriefingRef.current = true;
    setStatus("debriefing"); setError(null);
    try {
      if (isFirstSession) markFirstSessionDone();
      const res: any = await sessionDebrief({
        turns: turns.map((t) => ({ user: t.user, coach: t.coach, pronunciation: t.pronunciation })),
      });
      setDebrief(res.data);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      if (sessionId) {
        const st: SessionTurn[] = turns.map((t) => ({
          user: t.user, coach: t.coach, feedback: t.feedback ?? "", pronunciation: t.pronunciation, at: 0,
        }));
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

  // "Ajouter aux révisions" (panneau de correction) : retiré — pas cohérent de forcer une phrase
  // entière dans le Labo, qui est pensé pour des mots.

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
    } catch {
      setWordPopup({ word, fr: "", loading: false });
    }
  };

  const toggleBubble = async (key: string, text: string) => {
    if (bubbleFr[key]) { setBubbleFr((p) => ({ ...p, [key]: "" })); return; }
    setBubbleLoading((p) => ({ ...p, [key]: true }));
    try {
      const res: any = await translateText({ text, mode: "sentence" });
      setBubbleFr((p) => ({ ...p, [key]: res.data.translation || "(traduction indisponible)" }));
    } catch {
      setBubbleFr((p) => ({ ...p, [key]: "(traduction indisponible)" }));
    } finally {
      setBubbleLoading((p) => ({ ...p, [key]: false }));
    }
  };

  const renderBubbleText = (text: string, hardWords: HardWord[], bubbleKey: string) => {
    const hardMap: Record<string, string> = {};
    hardWords.forEach((h) => { hardMap[h.word.toLowerCase().replace(/[^a-z]/g, "")] = h.fr; });
    const tokens = text.split(/(\s+)/);
    return (
      <Text style={styles.themText}>
        {tokens.map((tok, i) => {
          if (/^\s+$/.test(tok)) return tok;
          const clean = tok.toLowerCase().replace(/[^a-z]/g, "");
          const isHard = clean in hardMap;
          const wordKey = `${bubbleKey}-${i}`;
          const isSelected = selectedWordKey === wordKey;
          return (
            <Text
              key={i}
              onPress={() => onWordTap(tok, hardMap[clean] ?? "", wordKey)}
              style={[isHard ? styles.hardWord : styles.tappableWord, isSelected && styles.selectedWord]}
            >
              {tok}
            </Text>
          );
        })}
      </Text>
    );
  };

  const renderCoachBubble = (text: string, hardWords: HardWord[], key: string) => (
    <View style={styles.themBubble}>
      {renderBubbleText(text, hardWords, key)}
      {bubbleFr[key] ? <Text style={styles.translation}>{bubbleFr[key]}</Text> : null}
      <View style={styles.bubbleActions}>
        <Pressable onPress={() => playText(key, text)} style={styles.translateBtn} hitSlop={8}>
          {listenLoading[key] ? (
            <ActivityIndicator size="small" color="#CFC8BE" />
          ) : (
            <>
              <Feather name="play" size={13} color="#CFC8BE" />
              <Text style={styles.translateBtnText}>Réécouter</Text>
            </>
          )}
        </Pressable>
        <Pressable onPress={() => toggleBubble(key, text)} style={styles.translateBtn} hitSlop={8}>
          {bubbleLoading[key] ? (
            <ActivityIndicator size="small" color="#CFC8BE" />
          ) : (
            <>
              <Feather name="globe" size={13} color="#CFC8BE" />
              <Text style={styles.translateBtnText}>{bubbleFr[key] ? "Masquer" : "Traduire"}</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <View style={styles.container}>
    <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={onExit} hitSlop={12}><Feather name="chevron-left" size={26} color={T.inkSoft} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{daily ? "Discussion du jour" : scenario.title}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${chatProgress}%` }]} />
          </View>
        </View>
        {!showChannelChoice && (
          <Pressable onPress={cycleRate} hitSlop={8} style={styles.speedPill}>
            <Feather name="sliders" size={12} color={T.abricotDeep} />
            <Text style={styles.speedPillText}>{labelForRate(speechRate)}</Text>
          </Pressable>
        )}
        {turns.length > 0 && !debrief && (
          <Pressable onPress={runDebrief} disabled={status !== "idle"} hitSlop={10} style={styles.closeBtn}>
            <Feather name="x" size={20} color={T.inkSoft} />
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {favFlash && (
        <Animated.View
          style={[
            styles.favBadge,
            {
              opacity: favFlashAnim,
              transform: [{ scale: favFlashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
            },
          ]}
        >
          <View style={styles.favBadgeIcon}><Feather name="check" size={14} color="#fff" /></View>
          <Text style={styles.favBadgeText}>« {favFlash} » ajouté à ton dictionnaire !</Text>
        </Animated.View>
      )}

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {status === "opening" && !showChannelChoice && (
          <View style={{ marginTop: 6 }}>
            <SkeletonCard style={{ borderLeftWidth: 3, borderLeftColor: T.abricot, borderRadius: 18, padding: 14, marginBottom: 12 }}>
              <SkeletonLine width="24%" style={{ marginBottom: 10 }} />
              <SkeletonLine width="92%" />
              <SkeletonLine width="68%" style={{ marginBottom: 0 }} />
            </SkeletonCard>
            <SkeletonBox height={72} radius={20} style={{ borderTopLeftRadius: 6, marginRight: 38 }} />
          </View>
        )}

        {opening && (
          <>
            {turns.length === 0 ? (
              <View style={styles.sceneCard}>
                {SceneIllustration && (
                  <View style={styles.sceneImgWrap}><SceneIllustration width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} /></View>
                )}
                <View style={styles.sceneTextInner}>
                  <Text style={styles.sceneK}>LA SCÈNE</Text>
                  <Text style={styles.sceneText}>{opening.context_fr}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.scenePill}>
                {SceneIllustration && (
                  <View style={styles.scenePillImgWrap}><SceneIllustration width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} /></View>
                )}
                <Text style={styles.scenePillText} numberOfLines={1}>{opening.context_fr}</Text>
              </View>
            )}
            {renderCoachBubble(opening.reply_en, opening.hardWords, "op")}
          </>
        )}

        {turns.map((t, i) => (
          <View key={i}>
            <View style={styles.meBubble}><Text style={styles.meText}>{t.user}</Text></View>

            <CorrectionCard
              correction={t.correction ?? { has_errors: false, original: [], corrected: [] }}
              feedback={t.feedback ?? ""}
              pronunciation={t.pronunciation ? { clear: (t.misheard ?? []).length === 0, problems: t.misheard ?? [] } : undefined}
              onPlayCorrected={t.correction?.has_errors ? () => playCorrected(t.correction!) : undefined}
            />

            {renderCoachBubble(t.coach, t.hardWords, `t${i}`)}
          </View>
        ))}

        {pendingUserText ? (
          <View style={styles.meBubble}><Text style={styles.meText}>{pendingUserText}</Text></View>
        ) : null}

        {status === "processing" && (
          <View style={styles.themBubble}>
            <TypingDots />
          </View>
        )}

        {debrief && <DebriefView debrief={debrief} />}
      </ScrollView>

      {status === "debriefing" && (
        <ActivityIndicator size="large" color={T.abricot} style={{ marginBottom: 8 }} />
      )}

      {opening && !debrief && !reachedLimit && !showChannelChoice && (
        <View style={styles.assistBar}>
          <Pressable style={styles.assistBtn} onPress={openTranslate} disabled={status === "processing"} hitSlop={6}>
            <Feather name="help-circle" size={15} color={T.abricotDeep} />
            <Text style={styles.assistBtnText}>Aide-moi à dire</Text>
          </Pressable>
          <Pressable style={styles.assistBtn} onPress={openExample} disabled={status === "processing"} hitSlop={6}>
            <MaterialCommunityIcons name="auto-fix" size={15} color={T.abricotDeep} />
            <Text style={styles.assistBtnText}>Un exemple</Text>
          </Pressable>
        </View>
      )}

      {!debrief ? (
        reachedLimit ? (
          <View style={styles.controls}>
            <Pressable onPress={() => setFirstSessionCongrats(true)} style={styles.limitButton}>
              <Text style={styles.limitButtonText}>Voir mon bilan</Text>
            </Pressable>
          </View>
        ) : channel === "voice" ? (
          status === "recording" ? (
            <View style={styles.recCard}>
              <View style={styles.waveformRow}>
                {waveWeights.map((w, i) => {
                  // metering (dBFS, très négatif = silence, proche de 0 = fort) — normalisé en 0..1.
                  // Repli : si non disponible sur ce SDK/appareil, level reste à un niveau bas fixe (barres calmes, pas figées à plat).
                  const metering = recorderState.metering;
                  const level = typeof metering === "number" ? Math.max(0, Math.min(1, (metering + 55) / 55)) : 0.15;
                  const h = 4 + w * level * 34;
                  return <View key={i} style={[styles.waveBarLive, { height: h }]} />;
                })}
              </View>
              <View style={styles.recRow}>
                <Pressable onPress={cancelRecording} style={styles.cancelBtn} hitSlop={10}>
                  <Feather name="trash-2" size={18} color="#C0392B" />
                </Pressable>
                <Pressable onPress={toggleRecording} style={[styles.mic, styles.micActive]}>
                  <Feather name="mic" size={28} color="#fff" />
                </Pressable>
                <Text style={styles.recTime}>{Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}</Text>
              </View>
              <Text style={styles.recHint}>Touche le micro pour envoyer · la poubelle pour annuler</Text>
            </View>
          ) : (
            <View style={styles.controls}>
              <Pressable onPress={() => setChannel("text")} style={styles.keyboardBtn} hitSlop={10}>
                <MaterialCommunityIcons name="keyboard-outline" size={20} color={T.inkSoft} />
              </Pressable>
              <View style={styles.micZone}>
                <Pressable onPress={toggleRecording} disabled={status !== "idle"} style={styles.mic}>
                  <Feather name="mic" size={30} color="#fff" />
                </Pressable>
                <Text style={styles.micLabel}>Touche pour parler</Text>
              </View>
              <View style={{ width: 44 }} />
            </View>
          )
        ) : (
          <View style={styles.textControls}>
            <View style={styles.inputRow}>
              <Pressable onPress={() => { if (status === "idle") setChannel("voice"); }} style={styles.keyboardBtn} hitSlop={10}>
                <Feather name="mic" size={19} color={T.inkSoft} />
              </Pressable>
              <TextInput
                style={styles.textInput}
                value={textInput}
                onChangeText={setTextInput}
                placeholder="Écris ta réponse en anglais…"
                placeholderTextColor={T.inkSoft}
                multiline
                editable={status !== "processing"}
              />
              <Pressable
                onPress={sendText}
                disabled={status === "processing" || !textInput.trim()}
                style={[styles.sendBtn, (status === "processing" || !textInput.trim()) && styles.sendBtnDisabled]}
              >
                <Feather name="send" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        )
      ) : (
        <Pressable onPress={onExit} style={styles.newSessionButton}>
          <Text style={styles.newSessionText}>Terminer</Text>
        </Pressable>
      )}

      {showTranslateHint && (opening || turns.length > 0) && channel === "voice" && (
        <View style={styles.hintBanner} pointerEvents="none">
          <Feather name="globe" size={16} color={T.night} />
          <Text style={styles.hintBannerText}>Touche un mot pour le traduire</Text>
        </View>
      )}

      {/* Choix du canal au lancement */}
      <Modal visible={showChannelChoice} transparent animationType="fade">
        <View style={styles.choiceOverlay}>
          <View style={styles.choiceCard}>
            <Text style={styles.choiceTitle}>Comment veux-tu t'entraîner ?</Text>
            <Text style={styles.choiceBody}>Tu pourras changer à tout moment pendant la conversation.</Text>
            <Pressable style={styles.choiceBtn} onPress={() => chooseChannel("voice")}>
              <View style={styles.choiceIcon}><Feather name="mic" size={22} color={T.night} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceBtnTitle}>À l'oral</Text>
                <Text style={styles.choiceBtnDesc}>Parle à voix haute, travaille ta prononciation</Text>
              </View>
            </Pressable>
            <Pressable style={styles.choiceBtn} onPress={() => chooseChannel("text")}>
              <View style={styles.choiceIcon}><Feather name="message-square" size={22} color={T.night} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceBtnTitle}>À l'écrit</Text>
                <Text style={styles.choiceBtnDesc}>Tape tes réponses, sans faire de bruit</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Assistant — Traduire (FR→EN) */}
      <Modal visible={showTranslate} transparent animationType="fade" onRequestClose={() => setShowTranslate(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.assistOverlay}>
          <View style={styles.assistCard}>
            <View style={styles.assistHead}>
              <Text style={styles.assistTitle}>Comment le dire en anglais</Text>
              <Pressable onPress={() => setShowTranslate(false)} hitSlop={10}><Feather name="x" size={22} color={T.inkSoft} /></Pressable>
            </View>
            <Text style={styles.assistHint}>Écris en français ce que tu veux dire. Je te montre comment le dire — à toi de le formuler ensuite.</Text>
            <TextInput
              style={styles.assistInput}
              value={translateInput}
              onChangeText={setTranslateInput}
              placeholder="Ex : Je voudrais réserver une table pour deux…"
              placeholderTextColor={T.inkSoft}
              multiline
            />
            <Pressable onPress={runTranslate} disabled={translateLoading || !translateInput.trim()} style={[styles.assistAction, (translateLoading || !translateInput.trim()) && { opacity: 0.4 }]}>
              {translateLoading ? <ActivityIndicator size="small" color={T.night} /> : <Text style={styles.assistActionText}>Traduire</Text>}
            </Pressable>
            {translateResult ? (
              <View style={styles.assistResult}>
                <Text style={styles.assistResultText}>{translateResult}</Text>
                <Pressable onPress={() => playText("modal-translate", translateResult)} style={styles.assistListen} hitSlop={8}>
                  {listenLoading["modal-translate"] ? <ActivityIndicator size="small" color={T.inkSoft} /> : (<><Feather name="volume-2" size={14} color={T.inkSoft} /><Text style={styles.assistListenText}>Écouter</Text></>)}
                </Pressable>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Assistant — Réponse d'exemple */}
      <Modal visible={showExample} transparent animationType="fade" onRequestClose={() => setShowExample(false)}>
        <View style={styles.assistOverlay}>
          <View style={styles.assistCard}>
            <View style={styles.assistHead}>
              <Text style={styles.assistTitle}>Une idée de réponse</Text>
              <Pressable onPress={() => setShowExample(false)} hitSlop={10}><Feather name="x" size={22} color={T.inkSoft} /></Pressable>
            </View>
            <Text style={styles.assistHint}>Un exemple de ce que tu pourrais répondre. Inspire-t'en, puis dis-le ou écris-le avec tes mots.</Text>
            {exampleLoading ? (
              <ActivityIndicator color={T.abricot} style={{ marginVertical: 24 }} />
            ) : exampleData && exampleData.en ? (
              <View style={styles.assistResult}>
                <Text style={styles.assistResultText}>{exampleData.en}</Text>
                {exampleData.fr ? <Text style={styles.assistResultFr}>{exampleData.fr}</Text> : null}
                <View style={styles.assistResultActions}>
                  <Pressable onPress={() => playText("modal-example", exampleData.en)} style={styles.assistListen} hitSlop={8}>
                    {listenLoading["modal-example"] ? <ActivityIndicator size="small" color={T.inkSoft} /> : (<><Feather name="volume-2" size={14} color={T.inkSoft} /><Text style={styles.assistListenText}>Écouter</Text></>)}
                  </Pressable>
                  <Pressable onPress={runExample} style={styles.assistListen} hitSlop={8}>
                    <Feather name="refresh-cw" size={14} color={T.inkSoft} /><Text style={styles.assistListenText}>Autre idée</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Text style={styles.assistHint}>Impossible de générer un exemple pour l'instant. Réessaie.</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!wordPopup} transparent animationType="fade" onRequestClose={() => setWordPopup(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => { setWordPopup(null); setSelectedWordKey(null); }}>
          <Pressable style={styles.wordCard} onPress={() => {}}>
            <Text style={styles.wordEn}>{wordPopup?.word}</Text>
            {wordPopup?.loading ? (
              <ActivityIndicator color={T.abricotDeep} style={{ marginTop: 10 }} />
            ) : wordPopup?.fr ? (
              <>
                <Text style={styles.wordFr}>{wordPopup.fr}</Text>
                <View style={styles.wordBtnRow}>
                  <Pressable onPress={() => playText(`pop-${wordPopup!.word}`, wordPopup!.word)} style={styles.wordListenBtn}>
                    {listenLoading[`pop-${wordPopup!.word}`] ? (
                      <ActivityIndicator size="small" color={T.night} />
                    ) : (
                      <><Feather name="volume-2" size={15} color={T.night} /><Text style={styles.wordListenText}>Écouter</Text></>
                    )}
                  </Pressable>
                  <Pressable onPress={() => addWordToFav({ word: wordPopup!.word, fr: wordPopup!.fr })} style={styles.wordFavBtn}>
                    <Feather name="star" size={16} color={T.night} />
                    <Text style={styles.wordFavText}>Ajouter à mes mots</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.wordFrMuted}>Traduction indisponible</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={firstSessionCongrats} transparent animationType="fade">
        <View style={styles.congratsOverlay}>
          <View style={styles.congratsCard}>
            <View style={styles.congratsIcon}><Feather name="award" size={40} color="#fff" /></View>
            <Text style={styles.congratsTitle}>Félicitations !</Text>
            <Text style={styles.congratsBody}>
              Tu viens de faire tes premiers pas en anglais. Ça se fête ! Voyons ce que ça donne.
            </Text>
            <Pressable onPress={runDebrief} style={styles.congratsBtn}>
              <Text style={styles.congratsBtnText}>Voir mon bilan</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 56, backgroundColor: T.cream },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  headerTitle: { color: T.night, fontSize: 17, fontWeight: "800" },
  speedPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: T.chipAbricot, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 8, marginRight: 6 },
  speedPillText: { color: T.abricotDeep, fontSize: 11, fontWeight: "800" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#EAE6DE", overflow: "hidden", marginTop: 6 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: T.abricot },
  error: { color: "#C0392B", marginBottom: 8, fontWeight: "600" },
  hint: { color: "#B8860B", marginBottom: 8, fontWeight: "600" },
  favBadge: { flexDirection: "row", alignItems: "center", gap: 9, alignSelf: "center", backgroundColor: "#2E7D53", borderRadius: 14, paddingVertical: 9, paddingHorizontal: 14, marginBottom: 8 },
  favBadgeIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  favBadgeText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  openingWait: { color: T.inkSoft, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 24 },
  scroll: { flex: 1, marginBottom: 10 },

  // Toggle de canal (voix / texte) dans le header
  keyboardBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#F2ECE3", alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F2ECE3", alignItems: "center", justifyContent: "center" },

  // Assistant : barre de deux boutons
  assistBar: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 10 },
  assistBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFFFF", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: "#EEE6DA" },
  assistBtnText: { color: T.abricotDeep, fontSize: 13, fontWeight: "800" },
  // Assistant : fenêtres
  assistOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.7)", justifyContent: "center", padding: 24 },
  assistCard: { backgroundColor: T.cream, borderRadius: 22, padding: 20 },
  assistHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  assistTitle: { color: T.night, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  assistHint: { color: T.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 19, marginBottom: 14 },
  assistInput: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, fontSize: 15, color: T.night, minHeight: 70, maxHeight: 140, borderWidth: 1, borderColor: "#EEE6DA", textAlignVertical: "top" },
  assistAction: { backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  assistActionText: { color: T.night, fontSize: 15, fontWeight: "800" },
  assistResult: { backgroundColor: "#FFF3E9", borderRadius: 14, padding: 14, marginTop: 14, borderLeftWidth: 3, borderLeftColor: T.abricot },
  assistResultText: { color: T.night, fontSize: 16, fontWeight: "700", lineHeight: 23 },
  assistResultFr: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", fontStyle: "italic", lineHeight: 19, marginTop: 8 },
  assistResultActions: { flexDirection: "row", gap: 18, marginTop: 10 },
  assistListen: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  assistListenText: { color: T.inkSoft, fontSize: 12.5, fontWeight: "700" },

  sceneCard: { backgroundColor: "#FFFFFF", borderRadius: 18, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: T.abricot, overflow: "hidden" },
  sceneImgWrap: { height: 90, backgroundColor: T.creamLine },
  sceneTextInner: { padding: 14 },
  sceneK: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 4 },
  sceneText: { color: T.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 20 },
  scenePill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 14, paddingVertical: 7, paddingHorizontal: 10, marginBottom: 12, alignSelf: "flex-start", maxWidth: "80%" },
  scenePillImgWrap: { width: 26, height: 26, borderRadius: 8, overflow: "hidden", backgroundColor: T.creamLine },
  scenePillText: { color: T.inkSoft, fontSize: 12, fontWeight: "700", flexShrink: 1 },

  themBubble: { backgroundColor: T.night, borderRadius: 20, borderTopLeftRadius: 6, padding: 13, marginBottom: 10, marginRight: 38, alignItems: "flex-start" },
  themText: { color: "#F2ECE1", fontSize: 14, fontWeight: "600", lineHeight: 22 },
  tappableWord: { color: "#F2ECE1" },
  hardWord: { color: T.abricot, textDecorationLine: "underline", textDecorationStyle: "dotted", fontWeight: "700" },
  selectedWord: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 4 },
  translation: { color: "#CFC8BE", fontSize: 13, fontWeight: "600", fontStyle: "italic", lineHeight: 19, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)" },
  bubbleActions: { flexDirection: "row", gap: 16, marginTop: 8 },
  translateBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 4 },
  translateBtnText: { color: "#CFC8BE", fontSize: 12, fontWeight: "700" },

  meBubble: { backgroundColor: T.abricot, borderRadius: 20, borderTopRightRadius: 6, padding: 13, marginBottom: 8, marginLeft: 38 },
  meText: { color: T.night, fontSize: 14, fontWeight: "700", lineHeight: 21 },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingBottom: 24 },
  controlsSpacer: { width: 84 },
  endButton: { width: 84, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 11, alignItems: "center" },
  endButtonText: { color: T.inkSoft, fontSize: 12, fontWeight: "800" },
  micZone: { flex: 1, alignItems: "center" },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: "#E8734D" },
  micLabel: { color: T.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 9 },

  recCard: { backgroundColor: "#FFFFFF", borderRadius: 24, marginHorizontal: 20, marginBottom: 20, padding: 18, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 6 },
  waveformRow: { flexDirection: "row", alignItems: "center", gap: 3, height: 40, alignSelf: "stretch", justifyContent: "center" },
  waveBarLive: { width: 3, borderRadius: 1.5, backgroundColor: T.abricot },
  recRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch", marginTop: 14 },
  cancelBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#FBDAD3", alignItems: "center", justifyContent: "center" },
  recTime: { color: T.inkSoft, fontSize: 13, fontWeight: "700", width: 44, textAlign: "right" },
  recHint: { color: T.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 12 },
  limitButton: { flex: 1, backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", marginHorizontal: 20 },
  limitButtonText: { color: T.night, fontSize: 15, fontWeight: "800" },

  // Mode texte : barre de saisie
  textControls: { paddingBottom: 20 },
  endTextBtn: { alignSelf: "flex-end", backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  textInput: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: T.night, maxHeight: 120, borderWidth: 1, borderColor: "#EEE6DA" },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.4 },

  newSessionButton: { backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", marginBottom: 24 },
  newSessionText: { color: T.night, fontSize: 15, fontWeight: "800" },

  hintBanner: { position: "absolute", bottom: 120, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.miel, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16 },
  hintBannerText: { color: T.night, fontSize: 13, fontWeight: "800" },

  // Choix du canal
  choiceOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.75)", alignItems: "center", justifyContent: "center", padding: 32 },
  choiceCard: { backgroundColor: T.cream, borderRadius: 24, padding: 24, width: "100%" },
  choiceTitle: { color: T.night, fontSize: 20, fontWeight: "800", letterSpacing: -0.3, textAlign: "center" },
  choiceBody: { color: T.inkSoft, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center", marginTop: 8, marginBottom: 20 },
  choiceBtn: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#EEE6DA" },
  choiceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  choiceBtnTitle: { color: T.night, fontSize: 16, fontWeight: "800" },
  choiceBtnDesc: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600", lineHeight: 17, marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.6)", alignItems: "center", justifyContent: "center", padding: 40 },
  wordCard: { backgroundColor: T.cream, borderRadius: 20, padding: 22, width: "100%", alignItems: "center" },
  wordEn: { color: T.night, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  wordFr: { color: T.abricotDeep, fontSize: 18, fontWeight: "700", marginTop: 6 },
  wordFrMuted: { color: T.inkSoft, fontSize: 14, fontWeight: "600", marginTop: 6, textAlign: "center" },
  wordBtnRow: { flexDirection: "row", gap: 10, marginTop: 18, alignSelf: "stretch" },
  wordListenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#F0EAE0", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  wordListenText: { color: T.night, fontSize: 13.5, fontWeight: "800" },
  wordFavBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  wordFavText: { color: T.night, fontSize: 14, fontWeight: "800" },

  congratsOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.8)", alignItems: "center", justifyContent: "center", padding: 36 },
  congratsCard: { backgroundColor: T.cream, borderRadius: 24, padding: 26, width: "100%", alignItems: "center" },
  congratsIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: "#4CAF7D", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  congratsTitle: { color: T.night, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  congratsBody: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, textAlign: "center", marginTop: 10, marginBottom: 20 },
  congratsBtn: { backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", alignSelf: "stretch" },
  congratsBtnText: { color: T.night, fontSize: 15, fontWeight: "800" },
});
