// NewsCover — illustration d'une actu : l'image générée pour le sujet, ou l'illustration de secours de sa rubrique
// (sur fond lavande) quand l'image manque ou ne se charge pas. L'image est lue depuis le cache local dès qu'il est prêt,
// et sans fondu d'apparition (fadeDuration 0), pour un affichage immédiat quand on revient sur l'écran. Pastille de rubrique optionnelle, coin haut gauche.
import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { rubriqueImage, localCoverUri, type NewsItem } from "../lib/news";

export default function NewsCover({ item, style, radius = 18, chip, children }: {
  item: NewsItem;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  chip?: "white" | "lavender"; // pastille de rubrique
  children?: React.ReactNode; // éléments posés sur l'image (pastille « terminée »…)
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [item.id]);
  const remote = !!item.image?.url && !failed;
  return (
    <View style={[styles.wrap, { borderRadius: radius, backgroundColor: remote ? "#FDE3CC" : "#E6DFFA" }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {remote
        ? <Image source={{ uri: localCoverUri(item.image!.url) ?? item.image!.url }} style={styles.image} resizeMode="cover" fadeDuration={0} onError={() => setFailed(true)} />
        : <Image source={rubriqueImage(item.rubrique)} style={styles.image} resizeMode="contain" fadeDuration={0} />}
      {chip ? (
        <View style={[styles.chip, chip === "lavender" && styles.chipLavender]}>
          <Text style={[styles.chipText, chip === "lavender" && { color: "#3F3399" }]} maxFontSizeMultiplier={1.2}>{item.rubriqueLabelFr.toUpperCase()}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  // Taille explicite : sans elle, une image locale garde sa taille d'origine (960 × 540) et déborde du cadre
  image: { width: "100%", height: "100%" },
  chip: { position: "absolute", top: 10, left: 10, backgroundColor: "#FFFFFF", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  chipLavender: { backgroundColor: "#E9E3FB" },
  chipText: { color: "#192947", fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
});
