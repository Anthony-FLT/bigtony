// Traduction du jour : l'utilisateur traduit un court texte, l'IA évalue (correction rouge/vert + modèle).
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { httpsCallable } from "firebase/functions";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { loadProfile } from "../lib/profile";
import { getTodayTranslation, assessTranslation, TranslationContent, TranslationResult } from "../lib/dailyTranslation";
import { markChallengeDone } from "../lib/dailyChallenges";
import { addFavorite } from "../lib/favorites";
import CorrectionCard, { Correction } from "../components/CorrectionCard";
import { SkeletonHeader, SkeletonCard, SkeletonLine, SkeletonBox } from "../components/Skeleton";
import BandeauTraduction from "../assets/hub/bandeau-traduction.svg";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type WordInfo = { word: string; fr: string; loading: boolean } | null;

// Estimation client (pas de donnée backend pour ça) : ~100 mots/min, minimum 1 min.
function estimateMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 100));
}

export default function TranslationScreen({ onBack }: { onBack: () => void }) {
  const [content, setContent] = useState<TranslationContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [level, setLevel] = useState("B1");
  const [attempt, setAttempt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wordInfo, setWordInfo] = useState<WordInfo>(null);
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [favFlash, setFavFlash] = useState(false);
  const wordPlayer = useAudioPlayer();

  useEffect(() => {
    loadProfile().then((p) => { if (p?.level) setLevel(p.level); });
    getTodayTranslation().then((c) => { setContent(c); setLoadingContent(false); });
  }, []);

  const toFrench = content?.direction === "en-to-fr";
  const dirLabel = toFrench ? "en français" : "en anglais";
  const sourceLabel = toFrench ? "ANGLAIS" : "FRANÇAIS";
  const destLabel = toFrench ? "FRANÇAIS" : "ANGLAIS";
  const wordCount = attempt.trim() ? attempt.trim().split(/\s+/).length : 0;

  const submit = async () => {
    if (!content || !attempt.trim() || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const r = await assessTranslation(content.source_text, content.direction, attempt.trim(), level);
      setResult(r);
      markChallengeDone("translation");
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSubmitting(false);
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
      const p = FileSystem.cacheDirectory + `transword_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(p, r.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
      wordPlayer.replace(p);
      wordPlayer.play();
    } catch (e) { console.warn("Lecture audio échouée:", e); }
  };

  // Ici, tous les mots sont tapables (pas de liste "mots difficiles" pour la traduction) —
  // seul le mot sélectionné se surligne le temps d'afficher sa traduction.
  const onWordTap = async (raw: string, key: string) => {
    const word = raw.replace(/[^A-Za-zÀ-ÿ'-]/g, "");
    if (!word) return;
    setSelectedWordKey(key);
    setWordInfo({ word, fr: "", loading: true });
    try {
      const res: any = await translateText({ text: word, mode: "word" });
      setWordInfo({ word, fr: res.data.translation || "", loading: false });
    } catch {
      setWordInfo({ word, fr: "", loading: false });
    }
  };

  const renderSource = (text: string) => {
    const tokens = text.split(/(\s+)/);
    return (
      <Text style={styles.sourceText}>
        {tokens.map((tok, i) => {
          if (/^\s+$/.test(tok)) return tok;
          const wordKey = `w-${i}`;
          const isSelected = selectedWordKey === wordKey;
          return (
            <Text key={i} onPress={() => onWordTap(tok, wordKey)} style={isSelected && styles.selectedWord}>
              {tok}
            </Text>
          );
        })}
      </Text>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={12}><Feather name="chevron-left" size={26} color={T.night} /></Pressable>
          <Text style={styles.headerTitle}>Traduction du jour</Text>
          {content ? (
            <View style={styles.durationPill}>
              <Feather name="clock" size={12} color={T.abricotDeep} />
              <Text style={styles.durationText}>{estimateMinutes(content.source_text)} min</Text>
            </View>
          ) : <View style={{ width: 26 }} />}
        </View>

        {favFlash && <Text style={styles.favFlash}>Ajouté à tes favoris</Text>}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {loadingContent ? (
            <View style={{ paddingTop: 14 }}>
              <SkeletonHeader message="Je prépare ta traduction…" />
              <SkeletonBox height={130} radius={20} style={{ marginBottom: 12 }} />
              <SkeletonCard style={{ borderLeftWidth: 3, borderLeftColor: T.abricot }}>
                <SkeletonLine width="28%" style={{ marginBottom: 12 }} />
                <SkeletonLine width="100%" />
                <SkeletonLine width="88%" style={{ marginBottom: 0 }} />
              </SkeletonCard>
              <SkeletonBox height={90} radius={16} />
            </View>
          ) : !content ? (
            <Text style={styles.error}>Impossible de charger l'exercice. Réessaie plus tard.</Text>
          ) : (
            <>
              <Text style={styles.instruction}>Traduis ce texte {dirLabel}, à ta façon.</Text>

              <View style={styles.contentCard}>
                <View style={styles.bannerInner}>
                  <BandeauTraduction width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
                </View>
                <View style={styles.sourceInner}>
                  <View style={styles.langPill}><Text style={styles.langPillText}>{sourceLabel}</Text></View>
                  {renderSource(content.source_text)}
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

              <View style={styles.inputCard}>
                <View style={[styles.langPill, styles.langPillDark]}><Text style={[styles.langPillText, styles.langPillTextDark]}>{destLabel}</Text></View>
                <TextInput
                  style={styles.input}
                  value={attempt}
                  onChangeText={setAttempt}
                  placeholder={`Écris ta traduction ${dirLabel}…`}
                  placeholderTextColor={T.inkSoft}
                  multiline
                  editable={!result}
                />
                <Text style={styles.wordCount}>{wordCount} mot{wordCount > 1 ? "s" : ""}</Text>
              </View>

              {error && <Text style={styles.error}>{error}</Text>}

              {!result ? (
                <Pressable
                  onPress={submit}
                  disabled={submitting || !attempt.trim()}
                  style={[styles.submitBtn, (submitting || !attempt.trim()) && { opacity: 0.4 }]}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={T.night} />
                  ) : (
                    <>
                      <Feather name="zap" size={16} color={T.night} />
                      <Text style={styles.submitText}>Vérifier ma traduction</Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <>
                  <CorrectionCard
                    correction={(result.correction as Correction) ?? { has_errors: false, original: [], corrected: [] }}
                    feedback={result.feedback_fr}
                  />
                  {result.model_translation ? (
                    <View style={styles.modelCard}>
                      <Text style={styles.modelK}>UNE BONNE TRADUCTION</Text>
                      <Text style={styles.modelText}>{result.model_translation}</Text>
                    </View>
                  ) : null}
                  <Pressable onPress={onBack} style={styles.doneBtn}>
                    <Text style={styles.doneText}>Terminer</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: T.night, letterSpacing: -0.3 },
  durationPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: T.chipAbricot, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 10 },
  durationText: { color: T.abricotDeep, fontSize: 12, fontWeight: "800" },
  favFlash: { color: "#3B9A6A", fontWeight: "700", textAlign: "center", paddingVertical: 6 },
  instruction: { color: T.inkSoft, fontSize: 14, fontWeight: "700", lineHeight: 20, marginTop: 8, marginBottom: 14, paddingHorizontal: 6 },
  error: { color: "#C0392B", fontWeight: "600", marginTop: 12, paddingHorizontal: 6 },

  contentCard: { backgroundColor: T.card, borderRadius: 20, overflow: "hidden", marginBottom: 12 },
  bannerInner: { height: 130, backgroundColor: T.creamLine },
  sourceInner: { padding: 18 },
  langPill: { alignSelf: "flex-start", backgroundColor: T.chipAbricot, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10, marginBottom: 10 },
  langPillText: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  langPillDark: { backgroundColor: T.night },
  langPillTextDark: { color: "#fff" },
  sourceText: { color: T.night, fontSize: 16, fontWeight: "700", lineHeight: 24 },
  selectedWord: { backgroundColor: T.chipAbricot, borderRadius: 4 },

  wordBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.card, borderRadius: 16, padding: 12, marginBottom: 12 },
  wordBarEn: { color: T.night, fontSize: 15.5, fontWeight: "800" },
  wordBarFr: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 2 },
  wordBarBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },

  inputCard: { backgroundColor: T.card, borderRadius: 18, padding: 16 },
  input: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, fontSize: 15, color: T.night, minHeight: 90, maxHeight: 200, borderWidth: 1, borderColor: "#EEE6DA", textAlignVertical: "top", marginTop: 4 },
  wordCount: { color: T.inkSoft, fontSize: 12, fontWeight: "700", marginTop: 8 },

  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, marginTop: 16 },
  submitText: { color: T.night, fontSize: 15, fontWeight: "800" },

  modelCard: { backgroundColor: T.miel, borderRadius: 16, padding: 16, marginTop: 4, marginBottom: 4 },
  modelK: { color: "#7A4A17", fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6 },
  modelText: { color: T.night, fontSize: 15.5, fontWeight: "700", lineHeight: 23 },

  doneBtn: { backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignItems: "center", marginTop: 16 },
  doneText: { color: T.night, fontSize: 15, fontWeight: "800" },
});
