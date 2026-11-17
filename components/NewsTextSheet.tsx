// NewsTextSheet — panneau « Revoir l'actu » : vignette, titre et texte anglais, sans quitter l'écran en cours (quiz, discussion).
import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { L } from "./lessonUi";
import NewsCover from "./NewsCover";
import type { NewsItem } from "../lib/news";

export default function NewsTextSheet({ visible, item, text, onClose }: { visible: boolean; item: NewsItem; text: string; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Fermer" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <NewsCover item={item} radius={12} style={styles.thumb} />
          <Text style={styles.title} numberOfLines={3}>{item.titleEn}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Fermer">
            <Feather name="x" size={20} color={L.textPrimary} />
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
          <Text style={styles.body}>{text}</Text>
        </ScrollView>
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(25,41,71,0.35)" },
  sheet: { backgroundColor: L.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30, maxHeight: "72%" },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: L.border, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  thumb: { width: 92, height: 60 },
  title: { flex: 1, color: L.textPrimary, fontSize: 16.5, fontWeight: "800", lineHeight: 22 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F4EEE7", alignItems: "center", justifyContent: "center" },
  body: { color: L.textPrimary, fontSize: 17.5, lineHeight: 28 },
});
