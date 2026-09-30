import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Animated, Easing, Linking } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { saveAppRating } from "../lib/profile";
import { logRatingSubmitted, logStoreReviewOpened } from "../lib/analytics";

// Note in-app après le premier daily : 1 à 5 étoiles (stockée dans le profil),
// puis proposition libre de laisser un avis sur le Play Store — quelle que soit la note.

const PACKAGE_ID = "fr.elanapp.english";
const STAR_LABELS = ["", "Décevant", "Bof", "Correct", "Bien", "Excellent !"];

export default function RatingModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [stars, setStars] = useState(0);
  const [step, setStep] = useState<"rate" | "thanks">("rate");
  const enter = useRef(new Animated.Value(0)).current;
  const bumps = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(1))).current;

  useEffect(() => {
    if (!visible) return;
    setStars(0);
    setStep("rate");
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible]);

  const pick = (n: number) => {
    setStars(n);
    // Les étoiles allumées rebondissent l'une après l'autre
    Animated.stagger(
      60,
      bumps.slice(0, n).map((v) =>
        Animated.sequence([
          Animated.timing(v, { toValue: 1.3, duration: 110, useNativeDriver: true }),
          Animated.spring(v, { toValue: 1, friction: 4, useNativeDriver: true }),
        ])
      )
    ).start();
  };

  const submit = () => {
    if (!stars) return;
    saveAppRating(stars);
    logRatingSubmitted(stars);
    setStep("thanks");
  };

  const openStore = async () => {
    logStoreReviewOpened();
    onClose();
    try {
      await Linking.openURL(`market://details?id=${PACKAGE_ID}`);
    } catch {
      Linking.openURL(`https://play.google.com/store/apps/details?id=${PACKAGE_ID}`).catch(() => {});
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View
          style={[styles.sheet, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] }]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Feather name="x" size={18} color={T.inkSoft} />
          </Pressable>

          {step === "rate" ? (
            <>
              <View style={styles.icon}>
                <MaterialCommunityIcons name="chat-processing-outline" size={30} color={T.abricotDeep} />
              </View>
              <Text style={styles.title}>Comment s'est passée ta première discussion du jour ?</Text>
              <Text style={styles.text}>Ta note nous aide à améliorer ton coach.</Text>

              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => pick(n)} hitSlop={6}>
                    <Animated.View style={{ transform: [{ scale: bumps[n - 1] }] }}>
                      <MaterialCommunityIcons name={n <= stars ? "star" : "star-outline"} size={44} color={n <= stars ? T.abricot : "#D9CFC4"} />
                    </Animated.View>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.starLabel}>{STAR_LABELS[stars] || " "}</Text>

              <Pressable onPress={submit} disabled={!stars} style={[styles.cta, !stars && styles.ctaOff]}>
                <Text style={styles.ctaText}>Valider</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.icon, { backgroundColor: "#DDF3E7" }]}>
                <Feather name="heart" size={28} color="#2E9E6B" />
              </View>
              <Text style={styles.title}>Merci pour ta note !</Text>
              <Text style={styles.text}>
                Si tu as 30 secondes, un avis sur le Play Store nous aide énormément à faire connaître Déclic.
              </Text>
              <Pressable onPress={openStore} style={styles.cta}>
                <Text style={styles.ctaText}>Laisser un avis</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8} style={{ paddingTop: 14 }}>
                <Text style={styles.later}>Plus tard</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(22, 30, 58, 0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF8F1", borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 34, alignItems: "center" },
  close: { position: "absolute", top: 16, right: 16, zIndex: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: "#EFE6DC", alignItems: "center", justifyContent: "center" },
  icon: { width: 60, height: 60, borderRadius: 30, backgroundColor: T.chipAbricot, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.3, lineHeight: 28, paddingHorizontal: 12 },
  text: { fontSize: 15, fontWeight: "600", color: T.inkSoft, textAlign: "center", lineHeight: 21, marginTop: 8 },
  stars: { flexDirection: "row", gap: 8, marginTop: 22 },
  starLabel: { fontSize: 14.5, fontWeight: "800", color: T.abricotDeep, marginTop: 8, minHeight: 20 },
  cta: { alignSelf: "stretch", backgroundColor: T.abricot, borderRadius: 18, paddingVertical: 17, alignItems: "center", marginTop: 20 },
  ctaOff: { opacity: 0.45 },
  ctaText: { color: T.night, fontSize: 16.5, fontWeight: "800" },
  later: { color: T.inkSoft, fontSize: 14.5, fontWeight: "800" },
});
