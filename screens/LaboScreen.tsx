import { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioRecorder, RecordingPresets, AudioModule, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { T } from "../lib/theme";
import { DRILLS, Drill, LabResult, assessDrill } from "../lib/labo";

const MIN_RECORDING_MS = 600;

// Couleur d'un score : rouge < 60, miel 60-79, menthe ≥ 80
function scoreColor(s: number) {
  if (s < 60) return T.corail;
  if (s < 80) return T.miel;
  return T.menthe;
}

export default function LaboScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [drill, setDrill] = useState<Drill>(DRILLS[0]);
  const [result, setResult] = useState<LabResult | null>(null);
  const [status, setStatus] = useState<"idle" | "recording" | "processing">("idle");
  const [error, setError] = useState<string | null>(null);
  const recordStartRef = useRef(0);

  const pickDrill = (d: Drill) => {
    setDrill(d);
    setResult(null);
    setError(null);
  };

  const startRecording = async () => {
    if (status !== "idle") return;
    setError(null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setStatus("recording");
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStatus("idle");
    }
  };

  const stopAndAssess = async () => {
    if (status !== "recording") return;
    setStatus("processing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - recordStartRef.current < MIN_RECORDING_MS) {
        setStatus("idle");
        return;
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("Aucun enregistrement");
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const r = await assessDrill(drill.text, audioBase64);
      setResult(r);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setStatus("idle");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.head}>
        <Text style={styles.h1}>Le labo</Text>
        <Text style={styles.sub}>Lis la phrase à voix haute. On note chaque son.</Text>
      </View>

      {/* Sélecteur de phrases */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ paddingHorizontal: 26, gap: 8 }}>
        {DRILLS.map((d) => (
          <Pressable key={d.id} onPress={() => pickDrill(d)} style={[styles.chip, drill.id === d.id && styles.chipActive]}>
            <Text style={[styles.chipText, drill.id === d.id && styles.chipTextActive]}>{d.id}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Carte phrase */}
      <View style={styles.drillCard}>
        <Text style={styles.drillFocus}>{drill.focus.toUpperCase()}</Text>
        {result ? (
          <Text style={styles.drillPhrase}>
            {result.words.map((w, i) => (
              <Text key={i} style={{ color: scoreColor(w.score) }}>
                {w.word}
                {i < result.words.length - 1 ? " " : ""}
              </Text>
            ))}
          </Text>
        ) : (
          <Text style={[styles.drillPhrase, { color: T.night }]}>{drill.text}</Text>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Détail par mot après évaluation */}
      {result && (
        <View style={styles.resultBlock}>
          <View style={styles.globalRow}>
            <Text style={styles.globalScore}>{Math.round(result.pronScore)}</Text>
            <Text style={styles.globalOutOf}>/100</Text>
            <Text style={styles.globalDetail}>
              précision {Math.round(result.accuracyScore)} · fluidité {Math.round(result.fluencyScore)}
            </Text>
          </View>

          {result.words
            .filter((w) => w.score < 80)
            .map((w, i) => (
              <View key={i} style={styles.wordCard}>
                <View style={styles.wordHeader}>
                  <Text style={styles.wordText}>{w.word}</Text>
                  <Text style={[styles.wordScore, { color: scoreColor(w.score) }]}>{w.score}</Text>
                </View>
                <View style={styles.phonemeRow}>
                  {w.phonemes.map((p, j) => (
                    <View key={j} style={[styles.phonemeChip, { backgroundColor: scoreColor(p.score) + "22" }]}>
                      <Text style={[styles.phonemeText, { color: scoreColor(p.score) }]}>{p.phoneme}</Text>
                      <Text style={[styles.phonemeScore, { color: scoreColor(p.score) }]}>{p.score}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          {result.words.every((w) => w.score >= 80) && (
            <Text style={styles.perfect}>Impeccable. Un Américain t'aurait compris sans effort.</Text>
          )}
        </View>
      )}

      {status === "processing" && <ActivityIndicator size="large" color={T.abricot} style={{ marginVertical: 16 }} />}

      {/* Micro */}
      <View style={styles.micZone}>
        <Pressable
          onPressIn={startRecording}
          onPressOut={stopAndAssess}
          disabled={status === "processing"}
          style={[styles.mic, status === "recording" && styles.micActive]}
        >
          <Feather name="mic" size={30} color={status === "recording" ? "#fff" : T.night} />
        </Pressable>
        <Text style={styles.micLabel}>
          {status === "recording" ? "Relâche quand tu as fini" : result ? "Réessaie" : "Maintiens et lis la phrase"}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 16 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 8 },
  chipsRow: { marginBottom: 16 },
  chip: { backgroundColor: T.card, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipActive: { backgroundColor: T.night },
  chipText: { color: T.inkSoft, fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  drillCard: { marginHorizontal: 26, backgroundColor: T.card, borderRadius: 22, padding: 22, alignItems: "center" },
  drillFocus: { color: T.abricotDeep, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 10 },
  drillPhrase: { fontSize: 22, fontWeight: "800", textAlign: "center", lineHeight: 30, letterSpacing: -0.3 },
  error: { color: T.corail, marginHorizontal: 26, marginTop: 12, fontWeight: "600" },
  resultBlock: { marginHorizontal: 26, marginTop: 16 },
  globalRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 14 },
  globalScore: { fontSize: 40, fontWeight: "800", color: T.night, letterSpacing: -1 },
  globalOutOf: { fontSize: 16, fontWeight: "700", color: T.inkSoft, marginLeft: 2 },
  globalDetail: { fontSize: 13, fontWeight: "600", color: T.inkSoft, marginLeft: 12 },
  wordCard: { backgroundColor: T.card, borderRadius: 16, padding: 14, marginBottom: 10 },
  wordHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  wordText: { fontSize: 17, fontWeight: "800", color: T.night },
  wordScore: { fontSize: 17, fontWeight: "800" },
  phonemeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  phonemeChip: { borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, alignItems: "center" },
  phonemeText: { fontSize: 14, fontWeight: "800" },
  phonemeScore: { fontSize: 10, fontWeight: "700", marginTop: 1 },
  perfect: { color: T.menthe, fontSize: 14, fontWeight: "700", textAlign: "center", marginTop: 4 },
  micZone: { alignItems: "center", marginTop: 24 },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: T.corail },
  micLabel: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 9 },
});