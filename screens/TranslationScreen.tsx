// Traduction du jour : l'utilisateur traduit un court texte, l'IA évalue (correction rouge/vert + modèle).
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { loadProfile } from "../lib/profile";
import { getTodayTranslation, assessTranslation, TranslationContent, TranslationResult } from "../lib/dailyTranslation";
import { markChallengeDone } from "../lib/dailyChallenges";
import CorrectionCard, { Correction } from "../components/CorrectionCard";

export default function TranslationScreen({ onBack }: { onBack: () => void }) {
  const [content, setContent] = useState<TranslationContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [level, setLevel] = useState("B1");
  const [attempt, setAttempt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProfile().then((p) => { if (p?.level) setLevel(p.level); });
    getTodayTranslation().then((c) => { setContent(c); setLoadingContent(false); });
  }, []);

  const toFrench = content?.direction === "en-to-fr";
  const dirLabel = toFrench ? "en français" : "en anglais";
  const sourceLabel = toFrench ? "ANGLAIS" : "FRANÇAIS";

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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={12}><Feather name="chevron-left" size={26} color={T.night} /></Pressable>
          <Text style={styles.headerTitle}>Traduction du jour</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {loadingContent ? (
            <ActivityIndicator color={T.abricot} style={{ marginTop: 40 }} />
          ) : !content ? (
            <Text style={styles.error}>Impossible de charger l'exercice. Réessaie plus tard.</Text>
          ) : (
            <>
              <Text style={styles.instruction}>Traduis ce texte {dirLabel}, à ta façon.</Text>

              <View style={styles.sourceCard}>
                <Text style={styles.sourceK}>{sourceLabel}</Text>
                <Text style={styles.sourceText}>{content.source_text}</Text>
              </View>

              <TextInput
                style={styles.input}
                value={attempt}
                onChangeText={setAttempt}
                placeholder={`Écris ta traduction ${dirLabel}…`}
                placeholderTextColor={T.inkSoft}
                multiline
                editable={!result}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              {!result ? (
                <Pressable
                  onPress={submit}
                  disabled={submitting || !attempt.trim()}
                  style={[styles.submitBtn, (submitting || !attempt.trim()) && { opacity: 0.4 }]}
                >
                  {submitting ? <ActivityIndicator size="small" color={T.night} /> : <Text style={styles.submitText}>Vérifier</Text>}
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
  instruction: { color: T.inkSoft, fontSize: 14, fontWeight: "700", lineHeight: 20, marginTop: 8, marginBottom: 14, paddingHorizontal: 6 },

  sourceCard: { backgroundColor: T.card, borderRadius: 18, padding: 18, borderLeftWidth: 3, borderLeftColor: T.abricot, marginBottom: 16 },
  sourceK: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 6 },
  sourceText: { color: T.night, fontSize: 16, fontWeight: "700", lineHeight: 24 },

  input: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, fontSize: 15, color: T.night, minHeight: 90, maxHeight: 200, borderWidth: 1, borderColor: "#EEE6DA", textAlignVertical: "top" },
  error: { color: "#C0392B", fontWeight: "600", marginTop: 12, paddingHorizontal: 6 },

  submitBtn: { backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignItems: "center", marginTop: 16 },
  submitText: { color: T.night, fontSize: 15, fontWeight: "800" },

  modelCard: { backgroundColor: T.miel, borderRadius: 16, padding: 16, marginTop: 4, marginBottom: 4 },
  modelK: { color: "#7A4A17", fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6 },
  modelText: { color: T.night, fontSize: 15.5, fontWeight: "700", lineHeight: 23 },

  doneBtn: { backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignItems: "center", marginTop: 16 },
  doneText: { color: T.night, fontSize: 15, fontWeight: "800" },
});
