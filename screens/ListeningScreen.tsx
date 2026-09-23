// Écoute du jour : player animé (play/pause + progression), texte masqué par défaut, QCM, favoris sur les mots.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Animated, Vibration } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { loadProfile, saveSpeechRate } from "../lib/profile";
import { labelForRate, nextRate } from "../lib/speech";
import { getTodayListening, getTodayListeningAnswers, saveListeningAnswer, ListeningContent, HardWord } from "../lib/dailyListening";
import { markChallengeDone } from "../lib/dailyChallenges";
import { addFavorite } from "../lib/favorites";
import { SkeletonHeader, SkeletonCard, SkeletonLine, SkeletonBox } from "../components/Skeleton";
import BandeauEcoute from "../assets/hub/bandeau-ecoute.svg";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type WordInfo = { word: string; fr: string; loading: boolean } | null;

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function tap() {
  try { Vibration.vibrate(10); } catch {}
}

// Estimation avant que l'audio soit prêt (pas de donnée backend pour ça) ; remplacée par la vraie durée dès qu'elle est connue.
function estimateMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 100));
}

export default function ListeningScreen({ onBack }: { onBack: () => void }) {
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const [content, setContent] = useState<ListeningContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoading, setAudioLoading] = useState(true);
  const [showText, setShowText] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [wordInfo, setWordInfo] = useState<WordInfo>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);
  const [speechRate, setSpeechRate] = useState<number>(0.95);
  // Barres du waveform : hauteurs fixées une fois au montage (purement décoratif — ne reflète pas
  // la vraie amplitude du fichier audio, juste un effet visuel façon forme d'onde).
  const WAVE_BARS = 46;
  const waveHeights = useRef(Array.from({ length: WAVE_BARS }, () => 0.25 + Math.random() * 0.75)).current;
  const [waveWidth, setWaveWidth] = useState(0);
  const voiceRef = useRef<string>("us-male");
  const pulse = useRef(new Animated.Value(1)).current;
  const wordPlayer = useAudioPlayer();

  const synthAudio = async (text: string, voice: string, rate: number) => {
    setAudioLoading(true);
    setAudioReady(false);
    try {
      const res: any = await translateText({ text, mode: "speak", voice, speakingRate: rate });
      const b64 = res.data?.audioBase64;
      if (b64) {
        const path = FileSystem.cacheDirectory + `listen_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(path);
        setAudioReady(true);
      }
    } catch (e) {
      console.warn("Synthèse audio échouée:", e);
    } finally {
      setAudioLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const p = await loadProfile();
      const voice = p?.voice ?? "us-male";
      voiceRef.current = voice;
      const rate = p?.speechRate ?? 0.95;
      setSpeechRate(rate);
      const c = await getTodayListening();
      setContent(c);
      setLoading(false);
      if (c) await synthAudio(c.text, voice, rate);

      getTodayListeningAnswers().then((saved) => {
        const normalized: Record<number, number> = {};
        Object.entries(saved).forEach(([k, v]) => { normalized[Number(k)] = v as number; });
        if (Object.keys(normalized).length > 0) setAnswers(normalized);
      });
    })();
  }, []);

  // Accès rapide : change la vitesse, l'enregistre (global) et re-synthétise l'audio.
  const cycleRate = async () => {
    const r = nextRate(speechRate);
    setSpeechRate(r);
    await saveSpeechRate(r);
    if (content) synthAudio(content.text, voiceRef.current, r);
  };

  const rewind5 = () => {
    if (!audioReady) return;
    tap();
    player.seekTo(Math.max(0, (status.currentTime || 0) - 5));
  };

  const seekFromWaveform = (x: number) => {
    if (!audioReady || !status.duration || !waveWidth) return;
    const ratio = Math.max(0, Math.min(1, x / waveWidth));
    tap();
    player.seekTo(ratio * status.duration);
  };

  // Pulsation douce du bouton pendant la lecture.
  useEffect(() => {
    if (status.playing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.1, duration: 550, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); pulse.setValue(1); };
    }
  }, [status.playing]);

  const togglePlay = () => {
    if (!audioReady) return;
    tap();
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const headerMinutes = status.duration > 0 ? Math.max(1, Math.round(status.duration / 60)) : (content ? estimateMinutes(content.text) : null);

  const allAnswered = content ? Object.keys(answers).length >= content.questions.length : false;
  const score = content ? content.questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0) : 0;

  const selectAnswer = (qi: number, oi: number) => {
    if (answers[qi] !== undefined) return;
    const next = { ...answers, [qi]: oi };
    setAnswers(next);
    saveListeningAnswer(qi, oi);
    if (content && Object.keys(next).length >= content.questions.length) {
      markChallengeDone("listening");
    }
  };

  const addWordToFav = async () => {
    if (!wordInfo?.fr) return;
    try { await addFavorite(wordInfo.word, wordInfo.fr); } catch (e) { console.warn("Favori échoué:", e); }
    setFavFlash(true);
    setTimeout(() => setFavFlash(false), 1400);
  };

  const playWord = async () => {
    if (!wordInfo?.word) return;
    try {
      const r: any = await translateText({ text: wordInfo.word, mode: "speak" });
      if (!r.data?.audioBase64) return;
      const p = FileSystem.cacheDirectory + `listenword_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(p, r.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
      wordPlayer.replace(p);
      wordPlayer.play();
    } catch (e) { console.warn("Lecture audio échouée:", e); }
  };

  const onWordTap = async (raw: string, knownFr: string, key: string) => {
    const word = raw.replace(/[^A-Za-z'-]/g, "");
    if (!word) return;
    setSelectedWordKey(key);
    if (knownFr) { setWordInfo({ word, fr: knownFr, loading: false }); return; }
    setWordInfo({ word, fr: "", loading: true });
    try {
      const res: any = await translateText({ text: word, mode: "word" });
      setWordInfo({ word, fr: res.data.translation || "", loading: false });
    } catch {
      setWordInfo({ word, fr: "", loading: false });
    }
  };

  const renderText = (text: string, hardWords: HardWord[]) => {
    const hardMap: Record<string, string> = {};
    hardWords.forEach((h) => { hardMap[h.word.toLowerCase().replace(/[^a-z]/g, "")] = h.fr; });
    const tokens = text.split(/(\s+)/);
    return (
      <Text style={styles.readText}>
        {tokens.map((tok, i) => {
          if (/^\s+$/.test(tok)) return tok;
          const clean = tok.toLowerCase().replace(/[^a-z]/g, "");
          const isHard = clean in hardMap;
          const wordKey = `w-${i}`;
          const isSelected = selectedWordKey === wordKey;
          return (
            <Text
              key={i}
              onPress={() => onWordTap(tok, hardMap[clean] ?? "", wordKey)}
              style={[isHard ? styles.hardWord : styles.word, isSelected && styles.selectedWord]}
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
        <Pressable onPress={onBack} hitSlop={12}><Feather name="chevron-left" size={26} color={T.night} /></Pressable>
        <Text style={styles.headerTitle}>Écoute du jour</Text>
        {headerMinutes !== null ? (
          <View style={styles.durationPill}>
            <Feather name="clock" size={12} color={T.abricotDeep} />
            <Text style={styles.durationText}>{headerMinutes} min</Text>
          </View>
        ) : <View style={{ width: 26 }} />}
      </View>

      {favFlash && <Text style={styles.favFlash}>Ajouté à tes favoris</Text>}

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={{ paddingTop: 14 }}>
            <SkeletonHeader message="Je prépare ton écoute…" />
            <SkeletonBox height={130} radius={20} style={{ marginBottom: 12 }} />
            <SkeletonBox height={90} radius={20} style={{ marginBottom: 16 }} />
            <SkeletonBox width={140} height={12} radius={6} style={{ marginLeft: 6, marginBottom: 12 }} />
            {[0, 1].map((i) => (
              <SkeletonCard key={i}>
                <SkeletonLine width="80%" style={{ marginBottom: 14 }} />
                <SkeletonBox height={42} radius={12} style={{ marginBottom: 8 }} />
                <SkeletonBox height={42} radius={12} style={{ marginBottom: 8 }} />
                <SkeletonBox height={42} radius={12} style={{ marginBottom: 0 }} />
              </SkeletonCard>
            ))}
          </View>
        ) : !content ? (
          <Text style={styles.error}>Impossible de charger l'exercice. Réessaie plus tard.</Text>
        ) : (
          <>
            <View style={styles.playerCard}>
              <View style={styles.bannerInner}>
                <BandeauEcoute width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
              </View>

              <View style={styles.playerInner}>
              <Pressable
                onLayout={(e) => setWaveWidth(e.nativeEvent.layout.width)}
                onPress={(e) => seekFromWaveform(e.nativeEvent.locationX)}
                style={styles.waveform}
              >
                {waveHeights.map((h, i) => {
                  const played = i / WAVE_BARS <= progress;
                  return <View key={i} style={[styles.waveBar, { height: 5 + h * 22, backgroundColor: played ? T.abricot : "rgba(157,176,212,0.32)" }]} />;
                })}
              </Pressable>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{fmt(status.currentTime || 0)}</Text>
                <Text style={styles.timeText}>{audioLoading ? "…" : fmt(status.duration || 0)}</Text>
              </View>

              <View style={styles.playerControls}>
                <Pressable onPress={rewind5} disabled={!audioReady} style={[styles.rewindBtn, !audioReady && { opacity: 0.5 }]}>
                  <Feather name="rotate-ccw" size={16} color="#fff" />
                  <Text style={styles.rewindText}>5s</Text>
                </Pressable>

                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  <Pressable onPress={togglePlay} disabled={!audioReady} style={[styles.playBtn, !audioReady && { opacity: 0.5 }]}>
                    {audioLoading ? (
                      <ActivityIndicator size="small" color={T.night} />
                    ) : (
                      <Feather name={status.playing ? "pause" : "play"} size={22} color={T.night} />
                    )}
                  </Pressable>
                </Animated.View>

                <Pressable onPress={cycleRate} hitSlop={8} style={styles.speedPill}>
                  <Text style={styles.speedPillText}>{labelForRate(speechRate)}</Text>
                </Pressable>
              </View>
              </View>
            </View>

            <Pressable onPress={() => setShowText((v) => !v)} style={styles.revealBtn}>
              <Feather name={showText ? "eye-off" : "eye"} size={16} color={T.abricotDeep} />
              <Text style={styles.revealText}>{showText ? "Masquer le texte" : "Afficher le texte"}</Text>
            </Pressable>

            {showText && (
              <View style={styles.textCard}>
                {renderText(content.text, content.hard_words)}
              </View>
            )}

            {wordInfo && (
              <View style={styles.wordBar}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wordBarEn}>{wordInfo.word}</Text>
                  {wordInfo.loading ? (
                    <ActivityIndicator color={T.abricotDeep} style={{ alignSelf: "flex-start", marginTop: 4 }} />
                  ) : (
                    <Text style={styles.wordBarFr}>{wordInfo.fr || "Traduction indisponible"}</Text>
                  )}
                </View>
                <Pressable onPress={playWord} style={styles.wordBarBtn} hitSlop={6}>
                  <Feather name="volume-2" size={17} color={T.night} />
                </Pressable>
                <Pressable onPress={addWordToFav} style={[styles.wordBarBtn, { backgroundColor: T.chipAbricot }]} hitSlop={6}>
                  <Feather name="star" size={17} color={T.abricotDeep} />
                </Pressable>
              </View>
            )}

            <View style={styles.qHeadRow}>
              <Text style={styles.qHead}>COMPRÉHENSION</Text>
              <View style={styles.qDots}>
                {content.questions.map((_, i) => (
                  <View key={i} style={[styles.qDot, answers[i] !== undefined && styles.qDotOn]} />
                ))}
              </View>
            </View>

            {content.questions.map((q, qi) => {
              const answered = answers[qi] !== undefined;
              const pickedCorrect = answered && answers[qi] === q.answer;
              return (
                <View key={qi} style={styles.qCard}>
                  <Text style={styles.qOverline}>QUESTION {qi + 1}</Text>
                  <Text style={styles.qText}>{q.question}</Text>
                  {q.options.map((opt, oi) => {
                    const selected = answers[qi] === oi;
                    const isCorrect = oi === q.answer;
                    const showCorrect = answered && isCorrect;
                    const showWrong = answered && selected && !isCorrect;
                    const letter = String.fromCharCode(65 + oi);
                    return (
                      <Pressable
                        key={oi}
                        onPress={() => selectAnswer(qi, oi)}
                        disabled={answered}
                        style={[styles.opt, showCorrect && styles.optCorrect, showWrong && styles.optWrong]}
                      >
                        <View style={[styles.optLetter, showCorrect && styles.optLetterCorrect, showWrong && styles.optLetterWrong]}>
                          <Text style={[styles.optLetterText, (showCorrect || showWrong) && { color: "#fff" }]}>{letter}</Text>
                        </View>
                        <Text style={[styles.optText, (showCorrect || showWrong) && styles.optTextStrong]}>{opt}</Text>
                        {showCorrect && <Feather name="check" size={16} color="#2E7D53" />}
                        {showWrong && <Feather name="x" size={16} color="#C0392B" />}
                      </Pressable>
                    );
                  })}
                  {answered && (
                    <Text style={[styles.qNote, pickedCorrect ? styles.qNoteGood : styles.qNoteBad]}>
                      {pickedCorrect ? "✓ Bonne réponse !" : "✗ Pas tout à fait — la bonne réponse est surlignée."}
                    </Text>
                  )}
                </View>
              );
            })}

            {allAnswered && (
              <View style={styles.resultCard}>
                <Text style={styles.resultScore}>{score} / {content.questions.length}</Text>
                <Text style={styles.resultMsg}>
                  {score === content.questions.length
                    ? "Sans faute — ton oreille progresse !"
                    : score >= content.questions.length - 1
                    ? "Presque parfait, bien joué."
                    : "L'oreille se muscle à l'écoute. Reviens demain !"}
                </Text>
                <Pressable onPress={onBack} style={styles.doneBtn}>
                  <Text style={styles.doneText}>Terminer</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: T.night, letterSpacing: -0.3 },
  durationPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: T.chipAbricot, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 10 },
  durationText: { color: T.abricotDeep, fontSize: 12, fontWeight: "800" },
  favFlash: { color: "#3B9A6A", fontWeight: "700", textAlign: "center", paddingVertical: 6 },
  error: { color: "#C0392B", fontWeight: "600", marginTop: 40, paddingHorizontal: 6, textAlign: "center" },

  playerCard: { backgroundColor: T.night, borderRadius: 20, overflow: "hidden", marginTop: 12, marginBottom: 12 },
  bannerInner: { height: 130, backgroundColor: T.creamLine },
  playerInner: { padding: 18 },
  waveform: { flexDirection: "row", alignItems: "center", gap: 2.5, height: 32 },
  waveBar: { flex: 1, borderRadius: 2, minHeight: 3 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  timeText: { color: "#9DB0D4", fontSize: 11, fontWeight: "700" },

  playerControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 },
  rewindBtn: { alignItems: "center", justifyContent: "center", gap: 2, width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.1)" },
  rewindText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  playBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  speedPill: { backgroundColor: "#FFFFFF", borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, minWidth: 50, alignItems: "center" },
  speedPillText: { color: T.night, fontSize: 13, fontWeight: "800" },

  revealBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, marginBottom: 8 },
  revealText: { color: T.abricotDeep, fontSize: 13.5, fontWeight: "800" },

  textCard: { backgroundColor: T.card, borderRadius: 18, padding: 18, marginBottom: 12 },
  readText: { color: T.night, fontSize: 16.5, fontWeight: "600", lineHeight: 27 },
  word: { color: T.night },
  hardWord: { color: T.abricotDeep, fontWeight: "800" },
  selectedWord: { backgroundColor: T.chipAbricot, borderRadius: 4 },

  wordBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.card, borderRadius: 16, padding: 12, marginBottom: 16 },
  wordBarEn: { color: T.night, fontSize: 15.5, fontWeight: "800" },
  wordBarFr: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },
  wordBarBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },

  qHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginHorizontal: 6, marginTop: 8 },
  qHead: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  qDots: { flexDirection: "row", gap: 5 },
  qDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: T.creamLine },
  qDotOn: { backgroundColor: T.abricot },

  qCard: { backgroundColor: T.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  qOverline: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginBottom: 4 },
  qText: { color: T.night, fontSize: 15.5, fontWeight: "800", lineHeight: 21, marginBottom: 12 },
  opt: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.cream, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1.5, borderColor: "transparent" },
  optCorrect: { backgroundColor: "#E6F4EC", borderColor: "#2E7D53" },
  optWrong: { backgroundColor: "#F8E6E2", borderColor: "#C0392B" },
  optLetter: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  optLetterCorrect: { backgroundColor: "#2E7D53" },
  optLetterWrong: { backgroundColor: "#C0392B" },
  optLetterText: { color: T.inkSoft, fontSize: 12.5, fontWeight: "800" },
  optText: { color: T.night, fontSize: 14.5, fontWeight: "600", flex: 1 },
  optTextStrong: { fontWeight: "800" },
  qNote: { fontSize: 13, fontWeight: "700", marginTop: 2 },
  qNoteGood: { color: "#2E7D53" },
  qNoteBad: { color: "#C0392B" },

  resultCard: { backgroundColor: T.night, borderRadius: 20, padding: 22, marginTop: 6, alignItems: "center" },
  resultScore: { color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -1 },
  resultMsg: { color: "#9DB0D4", fontSize: 14, fontWeight: "600", textAlign: "center", lineHeight: 20, marginTop: 8, marginBottom: 18 },
  doneBtn: { backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignItems: "center", alignSelf: "stretch" },
  doneText: { color: T.night, fontSize: 15, fontWeight: "800" },
});
