// SpikeScreen.tsx — conversation : traduction à la demande, favoris, plafond 1re séance.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
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
import { loadProfile, markFirstSessionDone, markTranslateHintSeen } from "./lib/profile";
import { Level } from "./lib/level";
import { addFavorite } from "./lib/favorites";
import { recordStumble } from "./lib/practiceWords";
import DebriefView from "./components/DebriefView";

const spikeTurn = httpsCallable(functions, "spikeTurn", { timeout: 70000 });
const sessionDebrief = httpsCallable(functions, "sessionDebrief", { timeout: 70000 });
const scenarioOpening = httpsCallable(functions, "scenarioOpening", { timeout: 30000 });
const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });
const welcomeOpening = httpsCallable(functions, "welcomeOpening", { timeout: 30000 });

const WELCOME_TURN_CONTEXT = "You are simply a warm, friendly, encouraging English coach meeting the learner on their very first day — you are NOT a character in a scene and there is NO scenario or story. Just be yourself and put them at ease. Your only goal is to help them introduce themselves and talk about their life: ask ONE simple question at a time about who they are (what they do, where they live, what they like, their day). Warmly react to each answer with a short encouraging word, then ask the next easy question. Never make it complex or serious — keep it light, kind and reassuring.";
const MIN_RECORDING_MS = 800;
const FIRST_SESSION_LIMIT = 10;
const WELCOME_LIMIT = 5;

const dailyOpening = httpsCallable(functions, "dailyOpening", { timeout: 30000 });

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
  feedback: string;
  pronunciation: Pronunciation;
};

type Opening = { context_fr: string; reply_en: string; reply_fr: string; hardWords: HardWord[] } | null;
type Debrief = { points_forts: string[]; axe: string; message_fr: string } | null;
type WordPopup = { word: string; fr: string; loading: boolean } | null;

// Ne garde que les mots faibles réellement présents dans ce que l'utilisateur a dit
// (retire les artefacts mal entendus par l'ASR, ex. "future" quand on a dit "features").
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
  const [isFirstSession, setIsFirstSession] = useState(false);
  const [bubbleFr, setBubbleFr] = useState<Record<string, string>>({});
  const [bubbleLoading, setBubbleLoading] = useState<Record<string, boolean>>({});
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);
  const [firstSessionCongrats, setFirstSessionCongrats] = useState(false);
  const [showTranslateHint, setShowTranslateHint] = useState(false);
  const recordStartRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const debriefingRef = useRef(false);

  const sessionLimit = welcome ? WELCOME_LIMIT : FIRST_SESSION_LIMIT;
  const capped = isFirstSession || daily || welcome;
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

  const loadOpening = async () => {
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
        });
      } else if (daily) {
        const p = await loadProfile();
        res = await dailyOpening({
          level: p?.level ?? "B1",
          interests: p?.interests ?? [],
          goals: p?.goals ?? [],
          job: p?.job ?? null,
        });
      } else {
        res = await scenarioOpening({ scenarioId: scenario.id, level, customContext: scenario.custom ?? null });
      }
      setOpening({
        context_fr: res.data.context_fr,
        reply_en: res.data.reply_en,
        reply_fr: res.data.reply_fr ?? "",
        hardWords: res.data.hard_words ?? [],
      });
      await playBase64(res.data.replyAudioBase64);
    } catch (e: any) {
      const msg = String(e?.message || "");
      setError(msg.includes("UNSAFE_CONTEXT") ? "Ce contexte n'est pas approprié pour une scène. Essaie autre chose." : (e.message ?? String(e)));
    } finally {
      setStatus("idle");
    }
  };

  useEffect(() => { loadOpening(); }, []);

  const persistTurn = async (turn: Turn) => {
    try {
      let sid = sessionId;
    if (!sid) { sid = await startSession(daily ? "daily" : scenario.id, daily ? "daily" : "scenario"); setSessionId(sid); }
      const st: SessionTurn = {
        user: turn.user, coach: turn.coach, feedback: turn.feedback,
        pronunciation: turn.pronunciation, at: Date.now(),
      };
      await addTurn(sid, st);
    } catch (e) { console.warn("Persistance du tour échouée:", e); }
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
      });
      const d = res.data;
      await playBase64(d.replyAudioBase64);

      if (!d.transcript) { setHint(d.feedback_fr || "Je n'ai rien entendu — réessaie."); return; }

        const newTurn: Turn = {
        user: d.transcript,
        coach: d.reply_en,
        coachFr: d.reply_fr ?? "",
        hardWords: d.hard_words ?? [],
        misheard: d.misheard ?? [],
        feedback: d.feedback_fr,
        pronunciation: d.pronunciation ?? null,
      };
      const nextCount = turns.length + 1;
      setTurns((prev) => [...prev, newTurn]);
      // Alimente le Labo avec les mots écorchés de ce tour
      for (const m of newTurn.misheard) recordStumble(m.said, m.heard);
      persistTurn(newTurn);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

      if ((isFirstSession || welcome) && nextCount >= sessionLimit) {
        setStatus("idle");
        setTimeout(() => setFirstSessionCongrats(true), 800);
        return;
      }
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
          user: t.user, coach: t.coach, feedback: t.feedback, pronunciation: t.pronunciation, at: 0,
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} hitSlop={12}><Feather name="chevron-left" size={26} color="#9DB0D4" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{daily ? "Discussion du jour" : scenario.title}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${chatProgress}%` }]} />
          </View>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {favFlash && <Text style={styles.favFlash}>Ajouté à tes favoris</Text>}

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={{ paddingBottom: 12 }}>
        {status === "opening" && <Text style={styles.openingWait}>La scène se prépare…</Text>}

        {opening && (
          <>
            <View style={styles.sceneCard}>
              <Text style={styles.sceneK}>LA SCÈNE</Text>
              <Text style={styles.sceneText}>{opening.context_fr}</Text>
            </View>
            <View style={styles.themBubble}>
              {renderBubbleText(opening.reply_en, opening.hardWords, "op")}
              {bubbleFr["op"] ? <Text style={styles.translation}>{bubbleFr["op"]}</Text> : null}
              <Pressable onPress={() => toggleBubble("op", opening.reply_en)} style={styles.translateBtn} hitSlop={8}>
                {bubbleLoading["op"] ? (
                  <ActivityIndicator size="small" color="#8497BC" />
                ) : (
                  <>
                    <Feather name="globe" size={13} color="#8497BC" />
                    <Text style={styles.translateBtnText}>{bubbleFr["op"] ? "Masquer" : "Traduire"}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </>
        )}

        {turns.map((t, i) => (
          <View key={i}>
            <View style={styles.meBubble}><Text style={styles.meText}>{t.user}</Text></View>
            <View style={styles.fbCard}>
              <Text style={styles.fbK}>TON RETOUR</Text>
              <Text style={styles.fbText}>{t.feedback}</Text>
             {t.pronunciation && (() => {
                const score = Math.round(t.pronunciation.pronScore);
                const band =
                  score >= 85 ? { label: "Prononciation claire", color: T.menthe }
                  : score >= 70 ? { label: "Prononciation correcte", color: T.miel }
                  : { label: "Prononciation à travailler", color: T.corail };
                return (
                  <View style={styles.pronBlock}>
                    <View style={styles.pronRow}>
                      <View style={[styles.pronDot, { backgroundColor: band.color }]} />
                      <Text style={[styles.pronLabel, { color: band.color }]}>{band.label}</Text>
                      <Text style={styles.pronScoreNum}>{score}/100</Text>
                    </View>
                    {t.misheard.map((m, k) => (
                      <View key={k} style={styles.mishRow}>
                        <Feather name="alert-triangle" size={13} color={T.corail} />
                        <Text style={styles.mishText}>« {m.said} » sonne comme « {m.heard} »</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
            <View style={styles.themBubble}>
              {renderBubbleText(t.coach, t.hardWords, `t${i}`)}
              {bubbleFr[`t${i}`] ? <Text style={styles.translation}>{bubbleFr[`t${i}`]}</Text> : null}
              <Pressable onPress={() => toggleBubble(`t${i}`, t.coach)} style={styles.translateBtn} hitSlop={8}>
                {bubbleLoading[`t${i}`] ? (
                  <ActivityIndicator size="small" color="#8497BC" />
                ) : (
                  <>
                    <Feather name="globe" size={13} color="#8497BC" />
                    <Text style={styles.translateBtnText}>{bubbleFr[`t${i}`] ? "Masquer" : "Traduire"}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ))}

        {debrief && <DebriefView debrief={debrief} />}
        
      </ScrollView>

      {(status === "processing" || status === "debriefing" || status === "opening") && (
        <ActivityIndicator size="large" color={T.abricot} style={{ marginBottom: 8 }} />
      )}

      {!debrief ? (
        <View style={styles.controls}>
          {turns.length > 0 && !reachedLimit && (
            <Pressable onPress={runDebrief} disabled={status !== "idle"} style={styles.endButton}>
              <Text style={styles.endButtonText}>Terminer</Text>
            </Pressable>
          )}
          {reachedLimit ? (
            <Pressable onPress={() => setFirstSessionCongrats(true)} style={styles.limitButton}>
              <Text style={styles.limitButtonText}>Voir mon bilan</Text>
            </Pressable>
          ) : (
            <View style={styles.micZone}>
              <Pressable
                onPressIn={startRecording}
                onPressOut={stopAndSend}
                disabled={status !== "idle" && status !== "recording"}
                style={[styles.mic, status === "recording" && styles.micActive]}
              >
                <Feather name="mic" size={30} color={status === "recording" ? "#fff" : T.night} />
              </Pressable>
              <Text style={styles.micLabel}>
                {status === "recording" ? "Relâche pour envoyer" : "Maintiens pour parler"}
              </Text>
            </View>
          )}
          {turns.length > 0 && !reachedLimit && <View style={styles.controlsSpacer} />}
        </View>
      ) : (
        <Pressable onPress={onExit} style={styles.newSessionButton}>
          <Text style={styles.newSessionText}>Terminer</Text>
        </Pressable>
      )}

      {showTranslateHint && (opening || turns.length > 0) && (
        <View style={styles.hintBanner} pointerEvents="none">
          <Feather name="globe" size={16} color={T.night} />
          <Text style={styles.hintBannerText}>Touche un mot pour le traduire</Text>
        </View>
      )}

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
              Tu viens de faire tes premiers pas en anglais. Ça se fête! voyons ce que ça donne.
            </Text>
            <Pressable onPress={runDebrief} style={styles.congratsBtn}>
              <Text style={styles.congratsBtnText}>Voir mon bilan</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 34, backgroundColor: T.night },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#2E3E5C", overflow: "hidden", marginTop: 6 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: T.abricot },
  error: { color: T.corail, marginBottom: 8, fontWeight: "600" },
  hint: { color: T.miel, marginBottom: 8, fontWeight: "600" },
  favFlash: { color: T.menthe, marginBottom: 8, fontWeight: "700" },
  openingWait: { color: T.onNightSoft, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 24 },
  scroll: { flex: 1, marginBottom: 10 },

  sceneCard: { backgroundColor: T.night2, borderRadius: 18, padding: 14, marginBottom: 12 },
  sceneK: { color: T.abricot, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 4 },
  sceneText: { color: "#C5D0E6", fontSize: 13, fontWeight: "600", lineHeight: 20 },

  themBubble: { backgroundColor: T.night2, borderRadius: 20, borderTopLeftRadius: 6, padding: 13, marginBottom: 10, marginRight: 38, alignItems: "flex-start" },
  themText: { color: T.onNight, fontSize: 14, fontWeight: "600", lineHeight: 22 },
  tappableWord: { color: T.onNight },
  hardWord: { color: T.miel, textDecorationLine: "underline", textDecorationStyle: "dotted" },
  selectedWord: { backgroundColor: "#3A4A6B", borderRadius: 4 },
  translation: { color: "#9DB0D4", fontSize: 13, fontWeight: "600", fontStyle: "italic", lineHeight: 19, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#31415F" },
  translateBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start", paddingVertical: 4 },
  translateBtnText: { color: "#8497BC", fontSize: 12, fontWeight: "700" },

  meBubble: { backgroundColor: T.abricot, borderRadius: 20, borderTopRightRadius: 6, padding: 13, marginBottom: 8, marginLeft: 38 },
  meText: { color: T.night, fontSize: 14, fontWeight: "700", lineHeight: 21 },

  fbCard: { backgroundColor: T.night2, borderLeftWidth: 3, borderLeftColor: T.abricot, borderRadius: 16, padding: 12, marginBottom: 8, marginRight: 38 },
  fbK: { color: T.abricot, fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginBottom: 3 },
  fbText: { color: "#B9C4DC", fontSize: 13, fontWeight: "600", lineHeight: 19 },
  pronBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#31415F" },
  pronRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pronDot: { width: 9, height: 9, borderRadius: 5 },
  pronLabel: { fontSize: 13, fontWeight: "800" },
  pronScoreNum: { color: T.onNightSoft, fontSize: 12, fontWeight: "700", marginLeft: "auto" },
  pronWords: { color: "#B9C4DC", fontSize: 12, fontWeight: "600", marginTop: 6 },
  debriefCard: { backgroundColor: T.night2, borderRadius: 20, padding: 16, marginTop: 6, borderWidth: 1, borderColor: "#3A4A6B" },
  debriefTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 10 },
  debriefMsg: { color: T.onNight, fontSize: 14, fontWeight: "600", lineHeight: 21, marginBottom: 12 },
  strengthRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  strengthText: { color: T.menthe, fontSize: 13, fontWeight: "700", flex: 1 },
  axeBox: { backgroundColor: "#3A2E14", borderRadius: 12, padding: 12, marginTop: 8 },
  axeLabel: { color: T.miel, fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginBottom: 3 },
  axeText: { color: "#fff", fontSize: 13, fontWeight: "600", lineHeight: 19 },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingBottom: 24 },
  controlsSpacer: { width: 84 },
  endButton: { width: 84, backgroundColor: T.night2, borderRadius: 12, padding: 11, alignItems: "center" },
  endButtonText: { color: "#C5D0E6", fontSize: 12, fontWeight: "800" },
  micZone: { flex: 1, alignItems: "center" },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: T.corail },
  micLabel: { color: T.onNightSoft, fontSize: 12, fontWeight: "600", marginTop: 9 },
  limitButton: { flex: 1, backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", marginHorizontal: 20 },
  limitButtonText: { color: T.night, fontSize: 15, fontWeight: "800" },

  newSessionButton: { backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", marginBottom: 24 },
  newSessionText: { color: T.night, fontSize: 15, fontWeight: "800" },

  hintBanner: { position: "absolute", bottom: 120, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.miel, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16 },
  hintBannerText: { color: T.night, fontSize: 13, fontWeight: "800" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.6)", alignItems: "center", justifyContent: "center", padding: 40 },
  wordCard: { backgroundColor: T.cream, borderRadius: 20, padding: 22, width: "100%", alignItems: "center" },
  wordEn: { color: T.night, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  wordFr: { color: T.abricotDeep, fontSize: 18, fontWeight: "700", marginTop: 6 },
  wordFrMuted: { color: T.inkSoft, fontSize: 14, fontWeight: "600", marginTop: 6, textAlign: "center" },
  wordFavBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, marginTop: 18 },
  wordFavText: { color: T.night, fontSize: 14, fontWeight: "800" },

  congratsOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.8)", alignItems: "center", justifyContent: "center", padding: 36 },
  congratsCard: { backgroundColor: T.cream, borderRadius: 24, padding: 26, width: "100%", alignItems: "center" },
  congratsIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  congratsTitle: { color: T.night, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  congratsBody: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, textAlign: "center", marginTop: 10, marginBottom: 20 },
  congratsBtn: { backgroundColor: T.abricot, borderRadius: 16, padding: 16, alignItems: "center", alignSelf: "stretch" },
  congratsBtnText: { color: T.night, fontSize: 15, fontWeight: "800" },

  mishRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 7 },
  mishText: { color: "#E7A38C", fontSize: 12.5, fontWeight: "700", flex: 1 },
});