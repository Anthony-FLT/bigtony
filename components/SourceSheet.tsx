// SourceSheet — écran 13 : « Au fait, comment as-tu découvert Déclic ? » Feuille du bas, une seule demande par onboarding.
// Un appui enregistre la réponse et ferme ; « Plus tard » ferme sans réponse (jamais converti en « Autre »).
import React from "react";
import { View, Text, Pressable, StyleSheet, Modal, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import { AcquisitionSource, saveProfile } from "../lib/profile";
import { logSourcePromptViewed, logSourceAnswered, logSourceSkipped } from "../lib/analytics";
import { O, OnbIcon } from "./onbUi";

const OPTIONS: { key: AcquisitionSource; label: string; brand?: string; icon?: "users" | "more"; color: string }[] = [
  { key: "tiktok", label: "TikTok", brand: "tiktok", color: "#111111" },
  { key: "instagram", label: "Instagram", brand: "instagram", color: "#E1306C" },
  { key: "play_store", label: "Google Play", brand: "google-play", color: "#34A853" },
  { key: "app_store", label: "App Store", brand: "app-store-ios", color: "#1C8EF9" },
  { key: "youtube", label: "YouTube", brand: "youtube", color: "#FF0000" },
  { key: "friend", label: "Un proche", icon: "users", color: O.ink },
  { key: "other", label: "Autre", icon: "more", color: O.ink },
];

export default function SourceSheet({ visible, coachAvatar, onDone }: { visible: boolean; coachAvatar?: any; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  React.useEffect(() => { if (visible) logSourcePromptViewed(); }, [visible]);
  const answer = async (key: AcquisitionSource) => {
    logSourceAnswered(key);
    saveProfile({ acquisition: key, sourcePromptShown: true }).catch(() => {});
    onDone();
  };
  const skip = () => {
    logSourceSkipped();
    saveProfile({ sourcePromptShown: true, sourceSkipped: true }).catch(() => {});
    onDone();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={skip}>
      <View style={st.overlay}>
        <Pressable style={{ flex: 1 }} onPress={skip} accessibilityLabel="Plus tard" />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={st.handle} />
          {coachAvatar ? <Image source={coachAvatar} style={st.avatar} resizeMode="cover" /> : null}
          <Text style={st.title} accessibilityRole="header">Au fait, comment as-tu découvert Déclic ?</Text>
          <Text style={st.body}>Ta réponse nous aide à faire connaître l'app.</Text>
          <View style={st.grid}>
            {OPTIONS.map((o) => (
              <Pressable key={o.key} onPress={() => answer(o.key)} style={st.opt} accessibilityRole="button" accessibilityLabel={o.label}>
                {o.brand ? <FontAwesome5 name={o.brand} brand size={18} color={o.color} /> : <OnbIcon name={o.icon!} size={20} tint={o.color} />}
                <Text style={st.optText}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={skip} style={st.later} hitSlop={10} accessibilityRole="button"><Text style={st.laterText}>Plus tard</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(25,41,71,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: O.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: O.border, alignSelf: "center", marginBottom: 10 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignSelf: "center", marginBottom: 8, borderWidth: 3, borderColor: "#fff" },
  title: { color: O.ink, fontSize: 21, fontWeight: "800", textAlign: "center", letterSpacing: -0.3, lineHeight: 27 },
  body: { color: O.muted, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 6, marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  opt: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: O.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14, minHeight: 52 },
  optText: { color: O.ink, fontSize: 15, fontWeight: "700" },
  later: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: 8 },
  laterText: { color: O.muted, fontSize: 14.5, fontWeight: "700" },
});
