import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";

const LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export default function WeekStrip({ days }: { days: boolean[] }) {
  const today = (new Date().getDay() + 6) % 7; // 0 = lundi
  return (
    <View style={styles.row}>
      {LABELS.map((l, i) => {
        const done = days[i];
        const isToday = i === today;
        return (
          <View key={i} style={[styles.dot, done && styles.dotDone, isToday && styles.dotToday]}>
            {done ? (
              <Feather name="check" size={13} color={T.night} />
            ) : (
              <Text style={[styles.label, isToday && styles.labelToday]}>{l}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginTop: 14 },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: T.creamLine, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: T.abricot, borderColor: T.abricot },
  dotToday: { borderColor: T.abricotDeep, borderWidth: 2 },
  label: { fontSize: 12, fontWeight: "800", color: T.inkSoft },
  labelToday: { color: T.abricotDeep },
});