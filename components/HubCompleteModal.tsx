import { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Animated, Easing } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { T } from "../lib/theme";

// Félicitations après la 1re journée où les 3 défis sont terminés :
// trophée qui jaillit, puis les défis cochés un par un, et rendez-vous demain.

const GREEN = "#2E9E6B";
const CHALLENGES = [
  { icon: "book-open-variant" as const, label: "Lecture" },
  { icon: "translate" as const, label: "Traduction" },
  { icon: "headphones" as const, label: "Écoute" },
];

export default function HubCompleteModal({ visible, count, onClose }: { visible: boolean; count: number; onClose: () => void }) {
  const enter = useRef(new Animated.Value(0)).current;
  const trophy = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const checks = useRef(CHALLENGES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) return;
    [enter, trophy, ...checks].forEach((v) => v.setValue(0));
    const intro = Animated.sequence([
      Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(trophy, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
      Animated.stagger(
        350,
        checks.map((v) => Animated.spring(v, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }))
      ),
    ]);
    const halo = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    intro.start();
    halo.start();
    return () => {
      intro.stop();
      halo.stop();
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View
          style={[styles.sheet, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] }]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Feather name="x" size={18} color={T.inkSoft} />
          </Pressable>

          <View style={styles.trophyWrap}>
            <Animated.View
              style={[
                styles.halo,
                {
                  opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }),
                  transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.trophy,
                {
                  opacity: trophy,
                  transform: [
                    { scale: trophy.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                    { rotate: trophy.interpolate({ inputRange: [0, 1], outputRange: ["-25deg", "0deg"] }) },
                  ],
                },
              ]}
            >
              <MaterialCommunityIcons name="trophy" size={46} color={T.night} />
            </Animated.View>
          </View>

          <Text style={styles.title}>Bravo, tes {count} défis du jour sont faits !</Text>
          <Text style={styles.text}>Reviens demain pour découvrir {count} nouveaux défis. C'est comme ça que l'anglais s'installe.</Text>

          <View style={styles.checks}>
            {CHALLENGES.map((c, i) => (
              <Animated.View
                key={c.label}
                style={[
                  styles.check,
                  { opacity: checks[i], transform: [{ scale: checks[i].interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] },
                ]}
              >
                <MaterialCommunityIcons name={c.icon} size={18} color={T.night} />
                <Text style={styles.checkLabel}>{c.label}</Text>
                <View style={styles.checkDot}>
                  <Feather name="check" size={11} color="#fff" />
                </View>
              </Animated.View>
            ))}
          </View>

          <Pressable onPress={onClose} style={styles.cta}>
            <Text style={styles.ctaText}>À demain !</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(22, 30, 58, 0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF8F1", borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 34, alignItems: "center" },
  close: { position: "absolute", top: 16, right: 16, zIndex: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: "#EFE6DC", alignItems: "center", justifyContent: "center" },

  trophyWrap: { width: 120, height: 120, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  halo: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: T.chipAbricot },
  trophy: { width: 84, height: 84, borderRadius: 42, backgroundColor: T.abricot, alignItems: "center", justifyContent: "center" },

  title: { fontSize: 23, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.3, lineHeight: 29, paddingHorizontal: 10 },
  text: { fontSize: 15, fontWeight: "600", color: T.inkSoft, textAlign: "center", lineHeight: 21, marginTop: 8 },

  checks: { flexDirection: "row", gap: 10, marginTop: 20 },
  check: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: T.card, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 10 },
  checkLabel: { fontSize: 13, fontWeight: "800", color: T.night },
  checkDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },

  cta: { alignSelf: "stretch", backgroundColor: T.abricot, borderRadius: 18, paddingVertical: 17, alignItems: "center", marginTop: 22 },
  ctaText: { color: T.night, fontSize: 16.5, fontWeight: "800" },
});
