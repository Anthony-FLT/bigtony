import { useRef } from "react";
import { View, Text, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from "react-native";
import { T } from "../lib/theme";

const ITEM_H = 42;
const VISIBLE = 5; // lignes visibles (impair : sélection au centre)
const PAD = ITEM_H * Math.floor(VISIBLE / 2);

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function WheelColumn({ values, selected, onSelect }: { values: number[]; selected: number; onSelect: (v: number) => void }) {
  const ref = useRef<ScrollView>(null);
  const didInit = useRef(false);
  const lastEmitted = useRef(selected);
  const idx = Math.max(0, values.indexOf(selected));

  const onLayout = (_e: LayoutChangeEvent) => {
    if (didInit.current) return;
    didInit.current = true;
    ref.current?.scrollTo({ y: idx * ITEM_H, animated: false });
  };

  // Valide la valeur au centre — appelé en continu pendant le défilement
  const handle = (y: number) => {
    const i = Math.max(0, Math.min(values.length - 1, Math.round(y / ITEM_H)));
    const v = values[i];
    if (v !== lastEmitted.current) {
      lastEmitted.current = v;
      onSelect(v);
    }
  };

  return (
    <ScrollView
      ref={ref}
      onLayout={onLayout}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      nestedScrollEnabled
      scrollEventThrottle={16}
      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => handle(e.nativeEvent.contentOffset.y)}
      onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => handle(e.nativeEvent.contentOffset.y)}
      onScrollEndDrag={(e: NativeSyntheticEvent<NativeScrollEvent>) => handle(e.nativeEvent.contentOffset.y)}
      contentContainerStyle={{ paddingVertical: PAD }}
      style={styles.col}
    >
      {values.map((v) => (
        <View key={v} style={styles.cell}>
          <Text style={[styles.cellText, v === selected && styles.cellTextSel]}>{String(v).padStart(2, "0")}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export default function TimeWheel({ hour, minute, onChange }: { hour: number; minute: number; onChange: (h: number, m: number) => void }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.band, { top: PAD, height: ITEM_H }]} pointerEvents="none" />
      <WheelColumn values={HOURS} selected={hour} onSelect={(h) => onChange(h, minute)} />
      <Text style={styles.colon}>:</Text>
      <WheelColumn values={MINUTES} selected={minute} onSelect={(m) => onChange(hour, m)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: ITEM_H * VISIBLE, flexDirection: "row", alignItems: "center", justifyContent: "center", position: "relative" },
  band: { position: "absolute", left: 24, right: 24, backgroundColor: T.chipAbricot, borderRadius: 12 },
  col: { width: 64 },
  cell: { height: ITEM_H, alignItems: "center", justifyContent: "center" },
  cellText: { fontSize: 20, fontWeight: "700", color: T.inkSoft, opacity: 0.4 },
  cellTextSel: { color: T.night, fontSize: 23, fontWeight: "800", opacity: 1 },
  colon: { fontSize: 22, fontWeight: "800", color: T.night, marginHorizontal: 8 },
});