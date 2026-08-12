import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioRecorder, useAudioPlayer, RecordingPresets, setAudioModeAsync, AudioModule } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { T } from "../lib/theme";
import { assessDrill } from "../lib/labo";
import { getWordCoaching, Coaching } from "../lib/wordCoaching";
import { setMastered } from "../lib/practiceWords";

const MIN_REC_MS = 400;

const ARPA_IPA: Record<string, string> = { aa:"ɑː",ae:"æ",ah:"ʌ",ao:"ɔː",aw:"aʊ",ay:"aɪ",b:"b",ch:"tʃ",d:"d",dh:"ð",eh:"ɛ",er:"ɜːr",ey:"eɪ",f:"f",g:"ɡ",hh:"h",ih:"ɪ",iy:"iː",jh:"dʒ",k:"k",l:"l",m:"m",n:"n",ng:"ŋ",ow:"oʊ",oy:"ɔɪ",p:"p",r:"r",s:"s",sh:"ʃ",t:"t",th:"θ",uh:"ʊ",uw:"uː",v:"v",w:"w",y:"j",z:"z",zh:"ʒ" };
const toIPA = (ph: string) => ARPA_IPA[ph.toLowerCase().replace(/[0-9]/g, "")] || ph;

export default function WordPracticeScreen({ word, heardAs, onClose }: { word: string; heardAs?: string; onClose: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer();
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [status, setStatus] = useState<"idle" | "recording" | "processing">("idle");
  const [score, setScore] = useState<number | null>(null);
  const [phonemes, setPhonemes] = useState<{ phoneme: string; score: number }[]>([]);
  const recStart = useRef(0);

  useEffect(() => { getWordCoaching(word).then(setCoaching); }, [word]);

  const playModel = async () => {
    if (!coaching?.audioBase64) return;
    const p = FileSystem.cacheDirectory + `word_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(p, coaching.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
    player.replace(p);
    player.play();
  };

  const startRec = async () => {
    if (status !== "idle") return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recStart.current = Date.now();
      setStatus("recording");
    } catch (e) { console.warn(e); setStatus("idle"); }
  };

  const stopRec = async () => {
    if (status !== "recording") return;
    setStatus("processing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - recStart.current < MIN_REC_MS) { setStatus("idle"); return; }
      const uri = recorder.uri;
      if (!uri) throw new Error("no uri");
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const r = await assessDrill(word, b64);
      const s = Math.round(r.pronScore);
      setScore(s);
      setPhonemes(r.words?.[0]?.phonemes ?? []);
      if (s >= 85) setMastered(word, true);
    } catch (e) { console.warn(e); }
    finally { setStatus("idle"); }
  };

  const col = (s: number) => (s < 60 ? T.corail : s < 80 ? T.miel : T.menthe);

  return (
    <View style={styles.container}>
      <Pressable onPress={onClose} hitSlop={12} style={styles.close}><Feather name="x" size={22} color={T.night} /></Pressable>

      <ScrollView contentContainerStyle={{ padding: 26, paddingTop: 72, paddingBottom: 150 }}>
        <Text style={styles.k}>PRONONCER</Text>
        <View style={styles.wordRow}>
          <Text style={styles.word}>{word}</Text>
          <Pressable onPress={playModel} style={styles.listenBtn} hitSlop={8}>
            <Feather name="volume-2" size={20} color={T.night} />
          </Pressable>
        </View>
        {coaching ? <Text style={styles.ipa}>{coaching.ipa}</Text> : null}

        {!coaching ? (
          <ActivityIndicator color={T.abricotDeep} style={{ marginTop: 30 }} />
        ) : (
          <>
            <Text style={styles.meaning}>{coaching.meaning_fr}</Text>

            <View style={styles.howCard}>
              <Text style={styles.howTitle}>Comment le prononcer</Text>
              <Text style={styles.howText}>{coaching.how_to_fr}</Text>
              <View style={styles.trapRow}>
                <Feather name="alert-triangle" size={14} color={T.corail} />
                <Text style={styles.trapText}>{coaching.trap_fr}</Text>
              </View>
            </View>

            {heardAs ? <Text style={styles.heard}>La dernière fois, on a entendu « {heardAs} » à la place.</Text> : null}

            {score !== null && (
              <View style={styles.resultCard}>
                <Text style={[styles.scorePct, { color: col(score) }]}>{score}%</Text>
                {phonemes.length > 0 && (
                  <View style={styles.phRow}>
                    {phonemes.map((p, i) => (
                      <View key={i} style={styles.phChip}><Text style={[styles.phText, { color: col(p.score) }]}>/{toIPA(p.phoneme)}/</Text></View>
                    ))}
                  </View>
                )}
                <Text style={styles.verdict}>
                  {score >= 85 ? "Excellent — ce mot rejoint tes acquis."
                    : score >= 70 ? "Presque ! Réécoute le modèle et réessaie."
                    : "Reprends doucement en suivant le conseil ci-dessus."}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.micBar}>
        <Pressable onPressIn={startRec} onPressOut={stopRec} disabled={status === "processing" || !coaching} style={[styles.mic, status === "recording" && styles.micActive]}>
          {status === "processing" ? <ActivityIndicator color="#fff" /> : <Feather name="mic" size={28} color={status === "recording" ? "#fff" : T.night} />}
        </Pressable>
        <Text style={styles.micLabel}>{status === "recording" ? "Relâche quand tu as fini" : "Maintiens et prononce"}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  close: { position: "absolute", top: 52, right: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: T.card, alignItems: "center", justifyContent: "center" },
  k: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  wordRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8 },
  word: { fontSize: 38, fontWeight: "800", color: T.night, letterSpacing: -1 },
  listenBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  ipa: { fontSize: 20, fontWeight: "700", color: T.inkSoft, marginTop: 4 },
  meaning: { fontSize: 16, fontWeight: "700", color: T.night, marginTop: 14 },

  howCard: { backgroundColor: T.night, borderRadius: 22, padding: 20, marginTop: 20 },
  howTitle: { color: T.abricot, fontSize: 13, fontWeight: "800", letterSpacing: 0.5, marginBottom: 10 },
  howText: { color: "#EAF0FA", fontSize: 15, fontWeight: "600", lineHeight: 23 },
  trapRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 14, backgroundColor: "rgba(255,122,107,0.12)", borderRadius: 12, padding: 12 },
  trapText: { color: "#F1B0A2", fontSize: 13.5, fontWeight: "700", lineHeight: 19, flex: 1 },

  heard: { color: T.corail, fontSize: 13.5, fontWeight: "700", marginTop: 16 },

  resultCard: { backgroundColor: T.card, borderRadius: 22, padding: 20, marginTop: 20, alignItems: "center" },
  scorePct: { fontSize: 46, fontWeight: "800", letterSpacing: -1.5 },
  phRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, justifyContent: "center" },
  phChip: { backgroundColor: T.cream, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10 },
  phText: { fontSize: 16, fontWeight: "800" },
  verdict: { color: T.inkSoft, fontSize: 14, fontWeight: "700", textAlign: "center", lineHeight: 20, marginTop: 14 },

  micBar: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", paddingBottom: 34, paddingTop: 12, backgroundColor: T.cream },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: T.corail },
  micLabel: { color: T.inkSoft, fontSize: 13, fontWeight: "700", marginTop: 9 },
});