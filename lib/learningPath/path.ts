// Calcul de la carte : croise catalogue, progression Firestore, niveau de pratique et droits.
// Lecture seule côté client ; les écritures de progression/XP viennent des Functions.
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase";
import { CHAPTERS, LESSONS, getChapter, getVariant, isLessonPublished } from "./catalog";
import type { AccessStatus, LearningPathView, LessonProgress, PathNode, PedagogicalStatus, PracticeLevel } from "./types";

const DEFAULT_LEVEL: PracticeLevel = "A2"; // « Je ne sais pas » → A2 très accompagnée (spec 2.2), configurable

export async function loadProgress(): Promise<Map<string, LessonProgress>> {
  const uid = auth.currentUser?.uid;
  const map = new Map<string, LessonProgress>();
  if (!uid) return map;
  try {
    const snap = await getDocs(collection(db, "users", uid, "progress"));
    snap.forEach((d: any) => map.set(d.id, { lessonId: d.id, ...(d.data() as any) }));
  } catch (e) {
    console.warn("loadProgress échoué:", e);
  }
  return map;
}

export async function loadLearningState(): Promise<{ practiceLevel: PracticeLevel; xp: number }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { practiceLevel: DEFAULT_LEVEL, xp: 0 };
  try {
    const snap = await getDoc(doc(db, "users", uid, "learning", "state"));
    const d = snap.data() ?? {};
    return { practiceLevel: (d.practiceLevel as PracticeLevel) ?? DEFAULT_LEVEL, xp: Number(d.xp ?? 0) };
  } catch (e) {
    console.warn("loadLearningState échoué:", e);
    return { practiceLevel: DEFAULT_LEVEL, xp: 0 };
  }
}

// Même logique que le serveur ; ici seulement pour l'affichage. Le serveur revalide à startOrResumeLesson.
export function buildLearningPath(
  progress: Map<string, LessonProgress>,
  practiceLevel: PracticeLevel,
  isEntitled: boolean,
  xp: number
): LearningPathView {
  const nodes: PathNode[] = [];
  let firstAvailableSeen = false; // révélation progressive : au-delà du premier nœud disponible, silhouettes
  const chapterProgress: Record<string, { validated: number; total: number }> = {};

  for (const lesson of LESSONS) {
    const chapter = getChapter(lesson.chapterId)!;
    const p = progress.get(lesson.id) ?? null;
    const published = isLessonPublished(lesson.id);
    const prereqOk = !lesson.prerequisiteLessonId || progress.get(lesson.prerequisiteLessonId)?.status === "validated";

    let pedagogical: PedagogicalStatus;
    if (p?.status === "validated") pedagogical = "validated";
    else if (p?.status === "needs_practice") pedagogical = "needs_practice";
    else if (p?.status === "in_progress") pedagogical = "in_progress";
    else if (!prereqOk) pedagogical = firstAvailableSeen ? "hidden_preview" : "locked_prerequisite";
    else pedagogical = "available";

    if (pedagogical === "available" || pedagogical === "in_progress" || pedagogical === "needs_practice") {
      // le nœud juste après le disponible reste détaillé (aperçu de la suite), les suivants en silhouette
      if (firstAvailableSeen) pedagogical = "hidden_preview";
      firstAvailableSeen = true;
    }

    const access: AccessStatus = lesson.isFreeDiscovery ? "free" : isEntitled ? "entitled" : "subscription_required";

    nodes.push({
      lesson, chapter, pedagogical, access,
      editorial: published ? "published" : "unpublished",
      variant: published ? getVariant(lesson.id, practiceLevel) : null,
      progress: p,
    });

    const cp = (chapterProgress[chapter.id] ??= { validated: 0, total: 0 });
    cp.total += 1;
    if (pedagogical === "validated") cp.validated += 1;
  }

  // Le nœud qui suit immédiatement le premier disponible est montré en détail (locked_prerequisite), pas en silhouette
  const firstIdx = nodes.findIndex((n) => ["available", "in_progress", "needs_practice"].includes(n.pedagogical));
  if (firstIdx >= 0 && nodes[firstIdx + 1]?.pedagogical === "hidden_preview") nodes[firstIdx + 1].pedagogical = "locked_prerequisite";

  const nextNode = firstIdx >= 0 ? nodes[firstIdx] : null;
  return { practiceLevel, nodes, nextNode, chapterProgress, xp };
}

export async function getLearningPath(isEntitled: boolean): Promise<LearningPathView> {
  const [progress, state] = await Promise.all([loadProgress(), loadLearningState()]);
  return buildLearningPath(progress, state.practiceLevel, isEntitled, state.xp);
}

// Libellé utilisateur d'un nœud non ouvrable (spec 3.1 : distinguer les deux raisons)
export function lockedReasonFr(node: PathNode): string | null {
  if (node.editorial === "unpublished") return "À venir";
  if (node.pedagogical === "locked_prerequisite" || node.pedagogical === "hidden_preview") return "Termine la leçon précédente";
  if (node.access === "subscription_required") return "Disponible avec l'abonnement";
  return null;
}
