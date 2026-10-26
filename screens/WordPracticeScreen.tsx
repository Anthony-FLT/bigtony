// WordPracticeScreen — exercice d'un mot du Labo (maquettes du 26/10) : 1 · Prononcer (écoute, ralenti, astuce, conseils,
// enregistrement → résultat) puis 2 · En contexte (mise en situation, indice, exemple, phrase → « Bien utilisé ! »).
// Logique inchangée : getWordCoaching, assessDrill (Azure, scripté), assessWordUsage, setMastered. Enregistrement : un tap pour
// commencer, un tap pour terminer.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAudioRecorder, useAudioPlayer, RecordingPresets, setAudioModeAsync, AudioModule } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { L, Icon, RoundButton } from "../components/lessonUi";
import { assessDrill, assessWordUsage, WordUsageResult } from "../lib/labo";
import { getWordCoaching, Coaching } from "../lib/wordCoaching";
import { setMastered } from "../lib/practiceWords";
import CorrectionCard, { Correction } from "../components/CorrectionCard";

const MIN_REC_MS = 400;
const PRON_OK = 75; // seuil de validation de la prononciation
const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

const ARPA_IPA: Record<string, string> = { aa:"ɑː",ae:"æ",ah:"ʌ",ao:"ɔː",aw:"aʊ",ay:"aɪ",b:"b",ch:"tʃ",d:"d",dh:"ð",eh:"ɛ",er:"ɜːr",ey:"eɪ",f:"f",g:"ɡ",hh:"h",ih:"ɪ",iy:"iː",jh:"dʒ",k:"k",l:"l",m:"m",n:"n",ng:"ŋ",ow:"oʊ",oy:"ɔɪ",p:"p",r:"r",s:"s",sh:"ʃ",t:"t",th:"θ",uh:"ʊ",uw:"uː",v:"v",w:"w",y:"j",z:"z",zh:"ʒ" };
const toIPA = (ph: string) => ARPA_IPA[ph.toLowerCase().replace(/[0-9]/g, "")] || ph;

// Met en évidence le mot dans la phrase de l'apprenant
function Highlighted({ text, word, style }: { text: string; word: string; style: any }) {
  const idx = text.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return <Text style={style}>{text}</Text>;
  return <Text style={style}>{text.slice(0, idx)}<Text style={{ color: L.accentDeep }}>{text.slice(idx, idx + word.length)}</Text>{text.slice(idx + word.length)}</Text>;
}

export default function WordPracticeScreen({ word, heardAs, onClose }: { word: string; heardAs?: string; onClose: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer();
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [step, setStep] = useState<"pronounce" | "context">("pronounce");
  const [status, setStatus] = useState<"idle" | "recording" | "processing">("idle");
  // Étape 1
  const [score, setScore] = useState<number | null>(null);
  const [phonemes, setPhonemes] = useState<{ phoneme: string; score: number }[]>([]);
  const [showTips, setShowTips] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  // Étape 2
  const [showHint, setShowHint] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [usage, setUsage] = useState<WordUsageResult | null>(null);
  const recStart = useRef(0);

  useEffect(() => { getWordCoaching(word).then(setCoaching); }, [word]);

  const playB64 = async (b64: string) => {
    try {
      const p = FileSystem.cacheDirectory + `word_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(p, b64, { encoding: FileSystem.EncodingType.Base64 });
      player.replace(p); player.seekTo(0); player.play();
    } catch (e) { console.warn(e); }
  };
  const speak = async (text: string, rate?: number) => {
    try {
      const r: any = await translateText({ text, mode: "speak", ...(rate ? { speakingRate: rate } : {}) });
      if (r.data?.audioBase64) await playB64(r.data.audioBase64);
    } catch (e) { console.warn(e); }
  };
  const playModel = () => (coaching?.audioBase64 ? playB64(coaching.audioBase64) : speak(word));
  const playSlow = () => speak(word, 0.6);

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
      if (step === "pronounce") {
        const r = await assessDrill(word, b64);
        setScore(Math.round(r.pronScore));
        setPhonemes(r.words?.[0]?.phonemes ?? []);
        setShowDetail(false);
      } else {
        const u = await assessWordUsage(word, b64);
        setUsage(u);
        if (u.wordUsed && u.sentenceOk && (u.pronScore ?? 0) >= PRON_OK) setMastered(word, true);
      }
    } catch (e) { console.warn(e); }
    finally { setStatus("idle"); }
  };
  const toggleRec = () => (status === "recording" ? stopRec() : startRec());

  const pronValidated = score !== null && score >= PRON_OK;
  const usageOk = !!usage && usage.wordUsed && usage.sentenceOk;
  const usagePronOk = !!usage && (usage.pronScore === null || usage.pronScore >= PRON_OK);
  const scoreColor = (s: number) => (s < 60 ? L.danger : s < PRON_OK ? L.accentDeep : L.success);

  // ---------- Bouton principal (micro) ----------
  const micLabel = step === "pronounce" ? "Prononcer" : "Dire ma phrase";
  const micButton = (
    <Pressable onPress={toggleRec} disabled={status === "processing" || !coaching} style={[styles.cta, status === "recording" && styles.ctaRec, (status === "processing" || !coaching) && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={status === "recording" ? "Terminer l'enregistrement" : micLabel}>
      {status === "processing" ? <ActivityIndicator color="#fff" /> : (
        <View style={styles.ctaRow}>
          <Icon name={status === "recording" ? "envoyer" : "micro"} size={20} tint="#fff" />
          <Text style={styles.ctaText}>{status === "recording" ? "Terminer" : micLabel}</Text>
        </View>
      )}
    </Pressable>
  );
  const micCaption = status === "recording" ? "Appuie quand tu as fini." : status === "processing" ? "Analyse en cours…" : "Appuie pour commencer.";

  return (
    <View style={styles.container}>
      {/* En-tête : retour, titre, fermer */}
      <View style={styles.header}>
        {step === "context" ? <RoundButton icon="retour" label="Étape précédente" onPress={() => setStep("pronounce")} size={44} iconSize={20} /> : <RoundButton icon="retour" label="Retour" onPress={onClose} size={44} iconSize={20} />}
        <Text style={styles.headerTitle}>Le labo</Text>
        <RoundButton icon="fermer" label="Fermer" onPress={onClose} size={44} iconSize={16} />
      </View>

      {/* Stepper */}
      <View style={styles.stepper}>
        <View style={styles.stepItem}>
          <View style={[styles.stepDot, step === "pronounce" ? styles.stepDotOn : styles.stepDotDone]}>{step === "context" ? <Icon name="check" size={14} tint="#fff" /> : <Text style={styles.stepNum}>1</Text>}</View>
          <Text style={[styles.stepLabel, step === "pronounce" && styles.stepLabelOn]}>Prononcer</Text>
        </View>
        <View style={[styles.stepLine, { backgroundColor: L.accentDeep }]} />
        <View style={styles.stepItem}>
          <View style={[styles.stepDot, step === "context" ? styles.stepDotOn : styles.stepDotOff]}><Text style={[styles.stepNum, step !== "context" && { color: L.textSecondary }]}>2</Text></View>
          <Text style={[styles.stepLabel, step === "context" && styles.stepLabelOn]}>En contexte</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: L.gutter, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!coaching ? (
          <ActivityIndicator color={L.primary} style={{ marginTop: 40 }} />
        ) : step === "pronounce" ? (
          <>
            {/* Carte du mot */}
            <View style={styles.wordCard}>
              <Text style={styles.word}>{word}</Text>
              <Text style={styles.meaning}>{coaching.meaning_fr}</Text>
              <View style={styles.listenRow}>
                <Pressable onPress={playModel} style={styles.listenBtn} accessibilityRole="button" accessibilityLabel="Écouter"><Icon name="ecouter" size={18} /><Text style={styles.listenText}>Écouter</Text></Pressable>
                <View style={styles.listenSep} />
                <Pressable onPress={playSlow} style={styles.listenBtn} accessibilityRole="button" accessibilityLabel="Écouter au ralenti"><MaterialCommunityIcons name="speedometer-slow" size={18} color={L.textPrimary} /><Text style={styles.listenText}>Ralenti</Text></Pressable>
              </View>
            </View>

            {coaching.trap_fr ? (
              <View style={styles.tip}><MaterialCommunityIcons name="lightbulb-outline" size={18} color={L.lavenderText} /><Text style={styles.tipText}>{coaching.trap_fr}</Text></View>
            ) : null}

            <Pressable onPress={() => setShowTips((v) => !v)} style={styles.collapse} accessibilityRole="button">
              <Text style={styles.collapseTitle}>Conseils de prononciation</Text>
              <Icon name="chevron" size={16} style={{ transform: [{ rotate: showTips ? "-90deg" : "90deg" }] }} />
            </Pressable>
            {showTips && (
              <View style={styles.collapseBody}>
                {coaching.ipa ? <Text style={styles.ipa}>{coaching.ipa}</Text> : null}
                <Text style={styles.collapseText}>{coaching.how_to_fr}</Text>
                {heardAs ? <Text style={styles.heard}>La dernière fois, on a entendu « {heardAs} » à la place.</Text> : null}
              </View>
            )}

            {/* Résultat */}
            {score !== null && (
              <View style={[styles.result, pronValidated ? styles.resultOk : styles.resultKo]}>
                <View style={styles.resultHead}>
                  <View style={[styles.resultIcon, { backgroundColor: pronValidated ? L.success : L.accentDeep }]}>{pronValidated ? <Icon name="check" size={16} tint="#fff" /> : <Icon name="rejouer" size={16} tint="#fff" />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resultTitle, { color: pronValidated ? L.success : L.textPrimary }]}>{pronValidated ? "Prononciation validée" : score >= 60 ? "Presque !" : "On reprend doucement"}</Text>
                    <Text style={styles.resultSub}>{pronValidated ? "Tu peux maintenant utiliser ce mot." : score >= 60 ? "Réécoute le modèle et réessaie." : "Suis le conseil ci-dessus et réessaie."}</Text>
                  </View>
                  <View style={[styles.scorePill, { backgroundColor: pronValidated ? "#D5EEDF" : L.accentSoft }]}><Text style={[styles.scoreText, { color: scoreColor(score) }]}>{score} %</Text></View>
                </View>
                {phonemes.length > 0 && (
                  <>
                    <Pressable onPress={() => setShowDetail((v) => !v)} style={styles.detailRow} accessibilityRole="button">
                      <Text style={styles.detailLabel}>Voir le détail</Text>
                      <Icon name="chevron" size={14} style={{ transform: [{ rotate: showDetail ? "-90deg" : "90deg" }] }} />
                    </Pressable>
                    {showDetail && (
                      <View style={styles.phRow}>
                        {phonemes.map((p, i) => <View key={i} style={styles.phChip}><Text style={[styles.phText, { color: scoreColor(p.score) }]}>/{toIPA(p.phoneme)}/</Text></View>)}
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        ) : (
          <>
            {/* Rappel compact du mot */}
            <View style={styles.wordRowCard}>
              <Text style={styles.wordSmall}>{word}</Text>
              <View style={styles.vSep} />
              <Text style={styles.wordSmallFr} numberOfLines={1}>{coaching.meaning_fr}</Text>
              <Pressable onPress={playModel} style={styles.roundListen} hitSlop={8} accessibilityRole="button" accessibilityLabel="Écouter"><Icon name="ecouter" size={18} /></Pressable>
            </View>

            {!usage || !usageOk ? (
              <>
                {coaching.situation_title_fr ? <Text style={styles.sitTitle}>{coaching.situation_title_fr}</Text> : <Text style={styles.sitTitle}>À toi de l'utiliser</Text>}
                <View style={styles.sitCard}>
                  <Text style={styles.sitText}>{coaching.situation_fr ?? `Dis une phrase en anglais avec « ${word} ».`}</Text>
                  <View style={styles.sitSep} />
                  <Text style={styles.sitUse}>Utilise « {word} » dans ta phrase.</Text>
                </View>

                <View style={styles.helpRow}>
                  <Pressable onPress={() => setShowHint((v) => !v)} style={[styles.helpBtn, showHint && styles.helpBtnOn]} accessibilityRole="button"><Icon name="aide" size={18} /><Text style={styles.helpText}>Un indice</Text><Icon name="chevron" size={14} style={{ transform: [{ rotate: showHint ? "-90deg" : "90deg" }] }} /></Pressable>
                  <Pressable onPress={() => setShowExample((v) => !v)} style={[styles.helpBtn, showExample && styles.helpBtnOn]} accessibilityRole="button"><Icon name="exemple" size={18} /><Text style={styles.helpText}>Un exemple</Text><Icon name="chevron" size={14} style={{ transform: [{ rotate: showExample ? "-90deg" : "90deg" }] }} /></Pressable>
                </View>
                {showHint && coaching.starter_en ? <View style={styles.helpBody}><Text style={styles.helpEn}>{coaching.starter_en}…</Text></View> : null}
                {showExample && coaching.example_en ? (
                  <View style={styles.helpBody}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={[styles.helpEn, { flex: 1 }]}>{coaching.example_en}</Text>
                      <Pressable onPress={() => speak(coaching.example_en!)} style={styles.roundListen} hitSlop={8}><Icon name="ecouter" size={16} /></Pressable>
                    </View>
                    {coaching.example_fr ? <Text style={styles.helpFr}>{coaching.example_fr}</Text> : null}
                  </View>
                ) : null}

                {usage && !usageOk && (
                  <View style={{ marginTop: 14 }}>
                    {!usage.wordUsed && <View style={[styles.tip, { backgroundColor: L.accentSoft }]}><Icon name="attention" size={18} /><Text style={styles.tipText}>Tu n'as pas utilisé « {word} » dans ta phrase — réessaie.</Text></View>}
                    <CorrectionCard correction={(usage.correction as Correction) ?? { has_errors: false, original: [], corrected: [] }} feedback={usage.feedback_fr} />
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.okBanner}><View style={[styles.resultIcon, { backgroundColor: L.success }]}><Icon name="check" size={16} tint="#fff" /></View><Text style={styles.okBannerText}>Bien utilisé !</Text></View>
                <View style={styles.phraseCard}>
                  <Text style={styles.phraseK}>TA PHRASE</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Highlighted text={usage.transcript} word={word} style={[styles.phrase, { flex: 1 }]} />
                    <Pressable onPress={() => speak(usage.transcript)} style={styles.roundListen} hitSlop={8} accessibilityRole="button" accessibilityLabel="Écouter ma phrase"><Icon name="ecouter" size={16} /></Pressable>
                  </View>
                  {usage.feedback_fr ? <><View style={styles.sitSep} /><Text style={styles.phraseFeedback}>{usage.feedback_fr}</Text></> : null}
                </View>
                <View style={styles.checksRow}>
                  <View style={[styles.check, usagePronOk ? styles.checkOk : styles.checkKo]}>
                    <View style={[styles.miniCheck, { backgroundColor: usagePronOk ? L.success : L.accentDeep }]}>{usagePronOk ? <Icon name="check" size={12} tint="#fff" /> : <Icon name="rejouer" size={12} tint="#fff" />}</View>
                    <Text style={styles.checkText}>Prononciation{usage.pronScore !== null && !usagePronOk ? ` ${usage.pronScore} %` : ""}</Text>
                  </View>
                  <View style={[styles.check, styles.checkOk]}><View style={[styles.miniCheck, { backgroundColor: L.success }]}><Icon name="check" size={12} tint="#fff" /></View><Text style={styles.checkText}>Mise en contexte</Text></View>
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Barre du bas */}
      <View style={styles.bottom}>
        {step === "pronounce" ? (
          score === null ? (
            <>
              <Text style={styles.bottomCaption}>Écoute, puis prononce le mot.</Text>
              {micButton}
              <Text style={styles.bottomCaption}>{micCaption}</Text>
            </>
          ) : pronValidated ? (
            <>
              <Pressable onPress={() => setStep("context")} style={styles.cta} accessibilityRole="button"><View style={styles.ctaRow}><Text style={styles.ctaText}>Passer à la mise en situation</Text><Icon name="fleche" size={18} tint="#fff" /></View></Pressable>
              <Pressable onPress={() => { setScore(null); setPhonemes([]); }} hitSlop={8}><Text style={styles.link}>Réessayer</Text></Pressable>
            </>
          ) : (
            <>
              {micButton}
              {status === "idle" ? <Pressable onPress={() => setStep("context")} hitSlop={8}><Text style={styles.link}>Passer quand même</Text></Pressable> : <Text style={styles.bottomCaption}>{micCaption}</Text>}
            </>
          )
        ) : usage && usageOk ? (
          <>
            <Pressable onPress={onClose} style={styles.cta} accessibilityRole="button"><Text style={styles.ctaText}>Revenir à mes mots</Text></Pressable>
            <Pressable onPress={() => setUsage(null)} hitSlop={8}><Text style={styles.link}>M'entraîner encore</Text></Pressable>
          </>
        ) : (
          <>
            <Text style={styles.bottomCaption}>Une phrase courte suffit.</Text>
            {micButton}
            <Text style={styles.bottomCaption}>{micCaption}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 52, paddingHorizontal: L.gutter, paddingBottom: 6 },
  headerTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "800" },

  stepper: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", paddingHorizontal: 60, paddingTop: 6, paddingBottom: 14 },
  stepItem: { alignItems: "center", gap: 6, width: 100 },
  stepDot: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stepDotOn: { backgroundColor: L.accentDeep },
  stepDotDone: { backgroundColor: "#F6B98A" },
  stepDotOff: { backgroundColor: L.border },
  stepNum: { color: "#fff", fontSize: 13.5, fontWeight: "800" },
  stepLine: { flex: 1, height: 3, borderRadius: 2, marginTop: 14, marginHorizontal: -20 },
  stepLabel: { color: L.textSecondary, fontSize: 12.5, fontWeight: "600" },
  stepLabelOn: { color: L.textPrimary, fontWeight: "800" },

  wordCard: { backgroundColor: L.surface, borderRadius: 20, padding: 18, marginTop: 6 },
  word: { color: L.textPrimary, fontSize: 36, fontWeight: "800", letterSpacing: -0.8 },
  meaning: { color: L.textSecondary, fontSize: 16, marginTop: 4 },
  listenRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  listenBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: L.textPrimary, borderRadius: 14, minHeight: 48 },
  listenText: { color: L.textPrimary, fontSize: 15, fontWeight: "800" },
  listenSep: { width: 1, height: 24, backgroundColor: L.border },

  tip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: L.lavender, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14, marginTop: 12 },
  tipText: { flex: 1, color: L.textPrimary, fontSize: 14, lineHeight: 19 },

  collapse: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: L.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, marginTop: 12 },
  collapseTitle: { color: L.textPrimary, fontSize: 15, fontWeight: "800" },
  collapseBody: { backgroundColor: L.surface, borderRadius: 16, padding: 16, marginTop: 6 },
  ipa: { color: L.textSecondary, fontSize: 15, marginBottom: 6 },
  collapseText: { color: L.textPrimary, fontSize: 14.5, lineHeight: 21 },
  heard: { color: L.danger, fontSize: 13.5, marginTop: 8 },

  result: { borderRadius: 18, padding: 14, marginTop: 14 },
  resultOk: { backgroundColor: L.successSoft },
  resultKo: { backgroundColor: L.accentSoft },
  resultHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  resultIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 16, fontWeight: "800" },
  resultSub: { color: L.textSecondary, fontSize: 13, marginTop: 2 },
  scorePill: { borderRadius: 10, paddingVertical: 4, paddingHorizontal: 9 },
  scoreText: { fontSize: 13, fontWeight: "800" },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)", marginTop: 12, paddingTop: 10 },
  detailLabel: { color: L.textPrimary, fontSize: 14, fontWeight: "700" },
  phRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  phChip: { backgroundColor: L.surface, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 9 },
  phText: { fontSize: 14, fontWeight: "800" },

  wordRowCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: L.surface, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16, marginTop: 6 },
  wordSmall: { color: L.textPrimary, fontSize: 20, fontWeight: "800" },
  vSep: { width: 1, height: 22, backgroundColor: L.border },
  wordSmallFr: { flex: 1, color: L.textSecondary, fontSize: 15 },
  roundListen: { width: 40, height: 40, borderRadius: 20, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center" },

  sitTitle: { color: L.textPrimary, fontSize: 22, fontWeight: "800", marginTop: 18, letterSpacing: -0.3 },
  sitCard: { backgroundColor: L.surface, borderRadius: 18, padding: 16, marginTop: 10 },
  sitText: { color: L.textPrimary, fontSize: 16, lineHeight: 23 },
  sitSep: { height: 1, backgroundColor: L.border, marginVertical: 12 },
  sitUse: { color: L.textSecondary, fontSize: 14 },
  helpRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  helpBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: L.surface, borderRadius: 14, minHeight: 50, borderWidth: 1.5, borderColor: "transparent" },
  helpBtnOn: { borderColor: L.accentDeep },
  helpText: { color: L.textPrimary, fontSize: 14.5, fontWeight: "800" },
  helpBody: { backgroundColor: L.surface, borderRadius: 14, padding: 14, marginTop: 8 },
  helpEn: { color: L.textPrimary, fontSize: 16, fontWeight: "700", lineHeight: 23 },
  helpFr: { color: L.textSecondary, fontSize: 13.5, fontStyle: "italic", marginTop: 6 },

  okBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.successSoft, borderRadius: 16, padding: 14, marginTop: 14 },
  okBannerText: { color: L.textPrimary, fontSize: 18, fontWeight: "800" },
  phraseCard: { backgroundColor: L.surface, borderRadius: 18, padding: 16, marginTop: 12 },
  phraseK: { color: L.textSecondary, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8, marginBottom: 6 },
  phrase: { color: L.textPrimary, fontSize: 19, fontWeight: "800", lineHeight: 27 },
  phraseFeedback: { color: L.textSecondary, fontSize: 14, lineHeight: 20 },
  checksRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  check: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, minHeight: 46 },
  checkOk: { backgroundColor: L.successSoft },
  checkKo: { backgroundColor: L.accentSoft },
  checkText: { color: L.textPrimary, fontSize: 13.5, fontWeight: "700" },
  miniCheck: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },

  bottom: { paddingHorizontal: L.gutter, paddingTop: 10, paddingBottom: 22, alignItems: "center", gap: 10, backgroundColor: L.background },
  bottomCaption: { color: L.textSecondary, fontSize: 13.5 },
  cta: { backgroundColor: L.accentDeep, borderRadius: 18, minHeight: 56, alignItems: "center", justifyContent: "center", alignSelf: "stretch", paddingHorizontal: 20 },
  ctaRec: { backgroundColor: L.danger },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  link: { color: L.textSecondary, fontSize: 14, fontWeight: "700", textDecorationLine: "underline", paddingVertical: 4 },
});
