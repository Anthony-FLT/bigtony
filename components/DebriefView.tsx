import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";

export type Debrief = { message_fr: string; points_forts: string[]; axe: string };

export default function DebriefView({ debrief }: { debrief: Debrief }) {
  return (
    <View style={styles.debriefCard}>
      <Text style={styles.debriefTitle}>Ton bilan</Text>
      <Text style={styles.debriefMsg}>{debrief.message_fr}</Text>
      {debrief.points_forts.map((p, i) => (
        <View key={i} style={styles.strengthRow}>
          <Feather name="check" size={16} color={T.menthe} />
          <Text style={styles.strengthText}>{p}</Text>
        </View>
      ))}
      <View style={styles.axeBox}>
        <Text style={styles.axeLabel}>À TRAVAILLER EN PRIORITÉ</Text>
        <Text style={styles.axeText}>{debrief.axe}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  debriefCard: { backgroundColor: T.card, borderRadius: 20, padding: 20, marginTop: 12 },
  debriefTitle: { fontSize: 18, fontWeight: "800", color: T.night, marginBottom: 8 },
  debriefMsg: { fontSize: 14.5, fontWeight: "600", color: T.inkSoft, lineHeight: 21, marginBottom: 14 },
  strengthRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 8 },
  strengthText: { flex: 1, fontSize: 14, fontWeight: "700", color: T.night, lineHeight: 20 },
  axeBox: { backgroundColor: T.chipAbricot, borderRadius: 14, padding: 14, marginTop: 8 },
  axeLabel: { fontSize: 11, fontWeight: "800", color: T.abricotDeep, letterSpacing: 0.5, marginBottom: 4 },
  axeText: { fontSize: 14, fontWeight: "700", color: T.night, lineHeight: 20 },
});