// SpikeScreen.tsx — conversation voix OU texte : choix du canal, correction rouge/vert, favoris, plafond 1re séance.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useAudioRecorder,
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
import { loadProfile, markFirstSessionDone, markTranslateHintSeen, VoiceKey } from "./lib/profile";
import { Level } from "./lib/level";
import { addFavorite } from "./lib/favorites";
import { recordStumble } from "./lib/practiceWords";
import DebriefView from "./components/DebriefView";
import CorrectionCard, { Correction } from "./components/CorrectionCard";
import { StatusBar } from "expo-status-bar";

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

export default function SpikeScreen({ scenario, onExit, daily, welcome }: { scenario: Scenario; onExit: () => void; daily?: boolean; welcome?: boolean }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [opening, setOpening] = useState<Opening>(null);
  const [debrief, setDebrief] = useState<Debrief>(null);
  const [status, setStatus] = useState<"opening" | "idle" | "recording" | "processing" | "debriefing">("opening");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("B1");
  const [voiceKey, setVoiceKey] = useState<VoiceKey>("us-male");
  const [isFirstSession, setIsFirstSession] = useState(false);
  const [bubbleFr, setBubbleFr] = useState<Record<string, string>>({});
  const [bubbleLoading, setBubbleLoading] = useState<Record<string, boolean>>({});
  const [listenLoading, setListenLoading] = useState<Record<string, boolean>>({});
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);
  const [firstSessionCongrats, setFirstSessionCongrats] = useState(false);
  const [showTranslateHint, setShowTranslateHint] = useState(false);
  // Canal de conversation
  const [channel, setChannel] = useState<Channel>("voice");
  const [showChannelChoice, setShowChannelChoice] = useState(true);
  const [textInput, setTextInput] = useState("");
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
      if (p && !p.firstSessionDone) setIsFirstSession(true);
      if (p && !p.translateHintSeen) setShowTranslateHint(true);
    });
  }, []);

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
      const res: any = await translateText({ text, mode: "speak", voice: voiceKey });
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
      const res: any = await translateText({ text, mode: "speak", voice: voiceKey });
      if (res.data?.audioBase64) await playBase64(res.data.audioBase64);
    } catch (e) {
      console.warn("Lecture de la correction échouée:", e);
    }
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
          voice: p?.voice ?? "us-male",
        });
      } else if (daily) {
        const p = await loadProfile();
        res = await dailyOpening({
          level: p?.level ?? "B1",
          interests: p?.interests ?? [],
          goals: p?.goals ?? [],
          job: p?.job ?? null,
          voice: p?.voice ?? "us-male",
        });
      } else {
        res = await scenarioOpening({ scenarioId: scenario.id, level, customContext: scenario.custom ?? null, voice: voiceKey });
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
      setError(msg.includes("UNSAFE_CONTEXT") ? "Ce contexte n'est pas approprié pour une scène. Essaie autre chose." : (e.message ?? String(e)));
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
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setStatus("recording");
    } catch (e: any) { setError(e.message ?? String(e)); setStatus("idle"); }
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
        voice: voiceKey,
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
    } catch (e: any) { setError(e.message ?? String(e)); }
    finally { setStatus((s) => (s === "processing" ? "idle" : s)); }
  };

  const sendText = async () => {
    const text = textInput.trim();
    if (!text || status === "processing" || reachedLimit) return;
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
      setTextInput("");
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
    } catch (e: any) { setError(e.message ?? String(e)); }
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
    } catch (e: any) { setError(e.message ?? String(e)); }
    finally { setStatus("idle"); debriefingRef.current = false; }
  };

  const addWordToFav = async (w: HardWord) => {
    await addFavorite(w.word, w.fr, scenario.id);
    setWordPopup(null);
    setSelectedWordKey(null);
    setFavFlash(true);
    setTimeout(() => setFavFlash(false), 1400);
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
        {channel === "text" && (
          <Pressable onPress={() => playText(key, text)} style={styles.translateBtn} hitSlop={8}>
            {listenLoading[key] ? (
              <ActivityIndicator size="small" color="#CFC8BE" />
            ) : (
              <>
                <Feather name="volume-2" size={13} color="#CFC8BE" />
                <Text style={styles.translateBtnText}>Écouter</Text>
              </>
            )}
          </Pressable>
        )}
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
          <View style={styles.channelToggle}>
            <Pressable onPress={() => { if (status === "idle") setChannel("voice"); }} style={[styles.channelPill, channel === "voice" && styles.channelPillActive]}>
              <Feather name="mic" size={16} color={channel === "voice" ? T.night : T.inkSoft} />
            </Pressable>
            <Pressable onPress={() => { if (status === "idle") setChannel("text"); }} style={[styles.channelPill, channel === "text" && styles.channelPillActive]}>
              <Feather name="message-square" size={16} color={channel === "text" ? T.night : T.inkSoft} />
            </Pressable>
          </View>
        )}
        {turns.length > 0 && !debrief && (
          <Pressable onPress={runDebrief} disabled={status !== "idle"} hitSlop={10} style={styles.closeBtn}>
            <Feather name="x" size={20} color={T.inkSoft} />
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {favFlash && <Text style={styles.favFlash}>Ajouté à tes favoris</Text>}

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {status === "opening" && !showChannelChoice && <Text style={styles.openingWait}>La scène se prépare…</Text>}

        {opening && (
          <>
            <View style={styles.sceneCard}>
              <Text style={styles.sceneK}>LA SCÈNE</Text>
              <Text style={styles.sceneText}>{opening.context_fr}</Text>
            </View>
            {renderCoachBubble(opening.reply_en, opening.hardWords, "op")}
          </>
        )}

        {turns.map((t, i) => (
          <View key={i}>
            <View style={styles.meBubble}><Text style={styles.meText}>{t.user}</Text></View>

            <CorrectionCard
              correction={t.correction ?? { has_errors: false, original: [], corrected: [] }}
              feedback={t.feedback ?? ""}
              onPlayCorrected={t.correction?.has_errors ? () => playCorrected(t.correction!) : undefined}
            />

            {t.pronunciation && (() => {
              const score = Math.round(t.pronunciation.pronScore);
              const band =
                score >= 85 ? { label: "Prononciation claire", color: "#3B9A6A" }
                : score >= 70 ? { label: "Prononciation correcte", color: "#B8860B" }
                : { label: "Prononciation à travailler", color: "#C0392B" };
              return (
                <View style={styles.pronCard}>
                  <View style={styles.pronRow}>
                    <View style={[styles.pronDot, { backgroundColor: band.color }]} />
                    <Text style={[styles.pronLabel, { color: band.color }]}>{band.label}</Text>
                    <Text style={styles.pronScoreNum}>{score}/100</Text>
                  </View>
                  {t.misheard.map((m, k) => (
                    <View key={k} style={styles.mishRow}>
                      <Feather name="alert-triangle" size={13} color="#C0392B" />
                      <Text style={styles.mishText}>« {m.said} » sonne comme « {m.heard} »</Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            {renderCoachBubble(t.coach, t.hardWords, `t${i}`)}
          </View>
        ))}

        {debrief && <DebriefView debrief={debrief} />}
      </ScrollView>

      {(status === "processing" || status === "debriefing" || (status === "opening" && !showChannelChoice)) && (
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
          <View style={styles.controls}>
            <View style={styles.micZone}>
              <Pressable
                onPressIn={startRecording}
                onPressOut={stopAndSend}
                disabled={status !== "idle" && status !== "recording"}
                style={[styles.mic, status === "recording" && styles.micActive]}
              >
                <Feather name="mic" size={30} color="#fff" />
              </Pressable>
              <Text style={styles.micLabel}>
                {status === "recording" ? "Relâche pour envoyer" : "Maintiens pour parler"}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.textControls}>
            <View style={styles.inputRow}>
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
                <Pressable onPress={() => addWordToFav({ word: wordPopup!.word, fr: wordPopup!.fr })} style={styles.wordFavBtn}>
                  <Feather name="star" size={16} color={T.night} />
                  <Text style={styles.wordFavText}>Ajouter aux favoris</Text>
                </Pressable>
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
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#EAE6DE", overflow: "hidden", marginTop: 6 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: T.abricot },
  error: { color: "#C0392B", marginBottom: 8, fontWeight: "600" },
  hint: { color: "#B8860B", marginBottom: 8, fontWeight: "600" },
  favFlash: { color: "#3B9A6A", marginBottom: 8, fontWeight: "700" },
  openingWait: { color: T.inkSoft, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 24 },
  scroll: { flex: 1, marginBottom: 10 },

  // Toggle de canal (voix / texte) dans le header
  channelToggle: { flexDirection: "row", backgroundColor: "#F2ECE3", borderRadius: 10, padding: 2, gap: 2 },
  channelPill: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8 },
  channelPillActive: { backgroundColor: "#FFFFFF" },
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

  sceneCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 14, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: T.abricot },
  sceneK: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 4 },
  sceneText: { color: T.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 20 },

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

  pronCard: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 12, marginBottom: 10, marginRight: 38 },
  pronRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pronDot: { width: 9, height: 9, borderRadius: 5 },
  pronLabel: { fontSize: 13, fontWeight: "800" },
  pronScoreNum: { color: T.inkSoft, fontSize: 12, fontWeight: "700", marginLeft: "auto" },
  mishRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 7 },
  mishText: { color: "#C0392B", fontSize: 12.5, fontWeight: "700", flex: 1 },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingBottom: 24 },
  controlsSpacer: { width: 84 },
  endButton: { width: 84, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 11, alignItems: "center" },
  endButtonText: { color: T.inkSoft, fontSize: 12, fontWeight: "800" },
  micZone: { flex: 1, alignItems: "center" },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: "#E8734D" },
  micLabel: { color: T.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 9 },
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
  wordFavBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, marginTop: 18 },
  wordFavText: { color: T.night, fontSize: 14, fontWeight: "800" },

  congratsOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.8)", alignItems: "center", justifyContent: "center", padding: 36 },
  congratsCard: { backgroundColor: T.cream, borderRadius: 24, padding: 26, width: "100%", alignItems: "center" },
  congratsIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: "#4CAF7D", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  congratsTitle: { color: T.night, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  congratsBody: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, textAlign: "center", marginTop: 10, marginBottom: 20 },
  congratsBtn: { backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", alignSelf: "stretch" },
  congratsBtnText: { color: T.night, fontSize: 15, fontWeight: "800" },
});
