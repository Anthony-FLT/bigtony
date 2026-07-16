import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { Scenario } from "../lib/scenarios";

const EXAMPLES = [
  "Je rends un plat au restaurant car il est froid",
  "Je demande une augmentation à mon patron",
  "Je fais visiter mon quartier à un touriste",
];

export default function CustomSceneScreen({ onLaunch, onBack }: { onLaunch: (s: Scenario) => void; onBack: () => void }) {
  const [text, setText] = useState("");

  const launch = () => {
    const ctx = text.trim();
    if (ctx.length < 8) return;
    onLaunch({
      id: "custom",
      title: "Ta scène",
      emoji: "",
      category: "quotidien",
      description: ctx,
      custom: ctx,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 26, paddingTop: 56 }}>
      <Pressable onPress={onBack} hitSlop={12} style={{ marginBottom: 16 }}>
        <Feather name="chevron-left" size={26} color={T.inkSoft} />
      </Pressable>
      <Text style={styles.h1}>Crée ta scène</Text>
      <Text style={styles.sub}>Décris la situation que tu veux travailler. On invente le reste.</Text>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Ex. je négocie le prix d'une voiture d'occasion…"
        placeholderTextColor={T.inkSoft}
        style={styles.input}
        multiline
        maxLength={200}
      />

      <Text style={styles.examplesLabel}>QUELQUES IDÉES</Text>
      {EXAMPLES.map((e) => (
        <Pressable key={e} onPress={() => setText(e)} style={styles.exampleChip}>
          <Text style={styles.exampleText}>{e}</Text>
        </Pressable>
      ))}

      <Pressable onPress={launch} disabled={text.trim().length < 8} style={[styles.cta, text.trim().length < 8 && styles.ctaOff]}>
        <Text style={styles.ctaText}>Lancer ma scène</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 8, marginBottom: 20 },
  input: { backgroundColor: T.card, borderRadius: 18, padding: 16, fontSize: 16, fontWeight: "600", color: T.night, minHeight: 90, textAlignVertical: "top" },
  examplesLabel: { fontSize: 11, fontWeight: "800", color: T.abricotDeep, letterSpacing: 0.8, marginTop: 24, marginBottom: 10 },
  exampleChip: { backgroundColor: T.card, borderRadius: 14, padding: 14, marginBottom: 8 },
  exampleText: { color: T.night, fontSize: 14, fontWeight: "600" },
  cta: { backgroundColor: T.abricot, borderRadius: 16, padding: 17, alignItems: "center", marginTop: 24 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: T.night, fontSize: 16, fontWeight: "800" },
});