import { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { T } from "../../lib/theme";
import { Goal, Feeling, Gender, saveProfile } from "../../lib/profile";
import { GOALS, FEELINGS, GENDERS, INTERESTS } from "../../lib/onboardingData";
import { Level, LEVEL_OPTIONS, calibrateLevel } from "../../lib/level";
import { assessDrill } from "../../lib/labo";
import TimeWheel from "../../components/TimeWheel";
import { requestNotifPermission, scheduleDailyReminder } from "../../lib/notifications";

// Écrans (steps) : q = question, v = validation
// 0 accroche · 1 objectifs · 2 ressenti · 3 auto-éval · 4 test · 5 VALIDATION
// 6 diagnostic(+courbe) · 7 prénom · 8 genre · 9 intérêts · 10 VALIDATION finale
// 6 diagnostic(+courbe) · 7 prénom · 8 genre · 9 intérêts · 10 rappel · 11 VALIDATION finale
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
const TOTAL = 12;

const TEST_SENTENCE = "I think this is worth thirty-three dollars";
const MIN_REC_MS = 700;
const CECRL: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Niveau visé = deux crans au-dessus du niveau actuel (plafonné à C2)
function targetLevel(current: Level): Level {
  const i = CECRL.indexOf(current);
  return CECRL[Math.min(CECRL.length - 1, i + 2)];
}

export default function OnboardingFlow({ onLaunch }: { onLaunch: (goals: Goal[]) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [step, setStep] = useState<Step>(0);
  const [launching, setLaunching] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [declaredLevel, setDeclaredLevel] = useState<Level | null>(null);
  const [testScore, setTestScore] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<"idle" | "recording" | "processing" | "done">("idle");
  const [saving, setSaving] = useState(false);
  const recStartRef = useRef(0);
  const [remHour, setRemHour] = useState(() => new Date().getHours());
  const [remMinute, setRemMinute] = useState(() => new Date().getMinutes());
  const finalLevel: Level = declaredLevel ? calibrateLevel(declaredLevel, testScore) : "B1";
  const goalTarget = targetLevel(finalLevel);

  const toggleGoal = (k: Goal) => setGoals((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleInterest = (i: string) =>
    setInterests((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < 5 ? [...p, i] : p));

  const next = () => setStep((s) => Math.min(TOTAL - 1, s + 1) as Step);
  const back = () => setStep((s) => Math.max(0, s - 1) as Step);

  const startTest = async () => {
    if (testStatus !== "idle" && testStatus !== "done") return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        console.warn("Permission micro refusée");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recStartRef.current = Date.now();
      setTestStatus("recording");
    } catch (e) {
      console.warn("Test record error:", e);
    }
  };
  const stopTest = async () => {
    if (testStatus !== "recording") return;
    setTestStatus("processing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - recStartRef.current < MIN_REC_MS) {
        setTestStatus("idle");
        return;
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("no uri");
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const r = await assessDrill(TEST_SENTENCE, audioBase64);
      setTestScore(Math.round(r.pronScore));
      setTestStatus("done");
    } catch (e) {
      console.warn("Test assess error:", e);
      setTestStatus("idle");
    }
  };

  const finishToLaunch = async () => {
    try {
      const granted = await requestNotifPermission();
      if (granted) await scheduleDailyReminder(remHour, remMinute);
    } catch (e) {
      console.warn("Rappel onboarding échoué:", e);
    }
    setSaving(true);
    try {
      await saveProfile({
        name: name.trim() || undefined,
        goals,
        feeling: feeling ?? undefined,
        job: job.trim() || undefined,
        gender: gender ?? undefined,
        interests,
        level: finalLevel,
        testScore,
      });
    } catch (e) {
      console.warn("Sauvegarde onboarding échouée:", e);
    } finally {
      setSaving(false);
      setLaunching(true);
    }
  };

  const canContinue =
    step === 0 ||
    (step === 1 && goals.length > 0) ||
    (step === 2 && !!feeling) ||
    (step === 3 && !!declaredLevel) ||
    (step === 4 && testStatus === "done") ||
    step === 5 ||
    step === 6 ||
    (step === 7 && name.trim().length > 0) ||
    (step === 8 && !!gender) ||
    step === 9 ||
    step === 10 ||
    step === 11;

  // Progression continue (0 → 1)
  const progress = step / (TOTAL - 1);

  if (launching) {
    return (
      <View style={styles.container}>
        <View style={styles.launchWrap}>
          <View style={styles.blobWrap}>
            <View style={styles.blob1} />
            <View style={styles.blob2} />
          </View>
          <Text style={styles.launchTitle}>
            {name.trim() ? `À toi de jouer, ${name.trim()}.` : "À toi de jouer."}
          </Text>
          <Text style={styles.launchLead}>
            Ta première conversation t'attend. Pas de stress : tu parles, on t'écoute, et on te guide pas à pas.
          </Text>
        </View>
        <Pressable onPress={() => onLaunch(goals)} style={styles.cta}>
          <Text style={styles.ctaText}>Lancer ma première scène</Text>
        </Pressable>
      </View>
    );
  }

 const isValidation = step === 5 || step === 11;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        {step > 0 ? (
          <Pressable onPress={back} hitSlop={12}>
            <Feather name="chevron-left" size={26} color={T.inkSoft} />
          </Pressable>
        ) : (
          <View style={{ width: 26 }} />
        )}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(6, progress * 100)}%` }]} />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        {/* 0 — Accroche */}
        {step === 0 && (
          <View style={styles.hero}>
            <View style={styles.blobWrap}>
              <View style={styles.blob1} />
              <View style={styles.blob2} />
            </View>
            <Text style={styles.big}>Arrête de traduire</Text>
            <Text style={styles.bigAccent}>dans ta tête.</Text>
            <Text style={styles.lead}>
              Ici, on ne révise pas de la grammaire : on parle, pour de vrai. Dix minutes par jour, et l'anglais finit
              par sortir tout seul.
            </Text>
          </View>
        )}

        {/* 1 — Objectifs (multi) */}
        {step === 1 && (
          <View>
            <Text style={styles.title}>Pourquoi tu veux t'y mettre ?</Text>
            <Text style={styles.sub}>Choisis tout ce qui compte pour toi.</Text>
            {GOALS.map((g) => (
              <SelectCard key={g.key} icon={g.icon} title={g.title} desc={g.desc} active={goals.includes(g.key)} onPress={() => toggleGoal(g.key)} />
            ))}
          </View>
        )}

        {/* 2 — Ressenti */}
        {step === 2 && (
          <View>
            <Text style={styles.title}>Qu'est-ce qui te bloque le plus ?</Text>
            <Text style={styles.sub}>Pour ajuster notre façon de te parler.</Text>
            {FEELINGS.map((f) => (
              <SelectCard key={f.key} icon={f.icon} title={f.title} desc={f.desc} active={feeling === f.key} onPress={() => setFeeling(f.key)} />
            ))}
          </View>
        )}

        {/* 3 — Auto-évaluation CECRL */}
        {step === 3 && (
          <View>
            <Text style={styles.title}>Où tu en es, à peu près ?</Text>
            <Text style={styles.sub}>Sois honnête — on ajuste tout à ton niveau.</Text>
            {LEVEL_OPTIONS.map((l) => (
              <Pressable key={l.key} onPress={() => setDeclaredLevel(l.key)} style={[styles.levelCard, declaredLevel === l.key && styles.levelCardOn]}>
                <View style={styles.levelBadge}><Text style={styles.levelBadgeText}>{l.key}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.levelTitle}>{l.title}</Text>
                  <Text style={styles.levelDesc}>{l.desc}</Text>
                </View>
                {declaredLevel === l.key && <Feather name="check-circle" size={20} color={T.abricotDeep} />}
              </Pressable>
            ))}
          </View>
        )}

        {/* 4 — Test de prononciation */}
        {step === 4 && (
          <View>
            <Text style={styles.title}>Un test, juste pour voir.</Text>
            <Text style={styles.sub}>Lis cette phrase à voix haute. On mesure, sans juger.</Text>
            <View style={styles.testCard}>
              <Text style={styles.testSentence}>“{TEST_SENTENCE}”</Text>
              <Text style={styles.testHint}>Oui, il y a quelques pièges dedans.</Text>
            </View>
            {testStatus === "done" && testScore !== null && (
              <View style={styles.testResult}>
                <Text style={styles.testScoreNum}>{testScore}<Text style={styles.testScoreOut}>/100</Text></Text>
                <Text style={styles.testVerdict}>
                  {testScore < 60
                    ? "Ton accent te trahit sur plusieurs sons — c'est exactement ce qu'on va corriger."
                    : testScore < 80
                    ? "Pas mal ! Quelques sons à polir, et tu passeras pour un vrai bilingue."
                    : "Solide. On va peaufiner les derniers détails ensemble."}
                </Text>
              </View>
            )}
            {testStatus === "processing" && <ActivityIndicator size="large" color={T.abricotDeep} style={{ marginTop: 16 }} />}
            <View style={styles.testMicZone}>
              <Pressable onPressIn={startTest} onPressOut={stopTest} disabled={testStatus === "processing"} style={[styles.testMic, testStatus === "recording" && styles.testMicActive]}>
                <Feather name="mic" size={28} color={testStatus === "recording" ? "#fff" : T.night} />
              </Pressable>
              <Text style={styles.testMicLabel}>
                {testStatus === "recording" ? "Relâche quand tu as fini" : testStatus === "done" ? "Réessayer" : "Maintiens et lis la phrase"}
              </Text>
            </View>
          </View>
        )}

        {/* 5 — VALIDATION après le test */}
        {step === 5 && (
          <View style={styles.validWrap}>
            <View style={styles.validIcon}>
              <Feather name="check" size={40} color="#fff" />
            </View>
            <Text style={styles.validTitle}>C'est déjà un bon départ.</Text>
            <Text style={styles.validLead}>
              À chaque phrase que tu diras, on te montrera précisément quel son améliorer — en français, sans jargon.
            </Text>
          </View>
        )}

        {/* 6 — Diagnostic + courbe projetée */}
        {step === 6 && (
          <View>
            <Text style={styles.title}>Voilà ton plan.</Text>
            <Text style={styles.sub}>De là où tu es, jusqu'où on veut t'emmener.</Text>

            <View style={styles.diagCard}>
              <View style={styles.diagLevelsRow}>
                <View>
                  <Text style={styles.diagLevelLabel}>AUJOURD'HUI</Text>
                  <Text style={styles.diagLevelNow}>{finalLevel}</Text>
                </View>
                <Feather name="arrow-right" size={22} color="#8497BC" />
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.diagLevelLabel}>OBJECTIF</Text>
                  <Text style={styles.diagLevelTarget}>{goalTarget}</Text>
                </View>
              </View>

              {/* Courbe de progression (SVG-like en Views) */}
              <ProgressCurve />

              <View style={styles.scaleRow}>
                {CECRL.map((lvl) => (
                  <View key={lvl} style={[styles.scaleSeg, lvl === finalLevel && styles.scaleSegNow, lvl === goalTarget && styles.scaleSegTarget]}>
                    <Text style={[styles.scaleText, (lvl === finalLevel || lvl === goalTarget) && styles.scaleTextOn]}>{lvl}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.scaleCaption}>
                Échelle européenne CECRL, de A1 (grand débutant) à C2 (bilingue) — la référence officielle des niveaux de
                langue.
              </Text>
            </View>
          </View>
        )}

        {/* 7 — Prénom */}
        {step === 7 && (
          <View>
            <Text style={styles.title}>Comment on t'appelle ?</Text>
            <Text style={styles.sub}>Prénom ou pseudo — pour que tout te soit adressé personnellement.</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Ton prénom" placeholderTextColor={T.inkSoft} style={styles.input} returnKeyType="done" autoFocus maxLength={24} />
          </View>
        )}

        {/* 8 — Métier + genre */}
        {step === 8 && (
          <View>
            <Text style={styles.title}>Parle-nous un peu de toi.</Text>
            <Text style={styles.sub}>Pour inventer des scènes qui te ressemblent.</Text>
            <Text style={styles.fieldLabel}>TON MÉTIER (OPTIONNEL)</Text>
            <TextInput value={job} onChangeText={setJob} placeholder="Ex. développeur, infirmière, commercial…" placeholderTextColor={T.inkSoft} style={styles.input} returnKeyType="done" />
            <Text style={styles.fieldLabel}>ON S'ADRESSE À TOI COMME…</Text>
            <View style={styles.genderRow}>
              {GENDERS.map((g) => (
                <Pressable key={g.key} onPress={() => setGender(g.key)} style={[styles.genderChip, gender === g.key && styles.genderChipOn]}>
                  <Text style={[styles.genderText, gender === g.key && styles.genderTextOn]}>{g.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* 9 — Intérêts */}
        {step === 9 && (
          <View>
            <Text style={styles.title}>Tes centres d'intérêt.</Text>
            <Text style={styles.sub}>Choisis-en jusqu'à 5 — on en parlera en anglais.</Text>
            <View style={styles.interestsWrap}>
              {INTERESTS.map((i) => (
                <Pressable key={i} onPress={() => toggleInterest(i)} style={[styles.interestChip, interests.includes(i) && styles.interestChipOn]}>
                  <Text style={[styles.interestText, interests.includes(i) && styles.interestTextOn]}>{i}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

      {/* 10 — Rappel quotidien */}
      {step === 10 && (
        <View>
          <Text style={styles.title}>Ton rendez-vous quotidien.</Text>
          <Text style={styles.sub}>Choisis l'heure de ton rappel — dix minutes par jour, à ton moment à toi.</Text>
          <TimeWheel hour={remHour} minute={remMinute} onChange={(h, m) => { setRemHour(h); setRemMinute(m); }} />
        </View>
      )}

        {/* 11 — VALIDATION finale */}
        {step === 11 && (
          <View style={styles.validWrap}>
            <View style={styles.validIcon}>
              <Feather name="check" size={40} color="#fff" />
            </View>
            <Text style={styles.validTitle}>Tout est prêt{name.trim() ? `, ${name.trim()}` : ""}.</Text>
            <Text style={styles.validLead}>
              On a calé ton niveau, tes objectifs et tes sujets préférés. Ta première conversation t'attend.
            </Text>
          </View>
        )}
      </ScrollView>

      {step < TOTAL - 1 ? (
        <Pressable onPress={next} disabled={!canContinue} style={[styles.cta, !canContinue && styles.ctaOff]}>
          <Text style={styles.ctaText}>
            {step === 0 ? "On commence"
              : step === 4 && testStatus !== "done" ? "Fais le test d'abord"
              : isValidation ? "Continuer"
              : "Continuer"}
          </Text>
        </Pressable>
      ) : (
        <Pressable onPress={finishToLaunch} disabled={saving} style={[styles.cta, saving && styles.ctaOff]}>
          <Text style={styles.ctaText}>{saving ? "…" : "C'est parti"}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Courbe de progression stylisée (barres montantes en dégradé abricot)
function ProgressCurve() {
  const heights = [26, 34, 44, 52, 66, 82];
  return (
    <View style={styles.curveRow}>
      {heights.map((h, i) => (
        <View key={i} style={styles.curveCol}>
          <View style={[styles.curveBar, { height: h, backgroundColor: i >= heights.length - 2 ? T.abricot : "#3A4A6B" }]} />
        </View>
      ))}
    </View>
  );
}

function SelectCard({ icon, title, desc, active, onPress }: { icon: string; title: string; desc: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.selectCard, active && styles.selectCardOn]}>
      <View style={[styles.selectIcon, active && styles.selectIconOn]}>
        <Feather name={icon as any} size={20} color={active ? T.night : T.abricotDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.selectTitle}>{title}</Text>
        <Text style={styles.selectDesc}>{desc}</Text>
      </View>
      {active && <Feather name="check-circle" size={20} color={T.abricotDeep} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, paddingTop: 52 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginBottom: 20, gap: 12 },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: T.creamLine, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: T.abricot },
  scroll: { paddingHorizontal: 26, paddingBottom: 20 },

  hero: { paddingTop: 20 },
  blobWrap: { height: 120, marginBottom: 20, alignItems: "center", justifyContent: "center" },
  blob1: { position: "absolute", width: 130, height: 130, borderRadius: 65, backgroundColor: T.abricot, opacity: 0.9, transform: [{ scaleX: 1.15 }] },
  blob2: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: T.miel, right: 60, top: 10 },
  big: { fontSize: 32, fontWeight: "800", color: T.night, lineHeight: 38, letterSpacing: -0.5 },
  bigAccent: { fontSize: 32, fontWeight: "800", color: T.abricotDeep, lineHeight: 38, letterSpacing: -0.5, marginBottom: 16 },
  lead: { fontSize: 16, fontWeight: "600", color: T.inkSoft, lineHeight: 24 },

  title: { fontSize: 25, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { fontSize: 15, fontWeight: "600", color: T.inkSoft, lineHeight: 22, marginTop: 6, marginBottom: 20 },

  selectCard: { backgroundColor: T.card, borderRadius: 20, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10, borderWidth: 2, borderColor: "transparent" },
  selectCardOn: { borderColor: T.abricot },
  selectIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  selectIconOn: { backgroundColor: T.abricot },
  selectTitle: { fontSize: 16, fontWeight: "800", color: T.night },
  selectDesc: { fontSize: 13, fontWeight: "600", color: T.inkSoft, marginTop: 2 },

  levelCard: { backgroundColor: T.card, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, borderWidth: 2, borderColor: "transparent" },
  levelCardOn: { borderColor: T.abricot },
  levelBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  levelBadgeText: { color: T.abricotDeep, fontSize: 14, fontWeight: "800" },
  levelTitle: { fontSize: 16, fontWeight: "800", color: T.night },
  levelDesc: { fontSize: 13, fontWeight: "600", color: T.inkSoft, marginTop: 2 },

  testCard: { backgroundColor: T.card, borderRadius: 22, padding: 22, alignItems: "center" },
  testSentence: { fontSize: 21, fontWeight: "800", color: T.night, textAlign: "center", lineHeight: 29, letterSpacing: -0.3 },
  testHint: { fontSize: 12, fontWeight: "600", color: T.inkSoft, marginTop: 10 },
  testResult: { marginTop: 16, backgroundColor: T.card, borderRadius: 18, padding: 18, alignItems: "center" },
  testScoreNum: { fontSize: 44, fontWeight: "800", color: T.abricotDeep, letterSpacing: -1 },
  testScoreOut: { fontSize: 18, fontWeight: "700", color: T.inkSoft },
  testVerdict: { fontSize: 14, fontWeight: "600", color: T.night, textAlign: "center", lineHeight: 21, marginTop: 6 },
  testMicZone: { alignItems: "center", marginTop: 24 },
  testMic: { width: 72, height: 72, borderRadius: 36, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  testMicActive: { backgroundColor: T.corail },
  testMicLabel: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 9 },

  validWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  validIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  validTitle: { fontSize: 26, fontWeight: "800", color: T.night, letterSpacing: -0.4, textAlign: "center" },
  validLead: { fontSize: 16, fontWeight: "600", color: T.inkSoft, lineHeight: 24, textAlign: "center", marginTop: 12 },

  diagCard: { backgroundColor: T.night, borderRadius: 22, padding: 22 },
  diagLevelsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diagLevelLabel: { color: "#9DB0D4", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  diagLevelNow: { color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1, marginTop: 2 },
  diagLevelTarget: { color: T.abricot, fontSize: 36, fontWeight: "800", letterSpacing: -1, marginTop: 2 },
  curveRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 90, marginVertical: 18, paddingHorizontal: 4 },
  curveCol: { flex: 1, alignItems: "center" },
  curveBar: { width: "60%", borderRadius: 5 },
  scaleRow: { flexDirection: "row", gap: 4 },
  scaleSeg: { flex: 1, backgroundColor: "#2E3E5C", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  scaleSegNow: { backgroundColor: "#4A5A78" },
  scaleSegTarget: { backgroundColor: T.abricot },
  scaleText: { color: "#9DB0D4", fontSize: 12, fontWeight: "800" },
  scaleTextOn: { color: "#fff" },
  scaleCaption: { color: "#8497BC", fontSize: 12, fontWeight: "600", lineHeight: 18, marginTop: 10 },

  fieldLabel: { fontSize: 11, fontWeight: "800", color: T.abricotDeep, letterSpacing: 0.8, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: T.card, borderRadius: 16, padding: 16, fontSize: 16, fontWeight: "600", color: T.night },
  genderRow: { gap: 8 },
  genderChip: { backgroundColor: T.card, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: "transparent" },
  genderChipOn: { borderColor: T.abricot },
  genderText: { fontSize: 15, fontWeight: "700", color: T.inkSoft },
  genderTextOn: { color: T.night },

  interestsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  interestChip: { backgroundColor: T.card, borderRadius: 16, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 2, borderColor: "transparent" },
  interestChipOn: { backgroundColor: T.abricot, borderColor: T.abricot },
  interestText: { fontSize: 14, fontWeight: "700", color: T.inkSoft },
  interestTextOn: { color: T.night },

  launchWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 26 },
  launchTitle: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.5, marginBottom: 12 },
  launchLead: { fontSize: 16, fontWeight: "600", color: T.inkSoft, lineHeight: 24 },

  cta: { backgroundColor: T.abricot, borderRadius: 16, padding: 17, alignItems: "center", marginHorizontal: 26, marginBottom: 28 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: T.night, fontSize: 16, fontWeight: "800" },
});