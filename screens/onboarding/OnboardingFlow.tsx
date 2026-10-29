// OnboardingFlow — onboarding v2 (maquettes du 29/10) : 01 accueil · 02 objectif · 03 blocage · 04 niveau + prénom · 05 coach
// · 06 brief café · 07 conversation café (DiscoveryCafeScreen) · 08 bilan café · 09 paywall (contexte after_coffee)
// · 10 présentation offerte (si offre fermée) ou 11 parcours débloqué (si achat) · puis onLaunch → première leçon du parcours.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Image, ActivityIndicator } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../lib/firebase";
import { Goal, Blocker, VoiceKey, saveProfile } from "../../lib/profile";
import type { Level } from "../../lib/level";
import { COACHES, LessonCoach, coachForVoice, CoachId } from "../../lib/learningPath/coaches";
import { LESSONS } from "../../lib/learningPath/catalog";
import { DISCOVERY_TITLE_FR, DISCOVERY_GOALS_FR } from "../../lib/learningPath/discovery";
import type { AttemptResult } from "../../lib/learningPath/types";
import { logOnboardingComplete, logOnboardingStepViewed, logOnboardingStepCompleted, logCoachPreviewPlayed, logPaywallShown } from "../../lib/analytics";
import PaywallScreen from "../PaywallScreen";
import DiscoveryCafeScreen from "./DiscoveryCafeScreen";
import { O, IMAGES, OnbIcon, IconDisc, PrimaryCta, SecondaryLink, TopBar, Title, Subtitle, ChoiceCard, CoachNote, InfoLine, Chip, CoachMedallion, s as ui, OnbIconName } from "../../components/onbUi";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });
const BRAND_ICON = require("../../assets/icon.png");

type Phase = "welcome" | "goal" | "blocker" | "level" | "coach" | "brief" | "cafe" | "summary" | "paywall" | "offer" | "unlocked";
const QUESTION_STEPS = 4; // segments : objectif · blocage · niveau · coach

// 02 — Où aimerais-tu te sentir à l'aise ? (« En entretien » remplacé par « Pour les études », demande du 29/10)
const GOALS: { key: Goal; title: string; desc: string; image: any; where: string }[] = [
  { key: "voyage", title: "En voyage", desc: "Café, hôtel, rencontres", image: IMAGES.goalTravel, where: "ton prochain voyage" },
  { key: "travail", title: "Au travail", desc: "Réunions et échanges", image: IMAGES.goalWork, where: "ton travail" },
  { key: "etudes", title: "Pour les études", desc: "Cours, exposés, échanges", image: IMAGES.goalStudies, where: "tes études" },
  { key: "quotidien", title: "Au quotidien", desc: "Discuter spontanément", image: IMAGES.goalDaily, where: "ton quotidien" },
];
// 03 — Qu'est-ce qui te freine le plus ? + rassurance (copy.fr.json)
const BLOCKERS: { key: Blocker; icon: OnbIconName; bg: string; tint: string; title: string; desc: string; reassureTitle: string; reassure: (c: string) => string }[] = [
  { key: "mistakes", icon: "sad", bg: "#FFE4CC", tint: O.primary, title: "J'ai peur de faire des fautes", desc: "Et d'être mal compris.", reassureTitle: "Ici, tu peux te tromper.", reassure: (c) => `${c} t'aide en français, puis te laisse réessayer tranquillement.` },
  { key: "words", icon: "brain", bg: O.mint, tint: O.success, title: "Je cherche mes mots", desc: "Les idées sont là, mais pas les mots.", reassureTitle: "Un mot te manque ?", reassure: (c) => `${c} te propose un indice pour continuer.` },
  { key: "dare", icon: "user", bg: O.lavender, tint: O.lavenderInk, title: "Je comprends, mais je n'ose pas", desc: "Parler me stresse encore.", reassureTitle: "Prends ton temps.", reassure: () => "Tu peux essayer, écouter et recommencer." },
  { key: "listening", icon: "ear", bg: "#E3F0FB", tint: "#2E6BB5", title: "J'ai du mal à comprendre", desc: "Surtout quand les gens parlent vite.", reassureTitle: "Tu ne seras jamais perdu.", reassure: () => "Tu peux réécouter et afficher une traduction quand tu en as besoin." },
];
// 04 — Niveau déclaré (pas de test)
const LEVELS: { key: string; level: Level; icon: OnbIconName; bg: string; tint: string; title: string; desc: string }[] = [
  { key: "start", level: "A1" as Level, icon: "sprout", bg: O.mint, tint: O.success, title: "Je débute", desc: "Quelques mots, c'est déjà un début." },
  { key: "basics", level: "A2" as Level, icon: "bars", bg: "#FFE4CC", tint: O.primary, title: "J'ai quelques bases", desc: "Je peux faire des phrases simples." },
  { key: "chat", level: "B1" as Level, icon: "message", bg: O.lavender, tint: O.lavenderInk, title: "Je peux déjà discuter", desc: "Je veux gagner en fluidité." },
  { key: "unknown", level: "A2" as Level, icon: "help", bg: "#E3F0FB", tint: "#2E6BB5", title: "Je ne sais pas encore", desc: "Commençons simplement." },
];
const COACH_ORDER: CoachId[] = ["us_female", "us_male", "uk_female", "uk_male"];
const PRESENTATION_TITLE = "Fais ta première présentation";

export default function OnboardingFlow({ onLaunch, onLogin, onFinish, premium = false }: {
  onLaunch: (goals: Goal[]) => void; // lance la première leçon du parcours (présentation)
  onLogin?: () => void;
  onFinish?: () => void; // « Terminer pour aujourd'hui » : retour à l'app sans lancer de leçon
  premium?: boolean; // déjà abonné : aucune offre affichée
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("welcome");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [levelKey, setLevelKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [coachId, setCoachId] = useState<CoachId>("us_female");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const player = useAudioPlayer();
  const speechRate = 0.95;
  const coach: LessonCoach = COACHES[coachId] ?? coachForVoice(null);
  const goalDef = GOALS.find((g) => g.key === goal) ?? GOALS[0];
  const firstName = name.trim();
  const firstLessonTitle = LESSONS[0]?.titleFr ?? PRESENTATION_TITLE;

  useEffect(() => { logOnboardingStepViewed(phase); }, [phase]);
  useEffect(() => () => { try { player.pause(); } catch {} }, []);

  // 05 — écoute de la voix du coach (vraie voix configurée, phrase courte)
  const previewVoice = async (c: LessonCoach) => {
    if (previewBusy) return;
    setPreviewBusy(c.id);
    try {
      const res: any = await translateText({ text: `Hi! I'm ${c.displayName}. Nice to meet you.`, mode: "speak", voice: c.voice, speakingRate: speechRate });
      if (res.data?.audioBase64) {
        const p = FileSystem.cacheDirectory + `coach_preview_${c.id}_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
        logCoachPreviewPlayed(c.id);
      }
    } catch (e) { console.warn("Écoute du coach échouée:", e); }
    finally { setPreviewBusy(null); }
  };

  // Profil enregistré avant la première conversation (le serveur lit la voix et le niveau dans le profil)
  const persistAndStartCafe = async () => {
    setSaving(true); setSaveError(null);
    try {
      const lvl = LEVELS.find((l) => l.key === levelKey)?.level ?? ("A2" as Level);
      await saveProfile({
        name: firstName || undefined,
        goals: goal ? [goal] : [],
        blockers: blocker ? [blocker] : [],
        level: lvl,
        testScore: null,
        voice: coach.voice as VoiceKey,
        feedbackStyle: "balanced",
        challenge: true,
        onboardingVersion: 2,
        onboardingStep: "cafe",
      });
      try { player.pause(); } catch {}
      logOnboardingStepCompleted("brief", { goal: goal ?? "", blocker: blocker ?? "", coach_id: coach.id });
      setPhase("cafe");
    } catch (e) {
      console.warn("Sauvegarde onboarding échouée:", e);
      setSaveError("Impossible d'enregistrer tes choix. Vérifie ta connexion et réessaie.");
    } finally { setSaving(false); }
  };

  const onCafeDone = (r: AttemptResult) => {
    setResult(r);
    saveProfile({ discoveryCompleted: true, onboardingStep: "summary" }).catch(() => {});
    setPhase("summary");
  };
  const toPaywall = () => {
    if (premium) { finishToLesson(); return; }
    saveProfile({ firstPaywallShown: true, onboardingStep: "paywall" }).catch(() => {});
    logPaywallShown("onboarding_after_coffee");
    setPhase("paywall");
  };
  const finishToLesson = () => {
    saveProfile({ presentationDiscoveryGranted: true, onboardingStep: "done" }).catch(() => {});
    logOnboardingComplete();
    onLaunch(goal ? [goal] : []);
  };
  const finishForToday = () => {
    saveProfile({ presentationDiscoveryGranted: true, onboardingStep: "done" }).catch(() => {});
    logOnboardingComplete();
    (onFinish ?? (() => onLaunch(goal ? [goal] : [])))();
  };

  const pad = { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 };

  // ---------------- 01 Accueil ----------------
  if (phase === "welcome") {
    return (
      <View style={[st.screen, pad]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <View style={st.brandRow}>
            <Image source={BRAND_ICON} style={st.brandIcon} />
            <View><Text style={st.brandName}>d<Text style={{ color: O.primary }}>é</Text>clic</Text><Text style={st.brandSub}>ANGLAIS</Text></View>
          </View>

          <View style={st.collage}>
            <View style={st.collageLeft}>
              <Image source={IMAGES.welcomeCoffee} style={st.collageImgL} resizeMode="cover" />
              <View style={[st.collageChip, { left: 8, bottom: -6 }]}><Text style={st.collageChipText}>Commander un café</Text></View>
            </View>
            <View style={st.collageRight}>
              <Image source={IMAGES.welcomeSocial} style={st.collageImgR} resizeMode="cover" />
              <View style={[st.collageChip, { right: 8, bottom: -8 }]}><Text style={st.collageChipText}>Faire connaissance</Text></View>
            </View>
            <View style={st.bubble}><Text style={st.bubbleText}>Hi! Nice to meet you.</Text></View>
          </View>

          <Text style={st.heroTitle}>Parle anglais{"\n"}<Text style={{ color: O.primary }}>sans bloquer.</Text></Text>
          <Text style={st.heroBody}>Un coach IA pour pratiquer, trouver tes mots et apprendre de tes erreurs.</Text>

          <View style={{ gap: 14, marginTop: 22 }}>
            {([
              { icon: "clock", bg: O.mint, tint: O.success, t: "À ton rythme", d: "Des conversations sans pression." },
              { icon: "message", bg: O.lavender, tint: O.lavenderInk, t: "Des aides en français", d: "Pour toujours comprendre." },
              { icon: "target", bg: "#FFE4CC", tint: O.primary, t: "Des situations utiles", d: "Voyage, travail, quotidien…" },
            ] as { icon: OnbIconName; bg: string; tint: string; t: string; d: string }[]).map((f) => (
              <View key={f.t} style={st.feature}>
                <IconDisc name={f.icon} bg={f.bg} tint={f.tint} size={48} iconSize={24} />
                <View style={{ flex: 1 }}><Text style={st.featureT}>{f.t}</Text><Text style={st.featureD}>{f.d}</Text></View>
              </View>
            ))}
          </View>
        </ScrollView>
        <PrimaryCta label="Créer mon parcours" onPress={() => setPhase("goal")} />
        {onLogin ? <SecondaryLink label="J'ai déjà un compte" onPress={onLogin} /> : null}
      </View>
    );
  }

  // ---------------- 02 → 05 Questions ----------------
  const question = (step: number, back: Phase, body: React.ReactNode, cta: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) => (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View style={[st.screen, pad]}>
        <StatusBar style="dark" />
        <TopBar step={step} total={QUESTION_STEPS} onBack={() => setPhase(back)} />
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{body}</ScrollView>
        <PrimaryCta label={cta.label} onPress={cta.onPress} disabled={cta.disabled} busy={cta.busy} />
      </View>
    </KeyboardAvoidingView>
  );

  if (phase === "goal") {
    return question(1, "welcome",
      <>
        <Title center>Où aimerais-tu te sentir{"\n"}à l'aise ?</Title>
        <Subtitle center>On adapte ta première conversation.</Subtitle>
        <View style={{ gap: 12, marginTop: 22 }}>
          {GOALS.map((g) => <ChoiceCard key={g.key} selected={goal === g.key} onPress={() => setGoal(g.key)} title={g.title} desc={g.desc} image={g.image} />)}
        </View>
        <View style={{ marginTop: 18 }}><InfoLine text="Tu pourras explorer les autres situations ensuite." /></View>
      </>,
      { label: "Continuer", onPress: () => { logOnboardingStepCompleted("goal", { goal: goal ?? "" }); setPhase("blocker"); }, disabled: !goal });
  }

  if (phase === "blocker") {
    const b = BLOCKERS.find((x) => x.key === blocker);
    return question(2, "goal",
      <>
        <Title center>Qu'est-ce qui te freine{"\n"}le plus ?</Title>
        <Subtitle center>Ton coach est là pour t'aider.</Subtitle>
        <View style={{ gap: 12, marginTop: 22 }}>
          {BLOCKERS.map((x) => <ChoiceCard key={x.key} selected={blocker === x.key} onPress={() => setBlocker(x.key)} title={x.title} desc={x.desc} icon={x.icon} iconBg={x.bg} iconTint={x.tint} />)}
        </View>
        {b ? <View style={{ marginTop: 16 }}><CoachNote avatar={coach.poster} title={b.reassureTitle} body={b.reassure(coach.displayName)} /></View> : null}
      </>,
      { label: "Continuer", onPress: () => { logOnboardingStepCompleted("blocker", { blocker: blocker ?? "" }); setPhase("level"); }, disabled: !blocker });
  }

  if (phase === "level") {
    return question(3, "blocker",
      <>
        <Title center>On commence{"\n"}à ton niveau.</Title>
        <Subtitle center>Pas de test à réussir. On s'adapte au fil des échanges.</Subtitle>
        <View style={{ gap: 12, marginTop: 22 }}>
          {LEVELS.map((l) => <ChoiceCard key={l.key} selected={levelKey === l.key} onPress={() => setLevelKey(l.key)} title={l.title} desc={l.desc} icon={l.icon} iconBg={l.bg} iconTint={l.tint} />)}
        </View>
        <Text style={st.label}>Ton prénom ou pseudo</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Ton prénom" placeholderTextColor={O.muted} style={st.input} maxLength={24} returnKeyType="done" accessibilityLabel="Ton prénom ou pseudo" />
      </>,
      { label: "Choisir mon coach", onPress: () => { logOnboardingStepCompleted("level", { level: levelKey ?? "" }); setPhase("coach"); }, disabled: !levelKey || firstName.length === 0 });
  }

  if (phase === "coach") {
    return question(4, "level",
      <>
        <Title center>Avec qui veux-tu{"\n"}pratiquer ?</Title>
        <Subtitle center>Écoute sa voix, choisis ton coach.</Subtitle>
        <View style={st.coachGrid}>
          {COACH_ORDER.map((id) => {
            const c = COACHES[id]; if (!c?.enabled) return null;
            const on = coachId === id;
            return (
              <Pressable key={id} onPress={() => setCoachId(id)} style={[st.coachCard, on && st.coachCardOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${c.displayName}, ${c.accentLabel}`}>
                <View style={[st.coachImgWrap, { backgroundColor: c.tint }]}>
                  <Image source={c.paywall} style={st.coachImg} resizeMode="contain" />
                  {on && <View style={st.coachCheck}><OnbIcon name="check" size={14} tint="#fff" /></View>}
                </View>
                <Text style={st.coachName}>{c.displayName} · {c.accent === "en-GB" ? "UK" : "US"}</Text>
                <Pressable onPress={() => previewVoice(c)} style={st.listenBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Écouter la voix de ${c.displayName}`}>
                  {previewBusy === id ? <ActivityIndicator size="small" color={O.ink} /> : <><OnbIcon name="volume" size={16} tint={O.ink} /><Text style={st.listenText}>Écouter</Text></>}
                </Pressable>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: 16 }}><InfoLine text="Tu pourras changer quand tu veux." /></View>
      </>,
      { label: `Continuer avec ${coach.displayName}`, onPress: () => { logOnboardingStepCompleted("coach", { coach_id: coach.id }); setPhase("brief"); } });
  }

  // ---------------- 06 Brief café ----------------
  if (phase === "brief") {
    return (
      <View style={[st.screen, pad]}>
        <StatusBar style="dark" />
        <TopBar step={QUESTION_STEPS} total={QUESTION_STEPS} onBack={() => setPhase("coach")} />
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <Title center>{firstName ? `${firstName}, on commence\nau café ?` : "On commence\nau café ?"}</Title>
          <Subtitle center>Une première conversation pour {goalDef.where}.</Subtitle>
          <View style={st.sceneWrap}>
            <Image source={IMAGES.sceneCafe} style={st.sceneImg} resizeMode="cover" />
            <Image source={coach.poster} style={st.sceneAvatar} resizeMode="cover" />
          </View>
          <View style={st.card}>
            <Text style={st.cardTitle}>{DISCOVERY_TITLE_FR}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <Chip icon="clock" label="Environ 2 min" />
              <Chip icon="user" label={`Avec ${coach.displayName}`} bg={O.mint} tint={O.success} />
            </View>
            <View style={{ gap: 10, marginTop: 14 }}>
              {DISCOVERY_GOALS_FR.map((g, i) => (
                <View key={g} style={st.goalRow}><View style={st.goalNum}><Text style={st.goalNumText}>{i + 1}</Text></View><Text style={st.goalText}>{g}</Text></View>
              ))}
            </View>
          </View>
          <View style={{ marginTop: 14 }}>
            <CoachNote icon="lightbulb" title="Un mot te manque ?" body={`${coach.displayName} te propose un indice et une traduction. Tu peux réessayer.`} />
          </View>
          {saveError ? <Text style={st.error}>{saveError}</Text> : null}
        </ScrollView>
        <PrimaryCta label="Commencer ma conversation" onPress={persistAndStartCafe} busy={saving} />
        <View style={st.micNote}><OnbIcon name="mic" size={14} tint={O.muted} /><Text style={st.micNoteText}>Tu parles, ou tu écris si tu préfères.</Text></View>
      </View>
    );
  }

  // ---------------- 07 Conversation café ----------------
  if (phase === "cafe") {
    const lvl = LEVELS.find((l) => l.key === levelKey)?.level ?? "A2";
    return <DiscoveryCafeScreen coach={coach} level={lvl} speechRate={speechRate} onDone={(r) => onCafeDone(r)} onBack={() => setPhase("brief")} />;
  }

  // ---------------- 08 Bilan café ----------------
  if (phase === "summary" && result) {
    const achieved = result.criteria.filter((c) => c.status === "achieved");
    const remaining = result.criteria.filter((c) => c.status !== "achieved");
    return (
      <View style={[st.screen, pad]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <CoachMedallion source={coach.poster} />
            <Text style={[ui.title, { textAlign: "center", marginTop: 10 }]}>Tu viens de commander{"\n"}en anglais.</Text>
            <Subtitle center>{firstName ? `${firstName}, tu as mené ton premier échange avec ${coach.displayName}.` : `Tu as mené ton premier échange avec ${coach.displayName}.`}</Subtitle>
          </View>
          <View style={[st.card, { marginTop: 18, gap: 10 }]}>
            {achieved.map((c) => <View key={c.id} style={st.doneRow}><View style={st.doneCheck}><OnbIcon name="check" size={14} tint="#fff" /></View><Text style={st.doneText}>{c.doneFr}</Text></View>)}
            {remaining.map((c) => <View key={c.id} style={st.doneRow}><View style={[st.doneCheck, { backgroundColor: O.border }]}><OnbIcon name="circle" size={14} tint={O.muted} /></View><Text style={[st.doneText, { color: O.muted }]}>{c.doneFr}</Text></View>)}
          </View>
          {result.keyPhraseEn ? (
            <>
              <Text style={st.sectionTitle}>Ta phrase à retenir</Text>
              <PhraseCard phrase={result.keyPhraseEn} voice={coach.voice} rate={speechRate} />
            </>
          ) : null}
          <Text style={st.sectionTitle}>Ta prochaine situation</Text>
          <View style={[st.card, st.nextCard]}>
            <Image source={IMAGES.scenePresentation} style={st.nextImg} resizeMode="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.cardTitle}>{firstLessonTitle}</Text>
              <Text style={st.nextDesc}>Présente-toi et fais connaissance avec {coach.displayName}.</Text>
              <View style={{ marginTop: 8, alignSelf: "flex-start" }}><Chip icon="gift" label="Conversation offerte" bg={O.mint} tint={O.success} /></View>
            </View>
          </View>
        </ScrollView>
        <PrimaryCta label="Découvrir la suite" onPress={toPaywall} />
      </View>
    );
  }

  // ---------------- 09 Paywall (contexte after_coffee) ----------------
  if (phase === "paywall") {
    return (
      <PaywallScreen
        context="after_coffee"
        onClose={() => { logOnboardingStepCompleted("paywall", { outcome: "closed" }); setPhase("offer"); }}
        onPurchased={() => { logOnboardingStepCompleted("paywall", { outcome: "purchased" }); setPhase("unlocked"); }}
      />
    );
  }

  // ---------------- 10 Présentation offerte (offre fermée) ----------------
  if (phase === "offer") {
    return (
      <View style={[st.screen, pad]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <CoachMedallion source={coach.poster} check={false} />
            <Text style={[ui.title, { textAlign: "center", marginTop: 10 }]}>Faisons un peu{"\n"}connaissance.</Text>
            <Subtitle center>Une dernière conversation découverte pour parler de toi avec {coach.displayName}.</Subtitle>
          </View>
          <View style={[st.card, { marginTop: 18, padding: 0, overflow: "hidden" }]}>
            <Image source={IMAGES.scenePresentation} style={st.offerImg} resizeMode="cover" />
            <View style={{ padding: 16 }}>
              <Text style={st.cardTitle}>{firstLessonTitle}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Chip icon="clock" label="Environ 2 min" />
                <Chip icon="gift" label="Conversation offerte" bg={O.mint} tint={O.success} />
              </View>
              <View style={{ gap: 10, marginTop: 14 }}>
                {["Présente-toi", "Parle d'un loisir", "Pose une question"].map((g, i) => (
                  <View key={g} style={st.goalRow}><View style={st.goalNum}><Text style={st.goalNumText}>{i + 1}</Text></View><Text style={st.goalText}>{g}</Text></View>
                ))}
              </View>
            </View>
          </View>
          <View style={{ marginTop: 14 }}>
            <CoachNote icon="lightbulb" title="Pas besoin d'une phrase parfaite." body={`${coach.displayName} t'aide à trouver tes mots.`} />
          </View>
        </ScrollView>
        <PrimaryCta label={`Me présenter à ${coach.displayName}`} onPress={finishToLesson} />
        <SecondaryLink label="Terminer pour aujourd'hui" onPress={finishForToday} />
      </View>
    );
  }

  // ---------------- 11 Parcours débloqué (achat) ----------------
  if (phase === "unlocked") {
    return (
      <View style={[st.screen, pad, { justifyContent: "center" }]}>
        <StatusBar style="dark" />
        <View style={{ alignItems: "center" }}>
          <CoachMedallion source={coach.poster} />
          <Text style={[ui.title, { textAlign: "center", marginTop: 10 }]}>Ton parcours{"\n"}est débloqué.</Text>
          <Subtitle center>{coach.displayName} t'attend pour ta première présentation.</Subtitle>
        </View>
        <View style={{ flex: 1 }} />
        <PrimaryCta label="Commencer ma conversation" onPress={finishToLesson} />
      </View>
    );
  }

  return null;
}

// Carte lavande « phrase à retenir » avec lecture
function PhraseCard({ phrase, voice, rate }: { phrase: string; voice: string; rate: number }) {
  const player = useAudioPlayer();
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { try { player.pause(); } catch {} }, []);
  const listen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res: any = await translateText({ text: phrase, mode: "speak", voice, speakingRate: rate });
      if (res.data?.audioBase64) {
        const p = FileSystem.cacheDirectory + `onb_phrase_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
      }
    } catch (e) { console.warn("Lecture échouée:", e); }
    finally { setBusy(false); }
  };
  return (
    <View style={st.phraseCard}>
      <View style={st.phraseRow}>
        <View style={st.phraseIcon}><OnbIcon name="volume" size={22} tint="#fff" /></View>
        <Text style={st.phraseText}>{phrase}</Text>
      </View>
      <Pressable onPress={listen} style={st.replay} hitSlop={6} accessibilityRole="button" accessibilityLabel="Réécouter la phrase">
        {busy ? <ActivityIndicator size="small" color={O.lavenderInk} /> : <><OnbIcon name="replay" size={15} tint={O.lavenderInk} /><Text style={st.replayText}>Réécouter</Text></>}
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: O.bg, paddingHorizontal: O.gutter },
  scroll: { paddingBottom: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 },
  brandIcon: { width: 44, height: 44, borderRadius: 13 },
  brandName: { fontSize: 26, fontWeight: "800", color: O.ink, letterSpacing: -0.8, lineHeight: 28 },
  brandSub: { fontSize: 10, fontWeight: "800", color: O.muted, letterSpacing: 3.5 },
  collage: { height: 290, marginBottom: 10 },
  collageLeft: { position: "absolute", left: 14, top: 40, width: "48%", transform: [{ rotate: "-6deg" }] },
  collageRight: { position: "absolute", right: 4, top: 10, width: "58%", transform: [{ rotate: "4deg" }] },
  collageImgL: { width: "100%", aspectRatio: 0.98, borderRadius: 22, borderWidth: 5, borderColor: "#fff" },
  collageImgR: { width: "100%", aspectRatio: 1.35, borderRadius: 22, borderWidth: 5, borderColor: "#fff" },
  collageChip: { position: "absolute", backgroundColor: O.navy, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  collageChipText: { color: "#fff", fontSize: 13.5, fontWeight: "800" },
  bubble: { position: "absolute", left: 18, top: 0, backgroundColor: O.navy, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 14, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  bubbleText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  heroTitle: { color: O.ink, fontSize: 38, fontWeight: "800", lineHeight: 44, letterSpacing: -1, marginTop: 10 },
  heroBody: { color: O.muted, fontSize: 17, lineHeight: 25, fontWeight: "600", marginTop: 12 },
  feature: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureT: { color: O.ink, fontSize: 17, fontWeight: "800" },
  featureD: { color: O.muted, fontSize: 14, fontWeight: "600", marginTop: 2 },
  label: { color: O.ink, fontSize: 14, fontWeight: "800", marginTop: 22, marginBottom: 8 },
  input: { backgroundColor: O.surface, borderRadius: 16, borderWidth: 1.5, borderColor: O.border, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontWeight: "600", color: O.ink },
  coachGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 22 },
  coachCard: { flexBasis: "47%", flexGrow: 1, backgroundColor: O.surface, borderRadius: 22, padding: 10, borderWidth: 2, borderColor: "transparent", alignItems: "center" },
  coachCardOn: { borderColor: O.primary, backgroundColor: "#FFF7EE" },
  coachImgWrap: { width: "100%", aspectRatio: 1, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "flex-end" },
  coachImg: { width: "100%", height: "100%" },
  coachCheck: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: O.primary, alignItems: "center", justifyContent: "center" },
  coachName: { color: O.ink, fontSize: 15, fontWeight: "800", marginTop: 10 },
  listenBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: O.lavender, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, marginTop: 8, minHeight: 36 },
  listenText: { color: O.ink, fontSize: 13, fontWeight: "800" },
  sceneWrap: { marginTop: 20, alignItems: "flex-start" },
  sceneImg: { width: "100%", aspectRatio: 1.55, borderRadius: 22 },
  sceneAvatar: { position: "absolute", left: 14, top: 14, width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: "#fff" },
  card: { backgroundColor: O.surface, borderRadius: O.radiusCard, padding: 16, marginTop: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  cardTitle: { color: O.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  goalNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: O.lavender, alignItems: "center", justifyContent: "center" },
  goalNumText: { color: O.lavenderInk, fontSize: 13, fontWeight: "800" },
  goalText: { flex: 1, color: O.ink, fontSize: 15.5, fontWeight: "600" },
  micNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 },
  micNoteText: { color: O.muted, fontSize: 12.5, fontWeight: "600" },
  error: { color: "#B3261E", fontSize: 14, fontWeight: "600", marginTop: 12, textAlign: "center" },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  doneCheck: { width: 26, height: 26, borderRadius: 13, backgroundColor: O.success, alignItems: "center", justifyContent: "center" },
  doneText: { flex: 1, color: O.ink, fontSize: 15.5, fontWeight: "600", lineHeight: 21 },
  sectionTitle: { color: O.ink, fontSize: 16, fontWeight: "800", marginTop: 18, marginBottom: 2 },
  phraseCard: { backgroundColor: O.lavender, borderRadius: 20, padding: 14, marginTop: 10 },
  phraseRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  phraseIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: O.lavenderInk, alignItems: "center", justifyContent: "center" },
  phraseText: { flex: 1, color: O.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  replay: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: O.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginTop: 10, minHeight: 34 },
  replayText: { color: O.lavenderInk, fontSize: 13, fontWeight: "800" },
  nextCard: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 10 },
  nextImg: { width: 104, height: 84, borderRadius: 14 },
  nextDesc: { color: O.muted, fontSize: 13.5, lineHeight: 19, fontWeight: "600", marginTop: 4 },
  offerImg: { width: "100%", height: 150 },
});
