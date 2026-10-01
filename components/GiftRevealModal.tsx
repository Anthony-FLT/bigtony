import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Animated, Easing, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";
import { loadGiftPricing, GiftPricing } from "../lib/giftOffer";

// Popup « cadeau » en bas d'écran : le paquet saute, le -50 % jaillit avec des confettis
// devant des rayons lumineux, puis prix de l'offre et compte à rebours.

const CONFETTI_COLORS = [T.abricot, T.abricotDeep, T.miel, "#7ED3A4", "#8FB3FF", "#F28DB2"];
const CONFETTI_COUNT = 26;
const RAY_COUNT = 14;
const GREEN = "#2E9E6B";

// Trajectoires tirées une fois pour toutes (éventail vers le haut, puis retombée)
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
  const dist = 100 + Math.random() * 90;
  return {
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dx: Math.cos(angle) * dist,
    peakY: Math.sin(angle) * dist,
    endY: Math.sin(angle) * dist + 150 + Math.random() * 60,
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
  giftOfferId,
  expiresAt,
  onAccept,
  onDecline,
}: {
  visible: boolean;
  discount: number; // remise affichée si les prix du store ne sont pas disponibles (ex. 50)
  giftOfferId: string; // offre Play, pour afficher les vrais prix
  expiresAt: number; // timestamp (ms) de fin de l'offre
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [pricing, setPricing] = useState<GiftPricing | null>(null);
  const remaining = expiresAt - now;
  const shownDiscount = pricing?.discount || discount;

  const enter = useRef(new Animated.Value(0)).current; // montée de la feuille
  const boxIn = useRef(new Animated.Value(0)).current; // apparition du paquet
  const wobble = useRef(new Animated.Value(0)).current;
  const lidHop = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current; // sortie du -50 %
  const rays = useRef(new Animated.Value(0)).current; // rotation continue des rayons
  const shine = useRef(new Animated.Value(0)).current; // reflet sur le bouton
  const confetti = useRef(CONFETTI.map(() => new Animated.Value(0))).current;

  // Prix réels de l'offre
  useEffect(() => {
    if (!visible) return;
    loadGiftPricing(giftOfferId).then(setPricing);
  }, [visible, giftOfferId]);

  // Séquence d'ouverture, rejouée à chaque affichage
  useEffect(() => {
    if (!visible) return;
    [enter, boxIn, wobble, lidHop, pop, ...confetti].forEach((v) => v.setValue(0));
    const opening = Animated.sequence([
      Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(boxIn, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.timing(wobble, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(lidHop, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(lidHop, { toValue: 0, duration: 260, easing: Easing.bounce, useNativeDriver: true }),
        ]),
        Animated.spring(pop, { toValue: 1, friction: 5, tension: 55, useNativeDriver: true }),
        ...confetti.map((v) =>
          Animated.timing(v, { toValue: 1, duration: 1500 + Math.random() * 500, easing: Easing.out(Easing.quad), useNativeDriver: true })
        ),
      ]),
    ]);
    const spin = Animated.loop(Animated.timing(rays, { toValue: 1, duration: 24000, easing: Easing.linear, useNativeDriver: true }));
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.delay(1400),
        Animated.timing(shine, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(shine, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    opening.start();
    spin.start();
    shimmer.start();
    return () => {
      opening.stop();
      spin.stop();
      shimmer.stop();
    };
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={askClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.sheet,
            { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] },
          ]}
        >
          {/* Scène au-dessus de la feuille : rayons, confettis, -50 %, paquet */}
          <View style={styles.stage} pointerEvents="none">
            <Animated.View
              style={[
                styles.rays,
                {
                  opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
                  transform: [{ rotate: rays.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
                },
              ]}
            >
              {Array.from({ length: RAY_COUNT }, (_, i) => (
                <View key={i} style={[styles.ray, { transform: [{ rotate: `${(360 / RAY_COUNT) * i}deg` }] }]} />
              ))}
            </Animated.View>

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

            <Animated.View
              style={[
                styles.discountPill,
                {
                  opacity: pop.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
                  transform: [
                    { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [70, 0] }) },
                    { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                    { rotate: "-3deg" },
                  ],
                },
              ]}
            >
              <Text style={styles.discountText}>
                -{shownDiscount}
                <Text style={styles.discountPct}>%</Text>
              </Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.box,
                { opacity: boxIn, transform: [{ scale: boxIn.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }, { rotate: wobbleRot }] },
              ]}
            >
              <Animated.View style={[styles.lid, { transform: [{ translateY: lidHop.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) }] }]}>
                <View style={styles.ribbon} />
              </Animated.View>
              <View style={styles.boxBody}>
                <View style={styles.ribbon} />
              </View>
            </Animated.View>
          </View>

          <Pressable onPress={askClose} hitSlop={12} style={styles.close}>
            <Feather name="x" size={18} color={T.inkSoft} />
          </Pressable>

          <View style={styles.congrats}>
            <Feather name="check" size={13} color={GREEN} />
            <Text style={styles.congratsText}>Bravo pour ta 1re conversation !</Text>
          </View>

          <Text style={styles.title}>Un cadeau pour fêter</Text>
          <Text style={[styles.title, { color: T.abricotDeep }]}>ta 1re conversation</Text>

          {pricing ? (
            <Text style={styles.priceText}>
              L'abonnement annuel à <Text style={styles.priceStrong}>{pricing.giftPrice}</Text> la 1re année au lieu de{" "}
              <Text style={styles.priceStrike}>{pricing.fullPrice}</Text>, soit {pricing.perMonth}/mois.
            </Text>
          ) : (
            <Text style={styles.priceText}>-{shownDiscount} % sur ta première année d'abonnement annuel.</Text>
          )}

          <View style={styles.timer}>
            <Feather name="clock" size={26} color={T.abricot} />
            <View>
              <Text style={styles.timerLabel}>L'OFFRE EXPIRE DANS</Text>
              <Text style={styles.timerValue}>{formatRemaining(remaining)}</Text>
            </View>
          </View>

          <Pressable onPress={onAccept} style={styles.cta}>
            <Animated.View
              pointerEvents="none"
              style={[styles.shine, { transform: [{ translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-120, 420] }) }, { skewX: "-20deg" }] }]}
            />
            <Text style={styles.ctaText}>Profiter de l'offre</Text>
          </Pressable>

          <Pressable onPress={askClose} hitSlop={8} style={{ paddingVertical: 12 }}>
            <Text style={styles.decline}>Non merci</Text>
          </Pressable>

          <Text style={styles.footer}>Paiement via Google Play · Annulable à tout moment</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(22, 30, 58, 0.72)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#FFF8F1",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 88,
    paddingBottom: 28,
    alignItems: "center",
    overflow: "visible", // la scène (paquet, rayons) dépasse au-dessus de la feuille
  },

  stage: { position: "absolute", top: -178, left: 0, right: 0, height: 290, alignItems: "center" },
  rays: { position: "absolute", top: 10, width: 300, height: 300, alignItems: "center", justifyContent: "center" },
  ray: { position: "absolute", width: 10, height: 300, borderRadius: 5, backgroundColor: "rgba(255, 196, 120, 0.28)" },
  confetti: { position: "absolute", top: 170, borderRadius: 2 },

  discountPill: {
    position: "absolute",
    top: 12,
    backgroundColor: "#fff",
    borderRadius: 22,
    borderWidth: 4,
    borderColor: T.miel,
    paddingHorizontal: 22,
    paddingVertical: 4,
    zIndex: 3,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  discountText: { fontSize: 52, fontWeight: "900", color: T.abricotDeep, letterSpacing: -1.5 },
  discountPct: { fontSize: 36 },

  box: { position: "absolute", top: 130, alignItems: "center", zIndex: 2 },
  lid: { width: 138, height: 34, backgroundColor: "#FFB27A", borderRadius: 9, alignItems: "center", overflow: "hidden", zIndex: 2 },
  boxBody: { width: 122, height: 86, backgroundColor: T.abricot, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, alignItems: "center", overflow: "hidden" },
  ribbon: { width: 22, height: "100%", backgroundColor: T.night },

  close: { position: "absolute", top: 16, right: 16, zIndex: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: "#EFE6DC", alignItems: "center", justifyContent: "center" },

  congrats: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#DDF3E7", borderRadius: 14, paddingVertical: 5, paddingHorizontal: 12, marginBottom: 14 },
  congratsText: { color: GREEN, fontSize: 13, fontWeight: "800" },

  title: { fontSize: 25, fontWeight: "800", color: T.night, textAlign: "center", letterSpacing: -0.4, lineHeight: 30 },
  priceText: { fontSize: 14.5, fontWeight: "600", color: T.inkSoft, textAlign: "center", lineHeight: 21, marginTop: 12 },
  priceStrong: { color: T.night, fontWeight: "900" },
  priceStrike: { textDecorationLine: "line-through" },

  timer: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.night, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18, marginTop: 18 },
  timerLabel: { color: T.abricot, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8 },
  timerValue: { color: "#fff", fontSize: 30, fontWeight: "900", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },

  cta: { alignSelf: "stretch", backgroundColor: T.abricot, borderRadius: 18, paddingVertical: 18, alignItems: "center", marginTop: 16, overflow: "hidden" },
  shine: { position: "absolute", top: -10, bottom: -10, left: 0, width: 70, backgroundColor: "rgba(255, 255, 255, 0.35)" },
  ctaText: { color: T.night, fontSize: 17, fontWeight: "800" },
  decline: { color: T.inkSoft, fontSize: 14.5, fontWeight: "800" },
  footer: { color: T.inkSoft, fontSize: 12, fontWeight: "600", opacity: 0.8 },
});
