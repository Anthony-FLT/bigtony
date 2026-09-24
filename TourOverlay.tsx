// Overlay du tour guidé : assombrit tout sauf l'élément ciblé (4 bandes autour de lui,
// pas de vrai "trou" découpé — plus robuste qu'un masque SVG, coins carrés en contrepartie).
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "./lib/theme";
import { useTourContext } from "./TourContext";

export type TourStep = { targetId: string; title: string; body: string; placement?: "top" | "bottom" };

export default function TourOverlay({
  steps,
  active,
  onFinish,
}: {
  steps: TourStep[];
  active: boolean;
  onFinish: () => void;
}) {
  const ctx = useTourContext();
  const [stepIndex, setStepIndex] = useState(0);
  const [, forceTick] = useState(0);
  const { width: screenW, height: screenH } = Dimensions.get("window");

  // Un élément peut se mesurer (et s'enregistrer) après le montage de l'overlay — on se re-rend alors.
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(() => forceTick((t) => t + 1));
  }, [ctx]);

  useEffect(() => { if (active) setStepIndex(0); }, [active]);

  if (!active || !ctx) return null;
  const step = steps[stepIndex];
  if (!step) return null;
  const rect = ctx.getRect(step.targetId);
  if (!rect) return null; // pas encore mesuré : on attend le prochain re-rendu

  const PAD = 6;
  const hx = Math.max(0, rect.x - PAD);
  const hy = Math.max(0, rect.y - PAD);
  const hw = Math.min(screenW - hx, rect.width + PAD * 2);
  const hh = rect.height + PAD * 2;

  const placement = step.placement ?? (hy > screenH * 0.55 ? "top" : "bottom");
  const isLast = stepIndex === steps.length - 1;

  const next = () => {
    if (isLast) { onFinish(); return; }
    setStepIndex((i) => i + 1);
  };

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <View style={[styles.band, { top: 0, left: 0, right: 0, height: hy }]} />
      <View style={[styles.band, { top: hy + hh, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.band, { top: hy, left: 0, width: hx, height: hh }]} />
      <View style={[styles.band, { top: hy, left: hx + hw, right: 0, height: hh }]} />
      <View pointerEvents="none" style={[styles.spotlightRing, { top: hy, left: hx, width: hw, height: hh }]} />

      <View style={[styles.tooltip, placement === "top" ? { bottom: screenH - hy + 14 } : { top: hy + hh + 14 }]}>
        <Text style={styles.tooltipTitle}>{step.title}</Text>
        <Text style={styles.tooltipBody}>{step.body}</Text>
        <View style={styles.tooltipFooter}>
          <Pressable onPress={onFinish} hitSlop={8}>
            <Text style={styles.skipText}>Passer le tour</Text>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={styles.stepCount}>{stepIndex + 1}/{steps.length}</Text>
            <Pressable onPress={next} style={styles.nextBtn}>
              <Text style={styles.nextText}>{isLast ? "Terminer" : "Suivant"}</Text>
              <Feather name="arrow-right" size={15} color={T.night} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: "absolute", backgroundColor: "rgba(10,14,25,0.72)" },
  spotlightRing: { position: "absolute", borderWidth: 2, borderColor: T.abricot, borderRadius: 14 },
  tooltip: { position: "absolute", left: 20, right: 20, backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18 },
  tooltipTitle: { color: T.night, fontSize: 16, fontWeight: "800", marginBottom: 6 },
  tooltipBody: { color: T.inkSoft, fontSize: 13.5, fontWeight: "600", lineHeight: 20 },
  tooltipFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  skipText: { color: T.inkSoft, fontSize: 12.5, fontWeight: "700" },
  stepCount: { color: T.inkSoft, fontSize: 12, fontWeight: "700" },
  nextBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: T.abricot, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14 },
  nextText: { color: T.night, fontSize: 13.5, fontWeight: "800" },
});
