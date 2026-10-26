// LaboScreen — maquettes du 26/10 : état vide « Quel mot te résiste ? », feuille « Ajouter un mot », sélection du jour
// avec carte par mot (menu ⋮ : maîtrisé / supprimer) et « Travailler ce mot ». Logique inchangée (practiceWords, WordPracticeScreen).
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { L, Icon, PrimaryButton, RoundButton } from "../components/lessonUi";
import { getDailySelection, listPracticeWords, addManualWord, removeWord, setMastered, PracticeWord } from "../lib/practiceWords";
import WordPracticeScreen from "./WordPracticeScreen";
import { SkeletonHeader, SkeletonBox } from "../components/Skeleton";

const ms = (t: any) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : 0);

export default function LaboScreen({ refreshKey, premium, onLocked, onBack }: { refreshKey: number; premium: boolean; onLocked: () => void; onBack?: () => void }) {
  const [daily, setDaily] = useState<PracticeWord[] | null>(null);
  const [all, setAll] = useState<PracticeWord[]>([]);
  const [practiceWord, setPracticeWord] = useState<PracticeWord | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [showMastered, setShowMastered] = useState(false);
  const [menuWord, setMenuWord] = useState<PracticeWord | null>(null); // feuille d'options ⋮

  const load = () => {
    getDailySelection(5).then(setDaily);
    listPracticeWords().then(setAll);
  };
  useEffect(load, [refreshKey]);

  const openAdd = () => (premium ? setShowAdd(true) : onLocked());
  const submitWord = async () => {
    const w = newWord.trim();
    if (w.length < 2) return;
    const created = await addManualWord(w);
    setNewWord(""); setShowAdd(false);
    load();
    if (created) setTimeout(() => setPracticeWord(created), 350); // la feuille se ferme avant d'ouvrir l'exercice
  };
  const wordMenu = (pw: PracticeWord) => setMenuWord(pw);
  const menuMastered = async () => { const w = menuWord; setMenuWord(null); if (w) { await setMastered(w.word, true); load(); } };
  const menuRemove = async () => { const w = menuWord; setMenuWord(null); if (w) { await removeWord(w.word); load(); } };

  const header = (
    <View style={styles.head}>
      {onBack && <RoundButton icon="retour" label="Retour" onPress={onBack} size={44} iconSize={20} style={{ marginBottom: 12 }} />}
      <Text style={styles.h1}>Le labo</Text>
      <Text style={styles.sub}>Travaille ta prononciation, un mot à la fois.</Text>
    </View>
  );

  if (!daily) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
        {header}
        <View style={{ paddingHorizontal: L.gutter, marginTop: 8 }}>
          <SkeletonHeader message="Chargement de tes mots…" />
          {[0, 1, 2].map((i) => <SkeletonBox key={i} height={120} radius={18} style={{ marginBottom: 10 }} />)}
        </View>
      </ScrollView>
    );
  }

  const masteredList = all.filter((w) => w.mastered);
  const others = all.filter((w) => !w.mastered && !daily.some((d) => d.word === w.word)).sort((a, b) => ms(b.addedAt) - ms(a.addedAt));
  const isEmpty = daily.length === 0 && others.length === 0;

  const wordCard = (pw: PracticeWord) => (
    <View key={pw.word} style={styles.wordCard}>
      <View style={styles.wordTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.word}>{pw.word}</Text>
          <Text style={[styles.wordState, pw.heardAs ? { color: L.danger } : null]}>{pw.heardAs ? `On a entendu « ${pw.heardAs} »` : "Prêt à travailler"}</Text>
        </View>
        <Pressable onPress={() => wordMenu(pw)} hitSlop={10} style={styles.kebab} accessibilityRole="button" accessibilityLabel={`Options pour ${pw.word}`}>
          <MaterialCommunityIcons name="dots-vertical" size={22} color={L.textPrimary} />
        </Pressable>
      </View>
      <PrimaryButton label="Travailler ce mot" onPress={() => setPracticeWord(pw)} style={{ marginTop: 12 }} />
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
      {header}

      {isEmpty ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}><MaterialCommunityIcons name="waveform" size={30} color="#5B5BD6" /></View>
          <Text style={styles.emptyTitle}>Quel mot te résiste ?</Text>
          <Text style={styles.emptyBody}>Ajoute un mot ou une expression pour l'écouter et t'entraîner.</Text>
          <Pressable onPress={openAdd} style={styles.addPrimary} accessibilityRole="button">
            <Text style={styles.addPrimaryPlus}>+</Text><Text style={styles.addPrimaryText}>Ajouter un mot</Text>
            {!premium && <Icon name="cadenas" size={16} tint="#fff" style={{ marginLeft: 6 }} />}
          </Pressable>
          <Text style={styles.emptyCaption}>Écoute. Répète. Progresse.</Text>
        </View>
      ) : (
        <>
          {daily.length > 0 && (
            <>
              <View style={styles.grpRow}>
                <Text style={styles.grp}>Ta sélection du jour</Text>
                <Text style={styles.grpCount}>{daily.length} mot{daily.length > 1 ? "s" : ""}</Text>
              </View>
              {daily.map(wordCard)}
            </>
          )}

          <Pressable onPress={openAdd} style={styles.addOutline} accessibilityRole="button">
            <Text style={styles.addOutlinePlus}>+</Text><Text style={styles.addOutlineText}>Ajouter un mot</Text>
            {!premium && <Icon name="cadenas" size={16} style={{ marginLeft: 6 }} />}
          </Pressable>

          {others.length > 0 && (
            <>
              <View style={[styles.grpRow, { marginTop: 22 }]}>
                <Text style={styles.grp}>Tous tes mots</Text>
                <Text style={styles.grpCount}>{others.length}</Text>
              </View>
              {others.map((pw) => (
                <Pressable key={pw.word} onPress={() => setPracticeWord(pw)} style={styles.rowCard} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowWord}>{pw.word}</Text>
                    {pw.heardAs ? <Text style={styles.rowHeard}>On a entendu « {pw.heardAs} »</Text> : null}
                  </View>
                  <Pressable onPress={() => wordMenu(pw)} hitSlop={10} style={styles.kebab}><MaterialCommunityIcons name="dots-vertical" size={20} color={L.textSecondary} /></Pressable>
                  <Icon name="chevron" size={16} />
                </Pressable>
              ))}
            </>
          )}

          {masteredList.length > 0 && (
            <>
              <Pressable style={styles.masteredHeader} onPress={() => setShowMastered((v) => !v)} accessibilityRole="button">
                <Icon name="check" size={18} />
                <Text style={styles.masteredHeaderText}>Mots maîtrisés ({masteredList.length})</Text>
                <Icon name="chevron" size={16} style={{ marginLeft: "auto", transform: [{ rotate: showMastered ? "-90deg" : "90deg" }] }} />
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
        </>
      )}

      {/* Feuille « Ajouter un mot » */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <Pressable style={styles.overlay} onPress={() => setShowAdd(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Ajouter un mot</Text>
                <Text style={styles.sheetSub}>Un mot ou une expression en anglais.</Text>
              </View>
              <Pressable onPress={() => setShowAdd(false)} hitSlop={10} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Fermer"><Icon name="fermer" size={16} /></Pressable>
            </View>
            <Text style={styles.fieldLabel}>Mot à travailler</Text>
            <TextInput
              value={newWord} onChangeText={setNewWord} placeholder="through, schedule, comfortable…" placeholderTextColor={L.textSecondary}
              style={styles.input} autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={submitWord}
            />
            <PrimaryButton label="Ajouter" onPress={submitWord} disabled={newWord.trim().length < 2} arrow={false} style={{ marginTop: 14 }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Feuille d'options d'un mot */}
      <Modal visible={!!menuWord} transparent animationType="fade" onRequestClose={() => setMenuWord(null)}>
        <Pressable style={styles.overlay} onPress={() => setMenuWord(null)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.menuWord}>{menuWord?.word}</Text>
          <Text style={styles.sheetSub}>{menuWord?.heardAs ? `On a entendu « ${menuWord.heardAs} »` : "Que veux-tu faire de ce mot ?"}</Text>
          <Pressable onPress={menuMastered} style={styles.menuRow} accessibilityRole="button">
            <View style={[styles.menuIcon, { backgroundColor: L.successSoft }]}><Icon name="check" size={20} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuTitle}>Marquer comme maîtrisé</Text>
              <Text style={styles.menuSub}>Il sort de ta sélection, tu pourras le retravailler.</Text>
            </View>
          </Pressable>
          <Pressable onPress={menuRemove} style={styles.menuRow} accessibilityRole="button">
            <View style={[styles.menuIcon, { backgroundColor: "#FBE3E0" }]}><Icon name="fermer" size={18} tint={L.danger} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.menuTitle, { color: L.danger }]}>Supprimer</Text>
              <Text style={styles.menuSub}>Retire le mot du labo.</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setMenuWord(null)} style={styles.menuCancel} accessibilityRole="button"><Text style={styles.menuCancelText}>Annuler</Text></Pressable>
        </View>
      </Modal>

      <Modal visible={!!practiceWord} animationType="slide" onRequestClose={() => { setPracticeWord(null); load(); }}>
        {practiceWord && <WordPracticeScreen word={practiceWord.word} heardAs={practiceWord.heardAs} onClose={() => { setPracticeWord(null); load(); }} />}
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  head: { paddingTop: 56, paddingHorizontal: L.gutter, paddingBottom: 14 },
  h1: { fontSize: 30, fontWeight: "800", color: L.textPrimary, letterSpacing: -0.5 },
  sub: { color: L.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 6 },

  empty: { alignItems: "center", paddingHorizontal: L.gutter, marginTop: 28 },
  emptyIcon: { width: 64, height: 64, borderRadius: 18, backgroundColor: L.lavender, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  emptyTitle: { color: L.textPrimary, fontSize: 24, fontWeight: "800", textAlign: "center" },
  emptyBody: { color: L.textSecondary, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 10, maxWidth: 300 },
  addPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: L.accentDeep, borderRadius: 16, minHeight: 56, alignSelf: "stretch", marginTop: 26 },
  addPrimaryPlus: { color: "#fff", fontSize: 24, fontWeight: "600", lineHeight: 26 },
  addPrimaryText: { color: "#fff", fontSize: 16.5, fontWeight: "800" },
  emptyCaption: { color: L.textSecondary, fontSize: 13.5, marginTop: 16 },

  grpRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginHorizontal: L.gutter, marginTop: 10, marginBottom: 10 },
  grp: { color: L.textPrimary, fontSize: 19, fontWeight: "800" },
  grpCount: { color: L.textSecondary, fontSize: 14, fontWeight: "600" },

  wordCard: { backgroundColor: L.surface, borderRadius: 20, padding: 16, marginHorizontal: L.gutter, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  wordTop: { flexDirection: "row", alignItems: "flex-start" },
  word: { color: L.textPrimary, fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  wordState: { color: L.textSecondary, fontSize: 14, marginTop: 4 },
  kebab: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  addOutline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: L.textPrimary, borderRadius: 16, minHeight: 56, marginHorizontal: L.gutter, marginTop: 4 },
  addOutlinePlus: { color: L.textPrimary, fontSize: 24, fontWeight: "600", lineHeight: 26 },
  addOutlineText: { color: L.textPrimary, fontSize: 16, fontWeight: "800" },

  rowCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: L.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, marginHorizontal: L.gutter, marginBottom: 8 },
  rowWord: { color: L.textPrimary, fontSize: 17, fontWeight: "700" },
  rowHeard: { color: L.danger, fontSize: 12.5, marginTop: 2 },

  masteredHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: L.gutter, marginTop: 22, marginBottom: 8 },
  masteredHeaderText: { color: L.textPrimary, fontSize: 15, fontWeight: "800" },
  masteredRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: L.surface, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 16, marginHorizontal: L.gutter, marginBottom: 8 },
  masteredWord: { color: L.textSecondary, fontSize: 15, fontWeight: "700" },
  masteredRevive: { color: L.accentDeep, fontSize: 13.5, fontWeight: "800" },

  overlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.45)" },
  menuWord: { color: L.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.background, borderRadius: 16, padding: 12, marginTop: 10 },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle: { color: L.textPrimary, fontSize: 15.5, fontWeight: "800" },
  menuSub: { color: L.textSecondary, fontSize: 12.5, marginTop: 1 },
  menuCancel: { alignItems: "center", justifyContent: "center", minHeight: 48, marginTop: 8 },
  menuCancelText: { color: L.textSecondary, fontSize: 15, fontWeight: "700" },
  sheet: { backgroundColor: L.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 24 },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: L.border, alignSelf: "center", marginBottom: 14 },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sheetTitle: { color: L.textPrimary, fontSize: 22, fontWeight: "800" },
  sheetSub: { color: L.textSecondary, fontSize: 14, marginTop: 4 },
  sheetClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  fieldLabel: { color: L.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 18, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: L.accentDeep, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, fontWeight: "700", color: L.textPrimary, backgroundColor: L.surface },
});
