import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { loadProfile, saveProfile, Profile } from "../lib/profile";
import { GOALS, INTERESTS } from "../lib/onboardingData";

export default function EditProfileScreen({ onBack }: { onBack: () => void }) {
  const [base, setBase] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile().then((p) => {
      setBase(p);
      setName(p?.name ?? "");
      setJob(p?.job ?? "");
      setGoals((p?.goals as string[]) ?? []);
      setInterests((p?.interests as string[]) ?? []);
    });
  }, []);

  const toggle = (arr: string[], set: (v: string[]) => void, key: string) => {
    set(arr.includes(key) ? arr.filter((x) => x !== key) : [...arr, key]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveProfile({
        ...base,                       // préserve feeling, level, gender, testScore…
        name: name.trim() || undefined,
        job: job.trim() || undefined,
        goals: goals as any,
        interests,
      });
      onBack();
    } catch (e) {
      console.warn("Sauvegarde profil échouée:", e);
      setSaving(false);
    }
  };

  if (!base && base !== null) return null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={12} style={{ marginBottom: 12 }}>
            <Feather name="chevron-left" size={26} color={T.inkSoft} />
          </Pressable>
          <Text style={styles.h1}>Ton profil</Text>
          <Text style={styles.sub}>Ajuste ce qui te ressemble. Tes conversations s'adaptent en conséquence.</Text>
        </View>

        <Text style={styles.label}>Ton prénom</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Ton prénom"
          placeholderTextColor="#B7AE9F"
        />

        <Text style={styles.label}>Ton métier (optionnel)</Text>
        <TextInput
          style={styles.input}
          value={job}
          onChangeText={setJob}
          placeholder="Ex. développeur, commercial, étudiant…"
          placeholderTextColor="#B7AE9F"
        />

        <Text style={styles.label}>Tes objectifs</Text>
        <View style={styles.wrap}>
          {GOALS.map((g) => {
            const sel = goals.includes(g.key);
            return (
              <Pressable key={g.key} onPress={() => toggle(goals, setGoals, g.key)} style={[styles.chip, sel && styles.chipSel]}>
                <Feather name={g.icon as any} size={14} color={sel ? T.night : T.inkSoft} />
                <Text style={[styles.chipText, sel && styles.chipTextSel]}>{g.title}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Tes centres d'intérêt</Text>
        <View style={styles.wrap}>
          {INTERESTS.map((it) => {
            const sel = interests.includes(it);
            return (
              <Pressable key={it} onPress={() => toggle(interests, setInterests, it)} style={[styles.chip, sel && styles.chipSel]}>
                <Text style={[styles.chipText, sel && styles.chipTextSel]}>{it}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.bottom}>
        <Pressable style={styles.cta} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={T.night} /> : <Text style={styles.ctaText}>Enregistrer</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 4 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 8 },
  label: { fontSize: 13, fontWeight: "800", color: T.inkSoft, letterSpacing: 0.4, marginTop: 24, marginBottom: 10, marginHorizontal: 26 },
  input: { backgroundColor: T.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginHorizontal: 26, fontSize: 15.5, fontWeight: "600", color: T.night },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginHorizontal: 26 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: T.card, borderRadius: 20, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1.5, borderColor: "transparent" },
  chipSel: { backgroundColor: T.chipAbricot, borderColor: T.abricot },
  chipText: { fontSize: 13.5, fontWeight: "700", color: T.inkSoft },
  chipTextSel: { color: T.night },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: T.cream, paddingHorizontal: 26, paddingBottom: 40, paddingTop: 10 },
  cta: { backgroundColor: T.abricot, borderRadius: 16, padding: 17, alignItems: "center" },
  ctaText: { color: T.night, fontSize: 16, fontWeight: "800" },
});