// CustomSceneScreen — « Crée ta scène », habillage aligné sur les nouveaux écrans : retour rond, champ bordé orange avec compteur,
// idées en cartes avec pictogramme, CTA « Lancer ma scène → ». Logique inchangée (scénario custom, 8 caractères min).
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { L, Icon, RoundButton, PrimaryButton } from "../components/lessonUi";
import { Scenario } from "../lib/scenarios";

const MIN_LEN = 8;
const MAX_LEN = 200;
const EXAMPLES: { text: string; emoji: string; bg: string }[] = [
  { text: "Je rends un plat au restaurant car il est froid", emoji: "🍽️", bg: L.accentSoft },
  { text: "Je demande une augmentation à mon patron", emoji: "💼", bg: L.lavender },
  { text: "Je fais visiter mon quartier à un touriste", emoji: "🗺️", bg: L.successSoft },
];

export default function CustomSceneScreen({ onLaunch, onBack }: { onLaunch: (s: Scenario) => void; onBack: () => void }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const ctx = text.trim();
  const ready = ctx.length >= MIN_LEN;

  const launch = () => {
    if (!ready) return;
    onLaunch({ id: "custom", title: "Ta scène", emoji: "", category: "quotidien", description: ctx, custom: ctx });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingHorizontal: L.gutter, paddingTop: 52, paddingBottom: 28 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <RoundButton icon="retour" label="Retour" onPress={onBack} size={44} iconSize={20} style={{ marginBottom: 12 }} />
        <Text style={styles.h1}>Crée ta scène</Text>
        <Text style={styles.sub}>Décris la situation que tu veux travailler. On invente le reste.</Text>

        <View style={[styles.inputWrap, focused && styles.inputWrapOn]}>
          <TextInput
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ex. je négocie le prix d'une voiture d'occasion…"
            placeholderTextColor={L.textSecondary}
            style={styles.input}
            multiline
            maxLength={MAX_LEN}
            accessibilityLabel="Décris ta situation"
          />
          <View style={styles.inputFoot}>
            <Text style={styles.inputHint}>{ctx.length > 0 && ctx.length < MIN_LEN ? "Encore quelques mots…" : "Une phrase suffit."}</Text>
            <Text style={styles.counter}>{text.length}/{MAX_LEN}</Text>
          </View>
        </View>

        <Text style={styles.grp}>Quelques idées</Text>
        {EXAMPLES.map((e) => {
          const selected = text === e.text;
          return (
            <Pressable key={e.text} onPress={() => setText(e.text)} style={[styles.idea, selected && styles.ideaOn]} accessibilityRole="button" accessibilityState={{ selected }}>
              <View style={[styles.ideaIcon, { backgroundColor: e.bg }]}><Text style={styles.ideaEmoji}>{e.emoji}</Text></View>
              <Text style={styles.ideaText}>{e.text}</Text>
              {selected ? <Icon name="check" size={18} /> : <Icon name="chevron" size={16} />}
            </Pressable>
          );
        })}

        <PrimaryButton label="Lancer ma scène" onPress={launch} disabled={!ready} style={{ marginTop: 22 }} />
        <Text style={styles.foot}>Le coach joue l'autre rôle et s'adapte à ce que tu dis.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  h1: { fontSize: 30, fontWeight: "800", color: L.textPrimary, letterSpacing: -0.5 },
  sub: { color: L.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 6, marginBottom: 18 },

  inputWrap: { backgroundColor: L.surface, borderRadius: 18, borderWidth: 1.5, borderColor: "transparent", padding: 14 },
  inputWrapOn: { borderColor: L.accentDeep },
  input: { fontSize: 17, fontWeight: "600", color: L.textPrimary, minHeight: 84, textAlignVertical: "top", lineHeight: 24 },
  inputFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  inputHint: { color: L.textSecondary, fontSize: 12.5 },
  counter: { color: L.textSecondary, fontSize: 12 },

  grp: { color: L.textPrimary, fontSize: 19, fontWeight: "800", marginTop: 24, marginBottom: 10 },
  idea: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1.5, borderColor: "transparent" },
  ideaOn: { borderColor: L.accentDeep },
  ideaIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ideaEmoji: { fontSize: 18 },
  ideaText: { flex: 1, color: L.textPrimary, fontSize: 15, fontWeight: "700", lineHeight: 20 },

  foot: { color: L.textSecondary, fontSize: 13, textAlign: "center", marginTop: 12 },
});
