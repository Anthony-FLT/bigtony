// Catalogue pédagogique embarqué : structure (9 chapitres, 36 leçons) + variantes publiées.
// Lecture seule. La copie canonique côté Functions fait autorité pour la validation et les droits.
import type { ChapterDefinition, LessonDefinition, LessonVariant, PracticeLevel } from "./types";

const structure = require("../../assets/catalog/structure.json") as {
  schemaVersion: string;
  structureVersion: number;
  chapters: ChapterDefinition[];
  lessons: LessonDefinition[];
};

// Un fichier par chapitre publié. Ajouter ici chapter-02.json, etc. au fur et à mesure.
const variantFiles: { chapterId: string; contentVersion: number; variants: LessonVariant[] }[] = [
  require("../../assets/catalog/chapter-01.json"),
];

export const CATALOG_STRUCTURE_VERSION = structure.structureVersion;

export const CHAPTERS: ChapterDefinition[] = [...structure.chapters].sort((a, b) => a.order - b.order);
export const LESSONS: LessonDefinition[] = [...structure.lessons].sort((a, b) =>
  a.chapterId === b.chapterId ? a.order - b.order : a.chapterId.localeCompare(b.chapterId)
);

const lessonById = new Map(LESSONS.map((l) => [l.id, l]));
const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));
const variantById = new Map<string, LessonVariant>();
const variantByLessonLevel = new Map<string, LessonVariant>();
for (const f of variantFiles) {
  for (const v of f.variants) {
    variantById.set(v.id, v);
    variantByLessonLevel.set(`${v.lessonId}:${v.practiceLevel}`, v);
  }
}

export function getChapter(id: string): ChapterDefinition | null { return chapterById.get(id) ?? null; }
export function getLesson(id: string): LessonDefinition | null { return lessonById.get(id) ?? null; }
export function getVariant(lessonId: string, level: PracticeLevel): LessonVariant | null {
  return variantByLessonLevel.get(`${lessonId}:${level}`) ?? null;
}
export function getVariantById(id: string): LessonVariant | null { return variantById.get(id) ?? null; }
export function lessonsOfChapter(chapterId: string): LessonDefinition[] {
  return LESSONS.filter((l) => l.chapterId === chapterId);
}
export function isLessonPublished(lessonId: string): boolean {
  const l = lessonById.get(lessonId);
  return !!l && l.published && !!chapterById.get(l.chapterId)?.published;
}

// Contrôles d'intégrité (AC25) — exécutés une fois au chargement, en dev uniquement.
// Une erreur ici est un bug de catalogue, pas un cas utilisateur.
export function validateCatalog(): string[] {
  const errors: string[] = [];
  if (CHAPTERS.length !== 9) errors.push(`9 chapitres attendus, ${CHAPTERS.length} trouvés`);
  if (LESSONS.length !== 36) errors.push(`36 leçons attendues, ${LESSONS.length} trouvées`);
  if (new Set(LESSONS.map((l) => l.id)).size !== LESSONS.length) errors.push("identifiants de leçon en double");
  // aucun cycle de prérequis : on remonte la chaîne depuis chaque leçon
  for (const l of LESSONS) {
    const seen = new Set<string>();
    let cur: LessonDefinition | null = l;
    while (cur?.prerequisiteLessonId) {
      if (seen.has(cur.id)) { errors.push(`cycle de prérequis autour de ${l.id}`); break; }
      seen.add(cur.id);
      cur = lessonById.get(cur.prerequisiteLessonId) ?? null;
      if (!cur) { errors.push(`prérequis inconnu pour ${l.id}`); break; }
    }
  }
  // chaque leçon publiée a ses 6 variantes, avec critères et transfert non vides
  const LEVELS: PracticeLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  for (const l of LESSONS.filter((x) => isLessonPublished(x.id))) {
    for (const lvl of LEVELS) {
      const v = getVariant(l.id, lvl);
      if (!v) { errors.push(`variante manquante ${l.id}-${lvl}`); continue; }
      if (v.requiredCriteria.length < 2) errors.push(`${v.id} : moins de 2 critères`);
      if (new Set(v.requiredCriteria.map((c) => c.id)).size !== v.requiredCriteria.length) errors.push(`${v.id} : critères en double`);
      if (!v.microExercise?.promptFr || v.microExercise.expectedSemanticCriteria.length < 2) errors.push(`${v.id} : micro-exercice incomplet`);
      if (!v.followUpsEn.includes(v.difficultyFollowUpEn)) errors.push(`${v.id} : difficultyFollowUpEn absent de followUpsEn`);
    }
  }
  return errors;
}

if (__DEV__) {
  const errs = validateCatalog();
  if (errs.length) console.warn("[catalogue] anomalies :\n - " + errs.join("\n - "));
}
