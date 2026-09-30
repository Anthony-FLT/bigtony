import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator, Animated, Easing, Image, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { T } from "../../lib/theme";
import { Goal, AgeRange, Gender, VoiceKey, saveProfile } from "../../lib/profile";
import { logOnboardingTestSkipped } from "../../lib/analytics";
import { GOALS, GENDERS, INTERESTS } from "../../lib/onboardingData";
import { Level, LEVEL_OPTIONS, calibrateLevel } from "../../lib/level";
import { assessDrill } from "../../lib/labo";
import TimeWheel from "../../components/TimeWheel";
import PaywallScreen from "../PaywallScreen";
import { requestNotifPermission, scheduleDailyReminder } from "../../lib/notifications";

// Écrans (steps) : q = question, v = validation
// 0 accroche · 1 objectifs · 2 ressenti · 3 auto-éval · 4 test · 5 VALIDATION
// 6 diagnostic(+courbe) · 7 prénom · 8 genre · 9 intérêts · 10 VALIDATION finale
// 6 diagnostic(+courbe) · 7 prénom · 8 genre · 9 intérêts · 10 rappel · 11 VALIDATION finale
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
const TOTAL = 12;

// Écran final : préparation du coach (0 → 100 %)
const PREP_DURATION = 6000;
const PREP_RING = 190;
const PREP_STROKE = 14;

const AGE_OPTIONS: { key: AgeRange; label: string }[] = [
  { key: "18-24", label: "18 – 24 ans" },
  { key: "25-34", label: "25 – 34 ans" },
  { key: "35-44", label: "35 – 44 ans" },
  { key: "45-54", label: "45 – 54 ans" },
  { key: "55+", label: "55 ans et plus" },
];

const COACH_VOICES: { key: VoiceKey; label: string }[] = [
  { key: "us-female", label: "Femme · US" },
  { key: "us-male", label: "Homme · US" },
  { key: "uk-female", label: "Femme · UK" },
  { key: "uk-male", label: "Homme · UK" },
];

// Écran d'accueil : deux bandes de scènes qui défilent lentement
const BRAND_ICON = require("../../assets/icon.png");
const HERO_TOP = [
  { img: require("../../assets/scenes/entretien-embauche.png"), label: "Entretien d'embauche" },
  { img: require("../../assets/scenes/cafe-ami.png"), label: "Commander un café" },
  { img: require("../../assets/scenes/probleme-chambre.png"), label: "Un souci à l'hôtel" },
  { img: require("../../assets/scenes/aeroport-controle.png"), label: "Passer la douane" },
  { img: require("../../assets/scenes/point-hebdo-teams.png"), label: "Réunion en visio" },
];
const HERO_BOTTOM = [
  { img: require("../../assets/scenes/restaurant-commande.png"), label: "Commander au restaurant" },
  { img: require("../../assets/scenes/demander-chemin.png"), label: "Demander son chemin" },
  { img: require("../../assets/scenes/location-voiture.png"), label: "Louer une voiture" },
  { img: require("../../assets/scenes/trajet-taxi.png"), label: "Prendre un taxi" },
  { img: require("../../assets/scenes/se-presenter.png"), label: "Se présenter" },
];
// Écran 2 : carrousel des bénéfices (captures d'écran de l'app dans un cadre de téléphone)
const BENEFIT_SHOTS = {
  conversation: require("../../assets/onboarding/benefit-conversation.png"),
  correction: require("../../assets/onboarding/benefit-correction.png"),
  daily: require("../../assets/onboarding/benefit-daily.png"),
};
const BENEFIT_SCENES = [
  { img: require("../../assets/scenes/entretien-embauche.png"), tag: "Travail", label: "Entretien" },
  { img: require("../../assets/scenes/point-hebdo-teams.png"), tag: "Travail", label: "Réunion d'équipe" },
  { img: require("../../assets/scenes/trajet-taxi.png"), tag: "Voyage", label: "Prendre un taxi" },
  { img: require("../../assets/scenes/restaurant-commande.png"), tag: "Voyage", label: "Au restaurant" },
  { img: require("../../assets/scenes/se-presenter.png"), tag: "Quotidien", label: "Se présenter" },
  { img: require("../../assets/scenes/cafe-ami.png"), tag: "Quotidien", label: "Commander un café" },
];
const BENEFITS = [
  { key: "conversation", title: "Parle à voix haute,", accent: "on t'écoute", text: "Ton coach IA te répond comme dans un vrai échange. Zéro jugement." },
  { key: "correction", title: "Corrigé à", accent: "chaque phrase", text: "La bonne version à écouter, et l'explication en français, sans jargon." },
  { key: "scenes", title: "Les situations de", accent: "ta vraie vie", text: "Entretien, réunion, voyage, café entre amis... ou ta propre scène." },
  { key: "daily", title: "Un peu chaque jour,", accent: "beaucoup de progrès", text: "3 mini-défis quotidiens, un labo pour tes mots difficiles et ton dictionnaire perso." },
] as const;
const BENEFIT_INTERVAL = 3000;

const HERO_CARD_W = 168;
const HERO_CARD_GAP = 14;

const TEST_SENTENCE = "I think this is worth thirty-three dollars";
const MIN_REC_MS = 700;
const CECRL: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Niveau visé = deux crans au-dessus du niveau actuel (plafonné à C2)
function targetLevel(current: Level): Level {
  const i = CECRL.indexOf(current);
  return CECRL[Math.min(CECRL.length - 1, i + 2)];
}

export default function OnboardingFlow({ onLaunch, onLogin }: { onLaunch: (goals: Goal[]) => void; onLogin?: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [step, setStep] = useState<Step>(0);
  const [launching, setLaunching] = useState(false);
  const [showBenefits, setShowBenefits] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [ageRange, setAgeRange] = useState<AgeRange | null>(null);
  const [declaredLevel, setDeclaredLevel] = useState<Level | null>(null);
  const [testScore, setTestScore] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [voice, setVoice] = useState<VoiceKey>("us-male");
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

  // L'écran 5 (« C'est déjà un bon départ ») n'a de sens que si le test a été fait
  const next = () =>
    setStep((s) => Math.min(TOTAL - 1, s + 1 === 5 && testStatus !== "done" ? 6 : s + 1) as Step);
  const back = () =>
    setStep((s) => Math.max(0, s - 1 === 5 && testStatus !== "done" ? 4 : s - 1) as Step);
  const skipTest = () => { logOnboardingTestSkipped(); next(); };

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

  // Étape 10 : la permission de notification est demandée ici, au moment où l'heure est choisie
  const confirmReminder = async () => {
    try {
      const granted = await requestNotifPermission();
      if (granted) await scheduleDailyReminder(remHour, remMinute);
    } catch (e) {
      console.warn("Rappel onboarding échoué:", e);
    }
    next();
  };

  // Le paywall s'affiche tout de suite, la sauvegarde du profil se fait derrière
  const finishToLaunch = async () => {
    setShowPaywall(true);
    setSaving(true);
    try {
      await saveProfile({
        name: name.trim() || undefined,
        goals,
        ageRange: ageRange ?? undefined,
        job: job.trim() || undefined,
        gender: gender ?? undefined,
        interests,
        level: finalLevel,
        testScore,
        voice,
      });
    } catch (e) {
      console.warn("Sauvegarde onboarding échouée:", e);
    } finally {
      setSaving(false);
    }
  };

  const canContinue =
    step === 0 ||
    (step === 1 && goals.length > 0) ||
    (step === 2 && !!ageRange) ||
    (step === 3 && !!declaredLevel) ||
    step === 4 ||
    step === 5 ||
    step === 6 ||
    (step === 7 && name.trim().length > 0) ||
    (step === 8 && !!gender) ||
    step === 9 ||
    step === 10 ||
    step === 11;

  // Progression continue (0 → 1)
  const progress = step / (TOTAL - 1);

  // Paywall après la préparation du coach : fermeture possible au bout de 7 s, puis écran « Bienvenue »
  if (showPaywall) {
    const toWelcome = () => {
      setShowPaywall(false);
      setLaunching(true);
    };
    return (
      <PaywallScreen
        closeDelayMs={7000}
        planLabel={`${finalLevel} → ${goalTarget}`}
        onClose={toWelcome}
        onPurchased={toWelcome}
      />
    );
  }

  if (launching) {
    return (
      <View style={styles.container}>
        <View style={styles.launchWrap}>
          <View style={styles.blobWrap}>
            <View style={styles.blob1} />
            <View style={styles.blob2} />
          </View>
          <Text style={styles.launchTitle}>
            {name.trim() ? `Bienvenue, ${name.trim()}.` : "Bienvenue."}
          </Text>
          <Text style={styles.launchLead}>
            Ta conversation de présentation t'attend dans l'app. Pas de stress : tu parles, on t'écoute, et on te guide pas à pas.
          </Text>
        </View>
        <Pressable onPress={() => onLaunch(goals)} style={styles.cta}>
          <Text style={styles.ctaText}>Découvrir l'app</Text>
        </Pressable>
      </View>
    );
  }

  // 0 — Écran d'accueil animé (plein écran, sans barre de progression)
  // 0 bis — Carrousel des bénéfices, juste après l'accueil
  if (step === 0) {
    return showBenefits ? (
      <BenefitsCarousel onDone={next} />
    ) : (
      <WelcomeHero onStart={() => setShowBenefits(true)} onLogin={onLogin} />
    );
  }

  // 11 — Préparation du coach (plein écran)
  if (step === 11) {
    const picked = interests.slice(0, 2).map((i) => i.toLowerCase()).join(", ");
    return <PrepScreen sceneHint={picked} saving={saving} onDone={finishToLaunch} />;
  }

  const isValidation = step === 5;

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

        {/* 2 — Tranche d'âge */}
        {step === 2 && (
          <View>
            <Text style={styles.title}>Quel âge as-tu ?</Text>
            <Text style={styles.sub}>Pour te proposer des scènes qui collent à ta vie.</Text>
            <View style={styles.ageGrid}>
              {AGE_OPTIONS.map((a) => {
                const on = ageRange === a.key;
                return (
                  <Pressable key={a.key} onPress={() => setAgeRange(a.key)} style={[styles.ageChip, on && styles.ageChipOn]}>
                    {on && <Feather name="check" size={15} color={T.abricot} />}
                    <Text style={[styles.ageText, on && styles.ageTextOn]}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => {
                setAgeRange(null);
                next();
              }}
              hitSlop={10}
              style={{ alignSelf: "center", marginTop: 22 }}
            >
              <Text style={styles.ageSkip}>Je préfère ne pas répondre</Text>
            </Pressable>
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
              {testStatus !== "done" && testStatus !== "recording" && (
                <Pressable onPress={skipTest} hitSlop={10} style={{ marginTop: 14 }}>
                  <Text style={styles.testSkipLink}>Passer ce test</Text>
                </Pressable>
              )}
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
            <Text style={styles.fieldLabel}>LA VOIX DE TON COACH</Text>
            <View style={styles.voiceGrid}>
              {COACH_VOICES.map((v) => (
                <Pressable key={v.key} onPress={() => setVoice(v.key)} style={[styles.voiceChip, voice === v.key && styles.voiceChipOn]}>
                  <Text style={[styles.voiceChipText, voice === v.key && styles.voiceChipTextOn]}>{v.label}</Text>
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

      </ScrollView>

      <Pressable onPress={step === 4 && testStatus !== "done" ? skipTest : step === 10 ? confirmReminder : next} disabled={!canContinue} style={[styles.cta, !canContinue && styles.ctaOff]}>
        <Text style={styles.ctaText}>
            {step === 4 && testStatus !== "done" ? "Passer ce test"
            : isValidation ? "Continuer"
            : "Continuer"}
        </Text>
      </Pressable>
    </View>
  );
}

// Préparation du coach : anneau 0 → 100 %, les étapes passent au vert une à une
function PrepScreen({ sceneHint, saving, onDone }: { sceneHint: string; saving: boolean; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const id = progress.addListener(({ value }) => setPct(Math.round(value * 100)));
    Animated.timing(progress, { toValue: 1, duration: PREP_DURATION, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    return () => progress.removeListener(id);
  }, [progress]);

  const items = [
    { label: "Analyse de ton niveau", at: 22 },
    { label: sceneHint ? `Sélection de tes scènes : ${sceneHint}` : "Sélection de tes scènes", at: 48 },
    { label: "Réglage de la voix de ton coach", at: 74 },
    { label: "Préparation de ta 1re conversation", at: 100 },
  ];
  const ready = pct >= 100;

  // Anneau : deux demi-cercles qui pivotent (droite de 0 à 50 %, gauche de 50 à 100 %)
  const rightRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-135deg", "45deg", "45deg"] });
  const leftRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-135deg", "-135deg", "45deg"] });

  return (
    <View style={[styles.heroScreen, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.prepRing}>
        <View style={styles.prepHalfRight}>
          <Animated.View style={[styles.prepArc, styles.prepArcRight, { transform: [{ rotate: rightRot }] }]} />
        </View>
        <View style={styles.prepHalfLeft}>
          <Animated.View style={[styles.prepArc, styles.prepArcLeft, { transform: [{ rotate: leftRot }] }]} />
        </View>
        <View style={styles.prepDot} />
        <Text style={styles.prepPct}>{pct}%</Text>
      </View>

      <Text style={styles.prepTitle}>{ready ? "Ton coach est prêt !" : "On prépare ton coach..."}</Text>
      <Text style={styles.prepSub}>{ready ? "Tout est calé pour toi." : "Ça prend quelques secondes."}</Text>

      <View style={styles.prepCard}>
        {items.map((it) => {
          const done = pct >= it.at;
          return (
            <View key={it.at} style={styles.prepRow}>
              <View style={[styles.prepCheck, done && styles.prepCheckOn]}>
                <Feather name="check" size={13} color={done ? T.night : "#C9C1B8"} />
              </View>
              <Text style={[styles.prepLabel, done && styles.prepLabelOn]}>{it.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.prepTip}>
        <MaterialCommunityIcons name="lightbulb-on-outline" size={16} color={T.abricotDeep} style={{ marginTop: 1 }} />
        <Text style={styles.prepTipText}>
          <Text style={{ fontWeight: "800", color: T.night }}>Le savais-tu ? </Text>
          Mieux vaut 10 minutes chaque jour qu'une heure le dimanche : c'est la régularité qui crée le déclic.
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      <Pressable onPress={onDone} disabled={!ready || saving} style={[styles.cta, (!ready || saving) && styles.ctaOff]}>
        <Text style={styles.ctaText}>{saving ? "…" : "Voir mon offre"}</Text>
      </Pressable>
    </View>
  );
}

// Écran d'accueil : logo, deux bandes de scènes en défilement lent, bulles flottantes
function WelcomeHero({ onStart, onLogin }: { onStart: () => void; onLogin?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.heroScreen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brandRow}>
        <Image source={BRAND_ICON} style={styles.brandIcon} />
        <View>
          <Text style={styles.brandName}>
            d<Text style={{ color: T.abricotDeep }}>é</Text>clic
          </Text>
          <Text style={styles.brandSub}>ANGLAIS</Text>
        </View>
      </View>

      <View style={styles.marquee}>
        <View style={styles.marqueeBand}>
          <MarqueeRow items={HERO_TOP} direction="left" duration={70000} />
          <MarqueeRow items={HERO_BOTTOM} direction="right" duration={80000} />
        </View>

        <FloatBubble delay={0} style={[styles.bubbleDark, { top: 14, left: 22 }]}>
          <Text style={styles.bubbleDarkText}>Hi! Nice to meet you</Text>
        </FloatBubble>
        <FloatBubble delay={900} style={{ top: 150, right: 14 }}>
          <Text style={styles.bubbleText}>
            I would like <Text style={styles.bubbleWrong}>an</Text> <Text style={styles.bubbleRight}>a</Text> coffee
          </Text>
        </FloatBubble>
        <FloatBubble delay={1800} style={[styles.bubbleRow, { top: 262, left: 40 }]}>
          <View style={styles.bubbleCheck}>
            <Feather name="check" size={12} color="#fff" />
          </View>
          <Text style={styles.bubbleOk}>Prononciation claire</Text>
        </FloatBubble>
      </View>

      <View style={{ flex: 1 }} />

      <View style={styles.heroText}>
        <Text style={styles.big}>Parle anglais</Text>
        <Text style={styles.bigAccent}>sans bloquer.</Text>
        <Text style={styles.lead}>
          Ton coach vocal t'écoute, te répond et te corrige avec douceur. Dix minutes par jour suffisent.
        </Text>
      </View>

      <Pressable onPress={onStart} style={[styles.cta, { marginBottom: onLogin ? 16 : 0 }]}>
        <Text style={styles.ctaText}>Commencer</Text>
      </Pressable>
      {onLogin ? (
        <Pressable onPress={onLogin} hitSlop={10} style={{ alignSelf: "center", paddingVertical: 4 }}>
          <Text style={styles.heroLogin}>J'ai déjà un compte</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Carrousel des bénéfices : défilement auto toutes les 3 s, swipe possible
function BenefitsCarousel({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const phoneH = Math.min(440, height * 0.5);

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  // Relancé à chaque changement de slide : un swipe manuel remet le compteur à zéro
  useEffect(() => {
    const t = setTimeout(() => goTo((index + 1) % BENEFITS.length), BENEFIT_INTERVAL);
    return () => clearTimeout(t);
  }, [index, width]);

  const onContinue = () => {
    if (index < BENEFITS.length - 1) goTo(index + 1);
    else onDone();
  };

  return (
    <View style={[styles.heroScreen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <Pressable onPress={onDone} hitSlop={10} style={styles.skipBtn}>
        <Text style={styles.skipText}>Passer</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {BENEFITS.map((b) => (
          <View key={b.key} style={{ width, flex: 1 }}>
            <View style={styles.benefitVisual}>
              {b.key === "scenes" ? <SceneGrid width={width} /> : <PhoneShot source={BENEFIT_SHOTS[b.key]} height={phoneH} />}

              {b.key === "conversation" && (
                <FloatBubble delay={0} style={[styles.bubbleRow, { top: "58%", left: 22 }]}>
                  <View style={styles.bubbleDot} />
                  <Text style={styles.bubbleOk}>Prononciation claire</Text>
                </FloatBubble>
              )}
              {b.key === "correction" && (
                <FloatBubble delay={0} style={[styles.bubbleRow, { top: "22%", right: 26 }]}>
                  <Text style={styles.chipWrong}>an</Text>
                  <Feather name="arrow-right" size={14} color={T.night} />
                  <Text style={styles.chipRight}>a</Text>
                </FloatBubble>
              )}
              {b.key === "scenes" && (
                <FloatBubble delay={0} style={[styles.bubbleDark, { top: -6, right: 30 }]}>
                  <Text style={styles.bubbleDarkText}>+ ta propre scène</Text>
                </FloatBubble>
              )}
              {b.key === "daily" && (
                <FloatBubble delay={0} style={[styles.bubbleRow, { top: "14%", right: 26 }]}>
                  <MaterialCommunityIcons name="fire" size={17} color={T.abricotDeep} />
                  <Text style={styles.bubbleText}>Ta série continue</Text>
                </FloatBubble>
              )}
            </View>

            <View style={styles.benefitText}>
              <Text style={styles.benefitTitle}>{b.title}</Text>
              <Text style={[styles.benefitTitle, { color: T.abricotDeep }]}>{b.accent}</Text>
              <Text style={styles.benefitLead}>{b.text}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {BENEFITS.map((b, i) => (
          <View key={b.key} style={i === index ? styles.dotActive : styles.dot} />
        ))}
      </View>

      <Pressable onPress={onContinue} style={styles.cta}>
        <Text style={styles.ctaText}>Continuer</Text>
      </Pressable>
    </View>
  );
}

// Capture d'écran de l'app dans un cadre de téléphone
function PhoneShot({ source, height }: { source: any; height: number }) {
  return (
    <View style={[styles.phone, { height, width: height * 0.48 }]}>
      <Image source={source} style={styles.phoneScreen} resizeMode="cover" />
    </View>
  );
}

// Grille 2 x 3 de scènes
function SceneGrid({ width }: { width: number }) {
  const cardW = Math.min(150, (width - 52 - 12) / 2);
  return (
    <View style={[styles.sceneGrid, { width: cardW * 2 + 12 }]}>
      {BENEFIT_SCENES.map((sc) => (
        <View key={sc.label} style={[styles.sceneCard, { width: cardW }]}>
          <View>
            <Image source={sc.img} style={styles.sceneImg} />
            <Text style={styles.sceneTag}>{sc.tag}</Text>
          </View>
          <Text style={styles.sceneLabel} numberOfLines={1}>{sc.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Bande de cartes en boucle infinie (la liste est dupliquée pour un raccord invisible)
function MarqueeRow({ items, direction, duration }: { items: { img: any; label: string }[]; direction: "left" | "right"; duration: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const setWidth = items.length * (HERO_CARD_W + HERO_CARD_GAP);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, [progress, duration]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: direction === "left" ? [0, -setWidth] : [-setWidth, 0],
  });

  return (
    <Animated.View style={[styles.marqueeRow, { width: setWidth * 2, transform: [{ translateX }] }]}>
      {[...items, ...items].map((it, i) => (
        <View key={i} style={styles.heroCard}>
          <Image source={it.img} style={styles.heroCardImg} />
          <Text style={styles.heroCardLabel} numberOfLines={1}>{it.label}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

// Bulle qui flotte doucement de haut en bas
function FloatBubble({ delay, style, children }: { delay: number; style?: any; children: ReactNode }) {
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -6, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const t = setTimeout(() => anim.start(), delay);
    return () => {
      clearTimeout(t);
      anim.stop();
    };
  }, [y, delay]);

  return <Animated.View style={[styles.bubble, style, { transform: [{ translateY: y }] }]}>{children}</Animated.View>;
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

  heroScreen: { flex: 1, backgroundColor: T.cream },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22 },
  brandIcon: { width: 56, height: 56, borderRadius: 16 },
  brandName: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.8, lineHeight: 32 },
  brandSub: { fontSize: 11, fontWeight: "800", color: T.inkSoft, letterSpacing: 4, marginTop: 2 },
  marquee: { height: 330, overflow: "hidden" },
  marqueeBand: { marginHorizontal: -60, marginTop: 22, transform: [{ rotate: "-4deg" }] },
  marqueeRow: { flexDirection: "row", paddingVertical: 8 },
  heroCard: { width: HERO_CARD_W, marginRight: HERO_CARD_GAP, backgroundColor: T.card, borderRadius: 20, padding: 6, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  heroCardImg: { width: "100%", height: 92, borderRadius: 15 },
  heroCardLabel: { fontSize: 13, fontWeight: "800", color: T.night, marginTop: 8, marginBottom: 4, marginHorizontal: 4 },
  bubble: { position: "absolute", backgroundColor: T.card, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 14, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  bubbleDark: { backgroundColor: T.night },
  bubbleDarkText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  bubbleText: { color: T.night, fontSize: 14, fontWeight: "800" },
  bubbleWrong: { color: T.corail, textDecorationLine: "line-through" },
  bubbleRight: { color: "#2E9E6B" },
  bubbleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bubbleCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#2E9E6B", alignItems: "center", justifyContent: "center" },
  bubbleOk: { color: "#1F7A52", fontSize: 13.5, fontWeight: "800" },
  heroText: { paddingHorizontal: 26, marginBottom: 22 },
  skipBtn: { alignSelf: "flex-end", paddingHorizontal: 26, paddingVertical: 6 },
  skipText: { color: T.inkSoft, fontSize: 14.5, fontWeight: "800" },
  benefitVisual: { flex: 1, alignItems: "center", justifyContent: "center" },
  benefitText: { paddingHorizontal: 30, paddingTop: 18, paddingBottom: 8, alignItems: "center" },
  benefitTitle: { fontSize: 28, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.6, lineHeight: 33 },
  benefitLead: { fontSize: 15, color: T.inkSoft, textAlign: "center", lineHeight: 22, marginTop: 10 },
  phone: { backgroundColor: T.night, borderRadius: 34, padding: 7, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  phoneScreen: { flex: 1, width: "100%", borderRadius: 27 },
  bubbleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2E9E6B" },
  chipWrong: { color: T.corail, fontWeight: "800", fontSize: 14, textDecorationLine: "line-through", backgroundColor: "#FDE3E0", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  chipRight: { color: "#1F7A52", fontWeight: "800", fontSize: 14, backgroundColor: "#DDF3E7", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  sceneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  sceneCard: { backgroundColor: T.card, borderRadius: 18, padding: 5, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  sceneImg: { width: "100%", height: 88, borderRadius: 14 },
  sceneTag: { position: "absolute", top: 6, left: 6, backgroundColor: T.card, color: T.abricotDeep, fontSize: 11, fontWeight: "800", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  sceneLabel: { fontSize: 13, fontWeight: "800", color: T.night, marginTop: 7, marginBottom: 4, marginHorizontal: 4 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, marginVertical: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.creamLine },
  dotActive: { width: 12, height: 12, borderRadius: 6, backgroundColor: T.abricot, borderWidth: 2, borderColor: T.chipAbricot },
  heroLogin: { color: T.inkSoft, fontSize: 14.5, fontWeight: "800" },
  blobWrap: { height: 120, marginBottom: 20, alignItems: "center", justifyContent: "center" },
  blob1: { position: "absolute", width: 130, height: 130, borderRadius: 65, backgroundColor: T.abricot, opacity: 0.9, transform: [{ scaleX: 1.15 }] },
  blob2: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: T.miel, right: 60, top: 10 },
  big: { fontSize: 32, fontWeight: "800", color: T.night, lineHeight: 38, letterSpacing: -0.5 },
  bigAccent: { fontSize: 32, fontWeight: "800", color: T.abricotDeep, lineHeight: 38, letterSpacing: -0.5, marginBottom: 16 },
  lead: { fontSize: 16, fontWeight: "600", color: T.inkSoft, lineHeight: 24 },

  title: { fontSize: 25, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  ageGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  ageChip: { width: "48%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: T.card, borderRadius: 18, paddingVertical: 20, borderWidth: 1.5, borderColor: T.card },
  ageChipOn: { backgroundColor: T.night, borderColor: T.night, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  ageText: { fontSize: 15.5, fontWeight: "800", color: T.night },
  ageTextOn: { color: "#fff" },
  ageSkip: { fontSize: 14, fontWeight: "800", color: T.inkSoft, textDecorationLine: "underline" },
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
  testSkipLink: { color: T.abricotDeep, fontSize: 13.5, fontWeight: "800", textDecorationLine: "underline" },

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
  voiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  voiceChip: { flexGrow: 1, flexBasis: "45%", backgroundColor: T.card, borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: "transparent" },
  voiceChipOn: { borderColor: T.abricot },
  voiceChipText: { fontSize: 14.5, fontWeight: "700", color: T.inkSoft },
  voiceChipTextOn: { color: T.night },

  interestsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  interestChip: { backgroundColor: T.card, borderRadius: 16, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 2, borderColor: "transparent" },
  interestChipOn: { backgroundColor: T.abricot, borderColor: T.abricot },
  interestText: { fontSize: 14, fontWeight: "700", color: T.inkSoft },
  interestTextOn: { color: T.night },

  prepRing: { width: PREP_RING, height: PREP_RING, borderRadius: PREP_RING / 2, borderWidth: PREP_STROKE, borderColor: T.creamLine, alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 26 },
  prepHalfRight: { position: "absolute", top: -PREP_STROKE, left: PREP_RING / 2 - PREP_STROKE, width: PREP_RING / 2, height: PREP_RING, overflow: "hidden" },
  prepHalfLeft: { position: "absolute", top: -PREP_STROKE, left: -PREP_STROKE, width: PREP_RING / 2, height: PREP_RING, overflow: "hidden" },
  prepArc: { position: "absolute", top: 0, width: PREP_RING, height: PREP_RING, borderRadius: PREP_RING / 2, borderWidth: PREP_STROKE, borderColor: "transparent" },
  prepArcRight: { left: -PREP_RING / 2, borderTopColor: T.abricot, borderRightColor: T.abricot },
  prepArcLeft: { left: 0, borderBottomColor: T.abricot, borderLeftColor: T.abricot },
  prepDot: { position: "absolute", top: -PREP_STROKE, width: PREP_STROKE, height: PREP_STROKE, borderRadius: PREP_STROKE / 2, backgroundColor: T.abricot },
  prepPct: { fontSize: 44, fontWeight: "800", color: T.night, letterSpacing: -1 },
  prepTitle: { fontSize: 24, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.4 },
  prepSub: { fontSize: 15, fontWeight: "600", color: T.inkSoft, textAlign: "center", marginTop: 6, marginBottom: 22 },
  prepCard: { backgroundColor: T.card, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 18, marginHorizontal: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  prepRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  prepCheck: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#F1ECE6", alignItems: "center", justifyContent: "center" },
  prepCheckOn: { backgroundColor: "#7ED3A4" },
  prepLabel: { flex: 1, fontSize: 15, fontWeight: "800", color: "#C9C1B8" },
  prepLabelOn: { color: T.night },
  prepTip: { flexDirection: "row", gap: 10, backgroundColor: T.chipAbricot, borderRadius: 18, padding: 16, marginHorizontal: 20, marginTop: 18 },
  prepTipText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: T.inkSoft, lineHeight: 20 },
  launchWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 26 },
  launchTitle: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.5, marginBottom: 12 },
  launchLead: { fontSize: 16, fontWeight: "600", color: T.inkSoft, lineHeight: 24 },

  cta: { backgroundColor: T.abricot, borderRadius: 16, padding: 17, alignItems: "center", marginHorizontal: 26, marginBottom: 28 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: T.night, fontSize: 16, fontWeight: "800" },
});