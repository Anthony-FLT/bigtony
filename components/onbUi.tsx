// onbUi — kit visuel de l'onboarding (maquettes du 29/10) : jetons, pictogrammes fournis (PNG 96 px teintés),
// boutons, barre de progression, cartes à choix, encart coach sombre, pastilles.
import React from "react";
import { View, Text, Pressable, Image, StyleSheet, ActivityIndicator, ImageSourcePropType, StyleProp, ViewStyle } from "react-native";

// design-tokens.json du pack
export const O = {
  bg: "#FFF0E0", surface: "#FFFFFF", ink: "#192947", primary: "#FF9B50", muted: "#746C65",
  lavender: "#EEE9FC", lavenderInk: "#5B4BD6", mint: "#DDF6E9", success: "#278966", border: "#E9DED1",
  primarySoft: "#FFE4CC", navy: "#192947",
  radiusCard: 24, radiusButton: 18, gutter: 20,
};

const ICONS = {
  bars: require("../assets/onboarding2/icons/bars.png"),
  brain: require("../assets/onboarding2/icons/brain.png"),
  check: require("../assets/onboarding2/icons/check.png"),
  "chevron-down": require("../assets/onboarding2/icons/chevron-down.png"),
  "chevron-left": require("../assets/onboarding2/icons/chevron-left.png"),
  "chevron-right": require("../assets/onboarding2/icons/chevron-right.png"),
  circle: require("../assets/onboarding2/icons/circle.png"),
  clock: require("../assets/onboarding2/icons/clock.png"),
  close: require("../assets/onboarding2/icons/close.png"),
  coffee: require("../assets/onboarding2/icons/coffee.png"),
  confetti: require("../assets/onboarding2/icons/confetti.png"),
  ear: require("../assets/onboarding2/icons/ear.png"),
  gift: require("../assets/onboarding2/icons/gift.png"),
  globe: require("../assets/onboarding2/icons/globe.png"),
  help: require("../assets/onboarding2/icons/help.png"),
  info: require("../assets/onboarding2/icons/info.png"),
  keyboard: require("../assets/onboarding2/icons/keyboard.png"),
  lightbulb: require("../assets/onboarding2/icons/lightbulb.png"),
  loader: require("../assets/onboarding2/icons/loader.png"),
  lock: require("../assets/onboarding2/icons/lock.png"),
  message: require("../assets/onboarding2/icons/message.png"),
  mic: require("../assets/onboarding2/icons/mic.png"),
  "mic-off": require("../assets/onboarding2/icons/mic-off.png"),
  more: require("../assets/onboarding2/icons/more.png"),
  pause: require("../assets/onboarding2/icons/pause.png"),
  play: require("../assets/onboarding2/icons/play.png"),
  replay: require("../assets/onboarding2/icons/replay.png"),
  sad: require("../assets/onboarding2/icons/sad.png"),
  sparkles: require("../assets/onboarding2/icons/sparkles.png"),
  sprout: require("../assets/onboarding2/icons/sprout.png"),
  suitcase: require("../assets/onboarding2/icons/suitcase.png"),
  target: require("../assets/onboarding2/icons/target.png"),
  user: require("../assets/onboarding2/icons/user.png"),
  users: require("../assets/onboarding2/icons/users.png"),
  volume: require("../assets/onboarding2/icons/volume.png"),
  warning: require("../assets/onboarding2/icons/warning.png"),
} as const;
export type OnbIconName = keyof typeof ICONS;

export const IMAGES = {
  welcomeCoffee: require("../assets/onboarding2/images/welcome-coffee.png"),
  welcomeSocial: require("../assets/onboarding2/images/welcome-social.png"),
  goalTravel: require("../assets/onboarding2/images/goal-travel.png"),
  goalWork: require("../assets/onboarding2/images/goal-work.png"),
  goalStudies: require("../assets/onboarding2/images/goal-interview.png"),
  goalDaily: require("../assets/onboarding2/images/goal-daily.png"),
  sceneCafe: require("../assets/onboarding2/images/scene-cafe.png"),
  scenePresentation: require("../assets/onboarding2/images/scene-presentation.png"),
  sceneHotel: require("../assets/onboarding2/images/scene-hotel.png"),
};

export function OnbIcon({ name, size = 22, tint = O.ink, style }: { name: OnbIconName; size?: number; tint?: string; style?: StyleProp<ViewStyle> }) {
  return <Image source={ICONS[name]} style={[{ width: size, height: size, tintColor: tint }, style as any]} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />;
}

// Rond teinté avec pictogramme (listes « bénéfices », cartes blocage/niveau)
export function IconDisc({ name, bg, tint, size = 44, iconSize = 22 }: { name: OnbIconName; bg: string; tint: string; size?: number; iconSize?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><OnbIcon name={name} size={iconSize} tint={tint} /></View>;
}

export function PrimaryCta({ label, onPress, disabled, busy, style }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={[s.cta, (disabled || busy) && s.ctaOff, style]} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
      {busy ? <ActivityIndicator color={O.ink} /> : <Text style={s.ctaText} maxFontSizeMultiplier={1.3}>{label}</Text>}
    </Pressable>
  );
}
export function SecondaryLink({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={[s.link, style]} accessibilityRole="button">
      <Text style={s.linkText} maxFontSizeMultiplier={1.3}>{label}</Text>
    </Pressable>
  );
}

// Barre du haut : chevron retour + segments (un par étape, l'étape courante en orange, les précédentes en orange clair)
export function TopBar({ step, total, onBack }: { step: number; total: number; onBack?: () => void }) {
  return (
    <View style={s.topBar}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={s.back} accessibilityRole="button" accessibilityLabel="Retour"><OnbIcon name="chevron-left" size={24} /></Pressable>
      ) : <View style={s.back} />}
      <View style={s.segments} accessibilityLabel={`Étape ${step} sur ${total}`}>
        {Array.from({ length: total }).map((_, i) => <View key={i} style={[s.segment, i + 1 < step && s.segmentDone, i + 1 === step && s.segmentOn]} />)}
      </View>
      <View style={s.back} />
    </View>
  );
}

export function Title({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <Text style={[s.title, center && { textAlign: "center" }]} accessibilityRole="header">{children}</Text>;
}
export function Subtitle({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <Text style={[s.sub, center && { textAlign: "center" }]}>{children}</Text>;
}

// Carte à choix : vignette ou pictogramme à gauche, titre + description, rond de sélection (coche orange quand choisie)
export function ChoiceCard({ selected, onPress, title, desc, image, icon, iconBg, iconTint, accessibilityLabel }: {
  selected: boolean; onPress: () => void; title: string; desc: string; image?: ImageSourcePropType; icon?: OnbIconName; iconBg?: string; iconTint?: string; accessibilityLabel?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[s.choice, selected && s.choiceOn]} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={accessibilityLabel ?? `${title}. ${desc}`}>
      {image ? <Image source={image} style={s.choiceImg} resizeMode="cover" /> : icon ? <IconDisc name={icon} bg={iconBg ?? O.primarySoft} tint={iconTint ?? O.primary} size={54} iconSize={26} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        <Text style={s.choiceDesc}>{desc}</Text>
      </View>
      <View style={[s.radio, selected && s.radioOn]}>{selected ? <OnbIcon name="check" size={16} tint="#fff" /> : null}</View>
    </Pressable>
  );
}

// Encart bleu nuit avec le portrait rond du coach et un texte (rassurance, astuce)
export function CoachNote({ avatar, title, body, icon }: { avatar?: ImageSourcePropType; title?: string; body: string; icon?: OnbIconName }) {
  return (
    <View style={s.note} accessibilityRole="text">
      {avatar ? <Image source={avatar} style={s.noteAvatar} resizeMode="cover" /> : icon ? <View style={s.noteIcon}><OnbIcon name={icon} size={22} tint={O.primary} /></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? <Text style={s.noteTitle}>{title}</Text> : null}
        <Text style={s.noteBody}>{body}</Text>
      </View>
      <OnbIcon name="sparkles" size={18} tint={O.primary} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}

export function InfoLine({ text }: { text: string }) {
  return (
    <View style={s.info}>
      <View style={s.infoIcon}><OnbIcon name="info" size={14} tint={O.lavenderInk} /></View>
      <Text style={s.infoText}>{text}</Text>
    </View>
  );
}

export function Chip({ icon, label, bg = O.lavender, tint = O.lavenderInk, color = O.ink }: { icon?: OnbIconName; label: string; bg?: string; tint?: string; color?: string }) {
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      {icon ? <OnbIcon name={icon} size={15} tint={tint} /> : null}
      <Text style={[s.chipText, { color }]}>{label}</Text>
    </View>
  );
}

// Portrait rond du coach avec coche verte et éclats (écrans de bilan)
export function CoachMedallion({ source, size = 104, check = true }: { source: ImageSourcePropType; size?: number; check?: boolean }) {
  return (
    <View style={{ width: size + 40, height: size + 16, alignItems: "center", justifyContent: "center" }}>
      <View style={[s.spark, { left: 0, top: 10, transform: [{ rotate: "-30deg" }] }]} />
      <View style={[s.spark, { right: 0, top: 14, transform: [{ rotate: "30deg" }] }]} />
      <View style={[s.spark, { left: 10, bottom: 6, transform: [{ rotate: "60deg" }] }]} />
      <View style={[s.spark, { right: 8, bottom: 2, transform: [{ rotate: "-60deg" }] }]} />
      <Image source={source} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 4, borderColor: O.surface }} resizeMode="cover" />
      {check && <View style={s.medalCheck}><OnbIcon name="check" size={16} tint="#fff" /></View>}
    </View>
  );
}

export const s = StyleSheet.create({
  cta: { backgroundColor: O.primary, borderRadius: O.radiusButton, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  ctaOff: { opacity: 0.45 },
  ctaText: { color: O.ink, fontSize: 17, fontWeight: "800" },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: O.muted, fontSize: 14.5, fontWeight: "700" },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  segments: { flex: 1, flexDirection: "row", gap: 6, paddingHorizontal: 20 },
  segment: { flex: 1, height: 7, borderRadius: 4, backgroundColor: O.border },
  segmentDone: { backgroundColor: O.primarySoft },
  segmentOn: { backgroundColor: O.primary },
  title: { color: O.ink, fontSize: 28, fontWeight: "800", lineHeight: 34, letterSpacing: -0.5 },
  sub: { color: O.muted, fontSize: 15.5, lineHeight: 22, fontWeight: "600", marginTop: 6 },
  choice: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: O.surface, borderRadius: 22, padding: 14, paddingRight: 18, borderWidth: 2, borderColor: "transparent", minHeight: 96 },
  choiceOn: { borderColor: O.primary, backgroundColor: "#FFF7EE" },
  choiceImg: { width: 96, height: 72, borderRadius: 14, backgroundColor: O.border },
  choiceTitle: { color: O.ink, fontSize: 17.5, fontWeight: "800" },
  choiceDesc: { color: O.muted, fontSize: 14, fontWeight: "600", marginTop: 3, lineHeight: 19 },
  radio: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: O.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: O.primary, borderColor: O.primary },
  note: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: O.navy, borderRadius: 20, padding: 14 },
  noteAvatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: "rgba(255,255,255,0.25)" },
  noteIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  noteTitle: { color: "#fff", fontSize: 15.5, fontWeight: "800", marginBottom: 2 },
  noteBody: { color: "rgba(255,255,255,0.85)", fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  info: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  infoIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: O.lavender, alignItems: "center", justifyContent: "center" },
  infoText: { color: O.muted, fontSize: 13, fontWeight: "600" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  chipText: { fontSize: 12.5, fontWeight: "800" },
  spark: { position: "absolute", width: 18, height: 4, borderRadius: 2, backgroundColor: O.primary },
  medalCheck: { position: "absolute", right: 18, bottom: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: O.success, borderWidth: 3, borderColor: O.bg, alignItems: "center", justifyContent: "center" },
});
