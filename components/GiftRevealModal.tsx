import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Animated, Easing, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";

// Popup « cadeau » : le paquet tremble, le couvercle s'envole, le -50 % sort avec des confettis,
// puis compte à rebours jusqu'à expiration de l'offre.

const CONFETTI_COLORS = [T.abricot, T.abricotDeep, T.miel, "#7ED3A4", "#8FB3FF", "#F28DB2"];
const CONFETTI_COUNT = 26;

// Trajectoires tirées une fois pour toutes (éventail vers le haut, puis retombée)
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
  const dist = 90 + Math.random() * 90;
  return {
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dx: Math.cos(angle) * dist,
    peakY: Math.sin(angle) * dist,
    endY: Math.sin(angle) * dist + 140 + Math.random() * 60,
    rot: `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360)}deg`,
    w: 6 + Math.random() * 5,
    h: 10 + Math.random() * 6,
  };
});

export function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function GiftRevealModal({
  visible,
  discount,
  expiresAt,
  onAccept,
  onDecline,
}: {
  visible: boolean;
  discount: number; // ex. 50
  expiresAt: number; // timestamp (ms) de fin de l'offre
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const remaining = expiresAt - now;

  const wobble = useRef(new Animated.Value(0)).current;
  const lid = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const content = useRef(new Animated.Value(0)).current;
  const confetti = useRef(CONFETTI.map(() => new Animated.Value(0))).current;

  // Séquence d'ouverture, rejouée à chaque affichage
  useEffect(() => {
    if (!visible) return;
    [wobble, lid, pop, content, ...confetti].forEach((v) => v.setValue(0));
    const anim = Animated.sequence([
      Animated.delay(250),
      Animated.timing(wobble, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(lid, { toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
        ...confetti.map((v) =>
          Animated.timing(v, { toValue: 1, duration: 1500 + Math.random() * 500, easing: Easing.out(Easing.quad), useNativeDriver: true })
        ),
        Animated.sequence([
          Animated.delay(450),
          Animated.timing(content, { toValue: 1, duration: 450, useNativeDriver: true }),
        ]),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, [visible]);

  // Compte à rebours
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible]);

  // Offre expirée pendant que la popup est ouverte
  useEffect(() => {
    if (visible && remaining <= 0) onDecline();
  }, [visible, remaining <= 0]);

  const askClose = () => {
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    Alert.alert(
      "Tu es sûr de ne pas vouloir en profiter ?",
      `Cette offre expirera dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
      [
        { text: "En profiter", onPress: onAccept },
        { text: "Non merci", style: "destructive", onPress: onDecline },
      ]
    );
  };

  const wobbleRot = wobble.interpolate({
    inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1],
    outputRange: ["0deg", "-9deg", "9deg", "-7deg", "7deg", "-4deg", "4deg", "0deg"],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={askClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Pressable onPress={askClose} hitSlop={12} style={styles.close}>
            <Feather name="x" size={20} color={T.night} />
          </Pressable>

          {/* Scène : confettis, -50 %, paquet */}
          <View style={styles.stage}>
            {CONFETTI.map((c, i) => {
              const v = confetti[i];
              return (
                <Animated.View
                  key={i}
                  style={[
                    styles.confetti,
                    {
                      width: c.w,
                      height: c.h,
                      backgroundColor: c.color,
                      opacity: v.interpolate({ inputRange: [0, 0.05, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                      transform: [
                        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, c.dx] }) },
                        { translateY: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, c.peakY, c.endY] }) },
                        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", c.rot] }) },
                      ],
                    },
                  ]}
                />
              );
            })}

            <Animated.Text
              style={[
                styles.discount,
                {
                  opacity: pop.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
                  transform: [
                    { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [40, -78] }) },
                    { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                  ],
                },
              ]}
            >
              -{discount} %
            </Animated.Text>

            <Animated.View style={[styles.box, { transform: [{ rotate: wobbleRot }] }]}>
              <View style={styles.boxBody}>
                <View style={styles.ribbonV} />
              </View>
              <Animated.View
                style={[
                  styles.lid,
                  {
                    opacity: lid.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
                    transform: [
                      { translateY: lid.interpolate({ inputRange: [0, 1], outputRange: [0, -110] }) },
                      { translateX: lid.interpolate({ inputRange: [0, 1], outputRange: [0, 50] }) },
                      { rotate: lid.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "35deg"] }) },
                    ],
                  },
                ]}
              >
                <View style={styles.ribbonLid} />
                <View style={[styles.bow, styles.bowLeft]} />
                <View style={[styles.bow, styles.bowRight]} />
              </Animated.View>
            </Animated.View>
          </View>

          <Animated.View style={{ opacity: content, alignItems: "center" }}>
            <Text style={styles.title}>Ton cadeau est là !</Text>
            <Text style={styles.text}>-{discount} % sur ta première année d'abonnement, pour avoir fait ta conversation de présentation.</Text>

            <View style={styles.timer}>
              <Feather name="clock" size={15} color={T.abricotDeep} />
              <Text style={styles.timerText}>Profite de l'offre : {formatRemaining(remaining)}</Text>
            </View>

            <Pressable onPress={onAccept} style={styles.cta}>
              <Text style={styles.ctaText}>En profiter</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(22, 30, 58, 0.72)", alignItems: "center", justifyContent: "center", padding: 22 },
  card: { width: "100%", maxWidth: 380, backgroundColor: T.cream, borderRadius: 28, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 24, alignItems: "center" },
  close: { position: "absolute", top: 14, right: 14, zIndex: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: "#EFE6DC", alignItems: "center", justifyContent: "center" },

  stage: { width: "100%", height: 230, alignItems: "center", justifyContent: "flex-end", paddingBottom: 14 },
  confetti: { position: "absolute", bottom: 90, borderRadius: 2 },
  discount: { position: "absolute", bottom: 80, fontSize: 64, fontWeight: "900", color: T.abricotDeep, letterSpacing: -2 },

  box: { alignItems: "center", justifyContent: "flex-end" },
  boxBody: { width: 112, height: 82, backgroundColor: T.night, borderRadius: 12, alignItems: "center", overflow: "hidden" },
  ribbonV: { width: 20, height: "100%", backgroundColor: T.abricot },
  lid: { position: "absolute", top: -26, width: 126, height: 30, backgroundColor: T.night, borderRadius: 9, alignItems: "center" },
  ribbonLid: { width: 20, height: "100%", backgroundColor: T.abricot },
  bow: { position: "absolute", top: -16, width: 30, height: 20, borderRadius: 12, borderWidth: 6, borderColor: T.abricot },
  bowLeft: { left: 30, transform: [{ rotate: "-25deg" }] },
  bowRight: { right: 30, transform: [{ rotate: "25deg" }] },

  title: { fontSize: 25, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.4 },
  text: { fontSize: 15, fontWeight: "600", color: T.inkSoft, textAlign: "center", lineHeight: 21, marginTop: 8 },
  timer: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: T.chipAbricot, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 14, marginTop: 16 },
  timerText: { color: T.abricotDeep, fontSize: 14.5, fontWeight: "800", fontVariant: ["tabular-nums"] },
  cta: { alignSelf: "stretch", backgroundColor: T.abricot, borderRadius: 16, paddingVertical: 17, alignItems: "center", marginTop: 18 },
  ctaText: { color: T.night, fontSize: 16.5, fontWeight: "800" },
});
