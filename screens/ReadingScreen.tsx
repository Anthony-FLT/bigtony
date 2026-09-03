// Lecture du jour : texte avec mots cliquables (traduction) + QCM de compréhension.
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { getTodayReading, ReadingContent, HardWord } from "../lib/dailyReading";
import { markChallengeDone } from "../lib/dailyChallenges";
import { addFavorite } from "../lib/favorites";
import { SkeletonHeader, SkeletonCard, SkeletonLine, SkeletonBox } from "../components/Skeleton";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type WordPopup = { word: string; fr: string; loading: boolean } | null;

export default function ReadingScreen({ onBack }: { onBack: () => void }) {
  const [content, setContent] = useState<ReadingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);

  useEffect(() => {
    getTodayReading().then((c) => { setContent(c); setLoading(false); });
  }, []);

  const allAnswered = content ? Object.keys(answers).length >= content.questions.length : false;
  const score = content ? content.questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0) : 0;

  const selectAnswer = (qi: number, oi: number) => {
    if (answers[qi] !== undefined) return;
    const next = { ...answers, [qi]: oi };
    setAnswers(next);
    if (content && Object.keys(next).length >= content.questions.length) {
      markChallengeDone("reading");
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
        <Text style={styles.headerTitle}>Lecture du jour</Text>
        <View style={{ width: 26 }} />
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
            <Text style={styles.hint}>Lis le texte, puis réponds aux questions. Touche un mot pour le traduire.</Text>

            <View style={styles.textCard}>
              {renderText(content.text, content.hard_words)}
            </View>

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
  hint: { color: T.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 8, marginBottom: 14, paddingHorizontal: 6 },
  error: { color: "#C0392B", fontWeight: "600", marginTop: 40, paddingHorizontal: 6, textAlign: "center" },

  textCard: { backgroundColor: T.card, borderRadius: 18, padding: 18, marginBottom: 22 },
  readText: { color: T.night, fontSize: 16.5, fontWeight: "600", lineHeight: 27 },
  word: { color: T.night },
  hardWord: { color: T.abricotDeep, textDecorationLine: "underline", textDecorationStyle: "dotted", fontWeight: "700" },
  selectedWord: { backgroundColor: T.chipAbricot, borderRadius: 4 },

  qHead: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginBottom: 10, marginHorizontal: 6 },
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
  favFlash: { color: "#3B9A6A", fontWeight: "700", textAlign: "center", paddingVertical: 6 },
});
