// SupportSection — bloc « Besoin d'aide ? » du profil : nous contacter (e-mail pré-rempli) et donner son avis (fiche Play Store).
// À placer dans SettingsScreen (ou l'écran de profil) : <SupportSection />
import { View, Text, Pressable, StyleSheet, Linking, Platform, Alert } from "react-native";
import Constants from "expo-constants";
import { Feather } from "@expo/vector-icons";
import { auth } from "../lib/firebase";
import { L } from "./lessonUi";

// À renseigner : adresse de contact
export const SUPPORT_EMAIL = "contact@declic-anglais.fr";
const PLAY_PACKAGE = "fr.elanapp.english";
const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
const PLAY_DEEPLINK = `market://details?id=${PLAY_PACKAGE}`;

function appInfo() {
  const version = Constants.expoConfig?.version ?? "?";
  const uid = auth.currentUser?.uid ?? "non connecté";
  return `\n\n—\nApp ${version} · ${Platform.OS} ${Platform.Version}\nIdentifiant : ${uid}`;
}

export default function SupportSection() {
  const contact = async () => {
    const subject = encodeURIComponent("Déclic Anglais — question");
    const body = encodeURIComponent(`Bonjour,\n\n${appInfo()}`);
    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) { await Linking.openURL(url); return; }
    } catch {}
    // Pas d'app mail sur l'appareil : on affiche l'adresse
    Alert.alert("Nous contacter", `Écris-nous à ${SUPPORT_EMAIL}`);
  };

  const review = async () => {
    try {
      if (Platform.OS === "android" && (await Linking.canOpenURL(PLAY_DEEPLINK))) { await Linking.openURL(PLAY_DEEPLINK); return; }
      await Linking.openURL(PLAY_URL);
    } catch { Alert.alert("Donner mon avis", "Impossible d'ouvrir le Play Store pour l'instant."); }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Besoin d'aide ?</Text>
      <View style={styles.card}>
        <Pressable onPress={contact} style={styles.row} accessibilityRole="button" accessibilityLabel="Nous contacter par e-mail">
          <View style={[styles.icon, { backgroundColor: L.accentSoft }]}><Feather name="mail" size={18} color={L.accentDeep} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Nous contacter</Text>
            <Text style={styles.rowSub}>Une question, un bug, une idée ? On répond vite.</Text>
          </View>
          <Feather name="chevron-right" size={18} color={L.textSecondary} />
        </Pressable>
        <View style={styles.sep} />
        <Pressable onPress={review} style={styles.row} accessibilityRole="button" accessibilityLabel="Donner mon avis sur le Play Store">
          <View style={[styles.icon, { backgroundColor: L.successSoft }]}><Feather name="star" size={18} color={L.success} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Donner mon avis</Text>
            <Text style={styles.rowSub}>Une note sur le Play Store nous aide énormément.</Text>
          </View>
          <Feather name="chevron-right" size={18} color={L.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  title: { color: L.textPrimary, fontSize: 18, fontWeight: "800", marginBottom: 10 },
  card: { backgroundColor: L.surface, borderRadius: 18, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: L.textPrimary, fontSize: 15.5, fontWeight: "800" },
  rowSub: { color: L.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  sep: { height: 1, backgroundColor: L.border },
});
