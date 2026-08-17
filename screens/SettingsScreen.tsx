import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Switch, Linking, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { loadProfile, Profile } from "../lib/profile";
import { getReminderSetting, scheduleDailyReminder, cancelDailyReminder, requestNotifPermission, getExpressionReminderEnabled, scheduleExpressionReminder, cancelExpressionReminder } from "../lib/notifications";
import { getAccess } from "../lib/entitlement";
import { restorePurchasesFlow } from "../lib/purchases";
import { deleteAccount } from "../lib/account";
import TimeWheel from "../components/TimeWheel";

export default function SettingsScreen({ onEditProfile, onDeleted }: { onEditProfile: () => void; onDeleted: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [on, setOn] = useState(false);
  const [hour, setHour] = useState(19);
  const [minute, setMinute] = useState(0);
  const [exprOn, setExprOn] = useState(true);
  const [premium, setPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, r, ex, acc] = await Promise.all([loadProfile(), getReminderSetting(), getExpressionReminderEnabled(), getAccess()]);
      setProfile(p);
      setOn(r.on); setHour(r.hour); setMinute(r.minute);
      setExprOn(ex);
      setPremium(acc.premium);
      setLoading(false);
    })();
  }, []);

  // — Rappel de discussion (logique d'origine, intacte) —
  const toggle = async (val: boolean) => {
    if (val) {
      const granted = await requestNotifPermission();
      if (!granted) return;
      await scheduleDailyReminder(hour, minute);
      setOn(true);
    } else {
      await cancelDailyReminder();
      setOn(false);
    }
  };
  const changeTime = async (h: number, m: number) => {
    setHour(h); setMinute(m);
    if (on) await scheduleDailyReminder(h, m);
  };

  // — Expression du jour —
  const toggleExpr = async (val: boolean) => {
    setExprOn(val);
    if (val) await scheduleExpressionReminder(); else await cancelExpressionReminder();
  };

  // — Abonnement —
  const openManageSub = () => {
    Linking.openURL("https://play.google.com/store/account/subscriptions?sku=premium&package=fr.elanapp.english")
      .catch(() => Alert.alert("Impossible d'ouvrir", "Ouvre le Play Store → Abonnements."));
  };
  const restore = async () => {
    setBusy(true);
    try {
      const ok = await restorePurchasesFlow();
      Alert.alert(ok ? "Achats restaurés" : "Aucun achat", ok ? "Ton abonnement est actif." : "Aucun abonnement actif trouvé.");
      if (ok) setPremium(true);
    } catch (e: any) { Alert.alert("Erreur", e.message ?? String(e)); }
    finally { setBusy(false); }
  };

  // — Suppression du compte —
  const confirmDelete = () => {
    Alert.alert(
      "Supprimer ton compte ?",
      "Toutes tes données (progression, favoris, profil) seront définitivement effacées. Cette action est irréversible.",
      [{ text: "Annuler", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: doDelete }]
    );
  };
  const doDelete = async () => {
    setBusy(true);
    try { await deleteAccount(); onDeleted(); }
    catch (e: any) { Alert.alert("Suppression impossible", e.message ?? String(e)); setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={T.abricotDeep} /></View>;

  const Row = ({ icon, label, sub, onPress, danger }: any) => (
    <Pressable style={styles.row} onPress={onPress}>
      <Feather name={icon} size={19} color={danger ? "#C0553B" : T.night} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: "#C0553B" }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {onPress && <Feather name="chevron-right" size={18} color="#C9C2B8" />}
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.head}>
          <Text style={styles.h1}>Paramètres</Text>
        </View>

        <Text style={styles.section}>PROFIL</Text>
        <View style={styles.card}>
          <Row icon="user" label={profile?.name || "Ton profil"} sub="Prénom, niveau, objectifs, intérêts" onPress={onEditProfile} />
        </View>

        <Text style={styles.section}>RAPPELS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Feather name="clock" size={19} color={T.night} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Rappel de discussion</Text>
              <Text style={styles.rowSub}>Un petit coup de pouce quotidien</Text>
            </View>
            <Switch value={on} onValueChange={toggle} trackColor={{ true: T.abricot }} />
          </View>
          {on && (
            <View style={styles.wheelWrap}>
              <TimeWheel hour={hour} minute={minute} onChange={changeTime} />
            </View>
          )}
          <View style={styles.sep} />
          <View style={styles.row}>
            <Feather name="book-open" size={19} color={T.night} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Expression du jour</Text>
              <Text style={styles.rowSub}>Chaque matin à 9h00</Text>
            </View>
            <Switch value={exprOn} onValueChange={toggleExpr} trackColor={{ true: T.abricot }} />
          </View>
        </View>

        <Text style={styles.section}>ABONNEMENT</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Feather name={premium ? "check-circle" : "lock"} size={19} color={premium ? T.menthe : T.night} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{premium ? "Abonnement actif" : "Aucun abonnement"}</Text>
              <Text style={styles.rowSub}>{premium ? "Merci de ton soutien" : "Passe en illimité"}</Text>
            </View>
          </View>
          {premium && (<><View style={styles.sep} /><Row icon="settings" label="Gérer mon abonnement" onPress={openManageSub} /></>)}
          <View style={styles.sep} />
          <Row icon="refresh-cw" label="Restaurer mes achats" onPress={restore} />
        </View>

        <Text style={styles.section}>À PROPOS</Text>
        <View style={styles.card}>
          <Row icon="file-text" label="Conditions d'utilisation" onPress={() => Linking.openURL("https://erbol-1307.web.app/cgu.html")} />
          <View style={styles.sep} />
          <Row icon="shield" label="Politique de confidentialité" onPress={() => Linking.openURL("https://erbol-1307.web.app/confidentialite.html")} />
        </View>

        <Text style={styles.section}>COMPTE</Text>
        <View style={styles.card}>
          <Row icon="trash-2" label="Supprimer mon compte" danger onPress={confirmDelete} />
        </View>

        <Text style={styles.version}>Élan – Coach d'anglais · v1.0.0</Text>
      </ScrollView>

      {busy && (
        <View style={styles.overlay}><ActivityIndicator size="large" color={T.abricot} /></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  center: { flex: 1, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 8 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  section: { fontSize: 12, fontWeight: "800", color: T.inkSoft, letterSpacing: 0.6, marginTop: 24, marginBottom: 8, marginHorizontal: 26 },
  card: { backgroundColor: T.card, borderRadius: 18, marginHorizontal: 20, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  rowLabel: { fontSize: 15.5, fontWeight: "700", color: T.night },
  rowSub: { fontSize: 12.5, fontWeight: "600", color: T.inkSoft, marginTop: 2 },
  sep: { height: 1, backgroundColor: T.creamLine, marginLeft: 50 },
  wheelWrap: { alignItems: "center", paddingVertical: 8 },
  version: { textAlign: "center", color: T.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 28 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(250,247,242,0.7)", alignItems: "center", justifyContent: "center" },
});