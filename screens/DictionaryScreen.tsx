// Mon dictionnaire : liste des mots/expressions gardés (ex-Favoris), avec recherche et filtre par type.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { listFavorites, removeFavorite, Favorite, WordType } from "../lib/favorites";
import DictionaryEntryScreen from "./DictionaryEntryScreen";
import { SkeletonHeader, SkeletonBox } from "../components/Skeleton";
import DictionaryEmptyImg from "../assets/hub/dictionnaire-vide.svg";

type FilterKey = "tous" | "expressions" | "mots";

const TYPE_LABEL: Record<WordType, string> = { nom: "nom", verbe: "verbe", adjectif: "adjectif", adverbe: "adverbe", expression: "expression" };
const TYPE_CHIP_STYLE: Record<WordType, { bg: string; fg: string }> = {
  expression: { bg: "#E9E3FB", fg: "#5B3FA6" },
  nom: { bg: "#FBE7CE", fg: "#8A5A17" },
  verbe: { bg: "#DCEAFB", fg: "#2A5C8A" },
  adjectif: { bg: "#DFF3E4", fg: "#2E7D53" },
  adverbe: { bg: "#FBE0D9", fg: "#B0472B" },
};

function isThisWeek(addedAt: any): boolean {
  const t = addedAt?.toDate ? addedAt.toDate() : (typeof addedAt === "number" ? new Date(addedAt) : null);
  if (!t) return true;
  return Date.now() - t.getTime() < 7 * 86400000;
}

export default function DictionaryScreen({
  onBack,
  onStartConversation,
  onOpenReading,
}: {
  onBack: () => void;
  onStartConversation?: () => void;
  onOpenReading?: () => void;
}) {
  const [favs, setFavs] = useState<Favorite[] | null>(null);
  const [openWord, setOpenWord] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("tous");

  const load = () => { listFavorites().then(setFavs); };
  useEffect(load, []);

  const onRemove = async (word: string) => {
    await removeFavorite(word);
    load();
  };

  const counts = useMemo(() => {
    if (!favs) return { tous: 0, expressions: 0, mots: 0 };
    const expressions = favs.filter((f) => f.wordType === "expression").length;
    return { tous: favs.length, expressions, mots: favs.length - expressions };
  }, [favs]);

  const filtered = useMemo(() => {
    if (!favs) return [];
    let list = favs;
    if (filter === "expressions") list = list.filter((f) => f.wordType === "expression");
    if (filter === "mots") list = list.filter((f) => f.wordType !== "expression");
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((f) => f.word.toLowerCase().includes(q) || f.fr.toLowerCase().includes(q));
    return list;
  }, [favs, filter, query]);

  const thisWeek = filtered.filter((f) => isThisWeek(f.addedAt));
  const older = filtered.filter((f) => !isThisWeek(f.addedAt));

  if (!favs) {
    return (
      <View style={styles.container}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={12} style={{ marginBottom: 12 }}>
            <Feather name="chevron-left" size={26} color={T.inkSoft} />
          </Pressable>
          <Text style={styles.h1}>Mon dictionnaire</Text>
        </View>
        <View style={{ paddingHorizontal: 26, marginTop: 6 }}>
          <SkeletonHeader message="Chargement de ton dictionnaire…" />
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBox key={i} height={62} radius={18} style={{ marginBottom: 10 }} />
          ))}
        </View>
      </View>
    );
  }

  const Row = ({ f }: { f: Favorite }) => {
    const chip = f.wordType ? TYPE_CHIP_STYLE[f.wordType] : null;
    return (
      <Pressable style={styles.row} onPress={() => setOpenWord(f.word)}>
        <View style={styles.rowIcon}><Feather name="volume-2" size={15} color={T.abricotDeep} /></View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowTop}>
            <Text style={styles.rowWord}>{f.word}</Text>
            {f.wordType && chip && (
              <View style={[styles.typeChip, { backgroundColor: chip.bg }]}>
                <Text style={[styles.typeChipText, { color: chip.fg }]}>{TYPE_LABEL[f.wordType]}</Text>
              </View>
            )}
          </View>
          <Text style={styles.rowFr} numberOfLines={1}>{f.gloss || f.fr}</Text>
        </View>
        <Pressable onPress={() => onRemove(f.word)} hitSlop={10} style={{ padding: 6 }}>
          <Feather name="x" size={16} color={T.inkSoft} />
        </Pressable>
        <Feather name="chevron-right" size={20} color="#D9B78E" />
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {openWord ? (
        <DictionaryEntryScreen word={openWord} onBack={() => { setOpenWord(null); load(); }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Pressable onPress={onBack} hitSlop={12} style={{ marginBottom: 12 }}>
              <Feather name="chevron-left" size={26} color={T.inkSoft} />
            </Pressable>
            <Text style={styles.h1}>Mon dictionnaire</Text>
            {favs.length > 0 && <Text style={styles.sub}>{favs.length} mot{favs.length > 1 ? "s" : ""} et expression{favs.length > 1 ? "s" : ""} gardé{favs.length > 1 ? "s" : ""}</Text>}
          </View>

          {favs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyImgWrap}><DictionaryEmptyImg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" /></View>
              <Text style={styles.emptyTitle}>Ton dictionnaire est encore vide</Text>
              <Text style={styles.emptyBody}>
                Pendant une conversation ou une lecture, touche un mot souligné puis{" "}
                <Text style={styles.emptyStrong}>Ajouter à mes mots</Text>. Il arrivera ici avec sa définition et des exemples.
              </Text>
              {onStartConversation && (
                <Pressable onPress={onStartConversation} style={styles.emptyCta}>
                  <Feather name="mic" size={17} color={T.night} />
                  <Text style={styles.emptyCtaText}>Lancer une conversation</Text>
                </Pressable>
              )}
              {onOpenReading && (
                <Pressable onPress={onOpenReading} hitSlop={8}>
                  <Text style={styles.emptyLink}>Faire la lecture du jour</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <>
              <View style={styles.searchRow}>
                <Feather name="search" size={16} color={T.inkSoft} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Rechercher un mot, une expression…"
                  placeholderTextColor={T.inkSoft}
                />
              </View>

              <View style={styles.filterRow}>
                {([["tous", "Tous"], ["expressions", "Expressions"], ["mots", "Mots"]] as [FilterKey, string][]).map(([key, label]) => (
                  <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filterChip, filter === key && styles.filterChipOn]}>
                    <Text style={[styles.filterChipText, filter === key && styles.filterChipTextOn]}>{label} {counts[key]}</Text>
                  </Pressable>
                ))}
              </View>

              {thisWeek.length > 0 && (
                <>
                  <Text style={styles.sectionK}>CETTE SEMAINE</Text>
                  {thisWeek.map((f) => <Row key={f.word} f={f} />)}
                </>
              )}
              {older.length > 0 && (
                <>
                  <Text style={styles.sectionK}>PLUS ANCIENS</Text>
                  {older.map((f) => <Row key={f.word} f={f} />)}
                </>
              )}
              {filtered.length === 0 && (
                <Text style={styles.noResult}>Aucun résultat pour cette recherche.</Text>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 10 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 14, fontWeight: "600", marginTop: 4 },

  emptyWrap: { alignItems: "center", paddingHorizontal: 30, marginTop: 20 },
  emptyImgWrap: { width: 180, height: 140, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: T.night, textAlign: "center" },
  emptyBody: { fontSize: 14.5, fontWeight: "600", color: T.inkSoft, lineHeight: 22, textAlign: "center", marginTop: 10 },
  emptyStrong: { color: T.abricotDeep, fontWeight: "800" },
  emptyCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 26, marginTop: 24, alignSelf: "stretch" },
  emptyCtaText: { color: T.night, fontSize: 15, fontWeight: "800" },
  emptyLink: { color: T.abricotDeep, fontSize: 13.5, fontWeight: "800", marginTop: 16 },

  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 26, marginTop: 10 },
  searchInput: { flex: 1, color: T.night, fontSize: 14.5, fontWeight: "600" },

  filterRow: { flexDirection: "row", gap: 8, marginHorizontal: 26, marginTop: 12, flexWrap: "wrap" },
  filterChip: { backgroundColor: T.card, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 12 },
  filterChipOn: { backgroundColor: T.night },
  filterChipText: { color: T.inkSoft, fontSize: 12.5, fontWeight: "700" },
  filterChipTextOn: { color: "#fff" },

  sectionK: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginHorizontal: 26, marginTop: 18, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: T.card, borderRadius: 18, padding: 14, marginHorizontal: 26, marginBottom: 8 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowWord: { fontSize: 16, fontWeight: "800", color: T.night },
  typeChip: { borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7 },
  typeChipText: { fontSize: 10.5, fontWeight: "800" },
  rowFr: { fontSize: 13, fontWeight: "600", color: T.inkSoft, marginTop: 2 },
  noResult: { color: T.inkSoft, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 30 },
});
