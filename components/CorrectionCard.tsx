import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { T } from "../lib/theme";

type Token = { text: string; wrong?: boolean; changed?: boolean };
export type Correction = {
  has_errors: boolean;
  original: Token[];
  corrected: Token[];
};
export type PronStatus = { clear: boolean; problems: { said: string; heard: string }[] } | null;

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

// Ligne compacte inline : diff mot-à-mot condensé sur une seule phrase (barré + remplacé).
function InlineDiff({ tokens }: { tokens: Token[] }) {
  return (
    <Text style={styles.inlineSentence}>
      {tokens.map((tok, i) => (
        <Text key={i}>
          {tok.wrong ? <Text style={styles.inlineStrike}>{tok.text}</Text> : <Text>{tok.text}</Text>}
          {i < tokens.length - 1 ? " " : ""}
        </Text>
      ))}
    </Text>
  );
}

export default function CorrectionCard({
  correction,
  feedback,
  pronunciation,
  onPlayCorrected,
}: {
  correction: Correction;
  feedback: string;
  pronunciation?: PronStatus;
  onPlayCorrected?: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const hasErrors = correction.has_errors;
  const pronClear = pronunciation ? pronunciation.clear : true;
  const allGood = !hasErrors && pronClear;

  return (
    <>
      {/* ===== Résumé compact, toujours visible ===== */}
      <View style={[styles.card, allGood ? styles.cardOk : styles.cardErr]}>
        {hasErrors ? (
          <View style={styles.inlineRow}>
            <View style={{ flex: 1 }}><InlineDiff tokens={correction.original} /></View>
            {onPlayCorrected && (
              <Pressable onPress={onPlayCorrected} hitSlop={8} style={styles.audioBtnSmall}>
                <Feather name="volume-2" size={16} color={T.night} />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.okRow}>
            <Feather name="check-circle" size={15} color="#3B9A6A" />
            <Text style={styles.okText}>Ta réponse est claire et bien comprise !</Text>
          </View>
        )}

        {pronunciation && (
          <View style={styles.statusRow}>
            <View style={styles.pronRow}>
              <View style={[styles.pronDot, { backgroundColor: pronClear ? "#3B9A6A" : "#C77A2E" }]} />
              <Text style={[styles.pronLabel, { color: pronClear ? "#3B9A6A" : "#C77A2E" }]}>
                {pronClear ? "Prononciation claire" : "Prononciation à revoir"}
              </Text>
            </View>
            {hasErrors && (
              <Pressable onPress={() => setShowDetail(true)} hitSlop={8} style={styles.whyBtn}>
                <Text style={styles.whyText}>Pourquoi ?</Text>
                <Feather name="chevron-right" size={13} color={T.abricotDeep} />
              </Pressable>
            )}
          </View>
        )}
        {!pronunciation && hasErrors && (
          <Pressable onPress={() => setShowDetail(true)} hitSlop={8} style={[styles.whyBtn, { alignSelf: "flex-end", marginTop: 6 }]}>
            <Text style={styles.whyText}>Pourquoi ?</Text>
            <Feather name="chevron-right" size={13} color={T.abricotDeep} />
          </Pressable>
        )}
      </View>

      {/* ===== Panneau détaillé ===== */}
      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowDetail(false)}>
          <Pressable style={styles.detailCard} onPress={() => {}}>
            <View style={styles.detailHead}>
              <View style={styles.detailHeadLeft}>
                <View style={styles.sparkDot}><Feather name="edit-3" size={13} color="#FFFFFF" /></View>
                <Text style={styles.detailTitle}>Correction</Text>
              </View>
              <Pressable onPress={() => setShowDetail(false)} hitSlop={10}><Feather name="x" size={20} color={T.inkSoft} /></Pressable>
            </View>

            {pronunciation && (
              <View style={[styles.banner, pronClear ? styles.bannerOk : styles.bannerWarn]}>
                <Feather name={pronClear ? "check-circle" : "alert-triangle"} size={15} color={pronClear ? "#2E7D53" : "#C77A2E"} />
                <Text style={[styles.bannerText, { color: pronClear ? "#2E7D53" : "#8A5A22" }]}>
                  {pronClear ? "Ta réponse est claire et bien comprise !" : "Quelques mots ont été mal compris."}
                </Text>
              </View>
            )}
            {pronunciation && !pronClear && pronunciation.problems.map((m, k) => (
              <Text key={k} style={styles.mishText}>« {m.said} » — on a entendu « {m.heard} »</Text>
            ))}

            <Text style={[styles.label, { marginTop: 14 }]}>TA PHRASE</Text>
            <TokenLine tokens={correction.original} mode="wrong" />

            <View style={styles.correctedRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { marginTop: 12 }]}>VERSION CORRIGÉE</Text>
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

            <View style={styles.detailActions}>
              <Pressable onPress={() => setShowDetail(false)} style={styles.continueBtn}>
                <Text style={styles.continueText}>Continuer</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, marginVertical: 8, borderLeftWidth: 4 },
  cardErr: { borderLeftColor: T.abricot },
  cardOk: { borderLeftColor: "#4CAF7D" },

  inlineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  inlineSentence: { fontSize: 14.5, fontWeight: "700", color: T.night, lineHeight: 21 },
  inlineStrike: { color: "#C0392B", textDecorationLine: "line-through" },
  audioBtnSmall: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F0F0F3", alignItems: "center", justifyContent: "center" },

  okRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  okText: { fontSize: 14, fontWeight: "700", color: "#2E7D53", flex: 1 },

  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  pronRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pronDot: { width: 7, height: 7, borderRadius: 3.5 },
  pronLabel: { fontSize: 12.5, fontWeight: "700" },
  whyBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  whyText: { color: T.abricotDeep, fontSize: 12.5, fontWeight: "800" },

  overlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.55)", justifyContent: "flex-end" },
  detailCard: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, maxHeight: "85%" },
  detailHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  detailHeadLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  sparkDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: T.night, alignItems: "center", justifyContent: "center" },
  detailTitle: { fontSize: 17, fontWeight: "800", color: T.night },

  banner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12 },
  bannerOk: { backgroundColor: "#E6F4EC" },
  bannerWarn: { backgroundColor: "#FBEEDD" },
  bannerText: { fontSize: 13.5, fontWeight: "700", flex: 1 },
  mishText: { color: "#C77A2E", fontSize: 12.5, fontWeight: "700", marginTop: 6 },

  label: { fontSize: 11, fontWeight: "800", color: T.inkSoft, letterSpacing: 0.5, marginBottom: 6 },
  sentence: { fontSize: 15, fontWeight: "600", color: T.night, lineHeight: 24 },
  plainWord: { color: T.night },
  wrongWord: { backgroundColor: "#FBDAD3", color: "#C0392B" },
  changedWord: { backgroundColor: "#CDEBD8", color: "#2E7D4F" },
  correctedRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  audioBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#F4F2ED", alignItems: "center", justifyContent: "center", marginTop: 26 },
  explainBox: { flexDirection: "row", gap: 9, backgroundColor: "#F4F2ED", borderRadius: 12, padding: 12, marginTop: 14 },
  explainText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: T.inkSoft, lineHeight: 20 },

  detailActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  continueBtn: { backgroundColor: T.night, borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  continueText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
