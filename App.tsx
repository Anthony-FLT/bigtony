import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./lib/firebase";
import { T } from "./lib/theme";
import { loadProfile, markRatingAsked, markHubCelebrated } from "./lib/profile";
import { getChallengesDone, HUB_CHALLENGES } from "./lib/dailyChallenges";
import ScenariosScreen from "./screens/ScenariosScreen";
import LaboScreen from "./screens/LaboScreen";
import OnboardingFlow from "./screens/onboarding/OnboardingFlow";
import SpikeScreen from "./SpikeScreen";
import { Scenario } from "./lib/scenarios";
import ProgressScreen from "./screens/ProgressScreen";
import CustomSceneScreen from "./screens/CustomSceneScreen";
import SettingsScreen from "./screens/SettingsScreen";
import DictionaryScreen from "./screens/DictionaryScreen";
import { logPaywallShown, logRatingShown, logHubCompleteShown } from "./lib/analytics";
import RatingModal from "./components/RatingModal";
import HubCompleteModal from "./components/HubCompleteModal";
import PaywallScreen from "./screens/PaywallScreen";
import { getAccess, Access } from "./lib/entitlement";
import { configurePurchases } from "./lib/purchases";
import Purchases from "react-native-purchases";
import { scheduleExpressionReminder, getExpressionReminderEnabled } from "./lib/notifications";
import EditProfileScreen from "./screens/EditProfileScreen";
import DailyHubScreen from "./screens/DailyHubScreen";
import TranslationScreen from "./screens/TranslationScreen";
import ReadingScreen from "./screens/ReadingScreen";
import ListeningScreen from "./screens/ListeningScreen";
import { KeyboardProvider } from "react-native-keyboard-controller";
import LessonScreen from "./screens/lesson/LessonScreen";
import DailyTalkScreen from "./screens/daily/DailyTalkScreen";
import LearningHomeScreen from "./screens/learning/LearningHomeScreen";
import PracticeHubScreen from "./screens/learning/PracticeHubScreen";
import { syncLearningEntitlement } from "./lib/learningPath/attempts";
import { LESSONS } from "./lib/learningPath/catalog";
import { listPracticeWords } from "./lib/practiceWords";
import { Icon as LessonIcon, IconName as LessonIconName } from "./components/lessonUi";
import { registerGlobals } from "@livekit/react-native";
import AvatarTestScreen from "./screens/dev/AvatarTestScreen";

// LiveKit (coach vidéo) : globals WebRTC, à appeler une fois au chargement
registerGlobals();

type Tab = "home" | "pratiquer" | "progres" | "settings";
type AppState = "loading" | "onboarding" | "ready";

const TABS: { key: Tab; png: LessonIconName; label: string }[] = [
  { key: "home", png: "parcours", label: "Parcours" },
  { key: "pratiquer", png: "bulle", label: "Pratiquer" },
  { key: "progres", png: "progres", label: "Progrès" },
  { key: "settings", png: "profil", label: "Profil" },
];

// Plus d'essai gratuit à l'unité : la leçon 1 est offerte, tout le reste est dans l'abonnement.
const NO_TRIAL = { reading: true, translation: true, listening: true };

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
  const [laboKey, setLaboKey] = useState(0);
  const [showLabo, setShowLabo] = useState(false);
  const [laboCount, setLaboCount] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showDailyHub, setShowDailyHub] = useState(false);
  const [showDailyTalk, setShowDailyTalk] = useState(false); // « Le point du jour »
  const [showTranslation, setShowTranslation] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showListening, setShowListening] = useState(false);
  const [ratingAsked, setRatingAsked] = useState(true); // true tant que le profil n'est pas chargé : on ne demande rien
  const [showRating, setShowRating] = useState(false);
  const [hubCelebrated, setHubCelebrated] = useState(true); // true tant que le profil n'est pas chargé
  const [showHubDone, setShowHubDone] = useState(false);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [showAvatarTest, setShowAvatarTest] = useState(false); // écran de test LiveAvatar (dev uniquement)
  const isPremium = access?.premium === true;
  const insets = useSafeAreaInsets();
  const bgCream = [styles.rootCream, { paddingBottom: insets.bottom }];
  const bgNight = [styles.rootNight, { paddingBottom: insets.bottom }];
  const bgPath = [styles.rootPath, { paddingBottom: insets.bottom }];

  useEffect(() => { configurePurchases(); }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        signInAnonymously(auth).catch((e) => console.error("Anon auth:", e));
        return;
      }
      // Relie le client RevenueCat à l'uid Firebase (App User ID = uid)
      try {
        configurePurchases();
        await Purchases.logIn(u.uid);
      } catch (e) {
        console.warn("RevenueCat logIn échoué:", e);
      }
      const profile = await loadProfile();
      setAppState(profile?.onboarded ? "ready" : "onboarding");
    });
    return unsub;
  }, []);

  // Au démarrage (et après chaque retour à l'accueil) : accès, jalons, compteur du Labo
  useEffect(() => {
    if (appState !== "ready") return;
    (async () => {
      getExpressionReminderEnabled().then((on) => { if (on) scheduleExpressionReminder(); });
      const a = await getAccess();
      setAccess(a);
      const p = await loadProfile();
      setRatingAsked(!!p?.ratingAsked);
      setHubCelebrated(!!p?.hubCelebrated);
      listPracticeWords().then((ws: any[]) => setLaboCount(ws.filter((w) => !w.mastered).length)).catch(() => {});
    })();
  }, [appState, homeKey]);

  useEffect(() => {
    if (appState === "ready" && !showPaywall) getAccess().then(setAccess);
  }, [showPaywall]);

  // Onboarding : l'accès est connu dès le départ (un abonné qui réinstalle ne voit aucune offre)
  useEffect(() => {
    if (appState === "onboarding") getAccess().then(setAccess).catch(() => {});
  }, [appState]);

  // Après chaque exercice : si un abonné vient de finir les 3 défis du jour pour la 1re fois, on le félicite
  const checkHubComplete = async () => {
    if (!isPremium || hubCelebrated) return;
    try {
      const done = await getChallengesDone();
      if (!HUB_CHALLENGES.every((c) => done[c])) return;
      setHubCelebrated(true);
      markHubCelebrated();
      logHubCompleteShown();
      setShowHubDone(true);
    } catch (e) {
      console.warn("checkHubComplete échoué:", e);
    }
  };
  const hubDoneModal = <HubCompleteModal visible={showHubDone} count={HUB_CHALLENGES.length} onClose={() => setShowHubDone(false)} />;
  const openPaywall = (source: Parameters<typeof logPaywallShown>[0]) => { logPaywallShown(source); setShowPaywall(true); };

  if (appState === "loading") {
    return <View style={bgPath} />;
  }

  if (appState === "onboarding") {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <OnboardingFlow
          premium={isPremium}
          onLaunch={() => {
            setAppState("ready");
            // Après le café (et l'offre) : la présentation s'ouvre directement ; la 2e offre viendra après elle
            const first = LESSONS.find((l) => l.isFreeDiscovery) ?? LESSONS[0];
            if (first) setActiveLessonId(first.id);
          }}
          onFinish={() => {
            // « Terminer pour aujourd'hui » : retour à l'accueil, sans lancer de leçon
            setAppState("ready");
            setHomeKey((k) => k + 1);
          }}
        />
      </View>
    );
  }

  if (showAvatarTest) {
    return (
      <View style={bgPath}>
        <StatusBar style="dark" />
        <AvatarTestScreen onBack={() => setShowAvatarTest(false)} />
      </View>
    );
  }

  if (activeLessonId) {
    return (
      <View style={bgPath}>
        <StatusBar style="dark" />
        <LessonScreen
          key={activeLessonId}
          lessonId={activeLessonId}
          premium={isPremium}
          onExit={(exit) => {
            if (exit.reason === "next_lesson") { setActiveLessonId(exit.nextLessonId); return; }
            setActiveLessonId(null);
            setHomeKey((k) => k + 1);
          }}
          onLocked={(reason) => {
            if (reason === "subscription_required") openPaywall("learning_path_after_lesson_1");
            else setActiveLessonId(null);
          }}
        />
        {/* Paywall par-dessus la leçon : l'écran de réussite reste monté (résultat conservé) */}
        <Modal visible={showPaywall} animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <View style={bgCream}>
            <StatusBar style="dark" />
            <PaywallScreen context="after_presentation" dismissable onClose={() => setShowPaywall(false)} onPurchased={() => { setShowPaywall(false); syncLearningEntitlement(); }} />
          </View>
        </Modal>
      </View>
    );
  }

  if (showDailyTalk) {
    return (
      <View style={bgPath}>
        <StatusBar style="dark" />
        <DailyTalkScreen
          onExit={() => { setShowDailyTalk(false); setHomeKey((k) => k + 1); }}
          onLocked={() => { setShowDailyTalk(false); openPaywall("daily_talk"); }}
        />
        <Modal visible={showPaywall} animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <View style={bgCream}>
            <StatusBar style="dark" />
            <PaywallScreen dismissable onClose={() => setShowPaywall(false)} onPurchased={() => { setShowPaywall(false); syncLearningEntitlement(); }} />
          </View>
        </Modal>
      </View>
    );
  }

  if (creatingScene) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <CustomSceneScreen onBack={() => setCreatingScene(false)} onLaunch={(s) => { setCreatingScene(false); setActiveScenario(s); }} />
      </View>
    );
  }

  if (activeScenario) {
    return (
   <View style={bgPath}>
        <StatusBar style="dark" />
        <SpikeScreen scenario={activeScenario} onExit={() => setActiveScenario(null)} />
      </View>
    );
  }

  if (dailyActive) {
    return (
 <View style={bgPath}>
        <StatusBar style="dark" />
        <SpikeScreen
          daily
          scenario={{ id: "daily", title: "Conversation libre", emoji: "", category: "quotidien", description: "" }}
          onExit={(completed) => {
            setDailyActive(false);
            setHomeKey((k) => k + 1);
            // Première conversation libre terminée par un abonné : on demande une note, une seule fois
            if (completed && isPremium && !ratingAsked) {
              setRatingAsked(true);
              markRatingAsked();
              logRatingShown();
              setShowRating(true);
            }
          }}
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
            onLocked={() => openPaywall("scenarios")}
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
          onStartConversation={() => { setShowFavorites(false); if (isPremium) setDailyActive(true); else openPaywall("daily_conversation"); }}
          onOpenReading={() => { setShowFavorites(false); if (isPremium) setShowReading(true); else openPaywall("daily_hub"); }}
        />
      </View>
    );
  }

  if (showTranslation) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <TranslationScreen onBack={() => { setShowTranslation(false); setHomeKey((k) => k + 1); checkHubComplete(); }} />
      </View>
    );
  }
  if (showReading) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <ReadingScreen onBack={() => { setShowReading(false); setHomeKey((k) => k + 1); checkHubComplete(); }} />
      </View>
    );
  }
  if (showListening) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <ListeningScreen onBack={() => { setShowListening(false); setHomeKey((k) => k + 1); checkHubComplete(); }} />
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
          trialExercisesDone={NO_TRIAL}
          onLocked={() => openPaywall("daily_hub")}
        />
        {hubDoneModal}
      </View>
    );
  }

  if (showPaywall) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <PaywallScreen dismissable onClose={() => setShowPaywall(false)} onPurchased={() => { setShowPaywall(false); syncLearningEntitlement(); }} />
      </View>
    );
  }

  if (showLabo) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
        <LaboScreen refreshKey={laboKey} premium={isPremium} onLocked={() => openPaywall("labo_add_word")} onBack={() => { setShowLabo(false); setHomeKey((k) => k + 1); }} />
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

  return (
    <View style={bgPath}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === "home" && (
          <LearningHomeScreen
            refreshKey={homeKey}
            premium={isPremium}
            onOpenLesson={(id) => setActiveLessonId(id)}
            onLocked={() => openPaywall("learning_path_map")}
            onStartFreeConversation={() => setDailyActive(true)}
            onGoDailyHub={() => setShowDailyHub(true)}
            onShowPaywall={openPaywall}
            onGoProfile={() => setTab("settings")}
            onGoDailyTalk={() => setShowDailyTalk(true)}
          />
        )}
        {tab === "pratiquer" && (
          <PracticeHubScreen
            premium={isPremium}
            laboCount={laboCount}
            onGoScenarios={() => setShowScenarios(true)}
            onGoLabo={() => { setLaboKey((k) => k + 1); setShowLabo(true); }}
            onGoFavorites={() => setShowFavorites(true)}
          />
        )}
        {tab === "progres" && (
          <ProgressScreen
            refreshKey={progressKey}
            onResume={(s) => { if (isPremium) setActiveScenario(s); else openPaywall("scenarios"); }}
            onGoLabo={() => { setLaboKey((k) => k + 1); setShowLabo(true); }}
            onGoFavorites={() => setShowFavorites(true)}
          onGoDailyTalk={() => setShowDailyTalk(true)}
          />
        )}
        {tab === "settings" && (
          <SettingsScreen
            onEditProfile={() => setShowEditProfile(true)}
            onDeleted={() => {
              setShowEditProfile(false);
              setShowPaywall(false);
              setShowFavorites(false);
              setShowScenarios(false);
              setActiveLessonId(null);
              setTab("home");
            }}
          />
        )}
      </View>

      <RatingModal visible={showRating} onClose={() => setShowRating(false)} />
      {hubDoneModal}

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => { if (t.key === "progres") setProgressKey((k) => k + 1); setTab(t.key); }}
            style={styles.tabItem}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tab === t.key }}
          >
            <LessonIcon name={t.png} size={26} tint={tab === t.key ? "#F2873A" : "#8A93A8"} />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <AppInner />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootCream: { flex: 1, backgroundColor: T.cream },
  rootNight: { flex: 1, backgroundColor: T.night },
  rootPath: { flex: 1, backgroundColor: "#FFFAF5" },
  laboBack: { position: "absolute", top: 50, left: 14, zIndex: 5, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", backgroundColor: "#FFFAF5", paddingBottom: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E8E1D9" },
  tabItem: { flex: 1, alignItems: "center", gap: 3 },
  tabLabel: { fontSize: 12, fontWeight: "700", color: "#8A93A8" },
  tabLabelOn: { color: "#F2873A" },
  devAvatarBtn: { position: "absolute", top: 60, right: 16, backgroundColor: "#C0392B", borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10 },
  devAvatarBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
});
