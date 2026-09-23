// Statistiques agrégées pour l'écran Progrès : conversations de la semaine + mot le plus confondu.
// Même méthode que streak.ts (tri par startedAt, filtre "done" côté client) pour éviter un index composite Firestore.
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { auth, db } from "./firebase";

export type TroubleWord = { word: string; count: number } | null;

export async function getProgressStats(): Promise<{ weekConversations: number; topTroubleWord: TroubleWord }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { weekConversations: 0, topTroubleWord: null };

  try {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    // Borné aux 60 sessions les plus récentes : largement assez pour ces deux stats,
    // évite de relire tout l'historique au fur et à mesure qu'il grandit.
    const q = query(collection(db, "users", uid, "sessions"), orderBy("startedAt", "desc"), limit(60));
    const snap = await getDocs(q);

    let weekConversations = 0;
    const wordTotals: Record<string, number> = {};

    snap.forEach((doc) => {
      const s: any = doc.data();
      if (s.status !== "done" || !s.startedAt?.toDate) return;
      const startedAt: Date = s.startedAt.toDate();
      if (startedAt >= monday) weekConversations++;

      const weakWords = Array.isArray(s.weakWords) ? s.weakWords : [];
      for (const w of weakWords) {
        if (!w?.word) continue;
        wordTotals[w.word] = (wordTotals[w.word] ?? 0) + (w.count ?? 1);
      }
    });

    let topTroubleWord: TroubleWord = null;
    let bestCount = 1; // sous ce seuil, trop peu de données pour que ce soit parlant
    for (const [word, count] of Object.entries(wordTotals)) {
      if (count > bestCount) { bestCount = count; topTroubleWord = { word, count }; }
    }

    return { weekConversations, topTroubleWord };
  } catch (e) {
    console.warn("getProgressStats échoué:", e);
    return { weekConversations: 0, topTroubleWord: null };
  }
}