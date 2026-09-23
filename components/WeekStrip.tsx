import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { T } from "../lib/theme";

const LABELS = ["L", "M", "M", "J", "V", "S", "D"];

// Clé du lundi de la semaine en cours — sert à ne jouer l'animation "objectif atteint" qu'une fois par semaine.
function mondayKey(): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return monday.toDateString();
}

export default function WeekStrip({ days, goal, dark }: { days: boolean[]; goal?: number; dark?: boolean }) {
  const today = (new Date().getDay() + 6) % 7; // 0 = lundi
  const done = days.filter(Boolean).length;
  const g = goal && goal > 0 ? goal : 0;
  const reached = g > 0 && done >= g;

  // Anime seulement au moment où l'objectif vient d'être atteint pour la première fois cette semaine.
  const [justReached, setJustReached] = useState(false);
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!reached) return;
    let cancelled = false;
    (async () => {
      const key = "weekGoalCelebrated:" + mondayKey();
      try {
        const seen = await AsyncStorage.getItem(key);
        if (seen || cancelled) return;
        await AsyncStorage.setItem(key, "1");
        if (cancelled) return;
        setJustReached(true);
        anim.setValue(0);
        Animated.spring(anim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [reached]);

  return (
    <View>
      <View style={styles.row}>
        {LABELS.map((l, i) => {
          const dayDone = days[i];
          const isToday = i === today;
          return (
            <View
              key={i}
              style={[
                styles.dot,
                dark && styles.dotDark,
                dayDone && styles.dotDone,
                isToday && !dayDone && (dark ? styles.dotTodayDark : styles.dotToday),
              ]}
            >
              {dayDone ? (
                <Feather name="check" size={13} color={T.night} />
              ) : (
                <Text style={[styles.label, dark && styles.labelDark, isToday && (dark ? styles.labelTodayDark : styles.labelToday)]}>{l}</Text>
              )}
            </View>
          );
        })}
      </View>

      {g > 0 && (
        <Animated.View
          style={[
            styles.goalRow,
            justReached && {
              opacity: anim,
              transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
            },
          ]}
        >
          <View style={styles.segTrack}>
            {Array.from({ length: g }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.seg,
                  i > 0 && { marginLeft: 4 },
                  i < done && (dark ? styles.segFillDark : styles.segFill),
                ]}
              />
            ))}
          </View>
          <Text style={[styles.goalText, dark && styles.goalTextDark, reached && (dark ? styles.goalTextReachedDark : styles.goalTextReached)]}>
            {reached ? "Objectif atteint" : `${done}/${g} jours`}
          </Text>
          <View style={[styles.starBadge, dark && styles.starBadgeDark, reached && styles.starBadgeReached]}>
            <Feather name="star" size={13} color={reached ? T.night : dark ? "rgba(255,255,255,0.4)" : T.creamLine} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, marginTop: 12 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: T.creamLine, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: T.abricot, borderColor: T.abricot },
  dotToday: { borderColor: T.abricotDeep, borderWidth: 2 },
  label: { fontSize: 12, fontWeight: "800", color: T.inkSoft },
  labelToday: { color: T.abricotDeep },

  // Variante sombre (bandeau bleu)
  dotDark: { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.25)" },
  dotTodayDark: { backgroundColor: T.abricot, borderColor: T.abricot },
  labelDark: { color: "#C9D3E8" },
  labelTodayDark: { color: T.night },

  // Objectif de la semaine — barre segmentée + libellé + étoile
  goalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  segTrack: { flex: 1, flexDirection: "row" },
  seg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: T.creamLine },
  segFill: { backgroundColor: T.abricot },
  segFillDark: { backgroundColor: T.abricot, opacity: 0.95 },

  goalText: { fontSize: 12, fontWeight: "800", color: T.inkSoft },
  goalTextDark: { color: "#C9D3E8" },
  goalTextReached: { color: T.abricotDeep },
  goalTextReachedDark: { color: T.abricot },

  starBadge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: T.creamLine, alignItems: "center", justifyContent: "center" },
  starBadgeDark: { borderColor: "rgba(255,255,255,0.3)" },
  starBadgeReached: { backgroundColor: T.abricot, borderColor: T.abricot },
});
