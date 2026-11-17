// NewsCarousel — « Ton rendez-vous du jour » : les actus de l'édition en cartes à faire défiler (une carte + l'amorce de la suivante).
import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import { L } from "./lessonUi";
import NewsCover from "./NewsCover";
import type { NewsItem, NewsProgress } from "../lib/news";

const GAP = 12;
const PEEK = 22; // largeur visible de la carte suivante

export default function NewsCarousel({ items, progress, gutter = L.gutter, onOpen }: {
  items: NewsItem[];
  progress: NewsProgress;
  gutter?: number; // marge de l'écran parent : le carrousel déborde jusqu'aux bords
  onOpen: (index: number) => void;
}) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(width - gutter * 2 - (items.length > 1 ? PEEK : 0), 460);
  const [page, setPage] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP));
    if (p !== page) setPage(Math.max(0, Math.min(items.length - 1, p)));
  };
  return (
    <View style={{ marginHorizontal: -gutter }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardW + GAP}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: gutter, gap: GAP }}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        {items.map((item, i) => {
          const p = progress[item.id];
          const done = !!p?.quiz;
          return (
            <Pressable key={item.id} onPress={() => onOpen(i)} style={[styles.card, { width: cardW }]} accessibilityRole="button" accessibilityLabel={`${item.rubriqueLabelFr}. ${item.titleFr || item.titleEn}. Actu ${i + 1} sur ${items.length}${done ? ", quiz fait" : ""}`}>
              <NewsCover item={item} chip="white" radius={18} style={styles.cover}>
                {done ? (
                  <View style={styles.done}>
                    <Feather name="check" size={13} color="#fff" />
                    <Text style={styles.doneText}>{p!.quiz!.score}/{p!.quiz!.total}</Text>
                  </View>
                ) : null}
              </NewsCover>
              <Text style={styles.titleEn} numberOfLines={2}>{item.titleEn}</Text>
              {item.titleFr ? <Text style={styles.titleFr} numberOfLines={1}>{item.titleFr}</Text> : null}
              <Text style={styles.pitch} numberOfLines={1}>Lis, écoute, puis raconte à ton coach.</Text>
              <View style={styles.foot}>
                <View style={styles.steps}><Text style={styles.stepsText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.1}>Lecture · Quiz · Oral</Text></View>
                <View style={styles.cta}>
                  <Text style={styles.ctaText} maxFontSizeMultiplier={1.2}>{done ? "Revoir" : "Découvrir"}</Text>
                  <Feather name="arrow-right" size={16} color={L.textPrimary} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {items.length > 1 ? (
        <View style={styles.dots} accessibilityLabel={`Actu ${page + 1} sur ${items.length}`}>
          {items.map((it, i) => <View key={it.id} style={[styles.dot, i === page && styles.dotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: L.surface, borderRadius: 24, borderWidth: 1, borderColor: L.border, padding: 12, paddingBottom: 14 },
  cover: { width: "100%", aspectRatio: 2.3 },
  done: { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: L.success, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  doneText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  titleEn: { color: L.textPrimary, fontSize: 21, fontWeight: "800", lineHeight: 27, letterSpacing: -0.3, marginTop: 12, marginHorizontal: 4 },
  titleFr: { color: L.textSecondary, fontSize: 15.5, fontWeight: "500", marginTop: 3, marginHorizontal: 4 },
  pitch: { color: L.textSecondary, fontSize: 13.5, marginTop: 8, marginHorizontal: 4 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12, marginHorizontal: 2 },
  steps: { borderWidth: 1.5, borderColor: L.textPrimary, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 9, flexShrink: 1 },
  stepsText: { color: L.textPrimary, fontSize: 12, fontWeight: "700" },
  cta: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: L.accentDeep, borderRadius: 14, minHeight: 44, paddingHorizontal: 12 },
  ctaText: { color: L.textPrimary, fontSize: 14.5, fontWeight: "800" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E7D9CC" },
  dotOn: { backgroundColor: L.accentDeep },
});
