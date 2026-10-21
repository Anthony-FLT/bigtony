// Kit visuel du parcours (maquettes du 20/10) : tokens, icônes PNG, illustrations, briques réutilisables.
// Fichiers attendus : assets/icons/ic_*.png et assets/illustrations/ill_*.png (noms de ta livraison).
import React from "react";
import { View, Text, Pressable, Image, StyleSheet, ImageStyle, StyleProp, ViewStyle } from "react-native";

export const L = {
  background: "#FFFAF5",
  surface: "#FFFFFF",
  primary: "#192947",
  textPrimary: "#192947",
  textSecondary: "#566176",
  accent: "#FFA35C",
  accentDeep: "#F2873A",
  accentSoft: "#FDDCBE",
  accentText: "#D97A2B",
  success: "#2F7D58",
  successFill: "#4CB97A",
  successSoft: "#E6F4EC",
  lavender: "#ECEBFC",
  lavenderText: "#6B5CE7",
  yellow: "#FBE4A8",
  yellowText: "#B9771A",
  border: "#E8E1D9",
  danger: "#B3261E",
  radiusCard: 22,
  radiusButton: 18,
  gutter: 20,
  buttonMinHeight: 56,
  touch: 48,
};

export const ICONS = {
  aide: require("../assets/icons/ic_aide.png"),
  attention: require("../assets/icons/ic_attention.png"),
  bouclier: require("../assets/icons/ic_bouclier.png"),
  bulle: require("../assets/icons/ic_bulle.png"),
  cadenas: require("../assets/icons/ic_cadenas.png"),
  check: require("../assets/icons/ic_check.png"),
  chevron: require("../assets/icons/ic_chevron.png"),
  clavier: require("../assets/icons/ic_clavier.png"),
  ecouter: require("../assets/icons/ic_ecouter.png"),
  envoyer: require("../assets/icons/ic_envoyer.png"),
  etoile: require("../assets/icons/ic_etoile.png"),
  exemple: require("../assets/icons/ic_exemple.png"),
  fermer: require("../assets/icons/ic_fermer.png"),
  flamme: require("../assets/icons/ic_flamme.png"),
  fleche: require("../assets/icons/ic_fleche.png"),
  horloge: require("../assets/icons/ic_horloge.png"),
  micro: require("../assets/icons/ic_micro.png"),
  niveau: require("../assets/icons/ic_niveau.png"),
  parcours: require("../assets/icons/ic_parcours.png"),
  play: require("../assets/icons/ic_play.png"),
  profil: require("../assets/icons/ic_profil.png"),
  progres: require("../assets/icons/ic_progres.png"),
  reglages: require("../assets/icons/ic_reglages.png"),
  rejouer: require("../assets/icons/ic_rejouer.png"),
  retour: require("../assets/icons/ic_retour.png"),
  traduire: require("../assets/icons/ic_traduire.png"),
} as const;
export type IconName = keyof typeof ICONS;

export const ILL = {
  avatar: require("../assets/illustrations/ill_avatar_user.png"),
  bulles: require("../assets/illustrations/ill_bulles.png"),
  cadenas: require("../assets/illustrations/ill_cadenas.png"),
  casque: require("../assets/illustrations/ill_casque.png"),
  chargement: require("../assets/illustrations/ill_chargement.png"),
  cible: require("../assets/illustrations/ill_cible.png"),
  crayon: require("../assets/illustrations/ill_crayon.png"),
  medaille: require("../assets/illustrations/ill_medaille.png"),
  micro: require("../assets/illustrations/ill_micro.png"),
  sceneCafe: require("../assets/illustrations/ill_scene_cafe.png"),
} as const;

// Icône PNG. tint : recolore une icône monochrome (laisse vide pour les icônes déjà colorées).
export function Icon({ name, size = 18, tint, style }: { name: IconName; size?: number; tint?: string; style?: StyleProp<ImageStyle> }) {
  return <Image source={ICONS[name]} style={[{ width: size, height: size }, tint ? { tintColor: tint } : null, style]} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

// Bouton rond blanc (retour, clavier, rejouer…)
export function RoundButton({ icon, onPress, label, size = 52, iconSize = 22, tint, style, disabled }: {
  icon: IconName; onPress: () => void; label: string; size?: number; iconSize?: number; tint?: string; style?: StyleProp<ViewStyle>; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={[styles.round, { width: size, height: size, borderRadius: size / 2 }, disabled && { opacity: 0.4 }, style]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}>
      <Icon name={icon} size={iconSize} tint={tint} />
    </Pressable>
  );
}

// Pastille d'info (série, XP, niveau, durée…)
export function Pill({ icon, children, bg = L.accentSoft, style }: { icon?: IconName; children: React.ReactNode; bg?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <Text style={styles.pillText}>{children}</Text>
    </View>
  );
}

// Bouton principal orange « Libellé → »
export function PrimaryButton({ label, onPress, disabled, style, arrow = true }: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; arrow?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.primary, disabled && { opacity: 0.4 }, style]} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
      <Text style={styles.primaryText} maxFontSizeMultiplier={1.4}>{label}</Text>
      {arrow && <Icon name="fleche" size={20} tint={L.textPrimary} />}
    </Pressable>
  );
}

// Petit bouton blanc « Écouter » / « Écouter l'exemple »
export function ListenButton({ label = "Écouter", onPress, busy, style }: { label?: string; onPress: () => void; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={[styles.listen, style]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name="ecouter" size={18} />
      <Text style={styles.listenText}>{busy ? "…" : label}</Text>
    </Pressable>
  );
}

export function SectionLabel({ children, color = L.textSecondary, style }: { children: React.ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  return <Text style={[styles.sectionLabel, { color }, style as any]}>{children}</Text>;
}

const styles = StyleSheet.create({
  round: { backgroundColor: L.surface, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, minHeight: 40 },
  pillText: { color: L.textPrimary, fontSize: 15, fontWeight: "700" },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: L.accentDeep, borderRadius: L.radiusButton, minHeight: L.buttonMinHeight, paddingHorizontal: 20, paddingVertical: 14 },
  primaryText: { color: L.textPrimary, fontSize: 18, fontWeight: "700" },
  listen: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: L.surface, borderRadius: 16, minHeight: 46, paddingHorizontal: 16 },
  listenText: { color: L.textPrimary, fontSize: 15, fontWeight: "700" },
  sectionLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
});
