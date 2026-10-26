// Mon dictionnaire — même gabarit que le Labo (maquettes du 26/10) : en-tête avec retour rond, état vide + « Ajouter un mot »,
// cartes par mot (mot en grand, type, sens, menu ⋮ en feuille, bouton « Voir la fiche »), feuille d'ajout.
// Logique inchangée : listFavorites / addFavorite / removeFavorite, fiche via DictionaryEntryScreen. Plus de barre de recherche.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { L, Icon, RoundButton, PrimaryButton } from "../components/lessonUi";
import { listFavorites, removeFavorite, addFavorite, Favorite, WordType } from "../lib/favorites";
import DictionaryEntryScreen from "./DictionaryEntryScreen";
import { SkeletonHeader, SkeletonBox } from "../components/Skeleton";

type FilterKey = "tous" | "expressions" | "mots";
const TYPE_LABEL: Record<WordType, string> = { nom: "nom", verbe: "verbe", adjectif: "adjectif", adverbe: "adverbe", expression: "expression" };
const TYPE_CHIP: Record<WordType, { bg: string; fg: string }> = {
  expression: { bg: L.lavender, fg: L.lavenderText },
  nom: { bg: L.accentSoft, fg: L.accentText },
  verbe: { bg: "#DCEAFB", fg: "#2A5C8A" },
  adjectif: { bg: L.successSoft, fg: L.success },
  adverbe: { bg: "#FBE0D9", fg: "#B0472B" },
};

function isThisWeek(addedAt: any): boolean {
  const t = addedAt?.toDate ? addedAt.toDate() : (typeof addedAt === "number" ? new Date(addedAt) : null);
  if (!t) return true;
  return Date.now() - t.getTime() < 7 * 86400000;
}

export default function DictionaryScreen({ onBack, onStartConversation, onOpenReading }: { onBack: () => void; onStartConversation?: () => void; onOpenReading?: () => void }) {
  const [favs, setFavs] = useState<Favorite[] | null>(null);
  const [openWord, setOpenWord] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("tous");
  const [menuFav, setMenuFav] = useState<Favorite | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [newFr, setNewFr] = useState("");

  const load = () => { listFavorites().then(setFavs); };
  useEffect(load, []);

  const counts = useMemo(() => {
    if (!favs) return { tous: 0, expressions: 0, mots: 0 };
    const expressions = favs.filter((f) => f.wordType === "expression").length;
    return { tous: favs.length, expressions, mots: favs.length - expressions };
  }, [favs]);
  const filtered = useMemo(() => {
    if (!favs) return [];
    if (filter === "expressions") return favs.filter((f) => f.wordType === "expression");
    if (filter === "mots") return favs.filter((f) => f.wordType !== "expression");
    return favs;
  }, [favs, filter]);
  const thisWeek = filtered.filter((f) => isThisWeek(f.addedAt));
  const older = filtered.filter((f) => !isThisWeek(f.addedAt));

  // Ajout direct : mot (+ traduction si connue) ; la fiche (type, IPA, définition, exemples) s'enrichit en arrière-plan
  const submitWord = async () => {
    const w = newWord.trim();
    if (w.length < 2) return;
    await addFavorite(w, newFr.trim());
    setNewWord(""); setNewFr(""); setShowAdd(false);
    load();
  };
  const menuOpen = () => { const f = menuFav; setMenuFav(null); if (f) setTimeout(() => setOpenWord(f.word), 250); };
  const menuRemove = async () => { const f = menuFav; setMenuFav(null); if (f) { await removeFavorite(f.word); load(); } };

  if (openWord) return <DictionaryEntryScreen word={openWord} onBack={() => { setOpenWord(null); load(); }} />;

  const header = (
    <View style={styles.head}>
      <RoundButton icon="retour" label="Retour" onPress={onBack} size={44} iconSize={20} style={{ marginBottom: 12 }} />
      <Text style={styles.h1}>Mon dictionnaire</Text>
      <Text style={styles.sub}>Les mots et expressions que tu as choisi de garder.</Text>
    </View>
  );

  if (!favs) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingHorizontal: L.gutter, marginTop: 6 }}>
          <SkeletonHeader message="Chargement de ton dictionnaire…" />
          {[0, 1, 2].map((i) => <SkeletonBox key={i} height={120} radius={18} style={{ marginBottom: 10 }} />)}
        </View>
      </View>
    );
  }

  const card = (f: Favorite) => {
    const chip = f.wordType ? TYPE_CHIP[f.wordType] : null;
    return (
      <View key={f.word} style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.wordRow}>
              <Text style={styles.word}>{f.word}</Text>
              {f.wordType && chip ? <View style={[styles.typePill, { backgroundColor: chip.bg }]}><Text style={[styles.typeText, { color: chip.fg }]}>{TYPE_LABEL[f.wordType]}</Text></View> : null}
            </View>
            <Text style={styles.fr} numberOfLines={2}>{f.gloss || f.fr || "Fiche en préparation…"}{f.ipa ? <Text style={styles.ipa}>  {f.ipa}</Text> : null}</Text>
          </View>
          <Pressable onPress={() => setMenuFav(f)} hitSlop={10} style={styles.kebab} accessibilityRole="button" accessibilityLabel={`Options pour ${f.word}`}>
            <MaterialCommunityIcons name="dots-vertical" size={22} color={L.textPrimary} />
          </Pressable>
        </View>
        <PrimaryButton label="Voir la fiche" onPress={() => setOpenWord(f.word)} style={{ marginTop: 12 }} />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {header}

        {favs.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Icon name="etoile" size={30} /></View>
            <Text style={styles.emptyTitle}>Quel mot veux-tu garder ?</Text>
            <Text style={styles.emptyBody}>Ajoute un mot ou une expression. En conversation ou en lecture, touche un mot pour le garder d'un geste.</Text>
            <Pressable onPress={() => setShowAdd(true)} style={styles.addPrimary} accessibilityRole="button">
              <Text style={styles.addPrimaryPlus}>+</Text><Text style={styles.addPrimaryText}>Ajouter un mot</Text>
            </Pressable>
            {onStartConversation ? <Pressable onPress={onStartConversation} hitSlop={8}><Text style={styles.emptyLink}>Ou lance une conversation</Text></Pressable> : <Text style={styles.emptyCaption}>Garde. Écoute. Réemploie.</Text>}
          </View>
        ) : (
          <>
            <View style={styles.filterRow}>
              {([["tous", "Tous"], ["expressions", "Expressions"], ["mots", "Mots"]] as [FilterKey, string][]).map(([key, label]) => (
                <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filterChip, filter === key && styles.filterChipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === key }}>
                  <Text style={[styles.filterChipText, filter === key && styles.filterChipTextOn]}>{label} {counts[key]}</Text>
                </Pressable>
              ))}
            </View>

            {thisWeek.length > 0 && (
              <>
                <View style={styles.grpRow}><Text style={styles.grp}>Cette semaine</Text><Text style={styles.grpCount}>{thisWeek.length} mot{thisWeek.length > 1 ? "s" : ""}</Text></View>
                {thisWeek.map(card)}
              </>
            )}
            {older.length > 0 && (
              <>
                <View style={styles.grpRow}><Text style={styles.grp}>Plus anciens</Text><Text style={styles.grpCount}>{older.length}</Text></View>
                {older.map(card)}
              </>
            )}
            {filtered.length === 0 && <Text style={styles.noResult}>Rien dans cette catégorie pour l'instant.</Text>}

            <Pressable onPress={() => setShowAdd(true)} style={styles.addOutline} accessibilityRole="button">
              <Text style={styles.addOutlinePlus}>+</Text><Text style={styles.addOutlineText}>Ajouter un mot</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Feuille « Ajouter un mot » */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <Pressable style={styles.overlay} onPress={() => setShowAdd(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Ajouter un mot</Text>
                <Text style={styles.sheetSub}>Un mot ou une expression en anglais. La fiche se complète toute seule.</Text>
              </View>
              <Pressable onPress={() => setShowAdd(false)} hitSlop={10} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Fermer"><Icon name="fermer" size={16} /></Pressable>
            </View>
            <Text style={styles.fieldLabel}>Mot à garder</Text>
            <TextInput value={newWord} onChangeText={setNewWord} placeholder="touch base, thorough…" placeholderTextColor={L.textSecondary} style={styles.input} autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
            <Text style={styles.fieldLabel}>Traduction (facultatif)</Text>
            <TextInput value={newFr} onChangeText={setNewFr} placeholder="faire un point" placeholderTextColor={L.textSecondary} style={[styles.input, { borderColor: L.border }]} autoCapitalize="none" returnKeyType="done" onSubmitEditing={submitWord} />
            <PrimaryButton label="Ajouter" onPress={submitWord} disabled={newWord.trim().length < 2} arrow={false} style={{ marginTop: 14 }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Feuille d'options d'un mot */}
      <Modal visible={!!menuFav} transparent animationType="fade" onRequestClose={() => setMenuFav(null)}>
        <Pressable style={styles.overlay} onPress={() => setMenuFav(null)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.menuWord}>{menuFav?.word}</Text>
          <Text style={styles.sheetSub}>{menuFav?.gloss || menuFav?.fr || ""}</Text>
          <Pressable onPress={menuOpen} style={styles.menuRow} accessibilityRole="button">
            <View style={[styles.menuIcon, { backgroundColor: L.accentSoft }]}><Icon name="ecouter" size={20} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuTitle}>Voir la fiche</Text>
              <Text style={styles.menuSub}>Définition, exemples, écoute.</Text>
            </View>
          </Pressable>
          <Pressable onPress={menuRemove} style={styles.menuRow} accessibilityRole="button">
            <View style={[styles.menuIcon, { backgroundColor: "#FBE3E0" }]}><Icon name="fermer" size={18} tint={L.danger} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.menuTitle, { color: L.danger }]}>Retirer du dictionnaire</Text>
              <Text style={styles.menuSub}>Tu pourras le garder à nouveau plus tard.</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setMenuFav(null)} style={styles.menuCancel} accessibilityRole="button"><Text style={styles.menuCancelText}>Annuler</Text></Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  head: { paddingTop: 56, paddingHorizontal: L.gutter, paddingBottom: 14 },
  h1: { fontSize: 30, fontWeight: "800", color: L.textPrimary, letterSpacing: -0.5 },
  sub: { color: L.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 6 },

  empty: { alignItems: "center", paddingHorizontal: L.gutter, marginTop: 28 },
  emptyIcon: { width: 64, height: 64, borderRadius: 18, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  emptyTitle: { color: L.textPrimary, fontSize: 24, fontWeight: "800", textAlign: "center" },
  emptyBody: { color: L.textSecondary, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 10, maxWidth: 320 },
  emptyCaption: { color: L.textSecondary, fontSize: 13.5, marginTop: 16 },
  emptyLink: { color: L.accentText, fontSize: 14, fontWeight: "800", marginTop: 16 },
  addPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: L.accentDeep, borderRadius: 16, minHeight: 56, alignSelf: "stretch", marginTop: 26 },
  addPrimaryPlus: { color: "#fff", fontSize: 24, fontWeight: "600", lineHeight: 26 },
  addPrimaryText: { color: "#fff", fontSize: 16.5, fontWeight: "800" },

  filterRow: { flexDirection: "row", gap: 8, marginHorizontal: L.gutter, marginTop: 4, flexWrap: "wrap" },
  filterChip: { backgroundColor: L.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  filterChipOn: { backgroundColor: L.textPrimary },
  filterChipText: { color: L.textSecondary, fontSize: 12.5, fontWeight: "700" },
  filterChipTextOn: { color: "#fff" },

  grpRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginHorizontal: L.gutter, marginTop: 18, marginBottom: 10 },
  grp: { color: L.textPrimary, fontSize: 19, fontWeight: "800" },
  grpCount: { color: L.textSecondary, fontSize: 14, fontWeight: "600" },
  noResult: { color: L.textSecondary, fontSize: 14, textAlign: "center", marginTop: 24, marginBottom: 8 },

  card: { backgroundColor: L.surface, borderRadius: 20, padding: 16, marginHorizontal: L.gutter, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  cardTop: { flexDirection: "row", alignItems: "flex-start" },
  wordRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  word: { color: L.textPrimary, fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  typePill: { borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7 },
  typeText: { fontSize: 11, fontWeight: "800" },
  fr: { color: L.textSecondary, fontSize: 14.5, marginTop: 4 },
  ipa: { color: L.textSecondary, fontSize: 13 },
  kebab: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  addOutline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: L.textPrimary, borderRadius: 16, minHeight: 56, marginHorizontal: L.gutter, marginTop: 4 },
  addOutlinePlus: { color: L.textPrimary, fontSize: 24, fontWeight: "600", lineHeight: 26 },
  addOutlineText: { color: L.textPrimary, fontSize: 16, fontWeight: "800" },

  overlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.45)" },
  sheet: { backgroundColor: L.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 24 },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: L.border, alignSelf: "center", marginBottom: 14 },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sheetTitle: { color: L.textPrimary, fontSize: 22, fontWeight: "800" },
  sheetSub: { color: L.textSecondary, fontSize: 14, marginTop: 4 },
  sheetClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  fieldLabel: { color: L.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: L.accentDeep, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, fontWeight: "700", color: L.textPrimary, backgroundColor: L.surface },
  menuWord: { color: L.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.background, borderRadius: 16, padding: 12, marginTop: 10 },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle: { color: L.textPrimary, fontSize: 15.5, fontWeight: "800" },
  menuSub: { color: L.textSecondary, fontSize: 12.5, marginTop: 1 },
  menuCancel: { alignItems: "center", justifyContent: "center", minHeight: 48, marginTop: 8 },
  menuCancelText: { color: L.textSecondary, fontSize: 15, fontWeight: "700" },
});
