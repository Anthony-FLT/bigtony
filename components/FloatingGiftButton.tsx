import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { formatRemaining } from "./GiftRevealModal";

// Bouton cadeau flottant (accueil) : rouvre l'offre cadeau tant qu'elle n'a pas expiré.
export default function FloatingGiftButton({
  expiresAt,
  discount,
  onPress,
  onExpire,
}: {
  expiresAt: number;
  discount: number;
  onPress: () => void;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const remaining = expiresAt - now;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (remaining <= 0) onExpire();
  }, [remaining <= 0]);

  // Flottement doux + petit frétillement toutes les quelques secondes
  const float = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const floatAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const wiggleAnim = Animated.loop(
      Animated.sequence([
        Animated.delay(2500),
        Animated.timing(wiggle, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    floatAnim.start();
    wiggleAnim.start();
    return () => {
      floatAnim.stop();
      wiggleAnim.stop();
    };
  }, [float, wiggle]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const rotate = wiggle.interpolate({
    inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1],
    outputRange: ["0deg", "-12deg", "12deg", "-8deg", "8deg", "0deg"],
  });

  if (remaining <= 0) return null;

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY }] }]}>
      <Pressable onPress={onPress} hitSlop={8}>
        <Animated.View style={[styles.btn, { transform: [{ rotate }] }]}>
          <MaterialCommunityIcons name="gift" size={30} color={T.night} />
        </Animated.View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>-{discount}%</Text>
        </View>
      </Pressable>
      <View style={styles.timer}>
        <Text style={styles.timerText}>{formatRemaining(remaining)}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 18, bottom: 18, alignItems: "center" },
  btn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: T.abricot,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  badge: { position: "absolute", top: -6, right: -10, backgroundColor: T.night, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  timer: { marginTop: 6, backgroundColor: T.night, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 },
  timerText: { color: "#fff", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
