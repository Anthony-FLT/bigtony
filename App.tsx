import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./lib/firebase";
import { T } from "./lib/theme";
import { loadProfile, markTrialExerciseUsed, saveGiftExpiresAt, markRatingAsked, markHubCelebrated } from "./lib/profile";
import { getChallengesDone, HUB_CHALLENGES } from "./lib/dailyChallenges";
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
import { logOnboardingComplete, logWelcomeConversationStart, logPaywallShown, logTrialExerciseStart, logGiftRevealShown, logGiftDeclined, logRatingShown, logHubCompleteShown } from "./lib/analytics";
import GiftRevealModal from "./components/GiftRevealModal";
import FloatingGiftButton from "./components/FloatingGiftButton";
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

type Tab = "home" | "labo" | "progres" | "settings";
type AppState = "loading" | "onboarding" | "ready";

const TABS: { key: Tab; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "home", icon: "home" },
  { key: "labo", icon: "target" },
  { key: "progres", icon: "trending-up" },
  { key: "settings", icon: "settings" },
];

// Offre Google Play « developer determined » proposée à la fin de la conversation de présentation
const GIFT_OFFER_ID = "cadeau-50";
const GIFT_DISCOUNT = 50; // affiché dans la popup (le paywall recalcule depuis le vrai prix)
const GIFT_DURATION_MS = 10 * 60 * 1000;

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
  const [giftPaywall, setGiftPaywall] = useState(false);
  const [giftExpiresAt, setGiftExpiresAt] = useState<number | null>(null);
  const [showGiftReveal, setShowGiftReveal] = useState(false);
  const [ratingAsked, setRatingAsked] = useState(true); // true tant que le profil n'est pas chargé : on ne demande rien
  const [showRating, setShowRating] = useState(false);
  const [hubCelebrated, setHubCelebrated] = useState(true); // true tant que le profil n'est pas chargé
  const [showHubDone, setShowHubDone] = useState(false);
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
      // Relie le client RevenueCat à l'uid Firebase : dans RevenueCat, l'App User ID devient l'uid
      // (les achats faits avant sous un ID anonyme RevenueCat sont rattachés automatiquement)
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
      setRatingAsked(!!p?.ratingAsked);
      setHubCelebrated(!!p?.hubCelebrated);
      // Offre cadeau encore valable (ex. app fermée puis rouverte) : l'icône cadeau revient
      if (p?.giftExpiresAt && p.giftExpiresAt > Date.now()) setGiftExpiresAt(p.giftExpiresAt);
    })();
  }, [appState, homeKey]);

   useEffect(() => {
    if (appState === "ready" && !showPaywall) getAccess().then(setAccess);
  }, [showPaywall]);

 
  // Après chaque jeu : si un abonné vient de finir les 3 défis du jour pour la 1re fois, on le félicite
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
  const hubDoneModal = (
    <HubCompleteModal visible={showHubDone} count={HUB_CHALLENGES.length} onClose={() => setShowHubDone(false)} />
  );

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
          onExit={(offerGift) => {
            setWelcomeActive(false);
            setHomeKey((k) => k + 1);
            // Conversation de présentation terminée (ou quittée après au moins un échange) en freemium : cadeau
            if (offerGift && !isPremium) {
              logGiftRevealShown();
              const expiresAt = Date.now() + GIFT_DURATION_MS;
              setGiftExpiresAt(expiresAt);
              saveGiftExpiresAt(expiresAt);
              setShowGiftReveal(true);
            }
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
          onExit={(completed) => {
            setDailyActive(false);
            setHomeKey((k) => k + 1);
            // Premier daily terminé par un abonné (ou en essai) : on demande une note, une seule fois
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
          onStartConversation={() => {
            setShowFavorites(false);
            if (isPremium) { setDailyActive(true); }
            else { logPaywallShown("daily_conversation"); setShowPaywall(true); }
          }}
          onOpenReading={() => {
            setShowFavorites(false);
            if (isPremium) { setShowReading(true); }
            else if (!trialExercisesDone.reading) { logTrialExerciseStart("reading"); markTrialExerciseUsed("reading").catch(() => {}); setShowReading(true); }
            else { logPaywallShown("daily_hub"); setShowPaywall(true); }
          }}
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
          trialExercisesDone={trialExercisesDone}
          onLocked={() => { logPaywallShown("daily_hub"); setShowPaywall(true); }}
        />
        {hubDoneModal}
      </View>
    );
  }
  if (showPaywall) {
    return (
      <View style={bgCream}>
        <StatusBar style="dark" />
          <PaywallScreen
          dismissable={!paywallHard}
          giftOfferId={giftPaywall ? GIFT_OFFER_ID : undefined}
          giftExpiresAt={giftPaywall ? giftExpiresAt ?? undefined : undefined}
          onClose={() => { setShowPaywall(false); setPaywallHard(false); setGiftPaywall(false); }}
          onPurchased={() => { setShowPaywall(false); setPaywallHard(false); setGiftPaywall(false); setGiftExpiresAt(null); saveGiftExpiresAt(null); }}
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

        {/* Icône cadeau flottante : rouvre l'offre tant qu'elle n'a pas expiré */}
        {tab === "home" && giftExpiresAt !== null && !isPremium && !showGiftReveal && (
          <FloatingGiftButton
            expiresAt={giftExpiresAt}
            discount={GIFT_DISCOUNT}
            onPress={() => {
              logPaywallShown("gift");
              setGiftPaywall(true);
              setShowPaywall(true);
            }}
            onExpire={() => setGiftExpiresAt(null)}
          />
        )}
      </View>

      <RatingModal visible={showRating} onClose={() => setShowRating(false)} />
      {hubDoneModal}

      {giftExpiresAt !== null && (
        <GiftRevealModal
          visible={showGiftReveal}
          discount={GIFT_DISCOUNT}
          giftOfferId={GIFT_OFFER_ID}
          expiresAt={giftExpiresAt}
          onAccept={() => {
            setShowGiftReveal(false);
            logPaywallShown("gift");
            setGiftPaywall(true);
            setShowPaywall(true);
          }}
          onDecline={() => {
            logGiftDeclined();
            setShowGiftReveal(false); // l'offre reste accessible via l'icône cadeau jusqu'à expiration
          }}
        />
      )}

      <View style={styles.tabBar}>
        {TABS.map((t) => {
          return (
            <Pressable
              key={t.key}
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

    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootCream: { flex: 1, backgroundColor: T.cream },
  rootNight: { flex: 1, backgroundColor: T.night },
  tabBar: { flexDirection: "row", backgroundColor: T.cream, paddingBottom: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.creamLine },
  tabItem: { flex: 1, alignItems: "center" },
});