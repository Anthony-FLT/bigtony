import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./lib/firebase";
import { T } from "./lib/theme";
import { loadProfile } from "./lib/profile";
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
import FavoritesScreen from "./screens/FavoritesScreen";
import PaywallScreen from "./screens/PaywallScreen";
import { getAccess, Access } from "./lib/entitlement";
import { configurePurchases } from "./lib/purchases";
import { scheduleExpressionReminder, getExpressionReminderEnabled } from "./lib/notifications";
import EditProfileScreen from "./screens/EditProfileScreen";

type Tab = "home" | "labo" | "progres" | "settings";
type AppState = "loading" | "onboarding" | "ready";

const TABS: { key: Tab; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "home", icon: "home" },
  { key: "labo", icon: "target" },
  { key: "progres", icon: "trending-up" },
  { key: "settings", icon: "settings" },
];

export default function App() {
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
  const isPremium = access?.premium === true;

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

 // Au démarrage : charge l'accès et, si non abonné avec la démo déjà consommée, paywall direct
  useEffect(() => {
    if (appState !== "ready") return;
    (async () => {
      getExpressionReminderEnabled().then((on) => { if (on) scheduleExpressionReminder(); });
      const a = await getAccess();
      setAccess(a);
      if (!a.premium) {
        const p = await loadProfile();
        if (p?.firstSessionDone) { setPaywallHard(true); setShowPaywall(true); }
      }
    })();
  }, [appState]);

   useEffect(() => {
    if (appState === "ready" && !showPaywall) getAccess().then(setAccess);
  }, [showPaywall]);

 
  if (appState === "loading") {
    return <View style={styles.rootCream} />;
  }

  if (appState === "onboarding") {
    return (
      <View style={styles.rootCream}>
        <StatusBar style="dark" />
        <OnboardingFlow
          onLaunch={() => {
            setWelcomeActive(true);
            setAppState("ready");
          }}
        />
      </View>
    );
  }

  if (creatingScene) {
    return (
      <View style={styles.rootCream}>
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
      <View style={styles.rootNight}>
        <StatusBar style="light" />
        <SpikeScreen scenario={activeScenario} onExit={() => setActiveScenario(null)} />
      </View>
    );
  }
if (welcomeActive) {
    return (
      <View style={styles.rootNight}>
        <StatusBar style="light" />
        <SpikeScreen
          welcome
          scenario={{ id: "welcome", title: "On fait connaissance", emoji: "", category: "quotidien", description: "" }}
          onExit={() => {
            setWelcomeActive(false);
            setHomeKey((k) => k + 1);
            if (!isPremium) { setPaywallHard(true); setShowPaywall(true); }
          }}
        />
      </View>
    );
  }
    if (dailyActive) {
    return (
      <View style={styles.rootNight}>
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
      <View style={styles.rootCream}>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>
          <ScenariosScreen onSelect={(s) => { setShowScenarios(false); setActiveScenario(s); }} onCreateCustom={() => { setShowScenarios(false); setCreatingScene(true); }} onBack={() => setShowScenarios(false)}/>
        </View>
      </View>
    );
  }
  if (showFavorites) {
    return (
      <View style={styles.rootCream}>
        <StatusBar style="dark" />
        <FavoritesScreen onBack={() => setShowFavorites(false)} />
      </View>
    );
  }
  if (showPaywall) {
    return (
      <View style={styles.rootCream}>
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
      <View style={styles.rootCream}>
        <StatusBar style="dark" />
        <EditProfileScreen onBack={() => setShowEditProfile(false)} />
      </View>
    );
  }
  return (
    <View style={styles.rootCream}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
       {tab === "home" && (
          <HomeScreen
            refreshKey={homeKey}
            premium={isPremium}
            onStartDaily={() => { if (isPremium) setDailyActive(true); else setShowPaywall(true); }}
            onGoLabo={() => { if (isPremium) setTab("labo"); else setShowPaywall(true); }}
            onGoScenarios={() => { if (isPremium) setShowScenarios(true); else setShowPaywall(true); }}
          />
        )}
        {tab === "labo" && <LaboScreen refreshKey={laboKey} />}
        {tab === "progres" && (
          <ProgressScreen
            refreshKey={progressKey}
            onResume={(s) => { if (isPremium) setActiveScenario(s); else setShowPaywall(true); }}
            onGoLabo={() => { if (isPremium) setTab("labo"); else setShowPaywall(true); }}
            onGoFavorites={() => { if (isPremium) setShowFavorites(true); else setShowPaywall(true); }}
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
        {TABS.map((t) => (
         <Pressable
            key={t.key}
            onPress={() => {
              if (t.key === "labo" && !isPremium) { setShowPaywall(true); return; }
              if (t.key === "progres") setProgressKey((k) => k + 1);
              if (t.key === "labo") setLaboKey((k) => k + 1);
              setTab(t.key);
            }}
            style={styles.tabItem}
          >
            <Feather name={t.icon} size={23} color={tab === t.key ? T.abricotDeep : "#D9B78E"} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootCream: { flex: 1, backgroundColor: T.cream },
  rootNight: { flex: 1, backgroundColor: T.night },
  tabBar: { flexDirection: "row", backgroundColor: T.cream, paddingBottom: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.creamLine },
  tabItem: { flex: 1, alignItems: "center" },
});