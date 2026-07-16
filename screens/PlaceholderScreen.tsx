import { View, Text, StyleSheet } from "react-native";
import { T } from "../lib/theme";

export default function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.cream, alignItems: "center", justifyContent: "center", padding: 32 },
  title: { color: T.night, fontSize: 22, fontWeight: "800", marginBottom: 8 },
  note: { color: T.inkSoft, fontSize: 15, fontWeight: "600", textAlign: "center", lineHeight: 22 },
});