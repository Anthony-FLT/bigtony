import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { loadProfile } from "./profile";

const dailyExpression = httpsCallable(functions, "dailyExpression", { timeout: 25000 });

export type Expression = { en: string; fr: string; example_en: string; example_fr: string };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getDailyExpression(): Promise<Expression | null> {
  const key = "dailyExpression";
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached.date === todayKey() && cached.expr) return cached.expr as Expression;
    }
  } catch {}

  // Pas de cache pour aujourd'hui → on génère
  try {
    const p = await loadProfile();
    const res: any = await dailyExpression({
      level: p?.level ?? "B1",
      interests: p?.interests ?? [],
      goals: p?.goals ?? [],
      job: p?.job ?? null,
      seed: todayKey() + "-" + Math.random().toString(36).slice(2, 7),
    });
    const expr = res.data as Expression;
    await AsyncStorage.setItem(key, JSON.stringify({ date: todayKey(), expr }));
    return expr;
  } catch (e) {
    console.warn("getDailyExpression échoué:", e);
    return null;
  }
}