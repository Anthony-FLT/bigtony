// OnboardingRoadmap — écran « Voici ton parcours » (GUIDE-CLAUDE.md, 03/11) : carrousel animé de 4 étapes placé après le
// bilan café et avant la présentation offerte, à la place de l'ancien paywall. Une caméra glisse horizontalement d'un podium
// à l'autre le long d'un chemin, chaque étape reste ~6 s, lecture/pause, « Et ensuite ? » passe à la suite, aucun paywall ici.
// Les illustrations PNG (780×600, fond transparent) contiennent déjà les étiquettes : seuls titre, sous-titre et CTA sont natifs.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing, Image, useWindowDimensions, AccessibilityInfo, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import type { Goal } from "../../lib/profile";
import type { CoachId } from "../../lib/learningPath/coaches";
import Svg, { Path } from "react-native-svg";
import { O, OnbIcon, PrimaryCta } from "../../components/onbUi";

const AnimatedPath = Animated.createAnimatedComponent(Path);

// design-tokens.json
const SLIDE_MS = 6000;
const CAMERA_MS = 1500;
const TEXT_DELAY_MS = 450;
const TEXT_ENTRANCE_MS = 650;
const ILLU_RATIO = 600 / 780;
const CAMERA_EASING = Easing.bezier(0.65, 0, 0.15, 1);

// Géométrie de la route (repère de référence 1680 × 320, une étape tous les 420) : un seul tracé continu passant par les 4 checkpoints
const WORLD_W = 1680;
const WORLD_H = 320;
const STEP = 420;
const ILLU_REF_W = 360; // taille de référence d'une illustration (780×600 → 360×277)
const CHECKPOINTS = [{ x: 210, y: 253 }, { x: 630, y: 253 }, { x: 1050, y: 253 }, { x: 1470, y: 253 }];
const CURVES: [number, number][][] = [
  [[210, 253], [350, 272], [490, 340], [630, 253]],
  [[630, 253], [770, 166], [910, 166], [1050, 253]],
  [[1050, 253], [1190, 340], [1330, 340], [1470, 253]],
];
const ROUTE_PATH = "M 210 253 C 350 272, 490 340, 630 253 C 770 166, 910 166, 1050 253 C 1190 340, 1330 340, 1470 253";
// Échantillonnage des courbes de Bézier (sans DOM) : longueurs cumulées et point à une longueur donnée
const SAMPLES = 80;
const ROUTE = (() => {
  const pts: { x: number; y: number; len: number }[] = [];
  let len = 0;
  CURVES.forEach(([p0, p1, p2, p3], ci) => {
    for (let i = ci === 0 ? 0 : 1; i <= SAMPLES; i++) {
      const t = i / SAMPLES, u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      if (pts.length) { const q = pts[pts.length - 1]; len += Math.hypot(x - q.x, y - q.y); }
      pts.push({ x, y, len });
    }
  });
  const total = len;
  // longueur cumulée à chaque checkpoint : [0, L1, L2, L]
  const targets = [0, pts[SAMPLES].len, pts[2 * SAMPLES].len, total];
  const pointAt = (l: number) => {
    const L = Math.max(0, Math.min(total, l));
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].len <= L) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi], span = b.len - a.len || 1, k = (L - a.len) / span;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  return { total, targets, pointAt };
})();
const MARKER = 30;

const ILLU = {
  cafe: require("../../assets/onboarding2/roadmap/illu-cafe.png"),
  progression: require("../../assets/onboarding2/roadmap/illu-progression.png"),
  voyage: require("../../assets/onboarding2/roadmap/illu-voyage.png"),
};
// Slide 2 : portrait du coach choisi. Seul Sam est livré dans le pack ; les autres coachs retombent sur lui tant que leurs PNG n'existent pas.
const ILLU_PRESENTATION: Partial<Record<CoachId, any>> = {
  us_male: require("../../assets/onboarding2/roadmap/illu-presentation-us_male.png"),
};
// Slide 3 : variante selon l'objectif. Seule « voyage » est livrée ; les autres objectifs l'utilisent en attendant leurs PNG.
const ILLU_GOAL: Partial<Record<Goal, any>> = {
  voyage: ILLU.voyage,
};

type Slide = { id: string; title: string; subtitle: string; illustration: any; cta: string };

export default function OnboardingRoadmap({ coachId, goal, onStart }: {
  coachId: CoachId;
  goal: Goal | null;
  onStart: () => void; // « Faire ma présentation » → conversation gratuite de présentation
}) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const sceneW = Math.max(280, winW - O.gutter * 2); // largeur visible du viewport
  const scale = Math.min(1, sceneW / STEP); // facteur d'échelle appliqué à toute la scène (route, podiums, marqueur)
  const illuW = ILLU_REF_W * scale;
  const illuH = Math.round(illuW * ILLU_RATIO);
  const sceneH = Math.round(WORLD_H * scale);

  // slides.json (textes validés)
  const slides: Slide[] = useMemo(() => [
    { id: "cafe", title: "Félicitations pour ce premier échange", subtitle: "C'est comme ça qu'on avance.", illustration: ILLU.cafe, cta: "Et ensuite ?" },
    { id: "presentation", title: "On fait quoi ensuite ?", subtitle: "Parle-nous un peu de toi, on fait connaissance !", illustration: ILLU_PRESENTATION[coachId] ?? ILLU_PRESENTATION.us_male, cta: "Et ensuite ?" },
    { id: "parcours", title: "Découvre ton parcours d'apprentissage", subtitle: "Celui qui va répondre à TES objectifs", illustration: (goal && ILLU_GOAL[goal]) ?? ILLU.voyage, cta: "Et ensuite ?" },
    { id: "progression", title: "Chaque conversation compte", subtitle: "Un peu tous les jours", illustration: ILLU.progression, cta: "Faire ma présentation" },
  ], [coachId, goal]);
  const last = slides.length - 1;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const indexRef = useRef(0);
  const playingRef = useRef(true);
  const camera = useRef(new Animated.Value(sceneW / 2 - CHECKPOINTS[0].x * scale)).current; // translation horizontale du monde (px), centrée sur l'étape 1 dès le départ
  const revealed = useRef(new Animated.Value(0)).current; // longueur de route révélée en orange (repère de référence)
  const marker = useRef(new Animated.ValueXY(ROUTE.pointAt(0))).current; // centre du marqueur, calculé sur la courbe
  const segment = useRef(new Animated.Value(0)).current; // remplissage du segment courant (0 → 1 sur 6 s)
  const enter = useRef(new Animated.Value(0)).current; // entrée du podium actif
  const textIn = useRef(new Animated.Value(0)).current; // entrée du sous-titre

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (v) { setReduceMotion(true); setPlaying(false); playingRef.current = false; enter.setValue(1); textIn.setValue(1); } }).catch(() => {});
  }, []);

  // Déplacement de caméra + entrée des éléments à chaque changement d'étape
  useEffect(() => {
    indexRef.current = index;
    const ms = reduceMotion ? 0 : CAMERA_MS;
    // Une même durée/courbe pour la caméra et la révélation de la route ; chacune repart de sa valeur courante (pas de saut en cas de clic rapide)
    const cameraX = sceneW / 2 - CHECKPOINTS[index].x * scale;
    Animated.parallel([
      Animated.timing(camera, { toValue: cameraX, duration: ms, easing: CAMERA_EASING, useNativeDriver: false }),
      Animated.timing(revealed, { toValue: ROUTE.targets[index], duration: ms, easing: CAMERA_EASING, useNativeDriver: false }),
    ]).start();
    if (!reduceMotion) {
      enter.setValue(0); textIn.setValue(0);
      Animated.timing(enter, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Animated.timing(textIn, { toValue: 1, duration: TEXT_ENTRANCE_MS, delay: TEXT_DELAY_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    segment.setValue(0);
    if (playingRef.current) runSegment();
    return () => { segment.stopAnimation(); };
  }, [index, sceneW]);

  // Remplissage du segment courant ; à la fin → étape suivante (ou arrêt de la lecture sur la dernière)
  const runSegment = () => {
    segment.stopAnimation((v) => {
      const remaining = Math.max(0, 1 - (typeof v === "number" ? v : 0)) * SLIDE_MS;
      Animated.timing(segment, { toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
        if (!finished || !playingRef.current) return;
        if (indexRef.current < last) setIndex(indexRef.current + 1);
        else { playingRef.current = false; setPlaying(false); }
      });
    });
  };
  const setPlay = (on: boolean) => {
    playingRef.current = on; setPlaying(on);
    if (on) { if (indexRef.current === last) segment.setValue(0); runSegment(); }
    else segment.stopAnimation();
  };
  // Pause quand l'app passe en arrière-plan
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active" && playingRef.current) setPlay(false); });
    // Le marqueur suit la courbe : sa position vient de pointAtLength(longueur révélée)
    const id = revealed.addListener(({ value }) => marker.setValue(ROUTE.pointAt(value)));
    return () => { sub.remove(); revealed.removeListener(id); segment.stopAnimation(); camera.stopAnimation(); revealed.stopAnimation(); };
  }, []);

  const next = () => { if (indexRef.current < last) setIndex(indexRef.current + 1); };
  const slide = slides[index];
  const isLast = index === last;

  // Tracé orange = copie du tracé, révélé par dashoffset ; masqué à zéro (sinon un point résiduel dû aux extrémités rondes)
  const dashOffset = revealed.interpolate({ inputRange: [0, ROUTE.total], outputRange: [ROUTE.total, 0] });
  const orangeOpacity = revealed.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });
  const worldW = WORLD_W * scale;

  return (
    <View style={[st.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <StatusBar style="dark" />
      {/* En-tête : logo, lecture/pause */}
      <View style={st.header}>
        <Text style={st.logo} accessibilityRole="header">d<Text style={{ color: O.primary }}>é</Text>clic.</Text>
        {!reduceMotion && (
          <Pressable onPress={() => setPlay(!playing)} style={st.playBtn} accessibilityRole="button" accessibilityLabel={playing ? "Mettre en pause" : "Reprendre"}>
            <OnbIcon name={playing ? "pause" : "play"} size={18} />
          </Pressable>
        )}
      </View>
      {/* Segments de progression */}
      <View style={st.segments} accessibilityLabel={`Étape ${index + 1} sur ${slides.length}`}>
        {slides.map((s, i) => (
          <View key={s.id} style={st.segment}>
            {i < index ? <View style={[st.segmentFill, { width: "100%" }]} /> : i === index ? <Animated.View style={[st.segmentFill, { width: segment.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} /> : null}
          </View>
        ))}
      </View>

      <Text style={st.title} accessibilityRole="header" accessibilityLiveRegion="polite">{slide.title}</Text>

      {/* Scène : monde translaté horizontalement, un podium par étape */}
      <View style={[st.scene, { height: sceneH, width: sceneW }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={{ width: worldW, height: sceneH, transform: [{ translateX: camera }] }}>
          {/* Route : fond crème, pointillés, progression orange — un seul tracé, trois couches */}
          <Svg width={worldW} height={sceneH} viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} style={StyleSheet.absoluteFill}>
            <Path d={ROUTE_PATH} stroke="#FFFAF2" strokeWidth={27} strokeLinecap="round" fill="none" />
            <Path d={ROUTE_PATH} stroke="#EED6BE" strokeWidth={2} strokeDasharray="4 12" fill="none" />
            <AnimatedPath d={ROUTE_PATH} stroke={O.primary} strokeWidth={5} strokeLinecap="round" fill="none" strokeDasharray={`${ROUTE.total} ${ROUTE.total}`} strokeDashoffset={dashOffset} opacity={orangeOpacity} />
          </Svg>
          {slides.map((s, i) => {
            const active = i === index;
            const cp = CHECKPOINTS[i];
            return (
              <Animated.View
                key={s.id}
                style={{
                  // podium centré sur son checkpoint : l'ellipse du podium est vers 80 % de la hauteur du PNG
                  position: "absolute", left: cp.x * scale - illuW / 2, top: cp.y * scale - illuH * 0.8, width: illuW, height: illuH,
                  opacity: active ? enter.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) : 0.35,
                  transform: active ? [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] : [{ scale: 0.86 }],
                }}
              >
                <Image source={s.illustration} style={{ width: illuW, height: illuH }} resizeMode="contain" />
              </Animated.View>
            );
          })}
          {/* Marqueur orange, centré sur le point courant de la courbe */}
          <Animated.View pointerEvents="none" style={[st.markerHalo, { transform: [{ translateX: Animated.subtract(Animated.multiply(marker.x, scale), (MARKER + 12) / 2) }, { translateY: Animated.subtract(Animated.multiply(marker.y, scale), (MARKER + 12) / 2) }] }]}>
            <View style={st.marker} />
          </Animated.View>
        </Animated.View>
      </View>

      <Animated.Text style={[st.subtitle, { opacity: textIn, transform: [{ translateY: textIn.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>{slide.subtitle}</Animated.Text>

      <View style={{ flex: 1 }} />
      {isLast ? (
        <PrimaryCta label={slide.cta} onPress={onStart} />
      ) : (
        <Pressable onPress={next} style={st.ctaNavy} accessibilityRole="button" accessibilityLabel={`${slide.cta} Étape suivante`}>
          <Text style={st.ctaNavyText} maxFontSizeMultiplier={1.3}>{slide.cta}  →</Text>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: O.bg, paddingHorizontal: O.gutter },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  logo: { fontSize: 24, fontWeight: "800", color: O.ink, letterSpacing: -0.8 },
  playBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: O.border },
  segments: { flexDirection: "row", gap: 6, marginTop: 6, marginBottom: 18 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#F3E4D2", overflow: "hidden" },
  segmentFill: { height: "100%", backgroundColor: O.ink, borderRadius: 2 },
  title: { color: O.ink, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5, textAlign: "center", minHeight: 68 },
  scene: { alignSelf: "center", overflow: "hidden", marginTop: 6 },
  markerHalo: { position: "absolute", left: 0, top: 0, width: MARKER + 12, height: MARKER + 12, borderRadius: (MARKER + 12) / 2, backgroundColor: "rgba(255,155,80,0.22)", alignItems: "center", justifyContent: "center" },
  marker: { width: MARKER, height: MARKER, borderRadius: MARKER / 2, backgroundColor: O.primary, borderWidth: 4, borderColor: "#FFE4CC" },
  subtitle: { color: O.ink, fontSize: 21, lineHeight: 28, fontWeight: "700", textAlign: "center", marginTop: 10, minHeight: 56 },
  ctaNavy: { backgroundColor: O.ink, borderRadius: 19, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  ctaNavyText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});
