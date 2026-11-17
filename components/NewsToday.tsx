// NewsToday — bloc « Ton actu du jour » : titre, date de l'édition et carrousel des actus, avec ses états
// (chargement, pas d'édition, tout fait). Affiché en haut de l'accueil.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { L } from "./lessonUi";
import NewsCarousel from "./NewsCarousel";
import { loadNewsEdition, loadNewsProgress, peekNewsEdition, peekNewsProgress, formatNewsDate, type NewsEdition, type NewsProgress } from "../lib/news";
import { logNewsCarouselShown } from "../lib/analytics";

export default function NewsToday({ refreshKey = 0, hideWhenEmpty = false, onOpenNews }: {
  refreshKey?: number; // change au retour d'une actu : on relit ce qui est fait
  hideWhenEmpty?: boolean; // accueil : rien n'est affiché tant qu'il n'y a pas d'édition
  onOpenNews: (edition: NewsEdition, index: number) => void;
}) {
  // Édition déjà en mémoire : affichée tout de suite, sans repasser par l'état « chargement » à chaque retour sur l'écran
  const [news, setNews] = useState<{ state: "loading" | "ready" | "empty"; edition: NewsEdition | null }>(() => {
    const e = peekNewsEdition();
    return e ? { state: "ready", edition: e } : { state: "loading", edition: null };
  });
  const [progress, setProgress] = useState<NewsProgress>(() => { const e = peekNewsEdition(); return (e && peekNewsProgress(e.date)) || {}; });
  const loggedDateRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const edition = await loadNewsEdition();
      if (cancelled) return;
      if (!edition) { setNews({ state: "empty", edition: null }); return; }
      const p = await loadNewsProgress(edition.date);
      if (cancelled) return;
      setProgress({ ...p });
      setNews({ state: "ready", edition });
      if (loggedDateRef.current !== edition.date) { loggedDateRef.current = edition.date; logNewsCarouselShown(edition.date, edition.items.length); }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const edition = news.edition;
  if (hideWhenEmpty && news.state === "empty") return null;
  const allDone = !!edition && edition.items.every((it) => !!progress[it.id]?.quiz);

  return (
    <View>
      <View style={styles.sectionRow}>
        <Text style={styles.section} accessibilityRole="header">Ton actu du jour</Text>
        {edition ? <View style={styles.count}><Text style={styles.countText} maxFontSizeMultiplier={1.2}>{edition.items.length} actu{edition.items.length > 1 ? "s" : ""}</Text></View> : null}
      </View>

      {news.state === "loading" ? (
        <View style={styles.placeholder} accessibilityLabel="Chargement des actus">
          <View style={styles.skelCover} />
          <View style={[styles.skelBar, { width: "80%" }]} />
          <View style={[styles.skelBar, { width: "55%" }]} />
        </View>
      ) : !edition ? (
        <View style={styles.placeholder}>
          <View style={styles.emptyIcon}><Feather name="coffee" size={26} color={L.accentText} /></View>
          <Text style={styles.emptyTitle}>Les actus du jour arrivent bientôt.</Text>
          <Text style={styles.emptySub}>Reviens un peu plus tard : chaque matin, quelques actus françaises à lire puis à raconter en anglais.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.editionDate}>Actus du {formatNewsDate(edition.date)}</Text>
          {allDone ? (
            <View style={styles.allDone} accessibilityRole="text">
              <Feather name="check-circle" size={18} color={L.success} />
              <Text style={styles.allDoneText}>Tu as fait le tour de l'actu. À demain !</Text>
            </View>
          ) : null}
          <NewsCarousel items={edition.items} progress={progress} onOpen={(i) => onOpenNews(edition, i)} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  section: { color: L.textPrimary, fontSize: 20, fontWeight: "800", letterSpacing: -0.3, flexShrink: 1 },
  count: { backgroundColor: L.accentSoft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  countText: { color: L.accentText, fontSize: 13.5, fontWeight: "800" },
  editionDate: { color: L.textSecondary, fontSize: 14, marginBottom: 12 },
  allDone: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: L.successSoft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  allDoneText: { flex: 1, color: L.success, fontSize: 14.5, fontWeight: "700" },
  placeholder: { backgroundColor: L.surface, borderRadius: 24, borderWidth: 1, borderColor: L.border, padding: 16, marginTop: 8, gap: 12 },
  skelCover: { width: "100%", aspectRatio: 2.3, borderRadius: 18, backgroundColor: "#F3E9DD" },
  skelBar: { height: 18, borderRadius: 9, backgroundColor: "#F3E9DD" },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: L.accentSoft, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: L.textPrimary, fontSize: 18, fontWeight: "800" },
  emptySub: { color: L.textSecondary, fontSize: 14.5, lineHeight: 21 },
});
