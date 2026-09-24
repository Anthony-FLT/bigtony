import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./lib/firebase";
import { T } from "./lib/theme";
import { loadProfile, markTourSeen } from "./lib/profile";
import HomeScreen from "./screens/HomeScreen";
import ScenariosScreen from "./screens/ScenariosScreen";
import PlaceholderScreen from "./screens/PlaceholderScreen";
import LaboScreen from "./screens/LaboScreen";
import OnboardingFlow from "./screens/onboarding/OnboardingFlow";
import SpikeScreen from "./SpikeScreen";
import { SCENARIOS, Scenario, pickFirstScenario } from "./lib/scenarios";
import ProgressScreen from "./screens/ProgressScreen";
import CustomSceneScreen from "./screens/CustomSceneScreen";
import SettingsScreen from "./screens/SettingsScreen";
import DictionaryScreen from "./screens/DictionaryScreen";
import { TourProvider, useTourTarget } from "./TourContext";
import TourOverlay, { TourStep } from "./TourOverlay";
import { logOnboardingComplete, logWelcomeConversationStart, logPaywallShown } from "./lib/analytics";
import PaywallScreen from "./screens/PaywallScreen";
import { getAccess, Access } from "./lib/entitlement";
import { configurePurchases } from "./lib/purchases";
import { scheduleExpressionReminder, getExpressionReminderEnabled } from "./lib/notifications";
import EditProfileScreen from "./screens/EditProfileScreen";
import DailyHubScreen from "./screens/DailyHubScreen";
import TranslationScreen from "./screens/TranslationScreen";
import ReadingScreen from "./screens/ReadingScreen";
import ListeningScreen from "./screens/ListeningScreen";

type Tab = "home" | "labo" | "progres" | "settings";
type AppState = "loading" | "onboarding" | "ready";

const TABS: { key: Tab; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "home", icon: "home" },
  { key: "labo", icon: "target" },
  { key: "progres", icon: "trending-up" },
  { key: "settings", icon: "settings" },
];

// Contenu du tour guidé — à ajuster librement, c'est une proposition de départ.
const TOUR_STEPS: TourStep[] = [
  { targetId: "home-parler", title: "Parle avec ton coach", body: "Choisis une situation réelle (entretien, voyage…) et entraîne-toi à voix haute, sans jugement." },
  { targetId: "home-hub", title: "Tes défis du jour", body: "Trois mini-exercices chaque jour — lecture, traduction, écoute — pour progresser en douceur." },
  { targetId: "home-reviser", title: "Ton dictionnaire", body: "Les mots que tu gardes pendant tes conversations arrivent ici, avec leur définition." },
  { targetId: "tab-labo", title: "Le Labo", body: "Les mots qui te résistent à l'oral atterrissent ici pour que tu les retravailles, un par un.", placement: "top" },
  { targetId: "tab-progres", title: "Tes progrès", body: "Ta série, ton temps de parole, et ce qu'il te reste à travailler — en un coup d'œil.", placement: "top" },
];

function AppInner() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [tab, setTab] = useState<Tab>("home");
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [progressKey, setProgressKey] = useState(0);
  const [creatingScene, setCreatingScene] = useState(false);
  const [dailyActive, setDailyActive] = useState(false);
  const [homeKey, setHomeKey] = useState(0);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [welcomeActive, setWelcomeActive] = useState(false);
  const [laboKey, setLaboKey] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [paywallHard, setPaywallHard] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showDailyHub, setShowDailyHub] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showListening, setShowListening] = useState(false);
  const [firstSessionDone, setFirstSessionDone] = useState(false);
  const [trialExercisesDone, setTrialExercisesDone] = useState<{ reading?: boolean; translation?: boolean; listening?: boolean }>({});
  const [tourActive, setTourActive] = useState(false);
  const laboTarget = useTourTarget("tab-labo");
  const progresTarget = useTourTarget("tab-progres");
  const isPremium = access?.premium === true;
  const insets = useSafeAreaInsets();
  // Réserve l'espace de la barre de navigation système en bas (boutons ou gestes),
  // ce qui remonte automatiquement tout le contenu — y compris les barres fixes des écrans.
  const bgCream = [styles.rootCream, { paddingBottom: insets.bottom }];
  const bgNight = [styles.rootNight, { paddingBottom: insets.bottom }];

  useEffect(() => { configurePurchases(); }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        signInAnonymously(auth).catch((e) => console.error("Anon auth:", e));
        return;
      }
      const profile = await loadProfile();
      setAppState(profile?.onboarded ? "ready" : "onboarding");
    });
    return unsub;
  }, []);

 // Au démarrage (et après chaque retour au Home) : charge l'accès et les jalons freemium — plus de paywall forcé.
  useEffect(() => {
    if (appState !== "ready") return;
    (async () => {
      getExpressionReminderEnabled().then((on) => { if (on) scheduleExpressionReminder(); });
      const a = await getAccess();
      setAccess(a);
      const p = await loadProfile();
      setFirstSessionDone(!!p?.firstSessionDone);
      setTrialExercisesDone(p?.trialExercisesDone ?? {});
      if (!p?.tourSeen) setTourActive(true);
    })();
  }, [appState, homeKey]);

   useEffect(() => {
    if (appState === "ready" && !showPaywall) getAccess().then(setAccess);
  }, [showPaywall]);

 
  if (appState === "loading") {
    return <View style={bgCream} />;
  }

  if (appState === "onboarding") {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <OnboardingFlow
          onLaunch={() => {
            logOnboardingComplete();
            setAppState("ready");
          }}
        />
      </View>
    );
  }

  if (creatingScene) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <CustomSceneScreen
          onBack={() => setCreatingScene(false)}
          onLaunch={(s) => { setCreatingScene(false); setActiveScenario(s); }}
        />
      </View>
    );
  }

  if (activeScenario) {
    return (
      <View style={bgNight}>
        <StatusBar style="light" />
        <SpikeScreen scenario={activeScenario} onExit={() => setActiveScenario(null)} />
      </View>
    );
  }
if (welcomeActive) {
    return (
      <View style={bgNight}>
        <StatusBar style="light" />
        <SpikeScreen
          welcome
          premium={isPremium}
          scenario={{ id: "welcome", title: "On fait connaissance", emoji: "", category: "quotidien", description: "" }}
          onExit={() => {
            setWelcomeActive(false);
            setHomeKey((k) => k + 1);
          }}
        />
      </View>
    );
  }
    if (dailyActive) {
    return (
      <View style={bgNight}>
        <StatusBar style="light" />
        <SpikeScreen
          daily
          scenario={{ id: "daily", title: "Discussion du jour", emoji: "", category: "quotidien", description: "" }}
          onExit={() => { setDailyActive(false); setHomeKey((k) => k + 1); }}
        />
      </View>
    );
  }
    if (showScenarios) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>
          <ScenariosScreen
            premium={isPremium}
            onSelect={(s) => { setShowScenarios(false); setActiveScenario(s); }}
            onCreateCustom={() => { setShowScenarios(false); setCreatingScene(true); }}
            onBack={() => setShowScenarios(false)}
            onLocked={() => { logPaywallShown("scenarios"); setShowPaywall(true); }}
          />
        </View>
      </View>
    );
  }
  if (showFavorites) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <DictionaryScreen
          onBack={() => setShowFavorites(false)}
          onStartConversation={() => { setShowFavorites(false); setDailyActive(true); }}
          onOpenReading={() => { setShowFavorites(false); setShowReading(true); }}
        />
      </View>
    );
  }
  if (showTranslation) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <TranslationScreen onBack={() => { setShowTranslation(false); setHomeKey((k) => k + 1); }} />
      </View>
    );
  }
  if (showReading) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <ReadingScreen onBack={() => { setShowReading(false); setHomeKey((k) => k + 1); }} />
      </View>
    );
  }
  if (showListening) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <ListeningScreen onBack={() => { setShowListening(false); setHomeKey((k) => k + 1); }} />
      </View>
    );
  }
  if (showDailyHub) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <DailyHubScreen
          onBack={() => setShowDailyHub(false)}
          onOpenTranslation={() => setShowTranslation(true)}
          onOpenReading={() => setShowReading(true)}
          onOpenListening={() => setShowListening(true)}
          premium={isPremium}
          trialExercisesDone={trialExercisesDone}
          onLocked={() => { logPaywallShown("daily_hub"); setShowPaywall(true); }}
        />
      </View>
    );
  }
  if (showPaywall) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
          <PaywallScreen
          dismissable={!paywallHard}
          onClose={() => { setShowPaywall(false); setPaywallHard(false); }}
          onPurchased={() => { setShowPaywall(false); setPaywallHard(false); }}
        />
      </View>
    );
  }
  if (showEditProfile) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <EditProfileScreen onBack={() => setShowEditProfile(false)} />
      </View>
    );
  }
  const allTrialExercisesUsed = !!(trialExercisesDone.reading && trialExercisesDone.translation && trialExercisesDone.listening);

  return (
    <View style={bgCream}>
      <StatusBar style={tab === "home" ? "light" : "dark"} />
      <View style={{ flex: 1 }}>
       {tab === "home" && (
          <HomeScreen
            refreshKey={homeKey}
            premium={isPremium}
            firstSessionDone={firstSessionDone}
            trialExercisesDone={trialExercisesDone}
            onStartWelcome={() => { if (isPremium || !firstSessionDone) { logWelcomeConversationStart(); setWelcomeActive(true); } else { logPaywallShown("welcome_already_used"); setShowPaywall(true); } }}
            onStartDaily={() => { if (isPremium) setDailyActive(true); else { logPaywallShown("daily_conversation"); setShowPaywall(true); } }}
            onGoLabo={() => setTab("labo")}
            onGoScenarios={() => setShowScenarios(true)}
            onGoDailyHub={() => { if (isPremium || !allTrialExercisesUsed) setShowDailyHub(true); else { logPaywallShown("daily_hub"); setShowPaywall(true); } }}
            onGoFavorites={() => setShowFavorites(true)}
            onShowPaywall={(source) => { logPaywallShown(source); setShowPaywall(true); }}
          />
        )}
        {tab === "labo" && <LaboScreen refreshKey={laboKey} premium={isPremium} onLocked={() => { logPaywallShown("labo_add_word"); setShowPaywall(true); }} />}
        {tab === "progres" && (
          <ProgressScreen
            refreshKey={progressKey}
            onResume={(s) => { if (isPremium) setActiveScenario(s); else { logPaywallShown("scenarios"); setShowPaywall(true); } }}
            onGoLabo={() => setTab("labo")}
            onGoFavorites={() => setShowFavorites(true)}
          />
        )}
         {tab === "settings" && (
          <SettingsScreen
             onEditProfile={() => setShowEditProfile(true)}
            onDeleted={() => {
              setShowEditProfile(false);
              setShowPaywall(false);
              setPaywallHard(false);
              setShowFavorites(false);
              setShowScenarios(false);
              setTab("home");
            }}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const target = t.key === "labo" ? laboTarget : t.key === "progres" ? progresTarget : null;
          return (
            <Pressable
              key={t.key}
              ref={target?.ref}
              onLayout={target?.onLayout}
              onPress={() => {
                if (t.key === "progres") setProgressKey((k) => k + 1);
                if (t.key === "labo") setLaboKey((k) => k + 1);
                setTab(t.key);
              }}
              style={styles.tabItem}
            >
              <Feather name={t.icon} size={23} color={tab === t.key ? T.abricotDeep : "#D9B78E"} />
            </Pressable>
          );
        })}
      </View>

      <TourOverlay steps={TOUR_STEPS} active={tourActive} onFinish={() => { setTourActive(false); markTourSeen().catch(() => {}); }} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <TourProvider>
        <AppInner />
      </TourProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootCream: { flex: 1, backgroundColor: T.cream },
  rootNight: { flex: 1, backgroundColor: T.night },
  tabBar: { flexDirection: "row", backgroundColor: T.cream, paddingBottom: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.creamLine },
  tabItem: { flex: 1, alignItems: "center" },
});