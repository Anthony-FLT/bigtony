// L'actu du jour — lecture de l'édition préparée chaque nuit par le serveur (dailyNews/current) et suivi local de ce qui est fait.
// L'app ne génère rien : textes, quiz, audios et images sont déjà prêts dans le document.
import { doc, getDoc } from "firebase/firestore";
import * as FileSystem from "expo-file-system/legacy";
import { db } from "./firebase";
import type { LessonVariant } from "./learningPath/types";

export type NewsLevel = "A2" | "B1" | "B2";
export const NEWS_LEVELS: NewsLevel[] = ["A2", "B1", "B2"];
export const NEWS_LEVEL_LABEL: Record<NewsLevel, string> = { A2: "Facile", B1: "Moyen", B2: "Avancé" };

export type NewsWord = { word: string; fr: string };
export type NewsQuestion = { question: string; options: string[]; answer: number };
export type NewsLevelContent = {
  text: string;
  hard_words: NewsWord[];
  questions: NewsQuestion[];
  audio: Record<string, string>; // voix du coach ("us-male"…) → lien du MP3
  discussion: LessonVariant | null; // utilisée côté serveur ; l'app n'en lit que les objectifs
};
export type NewsItem = {
  id: string; // "NEWS-20261116-1" — sert aussi d'identifiant de leçon pour la discussion
  position: number;
  rubrique: string;
  rubriqueLabelFr: string;
  titleEn: string;
  titleFr: string;
  summaryFr: string;
  image: { url: string } | null;
  source: { name: string; title: string; url: string };
  levels: Record<NewsLevel, NewsLevelContent>;
};
export type NewsEdition = { date: string; items: NewsItem[] };

// Niveau de pratique de l'utilisateur (A1 à C2) → niveau d'actu disponible (même règle que le serveur)
export function newsLevelFor(level: string | null | undefined): NewsLevel {
  if (level === "A1" || level === "A2") return "A2";
  if (level === "B1") return "B1";
  if (level === "B2" || level === "C1" || level === "C2") return "B2";
  return "A2";
}

// ---------------------------------------------------------------
// Lecture de l'édition
// ---------------------------------------------------------------
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function normalizeLevel(raw: any): NewsLevelContent | null {
  const body = text(raw?.text);
  if (!body) return null;
  const questions: NewsQuestion[] = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((q: any) => ({ question: text(q?.question), options: (Array.isArray(q?.options) ? q.options : []).map(text).filter(Boolean), answer: Number(q?.answer) }))
    .filter((q: NewsQuestion) => q.question && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
  if (questions.length === 0) return null;
  const audio: Record<string, string> = {};
  if (raw.audio && typeof raw.audio === "object") for (const [k, v] of Object.entries(raw.audio)) if (typeof v === "string" && v.startsWith("https://")) audio[k] = v;
  return {
    text: body,
    hard_words: (Array.isArray(raw.hard_words) ? raw.hard_words : []).map((w: any) => ({ word: text(w?.word), fr: text(w?.fr) })).filter((w: NewsWord) => w.word && w.fr),
    questions,
    audio,
    discussion: raw.discussion && typeof raw.discussion === "object" ? (raw.discussion as LessonVariant) : null,
  };
}

function normalizeItem(raw: any, index: number): NewsItem | null {
  if (!raw || raw.hidden === true || !text(raw.id) || !text(raw.titleEn)) return null;
  const levels = {} as Record<NewsLevel, NewsLevelContent>;
  for (const l of NEWS_LEVELS) {
    const c = normalizeLevel(raw.levels?.[l]);
    if (!c) return null; // un sujet incomplet n'est pas affiché
    levels[l] = c;
  }
  const url = text(raw.image?.url);
  return {
    id: text(raw.id),
    position: Number(raw.position) || index + 1,
    rubrique: text(raw.rubrique) || "societe",
    rubriqueLabelFr: text(raw.rubriqueLabelFr) || "Actu",
    titleEn: text(raw.titleEn),
    titleFr: text(raw.titleFr),
    summaryFr: text(raw.summaryFr),
    image: url.startsWith("https://") ? { url } : null,
    source: { name: text(raw.source?.name), title: text(raw.source?.title), url: text(raw.source?.url) },
    levels,
  };
}

const CACHE_MS = 15 * 60 * 1000;
let cache: { at: number; edition: NewsEdition | null } | null = null;

// Édition déjà en mémoire (sans attendre) : évite l'état « chargement » quand on revient sur l'accueil
export function peekNewsEdition(): NewsEdition | null {
  return cache?.edition ?? null;
}

// Renvoie l'édition publiée, ou null s'il n'y en a pas encore (ou hors ligne sans rien en mémoire).
export async function loadNewsEdition(force = false): Promise<NewsEdition | null> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.edition;
  try {
    const snap = await getDoc(doc(db, "dailyNews", "current"));
    const d: any = snap.data();
    const items = (Array.isArray(d?.items) ? d.items : [])
      .map((it: any, i: number) => normalizeItem(it, i))
      .filter((it: NewsItem | null): it is NewsItem => !!it)
      .sort((a: NewsItem, b: NewsItem) => a.position - b.position);
    const edition = d?.status === "published" && /^\d{4}-\d{2}-\d{2}$/.test(text(d?.date)) && items.length > 0 ? { date: text(d.date), items } : null;
    cache = { at: Date.now(), edition };
    if (edition) prefetchNewsCovers(edition); // en arrière-plan : les illustrations passent en fichiers locaux
    return edition;
  } catch (e) {
    console.warn("loadNewsEdition échoué:", e);
    return cache?.edition ?? null; // hors ligne : on garde ce qu'on avait
  }
}

// "2026-11-16" → "lundi 16 novembre"
const DAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function formatNewsDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d, 12);
  return `${DAYS_FR[dt.getDay()]} ${d === 1 ? "1er" : d} ${MONTHS_FR[m - 1]}`;
}

// Audio d'un niveau pour la voix du coach choisi ; à défaut, la première voix disponible
export function newsAudioUrl(content: NewsLevelContent, voice: string): string | null {
  return content.audio[voice] ?? Object.values(content.audio)[0] ?? null;
}

// Illustrations de secours par rubrique (quand l'image de l'actu n'a pas pu être générée ou chargée)
const RUBRIQUE_IMAGES: Record<string, any> = {
  sport: require("../assets/news/rubrique-sport.png"),
  culture: require("../assets/news/rubrique-culture.png"),
  sciences: require("../assets/news/rubrique-sciences.png"),
  societe: require("../assets/news/rubrique-societe.png"),
  economie: require("../assets/news/rubrique-economie.png"),
  environnement: require("../assets/news/rubrique-environnement.png"),
  animaux: require("../assets/news/rubrique-animaux.png"),
};
export function rubriqueImage(rubrique: string): any {
  return RUBRIQUE_IMAGES[rubrique] ?? RUBRIQUE_IMAGES.societe;
}

// ---------------------------------------------------------------
// Suivi local de l'édition en cours (quiz fait, discussion faite) — un petit fichier, remis à zéro à chaque nouvelle édition
// ---------------------------------------------------------------
export type NewsItemProgress = { quiz?: { score: number; total: number }; discussed?: boolean };
export type NewsProgress = Record<string, NewsItemProgress>;

const PROGRESS_FILE = `${FileSystem.documentDirectory ?? ""}news-progress.json`;
let progressMem: { date: string; items: NewsProgress } | null = null;

// Suivi déjà en mémoire (sans attendre)
export function peekNewsProgress(date: string): NewsProgress | null {
  return progressMem?.date === date ? progressMem.items : null;
}

export async function loadNewsProgress(date: string): Promise<NewsProgress> {
  if (progressMem?.date === date) return progressMem.items;
  try {
    const info = await FileSystem.getInfoAsync(PROGRESS_FILE);
    if (info.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(PROGRESS_FILE));
      if (parsed?.date === date && parsed.items && typeof parsed.items === "object") {
        progressMem = { date, items: parsed.items as NewsProgress };
        return progressMem.items;
      }
    }
  } catch (e) {
    console.warn("loadNewsProgress échoué:", e);
  }
  progressMem = { date, items: {} };
  return progressMem.items;
}

async function patchNewsProgress(date: string, itemId: string, patch: NewsItemProgress): Promise<NewsProgress> {
  const items = { ...(await loadNewsProgress(date)) };
  items[itemId] = { ...(items[itemId] ?? {}), ...patch };
  progressMem = { date, items };
  try {
    await FileSystem.writeAsStringAsync(PROGRESS_FILE, JSON.stringify(progressMem));
  } catch (e) {
    console.warn("sauvegarde du suivi des actus échouée:", e);
  }
  return items;
}
export function saveNewsQuiz(date: string, itemId: string, score: number, total: number): Promise<NewsProgress> {
  return patchNewsProgress(date, itemId, { quiz: { score, total } });
}
export function markNewsDiscussed(date: string, itemId: string): Promise<NewsProgress> {
  return patchNewsProgress(date, itemId, { discussed: true });
}

// ---------------------------------------------------------------
// Niveau de lecture choisi par l'utilisateur (Facile / Moyen / Avancé) : retenu d'une actu à l'autre et d'un jour à l'autre
// ---------------------------------------------------------------
const LEVEL_FILE = `${FileSystem.documentDirectory ?? ""}news-level.json`;
let levelMem: NewsLevel | null | undefined; // undefined = pas encore lu

export async function loadNewsLevel(): Promise<NewsLevel | null> {
  if (levelMem !== undefined) return levelMem;
  levelMem = null;
  try {
    const info = await FileSystem.getInfoAsync(LEVEL_FILE);
    if (info.exists) {
      const l = JSON.parse(await FileSystem.readAsStringAsync(LEVEL_FILE))?.level;
      if (NEWS_LEVELS.includes(l)) levelMem = l as NewsLevel;
    }
  } catch (e) {
    console.warn("loadNewsLevel échoué:", e);
  }
  return levelMem;
}
export async function saveNewsLevel(level: NewsLevel): Promise<void> {
  levelMem = level;
  try {
    await FileSystem.writeAsStringAsync(LEVEL_FILE, JSON.stringify({ level }));
  } catch (e) {
    console.warn("sauvegarde du niveau des actus échouée:", e);
  }
}

// ---------------------------------------------------------------
// Illustrations en cache local : téléchargées une fois par édition, puis lues depuis le téléphone (affichage immédiat, même hors ligne)
// ---------------------------------------------------------------
const COVER_PREFIX = "news-cover-";
const coverLocal: Record<string, string> = {}; // lien distant → fichier local
let coversFor: string | null = null;

// Fichier local de l'illustration s'il est déjà prêt, sinon null (on affiche alors le lien distant)
export function localCoverUri(url: string | null | undefined): string | null {
  return (url && coverLocal[url]) || null;
}

export async function prefetchNewsCovers(edition: NewsEdition): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir || coversFor === edition.date) return;
  coversFor = edition.date;
  const wanted = new Set<string>();
  await Promise.all(edition.items.map(async (item) => {
    const url = item.image?.url;
    if (!url) return;
    const name = `${COVER_PREFIX}${item.id}.jpg`;
    wanted.add(name);
    const path = dir + name;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        const res = await FileSystem.downloadAsync(url, path);
        if (res.status !== 200) { await FileSystem.deleteAsync(path, { idempotent: true }); return; }
      }
      coverLocal[url] = path;
    } catch (e) {
      console.warn("mise en cache d'une illustration échouée:", e);
    }
  }));
  // Ménage : illustrations des éditions précédentes
  try {
    const files = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(files.filter((f) => f.startsWith(COVER_PREFIX) && !wanted.has(f)).map((f) => FileSystem.deleteAsync(dir + f, { idempotent: true })));
  } catch {}
}
