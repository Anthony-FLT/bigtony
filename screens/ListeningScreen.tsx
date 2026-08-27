// Écoute du jour : player animé (play/pause + progression), texte masqué par défaut, QCM, favoris sur les mots.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal, Animated, Vibration } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { loadProfile } from "../lib/profile";
import { getTodayListening, ListeningContent, HardWord } from "../lib/dailyListening";
import { markChallengeDone } from "../lib/dailyChallenges";
import { addFavorite } from "../lib/favorites";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type WordPopup = { word: string; fr: string; loading: boolean } | null;

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function tap() {
  try { Vibration.vibrate(10); } catch {}
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
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    (async () => {
      const p = await loadProfile();
      const voice = p?.voice ?? "us-male";
      const c = await getTodayListening();
      setContent(c);
      setLoading(false);
      if (c) {
        try {
          const res: any = await translateText({ text: c.text, mode: "speak", voice });
          const b64 = res.data?.audioBase64;
          if (b64) {
            const path = FileSystem.cacheDirectory + `listen_${Date.now()}.mp3`;
            await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
            player.replace(path);
            setAudioReady(true);
          }
        } catch (e) {
          console.warn("Synthèse audio échouée:", e);
        }
      }
      setAudioLoading(false);
    })();
  }, []);

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

  const allAnswered = content ? Object.keys(answers).length >= content.questions.length : false;
  const score = content ? content.questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0) : 0;

  const selectAnswer = (qi: number, oi: number) => {
    if (answers[qi] !== undefined) return;
    const next = { ...answers, [qi]: oi };
    setAnswers(next);
    if (content && Object.keys(next).length >= content.questions.length) {
      markChallengeDone("listening");
    }
  };

  const addWordToFav = async (word: string, fr: string) => {
    try { await addFavorite(word, fr); } catch (e) { console.warn("Favori échoué:", e); }
    setWordPopup(null);
    setSelectedWordKey(null);
    setFavFlash(true);
    setTimeout(() => setFavFlash(false), 1400);
  };

  const onWordTap = async (raw: string, knownFr: string, key: string) => {
    const word = raw.replace(/[^A-Za-z'-]/g, "");
    if (!word) return;
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
        <View style={{ width: 26 }} />
      </View>

      {favFlash && <Text style={styles.favFlash}>Ajouté à tes favoris</Text>}

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator color={T.abricot} style={{ marginTop: 40 }} />
        ) : !content ? (
          <Text style={styles.error}>Impossible de charger l'exercice. Réessaie plus tard.</Text>
        ) : (
          <>
            <Text style={styles.hint}>Écoute l'audio, puis réponds aux questions. Affiche le texte seulement si tu en as besoin.</Text>

            <View style={styles.player}>
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <Pressable onPress={togglePlay} disabled={!audioReady} style={[styles.playBtn, !audioReady && { opacity: 0.5 }]}>
                  {audioLoading ? (
                    <ActivityIndicator size="small" color={T.night} />
                  ) : (
                    <Feather name={status.playing ? "pause" : "play"} size={22} color={T.night} />
                  )}
                </Pressable>
              </Animated.View>
              <View style={{ flex: 1 }}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{fmt(status.currentTime || 0)}</Text>
                  <Text style={styles.timeText}>{audioLoading ? "…" : fmt(status.duration || 0)}</Text>
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

            <Text style={styles.qHead}>COMPRÉHENSION</Text>
            {content.questions.map((q, qi) => {
              const answered = answers[qi] !== undefined;
              return (
                <View key={qi} style={styles.qCard}>
                  <Text style={styles.qText}>{q.question}</Text>
                  {q.options.map((opt, oi) => {
                    const selected = answers[qi] === oi;
                    const isCorrect = oi === q.answer;
                    const showCorrect = answered && isCorrect;
                    const showWrong = answered && selected && !isCorrect;
                    return (
                      <Pressable
                        key={oi}
                        onPress={() => selectAnswer(qi, oi)}
                        disabled={answered}
                        style={[styles.opt, showCorrect && styles.optCorrect, showWrong && styles.optWrong]}
                      >
                        <Text style={[styles.optText, (showCorrect || showWrong) && styles.optTextStrong]}>{opt}</Text>
                        {showCorrect && <Feather name="check" size={16} color="#2E7D53" />}
                        {showWrong && <Feather name="x" size={16} color="#C0392B" />}
                      </Pressable>
                    );
                  })}
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

      <Modal visible={!!wordPopup} transparent animationType="fade" onRequestClose={() => setWordPopup(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => { setWordPopup(null); setSelectedWordKey(null); }}>
          <Pressable style={styles.wordCard} onPress={() => {}}>
            <Text style={styles.wordEn}>{wordPopup?.word}</Text>
            {wordPopup?.loading ? (
              <ActivityIndicator color={T.abricotDeep} style={{ marginTop: 10 }} />
            ) : wordPopup?.fr ? (
              <>
                <Text style={styles.wordFr}>{wordPopup.fr}</Text>
                <Pressable onPress={() => addWordToFav(wordPopup!.word, wordPopup!.fr)} style={styles.wordFavBtn}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: T.night, letterSpacing: -0.3 },
  favFlash: { color: "#3B9A6A", fontWeight: "700", textAlign: "center", paddingVertical: 6 },
  hint: { color: T.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 8, marginBottom: 16, paddingHorizontal: 6 },
  error: { color: "#C0392B", fontWeight: "600", marginTop: 40, paddingHorizontal: 6, textAlign: "center" },

  player: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: T.night, borderRadius: 20, padding: 18, marginBottom: 12 },
  playBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: T.abricot },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  timeText: { color: "#9DB0D4", fontSize: 11, fontWeight: "700" },

  revealBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, marginBottom: 10 },
  revealText: { color: T.abricotDeep, fontSize: 13.5, fontWeight: "800" },

  textCard: { backgroundColor: T.card, borderRadius: 18, padding: 18, marginBottom: 22 },
  readText: { color: T.night, fontSize: 16.5, fontWeight: "600", lineHeight: 27 },
  word: { color: T.night },
  hardWord: { color: T.abricotDeep, textDecorationLine: "underline", textDecorationStyle: "dotted", fontWeight: "700" },
  selectedWord: { backgroundColor: T.chipAbricot, borderRadius: 4 },

  qHead: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginBottom: 10, marginHorizontal: 6, marginTop: 8 },
  qCard: { backgroundColor: T.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  qText: { color: T.night, fontSize: 15.5, fontWeight: "800", lineHeight: 21, marginBottom: 12 },
  opt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: T.cream, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8, borderWidth: 1.5, borderColor: "transparent" },
  optCorrect: { backgroundColor: "#E6F4EC", borderColor: "#2E7D53" },
  optWrong: { backgroundColor: "#F8E6E2", borderColor: "#C0392B" },
  optText: { color: T.night, fontSize: 14.5, fontWeight: "600", flex: 1 },
  optTextStrong: { fontWeight: "800" },

  resultCard: { backgroundColor: T.night, borderRadius: 20, padding: 22, marginTop: 6, alignItems: "center" },
  resultScore: { color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -1 },
  resultMsg: { color: "#9DB0D4", fontSize: 14, fontWeight: "600", textAlign: "center", lineHeight: 20, marginTop: 8, marginBottom: 18 },
  doneBtn: { backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignItems: "center", alignSelf: "stretch" },
  doneText: { color: T.night, fontSize: 15, fontWeight: "800" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.6)", alignItems: "center", justifyContent: "center", padding: 40 },
  wordCard: { backgroundColor: T.cream, borderRadius: 20, padding: 22, width: "100%", alignItems: "center" },
  wordEn: { color: T.night, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  wordFr: { color: T.abricotDeep, fontSize: 18, fontWeight: "700", marginTop: 6 },
  wordFrMuted: { color: T.inkSoft, fontSize: 14, fontWeight: "600", marginTop: 6, textAlign: "center" },
  wordFavBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, marginTop: 18 },
  wordFavText: { color: T.night, fontSize: 14, fontWeight: "800" },
});
