// Fiche mot du dictionnaire : définition, exemples en contexte, mots proches — pas d'exercice de prononciation ici.
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { httpsCallable } from "firebase/functions";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { functions } from "../lib/firebase";
import { T } from "../lib/theme";
import { getFavorite, removeFavorite, enrichFavorite, Favorite, ExampleCategory } from "../lib/favorites";
import { SCENARIOS } from "../lib/scenarios";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

const CAT_LABEL: Record<ExampleCategory, string> = { pro: "Au travail", voyage: "En voyage", quotidien: "Au quotidien" };
const SCENARIO_TITLE: Record<string, string> = { daily: "Discussion du jour", welcome: "On fait connaissance" };

function scenarioLabel(id?: string): string | null {
  if (!id) return null;
  if (SCENARIO_TITLE[id]) return SCENARIO_TITLE[id];
  const s = SCENARIOS.find((x) => x.id === id);
  return s ? s.title : null;
}

function formatDate(addedAt: any): string | null {
  const t = addedAt?.toDate ? addedAt.toDate() : (typeof addedAt === "number" ? new Date(addedAt) : null);
  if (!t) return null;
  return t.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// Met en évidence la première occurrence du mot dans la phrase d'exemple (tolérant, insensible à la casse).
function HighlightedSentence({ text, word }: { text: string; word: string }) {
  const idx = text.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return <Text style={styles.exSentence}>{text}</Text>;
  return (
    <Text style={styles.exSentence}>
      {text.slice(0, idx)}
      <Text style={styles.exHighlight}>{text.slice(idx, idx + word.length)}</Text>
      {text.slice(idx + word.length)}
    </Text>
  );
}

export default function DictionaryEntryScreen({ word, onBack }: { word: string; onBack: () => void }) {
  const [fav, setFav] = useState<Favorite | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<ExampleCategory | "tous">("tous");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const player = useAudioPlayer();

  const load = () => getFavorite(word).then(setFav);
  useEffect(() => { load(); }, [word]);

  // L'enrichissement (définition, exemples...) se génère en arrière-plan après l'ajout.
  // S'il n'est pas encore là, on réessaie quelques fois avant d'abandonner proprement.
  useEffect(() => {
    if (fav?.definitionEn || attempts >= 4) return;
    const t = setTimeout(() => { load(); setAttempts((a) => a + 1); }, 2200);
    return () => clearTimeout(t);
  }, [fav, attempts]);

  const retryEnrichment = async () => {
    if (!fav) return;
    setRetrying(true); setRetryError(null);
    try {
      await enrichFavorite(fav.word, fav.fr);
      await load();
      setAttempts(0); // relance le cycle d'attente normal si la fiche est bien arrivée
    } catch (e: any) {
      console.warn("Réessai enrichissement échoué:", e);
      setRetryError(e?.message ?? String(e));
    } finally {
      setRetrying(false);
    }
  };

  const playText = async (text: string, rate?: number) => {
    try {
      const r: any = await translateText({ text, mode: "speak", ...(rate ? { speakingRate: rate } : {}) });
      if (!r.data?.audioBase64) return;
      const p = FileSystem.cacheDirectory + `dict_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(p, r.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
      player.replace(p);
      player.play();
    } catch (e) { console.warn("Lecture audio échouée:", e); }
  };

  const doRemove = async () => {
    await removeFavorite(word);
    setConfirmRemove(false);
    onBack();
  };

  if (!fav) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={T.abricotDeep} style={{ marginTop: 80 }} />
      </View>
    );
  }

  const examples = fav.examples ?? [];
  const shownExamples = catFilter === "tous" ? examples : examples.filter((e) => e.category === catFilter);
  const catCounts: Record<string, number> = { tous: examples.length };
  (["pro", "voyage", "quotidien"] as ExampleCategory[]).forEach((c) => { catCounts[c] = examples.filter((e) => e.category === c).length; });
  const scenarioTitle = scenarioLabel(fav.scenario);
  const dateLabel = formatDate(fav.addedAt);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.topBar}>
          <Pressable onPress={onBack} hitSlop={12}><Feather name="chevron-left" size={26} color={T.night} /></Pressable>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => setConfirmRemove(true)} style={styles.starBtn} hitSlop={8}>
              <Feather name="star" size={18} color={T.abricotDeep} />
            </Pressable>
            <Pressable onPress={() => setConfirmRemove(true)} style={styles.starBtn} hitSlop={8}>
              <Feather name="more-horizontal" size={18} color={T.inkSoft} />
            </Pressable>
          </View>
        </View>

        <View style={styles.headCard}>
          <View style={styles.headBlob} />
          {fav.wordType && (
            <View style={styles.typePill}><Text style={styles.typePillText}>{fav.wordType.toUpperCase()}</Text></View>
          )}
          <Text style={styles.word}>{fav.word}</Text>
          {fav.ipa ? <Text style={styles.ipa}>{fav.ipa}</Text> : null}
          {fav.gloss ? <Text style={styles.gloss}>{fav.gloss}</Text> : null}
          <View style={styles.headBtnRow}>
            <Pressable onPress={() => playText(fav.word)} style={styles.headBtn}>
              <Feather name="volume-2" size={15} color={T.night} />
              <Text style={styles.headBtnText}>Écouter</Text>
            </Pressable>
            <Pressable onPress={() => playText(fav.word, 0.6)} style={[styles.headBtn, styles.headBtnMuted]}>
              <Feather name="clock" size={15} color="#fff" />
              <Text style={[styles.headBtnText, { color: "#fff" }]}>Lentement</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionK}>DÉFINITION</Text>
        {fav.definitionEn ? (
          <View style={styles.defCard}>
            <Text style={styles.defEn}>{fav.definitionEn}</Text>
            {fav.explanationFr ? <Text style={styles.defFr}>{fav.explanationFr}</Text> : null}
            {!!fav.registerTags?.length && (
              <View style={styles.tagRow}>
                {fav.registerTags.map((t, i) => (
                  <View key={i} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
                ))}
              </View>
            )}
          </View>
        ) : attempts >= 4 ? (
          <View style={styles.defCard}>
            <Text style={styles.retryText}>La définition n'a pas pu être générée.</Text>
            <Pressable onPress={retryEnrichment} disabled={retrying} style={[styles.retryBtn, retrying && { opacity: 0.5 }]}>
              {retrying ? <ActivityIndicator size="small" color={T.night} /> : (
                <><Feather name="refresh-cw" size={14} color={T.night} /><Text style={styles.retryBtnText}>Réessayer</Text></>
              )}
            </Pressable>
            {retryError && <Text selectable style={styles.retryErrorDetail}>{retryError}</Text>}
          </View>
        ) : (
          <View style={styles.defCard}><ActivityIndicator color={T.abricotDeep} /></View>
        )}

        {examples.length > 0 && (
          <>
            <View style={styles.sectionKRow}>
              <Text style={styles.sectionK}>EN CONTEXTE</Text>
              <Text style={styles.sectionCount}>{examples.length} exemple{examples.length > 1 ? "s" : ""}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 26, gap: 8, marginBottom: 12 }}>
              {(["tous", "quotidien", "pro", "voyage"] as const).map((c) => (
                catCounts[c] > 0 && (
                  <Pressable key={c} onPress={() => setCatFilter(c)} style={[styles.filterChip, catFilter === c && styles.filterChipOn]}>
                    <Text style={[styles.filterChipText, catFilter === c && styles.filterChipTextOn]}>
                      {c === "tous" ? "Tous" : CAT_LABEL[c]} {catCounts[c]}
                    </Text>
                  </Pressable>
                )
              ))}
            </ScrollView>

            {shownExamples.map((ex, i) => (
              <View key={i} style={styles.exCard}>
                <Text style={styles.exCat}>{CAT_LABEL[ex.category].toUpperCase()}</Text>
                <View style={styles.exRow}>
                  <View style={{ flex: 1 }}>
                    <HighlightedSentence text={ex.en} word={fav.word} />
                    <Text style={styles.exFr}>{ex.fr}</Text>
                  </View>
                  <Pressable onPress={() => playText(ex.en)} style={styles.exPlayBtn}>
                    <Feather name="play" size={14} color={T.night} />
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        {!!fav.relatedWords?.length && (
          <>
            <Text style={styles.sectionK}>MOTS PROCHES</Text>
            <View style={[styles.tagRow, { marginHorizontal: 26 }]}>
              {fav.relatedWords.map((w, i) => (
                <View key={i} style={styles.relatedChip}><Text style={styles.relatedText}>{w}</Text></View>
              ))}
            </View>
          </>
        )}

        {(dateLabel || scenarioTitle) && (
          <Text style={styles.footer}>
            Ajouté le {dateLabel ?? "récemment"}{scenarioTitle ? ` pendant « ${scenarioTitle} »` : ""}
          </Text>
        )}
      </ScrollView>

      <Modal visible={confirmRemove} transparent animationType="fade" onRequestClose={() => setConfirmRemove(false)}>
        <Pressable style={styles.confirmOverlay} onPress={() => setConfirmRemove(false)}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <Text style={styles.confirmTitle}>Retirer « {word} » de ton dictionnaire ?</Text>
            <Pressable onPress={doRemove} style={styles.confirmDangerBtn}>
              <Text style={styles.confirmDangerText}>Retirer</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmRemove(false)} style={{ paddingVertical: 12, alignItems: "center" }}>
              <Text style={styles.confirmCancelText}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingHorizontal: 20, paddingBottom: 10 },
  starBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: T.card, alignItems: "center", justifyContent: "center" },

  headCard: { backgroundColor: T.night, borderRadius: 24, marginHorizontal: 20, padding: 20, overflow: "hidden" },
  headBlob: { position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: 55, backgroundColor: "rgba(245,183,136,0.12)" },
  typePill: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9, marginBottom: 10 },
  typePillText: { color: "#C9D3E8", fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6 },
  word: { color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.6 },
  ipa: { color: "#9DB0D4", fontSize: 15, fontWeight: "600", marginTop: 4 },
  gloss: { color: T.abricot, fontSize: 15, fontWeight: "700", marginTop: 8 },
  headBtnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  headBtn: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: T.abricot, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16 },
  headBtnMuted: { backgroundColor: "rgba(255,255,255,0.12)" },
  headBtnText: { color: T.night, fontSize: 13.5, fontWeight: "800" },

  sectionK: { color: T.abricotDeep, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginHorizontal: 26, marginTop: 20, marginBottom: 10 },
  sectionKRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 26, marginTop: 20, marginBottom: 10 },
  sectionCount: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600" },

  defCard: { backgroundColor: T.card, borderRadius: 18, padding: 18, marginHorizontal: 26 },
  retryText: { color: T.inkSoft, fontSize: 14, fontWeight: "600", textAlign: "center", marginBottom: 12 },
  retryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 10 },
  retryBtnText: { color: T.night, fontSize: 13.5, fontWeight: "800" },
  retryErrorDetail: { color: "#C0392B", fontSize: 11.5, fontWeight: "600", textAlign: "center", marginTop: 10 },
  defEn: { color: T.night, fontSize: 15.5, fontWeight: "700", lineHeight: 23 },
  defFr: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", lineHeight: 20, marginTop: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  tag: { backgroundColor: T.chipAbricot, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10 },
  tagText: { color: T.abricotDeep, fontSize: 12, fontWeight: "700" },

  filterChip: { backgroundColor: T.card, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 12 },
  filterChipOn: { backgroundColor: T.night },
  filterChipText: { color: T.inkSoft, fontSize: 12.5, fontWeight: "700" },
  filterChipTextOn: { color: "#fff" },

  exCard: { backgroundColor: T.card, borderRadius: 16, padding: 14, marginHorizontal: 26, marginBottom: 10 },
  exCat: { color: T.abricotDeep, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, marginBottom: 6 },
  exRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  exSentence: { color: T.night, fontSize: 14.5, fontWeight: "600", lineHeight: 21 },
  exHighlight: { backgroundColor: T.chipAbricot, color: T.abricotDeep, fontWeight: "800" },
  exFr: { color: T.inkSoft, fontSize: 12.5, fontWeight: "600", marginTop: 5, lineHeight: 18 },
  exPlayBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },

  relatedChip: { backgroundColor: T.card, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 },
  relatedText: { color: T.night, fontSize: 13, fontWeight: "700" },

  footer: { color: T.inkSoft, fontSize: 12, fontWeight: "600", marginHorizontal: 26, marginTop: 20 },

  confirmOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.5)", alignItems: "center", justifyContent: "center", padding: 30 },
  confirmCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%" },
  confirmTitle: { color: T.night, fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 18, lineHeight: 22 },
  confirmDangerBtn: { backgroundColor: "#C0392B", borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  confirmDangerText: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  confirmCancelText: { color: T.inkSoft, fontSize: 14, fontWeight: "700" },
});
