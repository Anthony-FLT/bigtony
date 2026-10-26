// XP des exercices du jour et des scènes : décidés par le serveur (barème, plafonds, idempotence). Jamais bloquant.
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const awardXpFn = httpsCallable(functions, "awardXp", { timeout: 15000 });

export type XpSource = "exercise" | "scene";
export type XpAward = { xpGained: number; xpTotal: number; reason: "ok" | "duplicate" | "daily_cap" };

function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// key : identifiant stable de l'action du jour ("listening" | "reading" | "translation", ou l'id de session de la scène)
export async function awardXp(source: XpSource, key: string): Promise<XpAward | null> {
  try {
    const res: any = await awardXpFn({ source, key, dateKey: todayKey() });
    return res.data as XpAward;
  } catch (e) {
    console.warn("awardXp échoué:", e);
    return null;
  }
}
