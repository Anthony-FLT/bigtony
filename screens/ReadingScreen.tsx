// Lecture du jour : texte avec mots cliquables (traduction inline) + QCM de compréhension.
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { httpsCallable } from "firebase/functions";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { getTodayReading, getTodayReadingAnswers, saveReadingAnswer, ReadingContent, HardWord } from "../lib/dailyReading";
import { markChallengeDone } from "../lib/dailyChallenges";
import { addFavorite } from "../lib/favorites";
import { SkeletonHeader, SkeletonCard, SkeletonLine, SkeletonBox } from "../components/Skeleton";
import BandeauLecture from "../assets/hub/bandeau-lecture.svg";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type WordInfo = { word: string; fr: string; loading: boolean } | null;

// Estimation client (pas de donnée backend pour ça) : ~100 mots/min pour un apprenant, arrondi, minimum 1 min.
function estimateMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 100));
}

export default function ReadingScreen({ onBack }: { onBack: () => void }) {
  const [content, setContent] = useState<ReadingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [wordInfo, setWordInfo] = useState<WordInfo>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);
  const player = useAudioPlayer();

  useEffect(() => {
    getTodayReading().then((c) => {
      setContent(c);
      setLoading(false);
      getTodayReadingAnswers().then((saved) => {
        // Les clés Firestore sont des chaînes ; on les remet en nombres pour matcher l'état local.
        const normalized: Record<number, number> = {};
        Object.entries(saved).forEach(([k, v]) => { normalized[Number(k)] = v as number; });
        if (Object.keys(normalized).length > 0) setAnswers(normalized);
      });
    });
  }, []);

  const allAnswered = content ? Object.keys(answers).length >= content.questions.length : false;
  const score = content ? content.questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0) : 0;

  const selectAnswer = (qi: number, oi: number) => {
    if (answers[qi] !== undefined) return;
    const next = { ...answers, [qi]: oi };
    setAnswers(next);
    saveReadingAnswer(qi, oi);
    if (content && Object.keys(next).length >= content.questions.length) {
      markChallengeDone("reading");
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
      const p = FileSystem.cacheDirectory + `read_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(p, r.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
      player.replace(p);
      player.play();
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
        <Text style={styles.headerTitle}>Lecture du jour</Text>
        {content ? (
          <View style={styles.durationPill}>
            <Feather name="clock" size={12} color={T.abricotDeep} />
            <Text style={styles.durationText}>{estimateMinutes(content.text)} min</Text>
          </View>
        ) : <View style={{ width: 26 }} />}
      </View>

      {favFlash && <Text style={styles.favFlash}>Ajouté à tes favoris</Text>}

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={{ paddingTop: 14 }}>
            <SkeletonHeader message="Je prépare ta lecture…" />
            <SkeletonCard>
              <SkeletonLine width="100%" />
              <SkeletonLine width="96%" />
              <SkeletonLine width="98%" />
              <SkeletonLine width="90%" />
              <SkeletonLine width="60%" style={{ marginBottom: 0 }} />
            </SkeletonCard>
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
            <Text style={styles.hint}>Touche un mot souligné pour le traduire.</Text>

            <View style={styles.contentCard}>
              <View style={styles.bannerInner}>
                <BandeauLecture width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
              </View>
              <View style={styles.textInner}>
                {renderText(content.text, content.hard_words)}
              </View>
            </View>

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
                    ? "Sans faute — belle compréhension !"
                    : score >= content.questions.length - 1
                    ? "Presque parfait, bien joué."
                    : "C'est en lisant chaque jour que ça rentre. Continue !"}
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
  hint: { color: T.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 8, marginBottom: 14, paddingHorizontal: 6 },
  error: { color: "#C0392B", fontWeight: "600", marginTop: 40, paddingHorizontal: 6, textAlign: "center" },

  contentCard: { backgroundColor: T.card, borderRadius: 20, overflow: "hidden", marginBottom: 12 },
  bannerInner: { height: 130, backgroundColor: T.creamLine },
  textInner: { padding: 18 },
  readText: { color: T.night, fontSize: 16.5, fontWeight: "600", lineHeight: 27 },
  word: { color: T.night },
  hardWord: { color: T.abricotDeep, fontWeight: "800" },
  selectedWord: { backgroundColor: T.chipAbricot, borderRadius: 4 },

  wordBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.card, borderRadius: 16, padding: 12, marginBottom: 22 },
  wordBarEn: { color: T.night, fontSize: 15.5, fontWeight: "800" },
  wordBarFr: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },
  wordBarBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },

  qHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginHorizontal: 6 },
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

  favFlash: { color: "#3B9A6A", fontWeight: "700", textAlign: "center", paddingVertical: 6 },
});
