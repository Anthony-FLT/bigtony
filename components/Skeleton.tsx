// Squelette de chargement réutilisable, avec animation "shimmer" (balayage clair).
// À composer dans chaque écran pour imiter la structure du contenu à venir.
import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";

// Bloc gris animé de base.
export function SkeletonBox({ width = "100%", height = 16, radius = 8, style }: { width?: any; height?: number; radius?: number; style?: ViewStyle }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const translateX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-120, 220] });

  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: "#EFE7DB", overflow: "hidden" }, style]}>
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, transform: [{ translateX }] }}>
        <View style={{ width: 90, height: "100%", backgroundColor: "rgba(255,255,255,0.55)" }} />
      </Animated.View>
    </View>
  );
}

// Une ligne de texte simulée.
export function SkeletonLine({ width = "100%", style }: { width?: any; style?: ViewStyle }) {
  return <SkeletonBox width={width} height={14} radius={7} style={{ marginBottom: 10, ...style }} />;
}

// En-tête de chargement : petit indicateur + message adapté.
export function SkeletonHeader({ message }: { message: string }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={styles.headerRow}>
      <Animated.View style={{ opacity: pulse }}>
        <Feather name="loader" size={16} color={T.abricotDeep} />
      </Animated.View>
      <Text style={styles.headerMsg}>{message}</Text>
    </View>
  );
}

// Bloc de carte simulée (fond clair arrondi contenant des lignes).
export function SkeletonCard({ children, style }: { children?: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18, paddingHorizontal: 6 },
  headerMsg: { color: T.inkSoft, fontSize: 14, fontWeight: "700" },
  card: { backgroundColor: T.card, borderRadius: 18, padding: 18, marginBottom: 16 },
});
