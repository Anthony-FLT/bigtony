import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { getDailySelection, listPracticeWords, addManualWord, removeWord, setMastered, PracticeWord } from "../lib/practiceWords";
import WordPracticeScreen from "./WordPracticeScreen";

export default function LaboScreen({ refreshKey }: { refreshKey: number }) {
  const [daily, setDaily] = useState<PracticeWord[] | null>(null);
  const [all, setAll] = useState<PracticeWord[]>([]);
  const [practiceWord, setPracticeWord] = useState<PracticeWord | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [showMastered, setShowMastered] = useState(false);

  const load = () => {
    getDailySelection(5).then(setDaily);
    listPracticeWords().then(setAll);
  };
  useEffect(load, [refreshKey]);

  const submitWord = async () => {
    const w = newWord.trim();
    if (w.length < 2) return;
    await addManualWord(w);
    setNewWord(""); setShowAdd(false);
    load();
  };
  const onRemove = async (w: string) => { await removeWord(w); load(); };

  const renderWordCard = (pw: PracticeWord) => (
    <Pressable key={pw.word} style={styles.wordCard} onPress={() => setPracticeWord(pw)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.word}>{pw.word}</Text>
        {pw.heardAs ? <Text style={styles.heard}>on a entendu « {pw.heardAs} »</Text> : null}
      </View>
      <Pressable onPress={() => onRemove(pw.word)} hitSlop={10} style={{ padding: 6, marginRight: 2 }}>
        <Feather name="x" size={16} color={T.inkSoft} />
      </Pressable>
      <Feather name="chevron-right" size={20} color="#D9B78E" />
    </Pressable>
  );

  if (!daily) return <View style={styles.center}><ActivityIndicator size="large" color={T.abricotDeep} /></View>;

  const masteredList = all.filter((w) => w.mastered);
  const others = all.filter((w) => !w.mastered && !daily.some((d) => d.word === w.word));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.head}>
        <Text style={styles.h1}>Le labo</Text>
        <Text style={styles.sub}>Travaille les mots qui te résistent, un par un.</Text>
      </View>

      {daily.length > 0 ? (
        <>
          <Text style={styles.grp}>TA SÉLECTION DU JOUR</Text>
          {daily.map(renderWordCard)}
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Ton labo se remplit tout seul.</Text>
          <Text style={styles.emptyBody}>Les mots que tu écorches en discussion arrivent ici pour que tu les retravailles. Tu peux aussi en ajouter toi-même.</Text>
        </View>
      )}

      <Pressable style={styles.addCard} onPress={() => setShowAdd(true)}>
        <View style={styles.addIcon}><Feather name="plus" size={20} color={T.night} /></View>
        <Text style={styles.addText}>Ajouter un mot à travailler</Text>
      </Pressable>

      {others.length > 0 && (
        <>
          <Text style={styles.grp}>TOUS TES MOTS</Text>
          {others.map(renderWordCard)}
        </>
      )}

      {masteredList.length > 0 && (
        <>
          <Pressable style={styles.masteredHeader} onPress={() => setShowMastered((v) => !v)}>
            <Feather name="check-circle" size={16} color={T.menthe} />
            <Text style={styles.masteredHeaderText}>Mots maîtrisés ({masteredList.length})</Text>
            <Feather name={showMastered ? "chevron-up" : "chevron-down"} size={18} color={T.inkSoft} style={{ marginLeft: "auto" }} />
          </Pressable>
          {showMastered && masteredList.map((w) => (
            <View key={w.word} style={styles.masteredRow}>
              <Text style={styles.masteredWord}>{w.word}</Text>
              <Pressable onPress={async () => { await setMastered(w.word, false); load(); }} hitSlop={8}>
                <Text style={styles.masteredRevive}>Retravailler</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      <Modal visible={showAdd} transparent animationType="fade" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowAdd(false)}>
          <Pressable style={styles.addModal} onPress={() => {}}>
            <Text style={styles.addModalTitle}>Un mot à travailler</Text>
            <TextInput value={newWord} onChangeText={setNewWord} placeholder="Ex. thorough, schedule…" placeholderTextColor={T.inkSoft} style={styles.addInput} autoFocus autoCapitalize="none" />
            <Pressable onPress={submitWord} disabled={newWord.trim().length < 2} style={[styles.addSubmit, newWord.trim().length < 2 && { opacity: 0.4 }]}>
              <Text style={styles.addSubmitText}>Ajouter</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!practiceWord} animationType="slide" onRequestClose={() => { setPracticeWord(null); load(); }}>
        {practiceWord && (
          <WordPracticeScreen word={practiceWord.word} heardAs={practiceWord.heardAs} onClose={() => { setPracticeWord(null); load(); }} />
        )}
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  center: { flex: 1, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 12 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 8 },
  grp: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginHorizontal: 26, marginTop: 18, marginBottom: 10 },
  emptyCard: { backgroundColor: T.card, borderRadius: 20, padding: 20, marginHorizontal: 26, marginTop: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: T.night },
  emptyBody: { fontSize: 14, fontWeight: "600", color: T.inkSoft, lineHeight: 21, marginTop: 6 },
  wordCard: { flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderRadius: 18, padding: 16, marginHorizontal: 26, marginBottom: 10 },
  word: { fontSize: 19, fontWeight: "800", color: T.night },
  heard: { fontSize: 12.5, fontWeight: "600", color: T.corail, marginTop: 2 },
  addCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: T.miel, borderRadius: 18, padding: 14, marginHorizontal: 26, marginTop: 10 },
  addIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(27,42,74,0.12)", alignItems: "center", justifyContent: "center" },
  addText: { color: T.night, fontSize: 15, fontWeight: "800" },
  masteredHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 26, marginTop: 22, marginBottom: 8 },
  masteredHeaderText: { color: T.night, fontSize: 14, fontWeight: "800" },
  masteredRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.card, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 16, marginHorizontal: 26, marginBottom: 8 },
  masteredWord: { color: T.inkSoft, fontSize: 15, fontWeight: "700" },
  masteredRevive: { color: T.abricotDeep, fontSize: 13, fontWeight: "800" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.6)", alignItems: "center", justifyContent: "center", padding: 34 },
  addModal: { backgroundColor: T.cream, borderRadius: 22, padding: 22, width: "100%" },
  addModalTitle: { fontSize: 18, fontWeight: "800", color: T.night, marginBottom: 14 },
  addInput: { backgroundColor: T.card, borderRadius: 14, padding: 15, fontSize: 16, fontWeight: "600", color: T.night },
  addSubmit: { backgroundColor: T.abricot, borderRadius: 14, padding: 15, alignItems: "center", marginTop: 14 },
  addSubmitText: { color: T.night, fontSize: 15, fontWeight: "800" },
});