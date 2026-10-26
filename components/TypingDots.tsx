// Trois points qui pulsent : le coach prépare sa réponse (bulle coach vide animée)
import React, { useEffect, useRef } from "react";
import { Animated, View, StyleSheet } from "react-native";
import { L } from "./lessonUi";

export default function TypingDots({ color = L.textSecondary }: { color?: string }) {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];
  useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 160),
        Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 320, useNativeDriver: true }),
        Animated.delay((2 - i) * 160),
      ]))
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={styles.row} accessibilityLabel="Le coach prépare sa réponse">
      {dots.map((v, i) => <Animated.View key={i} style={[styles.dot, { backgroundColor: color, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0.3, 1], outputRange: [0.85, 1.15] }) }] }]} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, height: 20 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
});
