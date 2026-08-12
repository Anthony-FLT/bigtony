import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Switch } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { loadProfile, Profile } from "../lib/profile";
import { getReminderSetting, scheduleDailyReminder, cancelDailyReminder, requestNotifPermission } from "../lib/notifications";
import TimeWheel from "../components/TimeWheel";

export default function SettingsScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [on, setOn] = useState(false);
  const [hour, setHour] = useState(19);
  const [minute, setMinute] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [p, r] = await Promise.all([loadProfile(), getReminderSetting()]);
      setProfile(p);
      setOn(r.on); setHour(r.hour); setMinute(r.minute);
      setLoading(false);
    })();
  }, []);

  const toggle = async (val: boolean) => {
    if (val) {
      const granted = await requestNotifPermission();
      if (!granted) return; // permission refusée : on laisse off
      await scheduleDailyReminder(hour, minute);
      setOn(true);
    } else {
      await cancelDailyReminder();
      setOn(false);
    }
  };

  const changeTime = async (h: number, m: number) => {
    setHour(h); setMinute(m);
    if (on) await scheduleDailyReminder(h, m); // replanifie si actif
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={T.abricotDeep} /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.head}><Text style={styles.h1}>Paramètres</Text></View>

      {/* Profil */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ton profil</Text>
        <Row label="Prénom" value={profile?.name ?? "—"} />
        <Row label="Niveau" value={profile?.level ?? "—"} />
        <Row label="Métier" value={profile?.job ?? "Non renseigné"} />
      </View>

      {/* Rappel quotidien */}
      <View style={styles.card}>
        <View style={styles.reminderHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Rappel quotidien</Text>
            <Text style={styles.cardSub}>Une notification pour ne pas oublier ta discussion</Text>
          </View>
          <Switch value={on} onValueChange={toggle} trackColor={{ true: T.abricot, false: "#D9CFC0" }} thumbColor="#fff" />
        </View>
        {on && <TimeWheel hour={hour} minute={minute} onChange={changeTime} />}
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  center: { flex: 1, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 16 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  card: { backgroundColor: T.card, borderRadius: 20, padding: 18, marginHorizontal: 26, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: T.night },
  cardSub: { fontSize: 13, fontWeight: "600", color: T.inkSoft, marginTop: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.cream },
  rowLabel: { fontSize: 14, fontWeight: "600", color: T.inkSoft },
  rowValue: { fontSize: 14, fontWeight: "800", color: T.night },
  reminderHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
});