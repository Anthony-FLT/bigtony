import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { listFavorites, removeFavorite, Favorite } from "../lib/favorites";
import WordPracticeScreen from "./WordPracticeScreen";

export default function FavoritesScreen({ onBack }: { onBack: () => void }) {
  const [favs, setFavs] = useState<Favorite[] | null>(null);
  const [practice, setPractice] = useState<string | null>(null);

  const load = () => { listFavorites().then(setFavs); };
  useEffect(load, []);

  const onRemove = async (word: string) => {
    await removeFavorite(word);
    load();
  };

  if (!favs) return <View style={styles.center}><ActivityIndicator size="large" color={T.abricotDeep} /></View>;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={12} style={{ marginBottom: 12 }}>
            <Feather name="chevron-left" size={26} color={T.inkSoft} />
          </Pressable>
          <Text style={styles.h1}>Tes mots favoris</Text>
          <Text style={styles.sub}>Le vocabulaire que tu as choisi de garder. Touche un mot pour l'écouter et le prononcer.</Text>
        </View>

        {favs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Aucun favori pour l'instant.</Text>
            <Text style={styles.emptyBody}>
              Pendant une conversation, touche un mot pour voir sa traduction, puis « Ajouter aux favoris ». Ils t'attendront ici.
            </Text>
          </View>
        ) : (
          favs.map((f) => (
            <Pressable key={f.word} style={styles.favCard} onPress={() => setPractice(f.word)}>
              <View style={styles.favIcon}><Feather name="star" size={16} color={T.abricotDeep} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.favWord}>{f.word}</Text>
                <Text style={styles.favFr}>{f.fr}</Text>
              </View>
              <Pressable onPress={() => onRemove(f.word)} hitSlop={10} style={{ padding: 6 }}>
                <Feather name="x" size={16} color={T.inkSoft} />
              </Pressable>
              <Feather name="chevron-right" size={20} color="#D9B78E" />
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={!!practice} animationType="slide" onRequestClose={() => setPractice(null)}>
        {practice && <WordPracticeScreen word={practice} onClose={() => setPractice(null)} />}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  center: { flex: 1, backgroundColor: T.cream, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 56, paddingHorizontal: 26, paddingBottom: 14 },
  h1: { fontSize: 28, fontWeight: "800", color: T.night, letterSpacing: -0.4 },
  sub: { color: T.inkSoft, fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 8 },

  emptyCard: { backgroundColor: T.card, borderRadius: 20, padding: 20, marginHorizontal: 26, marginTop: 6 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: T.night },
  emptyBody: { fontSize: 14, fontWeight: "600", color: T.inkSoft, lineHeight: 21, marginTop: 6 },

  favCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: T.card, borderRadius: 18, padding: 15, marginHorizontal: 26, marginBottom: 10 },
  favIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center" },
  favWord: { fontSize: 17, fontWeight: "800", color: T.night },
  favFr: { fontSize: 13.5, fontWeight: "600", color: T.inkSoft, marginTop: 2 },
});