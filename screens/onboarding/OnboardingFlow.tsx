import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Animated, Easing, Image, Switch, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons, FontAwesome5 } from "@expo/vector-icons";
import { T } from "../../lib/theme";
import { L, Icon } from "../../components/lessonUi";
import { Goal, AgeRange, Gender, VoiceKey, FeedbackStyle, Blocker, DeadlineKind, DeadlineHorizon, AcquisitionSource, saveProfile } from "../../lib/profile";
import { GOALS, GENDERS, INTERESTS } from "../../lib/onboardingData";
import { Level, LEVEL_OPTIONS } from "../../lib/level";
import TimeWheel from "../../components/TimeWheel";
import PaywallScreen from "../PaywallScreen";
import { requestNotifPermission, scheduleDailyReminder } from "../../lib/notifications";
import { coachForVoice, LessonCoach } from "../../lib/learningPath/coaches";
import { LESSONS, getChapter, lessonsOfChapter } from "../../lib/learningPath/catalog";

// Écrans (steps) : 0 accueil + carrousel · 1 objectifs · 2 blocages · 3 auto-éval · 4 confiance + échéance · 5 plan
// 6 prénom · 7 métier/genre/voix/âge · 8 intérêts · 9 accompagnement · 10 où tu nous as connu · 11 rappel · 12 première leçon
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
const TOTAL = 13;
const STEP_BLOCKERS = 2;
const STEP_CONFIDENCE = 4;
const STEP_PLAN = 5;
const STEP_NAME = 6;
const STEP_ABOUT = 7;
const STEP_INTERESTS = 8;
const STEP_STYLE = 9;
const STEP_SOURCE = 10;
const STEP_REMINDER = 11;
const STEP_PREP = 12;
const QUESTION_STEPS = TOTAL - 2; // segments de la barre de progression (étapes 1 à 11)

// Blocages à l'oral (multi) + carte « miroir » affichée dès qu'un blocage est coché (le 1er coché donne le texte)
const BLOCKERS: { key: Blocker; icon: string; title: string; mirror: string }[] = [
  { key: "words", icon: "search", title: "Je cherche mes mots", mirror: "Chercher ses mots, c'est le blocage n°1 des francophones. Ici, « Aide-moi à dire » te donne la phrase en anglais à chaque fois que tu bloques." },
  { key: "mistakes", icon: "alert-circle", title: "J'ai peur de faire des fautes", mirror: "La peur des fautes fait taire la plupart des gens. Avec ton coach, l'erreur est attendue : il la corrige en une phrase, en français, et on continue." },
  { key: "dare", icon: "eye-off", title: "Je comprends, mais je n'ose pas", mirror: "Comprendre sans oser, c'est le signe que le niveau est là. Il manque les kilomètres de parole, et c'est exactement ce qu'on fait ici, sans personne pour te regarder." },
  { key: "accent", icon: "volume-2", title: "Mon accent me gêne", mirror: "Ton accent n'empêche personne de te comprendre. On travaille d'abord la fluidité, l'accent suit naturellement." },
  { key: "natives", icon: "users", title: "Je panique face à un natif", mirror: "Face à un natif, tout le monde accélère. Ton coach parle à la vitesse que tu choisis, et tu peux le réécouter autant que tu veux." },
];
const CONFIDENCE: { v: number; emoji: string; label: string }[] = [
  { v: 1, emoji: "😰", label: "Pas du tout" },
  { v: 2, emoji: "😕", label: "Peu" },
  { v: 3, emoji: "😐", label: "Moyennement" },
  { v: 4, emoji: "🙂", label: "Plutôt" },
  { v: 5, emoji: "😎", label: "Très" },
];
const confidenceMirror = (v: number) =>
  v <= 2 ? "On part de là, et c'est très bien : les premières leçons sont faites pour parler sans enjeu, à ton rythme."
  : v === 3 ? "Tu as des bases. On va les transformer en réflexes, pour que ça sorte sans réfléchir."
  : "Tu as déjà de l'aisance. On va la rendre plus naturelle et plus précise.";
const DEADLINES: { key: DeadlineKind; icon: string; label: string }[] = [
  { key: "interview", icon: "briefcase", label: "Un entretien" },
  { key: "trip", icon: "map", label: "Un voyage" },
  { key: "job", icon: "award", label: "Une prise de poste" },
  { key: "exam", icon: "file-text", label: "Un examen" },
  { key: "none", icon: "sun", label: "Rien de précis" },
];
const HORIZONS: { key: DeadlineHorizon; label: string }[] = [
  { key: "1m", label: "Moins d'un mois" },
  { key: "3m", label: "1 à 3 mois" },
  { key: "6m", label: "3 à 6 mois" },
  { key: "none", label: "Pas de date" },
];
// Icônes de marque (FontAwesome5 brands) pour les réseaux, Feather pour le reste
const SOURCES: { key: AcquisitionSource; icon: string; brand: boolean; label: string }[] = [
  { key: "instagram", icon: "instagram", brand: true, label: "Instagram" },
  { key: "tiktok", icon: "tiktok", brand: true, label: "TikTok" },
  { key: "youtube", icon: "youtube", brand: true, label: "YouTube" },
  { key: "play_store", icon: "google-play", brand: true, label: "Google Play" },
  { key: "word_of_mouth", icon: "message-circle", brand: false, label: "Bouche à oreille" },
  { key: "facebook", icon: "facebook", brand: true, label: "Facebook" },
  { key: "other", icon: "more-horizontal", brand: false, label: "Autre" },
];

// Accompagnement (maquette 04) : rythme des corrections, envoyé au serveur via le profil
const FEEDBACK_STYLES: { key: FeedbackStyle; title: string; desc: string }[] = [
  { key: "soft", title: "En douceur", desc: "L'essentiel, un point à la fois." },
  { key: "balanced", title: "Équilibré", desc: "Des corrections ciblées et des conseils." },
  { key: "strict", title: "Approfondi", desc: "Plus de détails pour affiner tes phrases." },
];

// Écran de préparation (hors parcours) : anneau 0 → 100 %
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
  { key: "us-female", label: "Emma · US" },
  { key: "us-male", label: "Sam · US" },
  { key: "uk-female", label: "Alice · UK" },
  { key: "uk-male", label: "James · UK" },
];

const BRAND_ICON = require("../../assets/icon.png");
// Écran d'accueil : deux bandes de scènes qui défilent lentement
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
const HERO_CARD_W = 168;
const HERO_CARD_GAP = 14;


// Première leçon du parcours (accueil + écran final)
const FIRST_LESSON = LESSONS[0] ?? null;
const FIRST_CHAPTER = FIRST_LESSON ? getChapter(FIRST_LESSON.chapterId) : null;
const FIRST_CHAPTER_LESSONS = FIRST_LESSON ? lessonsOfChapter(FIRST_LESSON.chapterId).slice(0, 3) : [];

const CECRL: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Niveau visé = deux crans au-dessus du niveau actuel (plafonné à C2)
function targetLevel(current: Level): Level {
  const i = CECRL.indexOf(current);
  return CECRL[Math.min(CECRL.length - 1, i + 2)];
}

export default function OnboardingFlow({ onLaunch, onLogin, skipPaywall = false }: { onLaunch: (goals: Goal[]) => void; onLogin?: () => void; skipPaywall?: boolean }) {
  const [step, setStep] = useState<Step>(0);
  const [launching, setLaunching] = useState(false);
  const [showBenefits, setShowBenefits] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [ageRange, setAgeRange] = useState<AgeRange | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [deadlineKind, setDeadlineKind] = useState<DeadlineKind | null>(null);
  const [deadlineHorizon, setDeadlineHorizon] = useState<DeadlineHorizon | null>(null);
  const [source, setSource] = useState<AcquisitionSource | null>(null);
  const [declaredLevel, setDeclaredLevel] = useState<Level | null>(null);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [voice, setVoice] = useState<VoiceKey>("us-male");
  const [interests, setInterests] = useState<string[]>([]);
  const [feedbackStyle, setFeedbackStyle] = useState<FeedbackStyle>("balanced");
  const [challenge, setChallenge] = useState(true);
  const [challengeOpen, setChallengeOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  // Heure proposée : la prochaine demi-heure ronde (11h17 → 11h30, 11h35 → 12h00)
  const [remHour, setRemHour] = useState(() => { const d = new Date(); const m = Math.ceil(d.getMinutes() / 30) * 30; return (d.getHours() + Math.floor(m / 60)) % 24; });
  const [remMinute, setRemMinute] = useState(() => (Math.ceil(new Date().getMinutes() / 30) * 30) % 60);
  const finalLevel: Level = declaredLevel ?? "B1";
  const goalTarget = targetLevel(finalLevel);

  const toggleBlocker = (k: Blocker) => setBlockers((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleGoal = (k: Goal) => setGoals((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleInterest = (i: string) =>
    setInterests((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < 5 ? [...p, i] : p));

  const next = () => setStep((s) => Math.min(TOTAL - 1, s + 1) as Step);
  const back = () => setStep((s) => Math.max(0, s - 1) as Step);

  // Étape 9 : la permission de notification est demandée ici, au moment où l'heure est choisie
  const confirmReminder = async () => {
    try {
      const granted = await requestNotifPermission();
      if (granted) await scheduleDailyReminder(remHour, remMinute);
    } catch (e) {
      console.warn("Rappel onboarding échoué:", e);
    }
    next();
  };

  const persistProfile = async () => {
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
        testScore: null,
        voice,
        feedbackStyle,
        challenge,
        blockers,
        confidence: confidence ?? undefined,
        deadline: deadlineKind ? { kind: deadlineKind, horizon: deadlineHorizon ?? "none" } : undefined,
        acquisition: source ?? undefined,
      });
    } catch (e) {
      console.warn("Sauvegarde onboarding échouée:", e);
    } finally {
      setSaving(false);
    }
  };

  // Filet de sécurité : le profil est enregistré dès l'arrivée sur l'écran de préparation.
  // Si l'app est fermée à ce moment-là, l'utilisateur ne refait pas tout l'onboarding.
  useEffect(() => {
    if (step === STEP_PREP) persistProfile();
  }, [step]);

  // Le paywall s'affiche tout de suite (le profil est déjà sauvegardé) — sauf pour la cohorte « parcours »
  const finishToLaunch = () => {
    if (skipPaywall) setLaunching(true);
    else setShowPaywall(true);
  };

  const canContinue =
    step === 0 ||
    (step === 1 && goals.length > 0) ||
    (step === STEP_BLOCKERS && blockers.length > 0) ||
    (step === 3 && !!declaredLevel) ||
    (step === STEP_CONFIDENCE && confidence !== null && !!deadlineKind && (deadlineKind === "none" || !!deadlineHorizon)) ||
    step === STEP_PLAN ||
    (step === STEP_NAME && name.trim().length > 0) ||
    (step === STEP_ABOUT && !!gender) ||
    step === STEP_INTERESTS ||
    step === STEP_STYLE ||
    (step === STEP_SOURCE && !!source) ||
    step === STEP_REMINDER ||
    step === STEP_PREP;

  const coach = coachForVoice(voice);
  // Lignes du plan : ses propres réponses, en clair
  const planLines: { k: string; v: string }[] = [
    { k: "Ton objectif", v: goals.map((g) => GOALS.find((x) => x.key === g)?.title).filter(Boolean).slice(0, 2).join(" · ") || "Parler avec plus d'aisance" },
    { k: "Ton blocage", v: blockers.map((b) => BLOCKERS.find((x) => x.key === b)?.title.toLowerCase()).filter(Boolean).slice(0, 2).join(", ") || "—" },
    ...(deadlineKind && deadlineKind !== "none"
      ? [{ k: "Ton échéance", v: `${DEADLINES.find((d) => d.key === deadlineKind)?.label ?? ""}${deadlineHorizon && deadlineHorizon !== "none" ? ` · ${HORIZONS.find((h) => h.key === deadlineHorizon)?.label.toLowerCase()}` : ""}` }]
      : []),
  ];

  // Paywall après la préparation du coach : fermeture possible au bout de 7 s, puis écran « Bienvenue »
  if (showPaywall) {
    const toWelcome = () => {
      setShowPaywall(false);
      setLaunching(true);
    };
    return (
      <PaywallScreen
        planLabel={`${finalLevel} → ${goalTarget}`}
        onClose={toWelcome}
        onPurchased={toWelcome}
      />
    );
  }

  if (launching) {
    return (
      <View style={styles.container}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.launchWrap}>
          <View style={styles.blobWrap}>
            <View style={styles.blob1} />
            <View style={styles.blob2} />
          </View>
          <Text style={styles.launchTitle}>
            {name.trim() ? `Bienvenue, ${name.trim()}.` : "Bienvenue."}
          </Text>
          <Text style={styles.launchLead}>
            {skipPaywall
              ? "Ta première leçon t'attend : une courte rencontre en anglais, et Sam te guide à chaque étape."
              : "Ta conversation de présentation t'attend dans l'app. Pas de stress : tu parles, on t'écoute, et on te guide pas à pas."}
          </Text>
        </View>
        </ScrollView>
        <Pressable onPress={() => onLaunch(goals)} style={styles.cta}>
          <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>{skipPaywall ? "Commencer ma première leçon" : "Découvrir l'app"}</Text>
        </Pressable>
      </View>
    );
  }

  // 0 — Écran d'accueil animé (plein écran, sans barre de progression)
  // 0 bis — Carrousel des bénéfices, juste après l'accueil
  if (step === 0) {
    return showBenefits ? (
      <BenefitsCarousel coach={coachForVoice(null)} onDone={next} onBack={() => setShowBenefits(false)} />
    ) : (
      <WelcomeHero onStart={() => setShowBenefits(true)} onLogin={onLogin} />
    );
  }

  // 10 — Première leçon (parcours) ou préparation du coach + paywall (hors parcours)
  if (step === STEP_PREP) {
    if (skipPaywall) return <FirstLessonScreen coach={coach} saving={saving} onStart={() => onLaunch(goals)} onBack={back} />;
    const picked = interests.slice(0, 2).map((i) => i.toLowerCase()).join(", ");
    return <PrepScreen sceneHint={picked} saving={saving} onDone={finishToLaunch} lessonMode={skipPaywall} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="chevron-left" size={24} color={T.night} />
        </Pressable>
        <View style={styles.segments} accessibilityLabel={`Étape ${step} sur ${QUESTION_STEPS}`}>
          {Array.from({ length: QUESTION_STEPS }).map((_, i) => (
            <View key={i} style={[styles.segment, i + 1 < step && styles.segmentDone, i + 1 === step && styles.segmentOn]} />
          ))}
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

        {/* 2 — Blocages à l'oral + carte miroir */}
        {step === STEP_BLOCKERS && (
          <View>
            <Text style={styles.title}>Qu'est-ce qui te bloque{"\n"}le plus à l'oral ?</Text>
            <Text style={styles.sub}>Coche tout ce qui te parle. C'est là-dessus qu'on va travailler.</Text>
            {BLOCKERS.map((b) => {
              const on = blockers.includes(b.key);
              return (
                <Pressable key={b.key} onPress={() => toggleBlocker(b.key)} style={[styles.selectCard, on && styles.selectCardOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <View style={[styles.selectIcon, on && styles.selectIconOn]}><Feather name={b.icon as any} size={20} color={on ? T.night : T.abricotDeep} /></View>
                  <Text style={[styles.selectTitle, { flex: 1 }]}>{b.title}</Text>
                  {on && <Feather name="check-circle" size={20} color={T.abricotDeep} />}
                </Pressable>
              );
            })}
            {blockers.length > 0 && <MirrorCard text={BLOCKERS.find((b) => b.key === blockers[0])!.mirror} />}
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

        {/* 4 — Confiance + échéance + carte miroir */}
        {step === STEP_CONFIDENCE && (
          <View>
            <Text style={styles.title}>À quel point tu te sens{"\n"}à l'aise pour parler ?</Text>
            <Text style={styles.sub}>Aujourd'hui, sans tricher. On mesurera le chemin parcouru.</Text>
            <View style={styles.confRow}>
              {CONFIDENCE.map((c) => {
                const on = confidence === c.v;
                return (
                  <Pressable key={c.v} onPress={() => setConfidence(c.v)} style={[styles.confChip, on && styles.confChipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${c.label} à l'aise`}>
                    <Text style={styles.confEmoji}>{c.emoji}</Text>
                    <Text style={[styles.confLabel, on && styles.confLabelOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {confidence !== null && <MirrorCard text={confidenceMirror(confidence)} />}

            <Text style={styles.fieldLabel}>TU AS UNE ÉCHÉANCE ?</Text>
            <View style={styles.chipWrap}>
              {DEADLINES.map((d) => {
                const on = deadlineKind === d.key;
                return (
                  <Pressable key={d.key} onPress={() => { setDeadlineKind(d.key); if (d.key === "none") setDeadlineHorizon("none"); }} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Feather name={d.icon as any} size={15} color={on ? T.night : T.inkSoft} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {deadlineKind && deadlineKind !== "none" && (
              <>
                <Text style={styles.fieldLabel}>C'EST POUR QUAND ?</Text>
                <View style={styles.chipWrap}>
                  {HORIZONS.map((h) => {
                    const on = deadlineHorizon === h.key;
                    return (
                      <Pressable key={h.key} onPress={() => setDeadlineHorizon(h.key)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{h.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </View>
        )}

        {/* 5 — Plan : reprend ses mots (blocage, objectif, échéance, confiance) */}
        {step === STEP_PLAN && (
          <View>
            <Text style={styles.title}>Voilà ton plan.</Text>
            <Text style={styles.sub}>De là où tu es, jusqu'où on veut t'emmener.</Text>

            <View style={styles.planCard}>
              {planLines.map((l) => (
                <View key={l.k} style={styles.planRow}>
                  <Text style={styles.planK}>{l.k}</Text>
                  <Text style={styles.planV}>{l.v}</Text>
                </View>
              ))}
              {confidence !== null && (
                <View style={[styles.planRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.planK}>Aisance</Text>
                  <Text style={styles.planV}>{confidence}/5 aujourd'hui → <Text style={{ color: T.abricotDeep }}>{Math.min(5, confidence + 2)}/5</Text> visé</Text>
                </View>
              )}
            </View>

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

        {/* 6 — Prénom */}
        {step === STEP_NAME && (
          <View>
            <Text style={styles.title}>Comment on t'appelle ?</Text>
            <Text style={styles.sub}>Prénom ou pseudo — pour que tout te soit adressé personnellement.</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Ton prénom" placeholderTextColor={T.inkSoft} style={styles.input} returnKeyType="done" autoFocus maxLength={24} />
          </View>
        )}

        {/* 7 — Métier + genre + voix + âge (optionnel) */}
        {step === STEP_ABOUT && (
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
            <Text style={styles.fieldLabel}>TON ÂGE (OPTIONNEL)</Text>
            <View style={styles.chipWrap}>
              {AGE_OPTIONS.map((a) => {
                const on = ageRange === a.key;
                return (
                  <Pressable key={a.key} onPress={() => setAgeRange(on ? null : a.key)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* 8 — Intérêts */}
        {step === STEP_INTERESTS && (
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

        {/* 9 — Accompagnement (maquette 04) */}
        {step === STEP_STYLE && (
          <View>
            <Text style={styles.title}>Comment veux-tu{"\n"}être accompagné ?</Text>
            <Text style={styles.sub}>Choisis le rythme des corrections.</Text>
            {FEEDBACK_STYLES.map((s) => {
              const on = feedbackStyle === s.key;
              return (
                <Pressable key={s.key} onPress={() => setFeedbackStyle(s.key)} style={[styles.radioCard, on && styles.radioCardOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.radioTitle}>{s.title}</Text>
                    <Text style={styles.radioDesc}>{s.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Text style={styles.styleNote}>Tu pourras modifier ce choix plus tard.</Text>

            <View style={styles.divider} />
            <Pressable onPress={() => setChallengeOpen((v) => !v)} style={styles.collapseRow} accessibilityRole="button" accessibilityState={{ expanded: challengeOpen }}>
              <Text style={styles.collapseTitle}>Quand cela devient facile</Text>
              <Feather name={challengeOpen ? "chevron-up" : "chevron-down"} size={22} color={T.night} />
            </Pressable>
            {challengeOpen && (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Me proposer un peu plus de défi</Text>
                <Switch value={challenge} onValueChange={setChallenge} trackColor={{ true: T.abricot, false: T.creamLine }} thumbColor="#fff" />
              </View>
            )}
          </View>
        )}

        {/* 10 — Où tu nous as connu */}
        {step === STEP_SOURCE && (
          <View>
            <Text style={styles.title}>Où as-tu entendu parler{"\n"}de Déclic Anglais ?</Text>
            <Text style={styles.sub}>Ça nous aide à savoir où aller chercher les prochains élèves.</Text>
            <View style={styles.chipWrap}>
              {SOURCES.map((o) => {
                const on = source === o.key;
                return (
                  <Pressable key={o.key} onPress={() => setSource(o.key)} style={[styles.chip, styles.chipBig, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    {o.brand
                      ? <FontAwesome5 name={o.icon} brand size={15} color={on ? T.night : T.inkSoft} />
                      : <Feather name={o.icon as any} size={16} color={on ? T.night : T.inkSoft} />}
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

      {/* 11 — Rappel quotidien */}
      {step === STEP_REMINDER && (
        <View>
          <Text style={styles.title}>Ton rendez-vous quotidien.</Text>
          <Text style={styles.sub}>Choisis l'heure de ton rappel — dix minutes par jour, à ton moment à toi.</Text>
          <TimeWheel hour={remHour} minute={remMinute} onChange={(h, m) => { setRemHour(h); setRemMinute(m); }} />
        </View>
      )}

      </ScrollView>

      <Pressable onPress={step === STEP_REMINDER ? confirmReminder : next} disabled={!canContinue} style={[styles.cta, !canContinue && styles.ctaOff]}>
        <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>Continuer</Text>
      </Pressable>
    </View>
  );
}


// Carte « miroir » : on reformule ce que l'utilisateur vient de dire et on lui répond
function MirrorCard({ text }: { text: string }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { a.setValue(0); Animated.timing(a, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(); }, [text]);
  return (
    <Animated.View style={[styles.mirror, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]} accessibilityLiveRegion="polite">
      <View style={styles.mirrorIcon}><Feather name="message-circle" size={16} color={T.night} /></View>
      <Text style={styles.mirrorText}>{text}</Text>
    </Animated.View>
  );
}

// Première leçon (maquette 05) : « Ta première leçon t'attend », carte de la leçon avec le coach choisi
function FirstLessonScreen({ coach, saving, onStart, onBack }: { coach: LessonCoach; saving: boolean; onStart: () => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const lessonTitle = FIRST_LESSON?.titleFr ?? "Se présenter";
  const chapterTitle = FIRST_CHAPTER?.titleFr ?? "Faire connaissance";
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="chevron-left" size={24} color={T.night} />
        </Pressable>
        <View style={styles.segments}>
          {Array.from({ length: QUESTION_STEPS }).map((_, i) => <View key={i} style={[styles.segment, styles.segmentDone, i === QUESTION_STEPS - 1 && styles.segmentOn]} />)}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "center" }}>
          <View style={styles.readyCheck}><Feather name="check" size={22} color={T.night} /></View>
          <Text style={[styles.title, { textAlign: "center", fontSize: 30, lineHeight: 36 }]}>Ta première leçon{"\n"}t'attend</Text>
          <Text style={[styles.sub, { textAlign: "center" }]}>Commence par un échange simple{"\n"}avec ton coach.</Text>
        </View>

        <View style={styles.lessonCard}>
          <Text style={styles.lessonK}>CHAPITRE 1 · {chapterTitle.toUpperCase()}</Text>
          <Text style={styles.lessonTitle}>{lessonTitle}</Text>
          <Text style={styles.lessonSub}>Fais connaissance avec {coach.displayName}.</Text>
          <View style={styles.lessonCoachRow}>
            <Image source={coach.poster} style={styles.lessonCoachImg} resizeMode="cover" />
            <View>
              <Text style={styles.lessonCoachName}>{coach.displayName} · Coach IA</Text>
              <Text style={styles.lessonCoachAccent}>{coach.accent === "en-GB" ? "Anglais britannique" : "Anglais américain"}</Text>
            </View>
          </View>
          <View style={styles.lessonDivider} />
          <Text style={styles.lessonDuring}>Pendant cette leçon</Text>
          {["Tu parles à ton rythme", `${coach.displayName} te guide et t'explique`].map((t) => (
            <View key={t} style={styles.lessonCheckRow}>
              <View style={styles.lessonCheck}><Feather name="check" size={14} color={T.night} /></View>
              <Text style={styles.lessonCheckText}>{t}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.readyNote}>Les échanges s'adaptent au niveau{"\n"}que tu as indiqué.</Text>
      </ScrollView>

      <Pressable onPress={onStart} disabled={saving} style={[styles.cta, { marginBottom: 10 }, saving && styles.ctaOff]} accessibilityRole="button">
        <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>{saving ? "…" : "Commencer ma première leçon"}</Text>
      </Pressable>
      <Text style={styles.readyFoot}>Tu vas parler avec {coach.displayName}.</Text>
    </View>
  );
}

// Écran d'accueil : logo, deux bandes de scènes en défilement lent, bulles flottantes
function WelcomeHero({ onStart, onLogin }: { onStart: () => void; onLogin?: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const marqueeH = Math.min(330, Math.max(220, height * 0.38));
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

      <View style={[styles.marquee, { height: marqueeH }]}>
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroText}>
          <Text style={styles.big}>Parle anglais</Text>
          <Text style={styles.bigAccent}>sans bloquer.</Text>
          <Text style={styles.lead}>
            Ton coach vocal t'écoute, te répond et te corrige avec douceur. Dix minutes par jour suffisent.
          </Text>
        </View>

        <Pressable onPress={onStart} style={[styles.cta, { marginBottom: onLogin ? 16 : 0 }]}>
          <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>Commencer</Text>
        </Pressable>
        {onLogin ? (
          <Pressable onPress={onLogin} hitSlop={10} style={{ alignSelf: "center", paddingVertical: 4 }}>
            <Text style={styles.heroLogin}>J'ai déjà un compte</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

// Carrousel (maquettes 02 et 03) : deux écrans qui montrent l'app elle-même, reconstitués en composants
const BENEFITS = [
  { key: "talk", title: "Parle avec", accent: "ton coach IA", text: "Des échanges courts, avec un objectif clair." },
  { key: "fix", title: "Comprends,", accent: "puis réessaie", text: "Une correction utile, expliquée simplement en français." },
] as const;

function BenefitsCarousel({ coach, onDone, onBack }: { coach: LessonCoach; onDone: () => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const goTo = (i: number) => { scrollRef.current?.scrollTo({ x: i * width, animated: true }); setIndex(i); };
  const onContinue = () => (index < BENEFITS.length - 1 ? goTo(index + 1) : onDone());

  return (
    <View style={[styles.heroScreen, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.carouselBar}>
        <Pressable onPress={index === 0 ? onBack : () => goTo(index - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="chevron-left" size={24} color={T.night} />
        </Pressable>
        <Pressable onPress={onDone} hitSlop={10} accessibilityRole="button"><Text style={styles.skipText}>Passer</Text></Pressable>
      </View>

      <ScrollView ref={scrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }} onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {BENEFITS.map((b) => (
          <ScrollView key={b.key} style={{ width }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.benefitTitle}>{b.title}</Text>
            <Text style={[styles.benefitTitle, { color: T.abricotDeep }]}>{b.accent}</Text>
            <Text style={styles.benefitLead}>{b.text}</Text>
            <MockChat coach={coach} variant={b.key} />
          </ScrollView>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {BENEFITS.map((b, i) => <View key={b.key} style={i === index ? styles.dotActive : styles.dot} />)}
      </View>
      <Pressable onPress={onContinue} style={styles.cta} accessibilityRole="button">
        <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>Continuer</Text>
      </Pressable>
    </View>
  );
}

// Reconstitution de l'écran de leçon (non interactive)
function MockChat({ coach, variant }: { coach: LessonCoach; variant: "talk" | "fix" }) {
  const name = coach.displayName;
  const actions = (
    <View style={styles.mockActions}>
      <View style={styles.mockAction}><Icon name="ecouter" size={15} /><Text style={styles.mockActionText}>Écouter</Text></View>
      <Text style={styles.mockActionText}>·</Text>
      <View style={styles.mockAction}><Icon name="traduire" size={15} /><Text style={styles.mockActionText}>Traduire</Text></View>
    </View>
  );
  const coachBubble = (text: string) => (
    <View style={styles.mockCoach}>
      <Text style={styles.mockCoachText}>{text}</Text>
      <View style={styles.mockSpeaker}><Icon name="ecouter" size={16} /></View>
    </View>
  );
  return (
    <View style={styles.mockCard} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.mockHead}>
        <Image source={coach.poster} style={styles.mockAvatar} resizeMode="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.mockName}>{name} · Coach IA</Text>
          <Text style={styles.mockRole}>Se présenter</Text>
        </View>
        <View style={styles.mockObjective}><Icon name="fleche" size={14} tint={L.lavenderText} /><Text style={styles.mockObjectiveText}>Dire où tu habites</Text></View>
      </View>

      {variant === "talk" ? (
        <>
          {coachBubble("Hi! Where do you live?")}
          {actions}
          <View style={styles.mockUser}><Text style={styles.mockUserText}>I live in Lyon.</Text></View>
          {coachBubble("Nice! What do you like about Lyon?")}
          {actions}
          <View style={styles.mockHelpRow}>
            <View style={[styles.mockHelp, { backgroundColor: L.accentSoft }]}><Icon name="aide" size={15} tint={L.accentDeep} /><Text style={[styles.mockHelpText, { color: L.accentDeep }]}>Un indice</Text></View>
            <View style={[styles.mockHelp, { backgroundColor: L.lavender }]}><Icon name="exemple" size={15} tint={L.lavenderText} /><Text style={[styles.mockHelpText, { color: L.lavenderText }]}>Un exemple</Text></View>
          </View>
        </>
      ) : (
        <>
          <View style={styles.mockUser}><Text style={styles.mockUserText}>I am live in Lyon.</Text></View>
          <View style={styles.mockFix}>
            <View style={styles.mockFixHead}><View style={styles.mockFixIcon}><Feather name="edit-2" size={12} color={L.lavenderText} /></View><Text style={styles.mockFixTitle}>Petite correction</Text></View>
            <View style={styles.mockFixInner}>
              <Text style={styles.mockFixPhrase}>I <Text style={styles.mockFixWord}> live </Text> in Lyon.</Text>
              <Text style={styles.mockFixExpl}>Avec « live », pas besoin de « am ».</Text>
              <View style={styles.mockFixActions}>
                <View style={styles.mockAction}><Icon name="ecouter" size={15} /><Text style={styles.mockFixActionText}>Écouter</Text></View>
                <View style={styles.mockRetry}><Icon name="rejouer" size={14} tint={L.lavenderText} /><Text style={styles.mockRetryText}>Réessayer</Text></View>
              </View>
            </View>
          </View>
          {coachBubble("Great! What do you like about Lyon?")}
        </>
      )}

      <View style={styles.mockComposer}>
        <View style={styles.mockKeyboard}><Icon name="clavier" size={18} /></View>
        <View style={{ alignItems: "center" }}>
          <View style={styles.mockMic}><Icon name="micro" size={26} tint="#fff" /></View>
          <Text style={styles.mockMicLabel}>Maintiens pour parler</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>
    </View>
  );
}

// Préparation du coach : anneau 0 → 100 %, les étapes passent au vert une à une
function PrepScreen({ sceneHint, saving, onDone, lessonMode }: { sceneHint: string; saving: boolean; onDone: () => void; lessonMode: boolean }) {
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
    { label: lessonMode ? "Préparation de ta 1re leçon" : "Préparation de ta 1re conversation", at: 100 },
  ];
  const ready = pct >= 100;

  // Anneau : deux demi-cercles qui pivotent (droite de 0 à 50 %, gauche de 50 à 100 %)
  const rightRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-135deg", "45deg", "45deg"] });
  const leftRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-135deg", "-135deg", "45deg"] });

  return (
    <View style={[styles.heroScreen, { paddingBottom: insets.bottom + 16 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 36, paddingBottom: 16 }}>
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
          Mieux vaut 10 minutes chaque jour qu'une heure le dimanche : c'est la régularité qui crée l'apprentissage.
        </Text>
      </View>

      </ScrollView>

      <Pressable onPress={onDone} disabled={!ready || saving} style={[styles.cta, { marginTop: 12 }, (!ready || saving) && styles.ctaOff]}>
        <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>{saving ? "…" : lessonMode ? "C'est parti" : "Voir mon offre"}</Text>
      </Pressable>
    </View>
  );
}

// Écran d'accueil : logo, deux bandes de scènes en défilement lent, bulles flottantes

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
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginBottom: 20, gap: 14 },
  segments: { flex: 1, flexDirection: "row", gap: 6 },
  segment: { flex: 1, height: 7, borderRadius: 4, backgroundColor: T.creamLine },
  segmentDone: { backgroundColor: "#F6D9BF" },
  segmentOn: { backgroundColor: T.abricot },
  scroll: { paddingHorizontal: 26, paddingBottom: 20 },


  heroScreen: { flex: 1, backgroundColor: T.cream },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22 },
  brandIcon: { width: 56, height: 56, borderRadius: 16 },
  brandName: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.8, lineHeight: 32 },
  brandSub: { fontSize: 11, fontWeight: "800", color: T.inkSoft, letterSpacing: 4, marginTop: 2 },
  skipText: { color: T.inkSoft, fontSize: 14.5, fontWeight: "800" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, marginVertical: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.creamLine },
  dotActive: { width: 12, height: 12, borderRadius: 6, backgroundColor: T.abricot, borderWidth: 2, borderColor: T.chipAbricot },
  heroLogin: { color: T.inkSoft, fontSize: 14.5, fontWeight: "800" },
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


  // Carrousel (02 / 03)
  carouselBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, marginBottom: 10 },
  benefitTitle: { fontSize: 30, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.6, lineHeight: 36 },
  benefitLead: { fontSize: 15.5, color: T.inkSoft, textAlign: "center", lineHeight: 22, marginTop: 8, marginBottom: 16 },
  mockCard: { backgroundColor: T.card, borderRadius: 24, padding: 14, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  mockHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  mockAvatar: { width: 46, height: 46, borderRadius: 12 },
  mockName: { color: T.night, fontSize: 14, fontWeight: "800" },
  mockRole: { color: T.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 1 },
  mockObjective: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: L.lavender, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 10 },
  mockObjectiveText: { color: L.lavenderText, fontSize: 12, fontWeight: "800" },
  mockCoach: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.cream, borderRadius: 16, borderWidth: 1, borderColor: "#EFE8DF", padding: 12, marginRight: 24 },
  mockCoachText: { flex: 1, color: T.night, fontSize: 15.5, lineHeight: 22 },
  mockSpeaker: { width: 32, height: 32, borderRadius: 16, backgroundColor: T.card, borderWidth: 1, borderColor: "#EFE8DF", alignItems: "center", justifyContent: "center" },
  mockActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 12, paddingLeft: 4 },
  mockAction: { flexDirection: "row", alignItems: "center", gap: 5 },
  mockActionText: { color: T.inkSoft, fontSize: 12.5, fontWeight: "700" },
  mockUser: { alignSelf: "flex-end", backgroundColor: L.accentSoft, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12, maxWidth: "80%" },
  mockUserText: { color: T.night, fontSize: 15.5, fontWeight: "600" },
  mockHelpRow: { flexDirection: "row", gap: 10, marginTop: 2, marginBottom: 12 },
  mockHelp: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 16, paddingVertical: 11 },
  mockHelpText: { fontSize: 13.5, fontWeight: "800" },
  mockFix: { backgroundColor: L.lavender, borderRadius: 18, padding: 10, marginBottom: 12 },
  mockFixHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  mockFixIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#DCD9F8", alignItems: "center", justifyContent: "center" },
  mockFixTitle: { color: L.lavenderText, fontSize: 14, fontWeight: "800" },
  mockFixInner: { backgroundColor: T.card, borderRadius: 14, padding: 12 },
  mockFixPhrase: { color: T.night, fontSize: 17, fontWeight: "700", lineHeight: 26 },
  mockFixWord: { backgroundColor: "#DDF3E7", color: "#1F7A52", borderRadius: 6, overflow: "hidden" },
  mockFixExpl: { color: T.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 6 },
  mockFixActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  mockFixActionText: { color: T.night, fontSize: 13, fontWeight: "700" },
  mockRetry: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: L.lavender, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
  mockRetryText: { color: L.lavenderText, fontSize: 13, fontWeight: "800" },
  mockComposer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#EFE8DF", borderRadius: 40, paddingVertical: 8, paddingHorizontal: 10, marginTop: 4 },
  mockKeyboard: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.cream, borderWidth: 1, borderColor: "#EFE8DF", alignItems: "center", justifyContent: "center" },
  mockMic: { width: 62, height: 62, borderRadius: 31, backgroundColor: L.accentDeep, alignItems: "center", justifyContent: "center", marginTop: -26, borderWidth: 4, borderColor: T.card },
  mockMicLabel: { color: T.inkSoft, fontSize: 11.5, fontWeight: "600", marginTop: 4 },

  // Blocages / confiance / échéance / source
  mirror: { flexDirection: "row", gap: 12, backgroundColor: T.night, borderRadius: 18, padding: 16, marginTop: 8 },
  mirrorIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },
  mirrorText: { flex: 1, color: "#fff", fontSize: 14.5, fontWeight: "600", lineHeight: 21 },
  confRow: { flexDirection: "row", gap: 6 },
  confChip: { flex: 1, alignItems: "center", backgroundColor: T.card, borderRadius: 16, paddingVertical: 12, borderWidth: 2, borderColor: "transparent" },
  confChipOn: { borderColor: T.abricot, backgroundColor: "#FFF4EA" },
  confEmoji: { fontSize: 26 },
  confLabel: { color: T.inkSoft, fontSize: 10.5, fontWeight: "800", marginTop: 6, textAlign: "center" },
  confLabelOn: { color: T.night },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: T.card, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 2, borderColor: "transparent" },
  chipBig: { flexBasis: "47%", flexGrow: 1, paddingVertical: 14 },
  chipOn: { borderColor: T.abricot, backgroundColor: "#FFF4EA" },
  chipText: { color: T.inkSoft, fontSize: 14, fontWeight: "700" },
  chipTextOn: { color: T.night },
  planCard: { backgroundColor: T.card, borderRadius: 18, paddingHorizontal: 16, marginBottom: 14 },
  planRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.creamLine },
  planK: { width: 104, color: T.inkSoft, fontSize: 13, fontWeight: "800" },
  planV: { flex: 1, color: T.night, fontSize: 14.5, fontWeight: "700", lineHeight: 20 },

  // Accompagnement (04)
  radioCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.card, borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 2, borderColor: "transparent" },
  radioCardOn: { borderColor: T.abricot, backgroundColor: "#FFF4EA" },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "#CFC8BE", alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: T.abricotDeep },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: T.abricotDeep },
  radioTitle: { color: T.night, fontSize: 17, fontWeight: "800" },
  radioDesc: { color: T.inkSoft, fontSize: 14, fontWeight: "600", lineHeight: 20, marginTop: 2 },
  styleNote: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", textAlign: "center", marginTop: 8 },
  divider: { height: 1, backgroundColor: T.creamLine, marginVertical: 22 },
  collapseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  collapseTitle: { color: T.night, fontSize: 18, fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  switchLabel: { flex: 1, color: T.night, fontSize: 15.5, fontWeight: "600", paddingRight: 12 },

  // Première leçon (05)
  readyCheck: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  lessonCard: { backgroundColor: T.card, borderRadius: 22, padding: 18, marginTop: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  lessonK: { color: T.abricotDeep, fontSize: 11.5, fontWeight: "800", letterSpacing: 1 },
  lessonTitle: { color: T.night, fontSize: 26, fontWeight: "800", letterSpacing: -0.4, marginTop: 6 },
  lessonSub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", marginTop: 4 },
  lessonCoachRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 16 },
  lessonCoachImg: { width: 150, aspectRatio: 0.95, borderRadius: 16, backgroundColor: "#FDDCBE" },
  lessonCoachName: { color: T.night, fontSize: 16, fontWeight: "800" },
  lessonCoachAccent: { color: T.inkSoft, fontSize: 14, fontWeight: "600", marginTop: 3 },
  lessonDivider: { height: 1, backgroundColor: T.creamLine, marginVertical: 18 },
  lessonDuring: { color: T.night, fontSize: 17, fontWeight: "800", marginBottom: 10 },
  lessonCheckRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  lessonCheck: { width: 30, height: 30, borderRadius: 15, backgroundColor: T.menthe, alignItems: "center", justifyContent: "center" },
  lessonCheckText: { color: T.night, fontSize: 15.5, fontWeight: "600" },
  readyNote: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", textAlign: "center", marginTop: 16, lineHeight: 19 },
  readyFoot: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", textAlign: "center", marginBottom: 6 },

  // Écran « Bienvenue » (hors parcours, après le paywall)
  blobWrap: { height: 120, marginBottom: 20, alignItems: "center", justifyContent: "center" },
  blob1: { position: "absolute", width: 130, height: 130, borderRadius: 65, backgroundColor: T.abricot, opacity: 0.9, transform: [{ scaleX: 1.15 }] },
  blob2: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: T.miel, right: 60, top: 10 },
  launchWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 26 },
  launchTitle: { fontSize: 30, fontWeight: "800", color: T.night, letterSpacing: -0.5, marginBottom: 12 },
  launchLead: { fontSize: 16, fontWeight: "600", color: T.inkSoft, lineHeight: 24 },

  cta: { backgroundColor: T.abricot, borderRadius: 18, padding: 18, alignItems: "center", marginHorizontal: 22, marginBottom: 18 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: T.night, fontSize: 17, fontWeight: "800" },
});
