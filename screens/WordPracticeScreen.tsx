import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioRecorder, useAudioPlayer, RecordingPresets, setAudioModeAsync, AudioModule } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { assessDrill, assessWordUsage, WordUsageResult } from "../lib/labo";
import { getWordCoaching, Coaching } from "../lib/wordCoaching";
import { setMastered } from "../lib/practiceWords";
import CorrectionCard, { Correction } from "../components/CorrectionCard";

const MIN_REC_MS = 400;
const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

const ARPA_IPA: Record<string, string> = { aa:"ɑː",ae:"æ",ah:"ʌ",ao:"ɔː",aw:"aʊ",ay:"aɪ",b:"b",ch:"tʃ",d:"d",dh:"ð",eh:"ɛ",er:"ɜːr",ey:"eɪ",f:"f",g:"ɡ",hh:"h",ih:"ɪ",iy:"iː",jh:"dʒ",k:"k",l:"l",m:"m",n:"n",ng:"ŋ",ow:"oʊ",oy:"ɔɪ",p:"p",r:"r",s:"s",sh:"ʃ",t:"t",th:"θ",uh:"ʊ",uw:"uː",v:"v",w:"w",y:"j",z:"z",zh:"ʒ" };
const toIPA = (ph: string) => ARPA_IPA[ph.toLowerCase().replace(/[0-9]/g, "")] || ph;

export default function WordPracticeScreen({ word, heardAs, onClose }: { word: string; heardAs?: string; onClose: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer();
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [step, setStep] = useState<"discover" | "use">("discover");
  const [status, setStatus] = useState<"idle" | "recording" | "processing">("idle");
  // Étape 1
  const [score, setScore] = useState<number | null>(null);
  const [phonemes, setPhonemes] = useState<{ phoneme: string; score: number }[]>([]);
  // Étape 2
  const [showStarter, setShowStarter] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [usage, setUsage] = useState<WordUsageResult | null>(null);
  const recStart = useRef(0);

  useEffect(() => { getWordCoaching(word).then(setCoaching); }, [word]);

  const playB64 = async (b64: string) => {
    try {
      const p = FileSystem.cacheDirectory + `word_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(p, b64, { encoding: FileSystem.EncodingType.Base64 });
      player.replace(p);
      player.play();
    } catch (e) { console.warn(e); }
  };
  const playModel = () => { if (coaching?.audioBase64) playB64(coaching.audioBase64); };
  const playSlow = async () => {
    try {
      const r: any = await translateText({ text: word, mode: "speak", speakingRate: 0.6 });
      if (r.data?.audioBase64) await playB64(r.data.audioBase64);
    } catch (e) { console.warn(e); }
  };
  const playExample = async () => {
    if (!coaching?.example_en) return;
    try {
      const r: any = await translateText({ text: coaching.example_en, mode: "speak" });
      if (r.data?.audioBase64) await playB64(r.data.audioBase64);
    } catch (e) { console.warn(e); }
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

      if (step === "discover") {
        const r = await assessDrill(word, b64);
        const s = Math.round(r.pronScore);
        setScore(s);
        setPhonemes(r.words?.[0]?.phonemes ?? []);
      } else {
        const u = await assessWordUsage(word, b64);
        setUsage(u);
        if (u.wordUsed && u.sentenceOk && (u.pronScore ?? 0) >= 75) setMastered(word, true);
      }
    } catch (e) { console.warn(e); }
    finally { setStatus("idle"); }
  };

  const col = (s: number) => (s < 60 ? T.corail : s < 80 ? T.miel : T.menthe);

  return (
    <View style={styles.container}>
      <Pressable onPress={onClose} hitSlop={12} style={styles.close}><Feather name="x" size={22} color={T.night} /></Pressable>

      <View style={styles.head}>
        <Text style={styles.k}>LABO</Text>
        <Text style={styles.h1}>{step === "discover" ? "Découvre le mot" : "À toi de l'utiliser"}</Text>
      </View>

      {/* Stepper */}
      <View style={styles.stepper}>
        <View style={styles.stepItem}>
          <View style={[styles.stepCircle, styles.stepOn]}>
            {step === "use" ? <Feather name="check" size={16} color="#fff" /> : <Text style={styles.stepNum}>1</Text>}
          </View>
          <Text style={styles.stepLabel}>Découvrir</Text>
        </View>
        <View style={styles.stepLine} />
        <View style={styles.stepItem}>
          <View style={[styles.stepCircle, step === "use" ? styles.stepOn : styles.stepOff]}>
            <Text style={[styles.stepNum, step !== "use" && styles.stepNumOff]}>2</Text>
          </View>
          <Text style={[styles.stepLabel, step !== "use" && styles.stepLabelOff]}>Utiliser</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 26, paddingBottom: 240 }} keyboardShouldPersistTaps="handled">
        {!coaching ? (
          <ActivityIndicator color={T.abricotDeep} style={{ marginTop: 40 }} />
        ) : step === "discover" ? (
          // ===================== ÉTAPE 1 — DÉCOUVRIR =====================
          <>
            <View style={styles.wordCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.word}>{word}</Text>
                <Text style={styles.ipaMeaning}>{coaching.ipa} · {coaching.meaning_fr}</Text>
              </View>
              <Pressable onPress={playModel} style={styles.listenBtn} hitSlop={8}>
                <Feather name="volume-2" size={20} color={T.night} />
              </Pressable>
            </View>

            <View style={styles.howCard}>
              <View style={styles.howHead}>
                <Feather name="headphones" size={16} color={T.abricot} />
                <Text style={styles.howTitle}>ÉCOUTE, PUIS ESSAIE</Text>
              </View>
              <Text style={styles.howText}>{coaching.how_to_fr}</Text>
              <View style={styles.trapRow}>
                <Text style={styles.trapText}>{coaching.trap_fr}</Text>
              </View>
            </View>

            <Pressable onPress={playSlow} style={styles.slowBtn}>
              <Feather name="volume-2" size={18} color={T.night} />
              <Text style={styles.slowText}>Écouter lentement</Text>
            </Pressable>

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
                  {score >= 85 ? "Excellent — passe à l'étape suivante."
                    : score >= 70 ? "Presque ! Réécoute le modèle et réessaie."
                    : "Reprends doucement en suivant le conseil ci-dessus."}
                </Text>
              </View>
            )}
          </>
        ) : (
          // ===================== ÉTAPE 2 — À TOI DE L'UTILISER =====================
          <>
            <View style={styles.wordCardSmall}>
              <Text style={styles.wordSmall}>{word}</Text>
              <Text style={styles.wordSmallSep}>|</Text>
              <Text style={styles.wordSmallFr}>{coaching.meaning_fr}</Text>
              <Pressable onPress={playModel} style={styles.listenBtnSmall} hitSlop={8}>
                <Feather name="volume-2" size={18} color={T.night} />
              </Pressable>
            </View>

            <View style={styles.sitCard}>
              {coaching.situation_title_fr ? (
                <View style={styles.sitHead}>
                  <Feather name="user" size={16} color={T.abricot} />
                  <Text style={styles.sitTitle}>{coaching.situation_title_fr.toUpperCase()}</Text>
                </View>
              ) : null}
              <Text style={styles.sitText}>{coaching.situation_fr ?? `Dis une phrase en anglais avec « ${word} ».`}</Text>
            </View>

            <Text style={styles.buildTitle}>Construis ta phrase</Text>
            <Text style={styles.buildHint}>Une phrase courte suffit.</Text>

            <Pressable style={styles.helpRow} onPress={() => setShowStarter((v) => !v)}>
              <Feather name="message-circle" size={18} color={T.night} />
              <Text style={styles.helpLabel}>Un début de phrase</Text>
              <Feather name={showStarter ? "chevron-up" : "chevron-down"} size={18} color={T.inkSoft} style={{ marginLeft: "auto" }} />
            </Pressable>
            {showStarter && coaching.starter_en ? (
              <View style={styles.helpBody}><Text style={styles.helpEn}>{coaching.starter_en}</Text></View>
            ) : null}

            <Pressable style={styles.helpRow} onPress={() => setShowExample((v) => !v)}>
              <Feather name="zap" size={18} color={T.night} />
              <Text style={styles.helpLabel}>Voir un exemple</Text>
              <Feather name={showExample ? "chevron-up" : "chevron-down"} size={18} color={T.inkSoft} style={{ marginLeft: "auto" }} />
            </Pressable>
            {showExample && coaching.example_en ? (
              <View style={styles.helpBody}>
                <View style={styles.exampleRow}>
                  <Text style={[styles.helpEn, { flex: 1 }]}>{coaching.example_en}</Text>
                  <Pressable onPress={playExample} hitSlop={8} style={styles.exampleListen}>
                    <Feather name="volume-2" size={16} color={T.night} />
                  </Pressable>
                </View>
                {coaching.example_fr ? <Text style={styles.exampleFr}>{coaching.example_fr}</Text> : null}
              </View>
            ) : null}

            {usage && (
              <View style={{ marginTop: 18 }}>
                {usage.pronScore !== null && (
                  <View style={styles.pronPill}>
                    <Feather name="mic" size={14} color={col(usage.pronScore)} />
                    <Text style={[styles.pronPillText, { color: col(usage.pronScore) }]}>Prononciation {usage.pronScore}%</Text>
                  </View>
                )}
                {!usage.wordUsed && (
                  <Text style={styles.warnText}>Tu n'as pas utilisé « {word} » dans ta phrase — réessaie.</Text>
                )}
                <CorrectionCard
                  correction={(usage.correction as Correction) ?? { has_errors: false, original: [], corrected: [] }}
                  feedback={usage.feedback_fr}
                />
                {usage.wordUsed && usage.sentenceOk && (
                  <Pressable onPress={onClose} style={styles.doneBtn}><Text style={styles.doneText}>Terminer</Text></Pressable>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Barre du bas : micro + navigation d'étape */}
      <View style={styles.bottomBar}>
        <View style={styles.micWrap}>
          <Pressable onPressIn={startRec} onPressOut={stopRec} disabled={status === "processing" || !coaching} style={[styles.mic, status === "recording" && styles.micActive]}>
            {status === "processing" ? <ActivityIndicator color="#fff" /> : <Feather name="mic" size={28} color={status === "recording" ? "#fff" : T.night} />}
          </Pressable>
          <Text style={styles.micLabel}>
            {status === "recording" ? "Relâche quand tu as fini" : step === "discover" ? "Maintiens et prononce" : "Maintiens pour répondre"}
          </Text>
        </View>

        {step === "discover" ? (
          <Pressable onPress={() => setStep("use")} disabled={!coaching} style={styles.nextBtn}>
            <Text style={styles.nextText}>Utiliser ce mot</Text>
            <Feather name="arrow-right" size={18} color={T.abricotDeep} />
          </Pressable>
        ) : (
          <Pressable onPress={onClose} hitSlop={8} style={{ paddingVertical: 8 }}>
            <Text style={styles.skip}>Passer ce mot</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  close: { position: "absolute", top: 52, right: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: T.card, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 60, paddingHorizontal: 26, paddingBottom: 6 },
  k: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  h1: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.6, marginTop: 4 },

  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingVertical: 14 },
  stepItem: { alignItems: "center", gap: 6 },
  stepCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stepOn: { backgroundColor: T.abricot },
  stepOff: { backgroundColor: "#E7DFD2" },
  stepNum: { color: "#fff", fontSize: 15, fontWeight: "800" },
  stepNumOff: { color: T.inkSoft },
  stepLabel: { fontSize: 12.5, fontWeight: "800", color: T.night },
  stepLabelOff: { color: T.inkSoft },
  stepLine: { flex: 1, height: 3, backgroundColor: T.abricot, marginHorizontal: 8, borderRadius: 2, maxWidth: 120, marginBottom: 22 },

  wordCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, marginTop: 6, gap: 12 },
  word: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.6 },
  ipaMeaning: { fontSize: 14, fontWeight: "700", color: T.inkSoft, marginTop: 4 },
  listenBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },

  howCard: { backgroundColor: T.night, borderRadius: 22, padding: 20, marginTop: 16 },
  howHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  howTitle: { color: T.abricot, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  howText: { color: "#EAF0FA", fontSize: 16, fontWeight: "600", lineHeight: 24 },
  trapRow: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12 },
  trapText: { color: "#C9D3E8", fontSize: 13.5, fontWeight: "700", lineHeight: 19 },

  slowBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 16, paddingVertical: 15, marginTop: 14 },
  slowText: { color: T.night, fontSize: 15, fontWeight: "800" },

  heard: { color: T.corail, fontSize: 13.5, fontWeight: "700", marginTop: 16 },

  resultCard: { backgroundColor: T.card, borderRadius: 22, padding: 20, marginTop: 18, alignItems: "center" },
  scorePct: { fontSize: 46, fontWeight: "800", letterSpacing: -1.5 },
  phRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, justifyContent: "center" },
  phChip: { backgroundColor: T.cream, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10 },
  phText: { fontSize: 16, fontWeight: "800" },
  verdict: { color: T.inkSoft, fontSize: 14, fontWeight: "700", textAlign: "center", lineHeight: 20, marginTop: 14 },

  // Étape 2
  wordCardSmall: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, marginTop: 6 },
  wordSmall: { fontSize: 22, fontWeight: "800", color: T.night },
  wordSmallSep: { fontSize: 18, color: T.creamLine, fontWeight: "700" },
  wordSmallFr: { fontSize: 15, fontWeight: "700", color: T.inkSoft, flex: 1 },
  listenBtnSmall: { width: 42, height: 42, borderRadius: 21, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },

  sitCard: { backgroundColor: T.night, borderRadius: 22, padding: 20, marginTop: 16 },
  sitHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sitTitle: { color: T.abricot, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  sitText: { color: "#EAF0FA", fontSize: 16.5, fontWeight: "700", lineHeight: 24 },

  buildTitle: { fontSize: 19, fontWeight: "800", color: T.night, marginTop: 20 },
  buildHint: { fontSize: 13.5, fontWeight: "600", color: T.inkSoft, marginTop: 2, marginBottom: 12 },

  helpRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, marginBottom: 10 },
  helpLabel: { fontSize: 15, fontWeight: "800", color: T.night },
  helpBody: { backgroundColor: T.card, borderRadius: 14, padding: 14, marginTop: -4, marginBottom: 10 },
  helpEn: { fontSize: 16, fontWeight: "700", color: T.night, lineHeight: 22 },
  exampleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  exampleListen: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  exampleFr: { fontSize: 13.5, fontWeight: "600", color: T.inkSoft, marginTop: 6 },

  pronPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: T.card, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 10 },
  pronPillText: { fontSize: 13, fontWeight: "800" },
  warnText: { color: T.corail, fontSize: 14, fontWeight: "700", marginBottom: 10 },
  doneBtn: { backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  doneText: { color: T.night, fontSize: 15, fontWeight: "800" },

  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", paddingBottom: 30, paddingTop: 10, backgroundColor: T.cream, paddingHorizontal: 26 },
  micWrap: { alignItems: "center" },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  micActive: { backgroundColor: T.corail },
  micLabel: { color: T.inkSoft, fontSize: 13, fontWeight: "700", marginTop: 9 },
  nextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: T.abricot, borderRadius: 16, paddingVertical: 15, alignSelf: "stretch", marginTop: 14 },
  nextText: { color: T.abricotDeep, fontSize: 15, fontWeight: "800" },
  skip: { color: T.inkSoft, fontSize: 14, fontWeight: "700", textDecorationLine: "underline", marginTop: 14 },
});
