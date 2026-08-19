import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";

type Token = { text: string; wrong?: boolean; changed?: boolean };
export type Correction = {
  has_errors: boolean;
  original: Token[];
  corrected: Token[];
};

// Rend une ligne de tokens, en surlignant selon le mode.
function TokenLine({ tokens, mode }: { tokens: Token[]; mode: "wrong" | "changed" }) {
  return (
    <Text style={styles.sentence}>
      {tokens.map((tok, i) => {
        const hl = mode === "wrong" ? tok.wrong : tok.changed;
        return (
          <Text key={i}>
            <Text style={hl ? (mode === "wrong" ? styles.wrongWord : styles.changedWord) : styles.plainWord}>
              {tok.text}
            </Text>
            {i < tokens.length - 1 ? " " : ""}
          </Text>
        );
      })}
    </Text>
  );
}

export default function CorrectionCard({
  correction,
  feedback,
  onPlayCorrected,
}: {
  correction: Correction;
  feedback: string;
  onPlayCorrected?: () => void;
}) {
  // Cas 1 : phrase correcte → carte verte "Très bien !"
  if (!correction.has_errors) {
    return (
      <View style={[styles.card, styles.cardOk]}>
        <View style={styles.header}>
          <View style={styles.okDot}><Feather name="check" size={14} color="#FFFFFF" /></View>
          <Text style={styles.okTitle}>Très bien !</Text>
        </View>
        <Text style={styles.feedback}>{feedback}</Text>
      </View>
    );
  }

  // Cas 2 : erreurs → carte de correction rouge/vert
  return (
    <View style={[styles.card, styles.cardErr]}>
      <View style={styles.header}>
        <View style={styles.sparkDot}><Feather name="edit-3" size={13} color="#FFFFFF" /></View>
        <Text style={styles.errTitle}>Correction</Text>
      </View>

      <Text style={styles.label}>TA PHRASE</Text>
      <TokenLine tokens={correction.original} mode="wrong" />

      <Text style={[styles.label, { marginTop: 12 }]}>VERSION CORRIGÉE</Text>
      <View style={styles.correctedRow}>
        <View style={{ flex: 1 }}>
          <TokenLine tokens={correction.corrected} mode="changed" />
        </View>
        {onPlayCorrected && (
          <Pressable onPress={onPlayCorrected} hitSlop={8} style={styles.audioBtn}>
            <Feather name="volume-2" size={18} color={T.night} />
          </Pressable>
        )}
      </View>

      <View style={styles.explainBox}>
        <Feather name="info" size={15} color={T.inkSoft} style={{ marginTop: 1 }} />
        <Text style={styles.explainText}>{feedback}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, marginVertical: 8, borderLeftWidth: 4 },
  cardErr: { borderLeftColor: T.abricot },
  cardOk: { borderLeftColor: "#4CAF7D" },
  header: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 },
  sparkDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: T.night, alignItems: "center", justifyContent: "center" },
  okDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#4CAF7D", alignItems: "center", justifyContent: "center" },
  errTitle: { fontSize: 15, fontWeight: "800", color: T.abricotDeep },
  okTitle: { fontSize: 15, fontWeight: "800", color: "#3B9A6A" },
  label: { fontSize: 11, fontWeight: "800", color: T.inkSoft, letterSpacing: 0.5, marginBottom: 6 },
  sentence: { fontSize: 14.5, fontWeight: "600", color: T.night, lineHeight: 24 },
  plainWord: { color: T.night },
  wrongWord: { backgroundColor: "#FBDAD3", color: "#C0392B" },
  changedWord: { backgroundColor: "#CDEBD8", color: "#2E7D4F" },
  correctedRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  audioBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#F0F0F3", alignItems: "center", justifyContent: "center" },
  explainBox: { flexDirection: "row", gap: 9, backgroundColor: "#F4F5F7", borderRadius: 12, padding: 12, marginTop: 14 },
  explainText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: T.inkSoft, lineHeight: 20 },
  feedback: { fontSize: 14, fontWeight: "600", color: T.inkSoft, lineHeight: 21 },
});