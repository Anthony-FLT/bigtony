// L'actu du jour — fonction planifiée (03:00, heure de Paris) qui prépare l'édition des actus de la VEILLE.
// Chargé depuis index.js par : Object.assign(exports, require("./dailyNews"));
//
// Tout est généré une fois, pour tous les utilisateurs ; l'app ne fait que lire le document dailyNews/current.
//   1. lecture des flux RSS par rubrique (config/news.feeds), articles publiés la veille ;
//   2. sélection de 4 ou 5 sujets par Gemini, avec un filtre éditorial strict (pas de drames, de faits divers ni de politique) ;
//   3. pour chaque sujet : notre propre texte anglais en 3 niveaux (A2, B1, B2), quiz, mots clés, consigne de discussion pour le
//      coach, puis vérification que le texte n'ajoute aucun fait absent de la source ;
//   4. audio lu par les voix des coachs + image d'illustration générée, rangés dans Cloud Storage ;
//   5. écriture de dailyNews/{date} (archive) et dailyNews/current (ce que l'app lit).
// Aucun texte ni photo de presse n'est repris : la source n'est citée que par son nom, son titre et son lien.
//
// Réglages à chaud dans Firestore, document config/news (tous les champs sont optionnels) :
//   enabled (bool) · count (3 à 6) · feeds [{ rubrique, url, source }] · textModel · imageModel ("" = pas d'image) · imageStyle (consigne de style des images)
//   audioVoices (["us-male", …], [] = pas d'audio) · keepDays (durée de conservation des fichiers) · bucket
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI, Type } = require("@google/genai");
const textToSpeech = require("@google-cloud/text-to-speech");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { execFile } = require("child_process");
const { promisify } = require("util");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

if (!getApps().length) initializeApp();

const REGION = "europe-west1";
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const { VOICES, refreshVoices } = require("./voices");
const execFileAsync = promisify(execFile);

const USER_AGENT = "DeclicAnglaisBot/1.0 (lecteur RSS quotidien)";
const NEWS_LEVELS = ["A2", "B1", "B2"]; // A1 lit le niveau A2 ; C1 et C2 lisent le niveau B2 (voir newsLevelFor)

const DEFAULTS = {
  enabled: true,
  count: 5,
  textModel: "gemini-3.6-flash",
  imageModel: "gemini-3.1-flash-lite-image",
  audioVoices: ["us-male", "us-female", "uk-male", "uk-female"],
  keepDays: 14,
  bucket: "",
  feeds: [
    { rubrique: "sport", source: "franceinfo", url: "https://www.francetvinfo.fr/sports.rss" },
    { rubrique: "culture", source: "franceinfo", url: "https://www.francetvinfo.fr/culture.rss" },
    { rubrique: "sciences", source: "franceinfo", url: "https://www.francetvinfo.fr/sciences.rss" },
    { rubrique: "societe", source: "franceinfo", url: "https://www.francetvinfo.fr/societe.rss" },
    { rubrique: "economie", source: "franceinfo", url: "https://www.francetvinfo.fr/economie.rss" },
    { rubrique: "environnement", source: "franceinfo", url: "https://www.franceinfo.fr/environnement.rss" },
    { rubrique: "animaux", source: "franceinfo", url: "https://www.francetvinfo.fr/animaux.rss" },
  ],
};

const RUBRIQUE_LABELS = {
  sport: "Sport", culture: "Culture", sciences: "Sciences", societe: "Société", economie: "Économie",
  environnement: "Environnement", animaux: "Animaux", tech: "Tech", insolite: "Insolite", voyage: "Voyage",
};
const rubriqueLabel = (k) => RUBRIQUE_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : "Actu");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const wordCount = (s) => clean(s).split(" ").filter(Boolean).length;

// ---------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------
async function loadConfig(db) {
  let d = {};
  try { d = (await db.doc("config/news").get()).data() || {}; }
  catch (e) { console.warn("[actus] config/news illisible, réglages par défaut:", e?.message || e); }
  const feeds = Array.isArray(d.feeds)
    ? d.feeds.filter((f) => f && typeof f.url === "string" && /^https:\/\//.test(f.url) && typeof f.rubrique === "string" && f.rubrique)
        .map((f) => ({ rubrique: f.rubrique.trim().toLowerCase(), url: f.url.trim(), source: clean(f.source) || new URL(f.url).hostname.replace(/^www\./, "") }))
    : [];
  const voices = Array.isArray(d.audioVoices) ? d.audioVoices.filter((v) => typeof v === "string" && VOICES[v]) : null;
  return {
    enabled: d.enabled !== false,
    count: Math.max(3, Math.min(6, Number.isFinite(Number(d.count)) && Number(d.count) > 0 ? Math.round(Number(d.count)) : DEFAULTS.count)),
    textModel: clean(d.textModel) || DEFAULTS.textModel,
    imageModel: typeof d.imageModel === "string" ? d.imageModel.trim() : DEFAULTS.imageModel,
    imageStyle: clean(d.imageStyle).slice(0, 600) || IMAGE_STYLE,
    audioVoices: voices || DEFAULTS.audioVoices,
    keepDays: Math.max(2, Math.min(90, Number(d.keepDays) > 0 ? Math.round(Number(d.keepDays)) : DEFAULTS.keepDays)),
    bucket: clean(d.bucket),
    feeds: feeds.length ? feeds : DEFAULTS.feeds,
  };
}

// ---------------------------------------------------------------
// Dates : la « veille » se calcule à l'heure de Paris, quel que soit le fuseau du serveur
// ---------------------------------------------------------------
const PARIS_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function parisParts(d) {
  return Object.fromEntries(PARIS_FMT.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
}
function parisOffsetMs(d) {
  const p = parisParts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}
// Instant UTC (ms) de 00:00 heure de Paris pour une date calendaire
function parisMidnightUtc(y, m, d) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = guess - parisOffsetMs(new Date(guess));
  const again = guess - parisOffsetMs(new Date(t)); // le décalage peut différer autour d'un changement d'heure
  if (again !== t) t = again;
  return t;
}
// Fenêtre de l'édition : toute la journée de la veille, à l'heure de Paris
function editionWindow(now) {
  const p = parisParts(now);
  const y = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  const yy = y.getUTCFullYear(), ym = y.getUTCMonth() + 1, yd = y.getUTCDate();
  return { date: `${yy}-${pad(ym)}-${pad(yd)}`, start: parisMidnightUtc(yy, ym, yd), end: parisMidnightUtc(p.year, p.month, p.day) };
}
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// ---------------------------------------------------------------
// Flux RSS (RSS 2.0 et Atom), sans dépendance
// ---------------------------------------------------------------
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", hellip: "…", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", euro: "€" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}
function plainText(raw) {
  if (!raw) return "";
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s).replace(/<[^>]+>/g, " "); // les descriptions contiennent parfois du HTML échappé
  return clean(decodeEntities(s));
}
function tagContent(block, names) {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m && m[1].trim()) return m[1];
  }
  return "";
}
function itemLink(block) {
  const rss = plainText(tagContent(block, ["link"]));
  if (/^https?:\/\//.test(rss)) return rss;
  const atom = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(block);
  if (atom) return decodeEntities(atom[1]);
  const guid = plainText(tagContent(block, ["guid", "id"]));
  return /^https?:\/\//.test(guid) ? guid : "";
}
function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const title = plainText(tagContent(b, ["title"]));
    const link = itemLink(b);
    if (!title || !link) continue;
    const description = plainText(tagContent(b, ["description", "summary", "content:encoded", "content"])).slice(0, 700);
    const t = Date.parse(plainText(tagContent(b, ["pubDate", "dc:date", "published", "updated"])));
    items.push({ title, link, description, date: Number.isFinite(t) ? t : null });
  }
  return items;
}
async function fetchFeedText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(12_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const declared = /encoding=["']([\w-]+)["']/i.exec(buf.subarray(0, 200).toString("latin1"))?.[1]
    || /charset=([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1] || "utf-8";
  try { return new TextDecoder(declared.toLowerCase()).decode(buf); } catch { return buf.toString("utf8"); }
}

// Candidats de la veille, toutes rubriques confondues. Un flux en panne n'empêche pas les autres.
async function collectCandidates(cfg, win, fetchText) {
  const results = await Promise.all(cfg.feeds.map(async (feed) => {
    try { return { feed, items: parseFeed(await fetchText(feed.url)) }; }
    catch (e) { console.warn(`[actus] flux en échec (${feed.rubrique}) ${feed.url}:`, e?.message || e); return { feed, items: null }; }
  }));
  const seen = new Set();
  const inWindow = [], recent = [];
  let feedsOk = 0;
  for (const { feed, items } of results) {
    if (!items) continue;
    feedsOk++;
    let undated = 0, kept = 0;
    for (const it of items) {
      const key = it.link.split("?")[0].toLowerCase();
      const titleKey = it.title.toLowerCase();
      if (seen.has(key) || seen.has(titleKey)) continue;
      const c = { ...it, rubrique: feed.rubrique, source: feed.source };
      if (it.date === null) { if (undated++ < 4) { seen.add(key); seen.add(titleKey); recent.push(c); } continue; }
      if (it.date >= win.start && it.date < win.end) { if (kept++ < 15) { seen.add(key); seen.add(titleKey); inWindow.push(c); } }
      else if (it.date >= win.start - 24 * 3600_000 && it.date < win.start) { seen.add(key); seen.add(titleKey); recent.push(c); } // avant-veille : réserve
    }
  }
  // Journée trop calme (dimanche, jour férié, flux peu actifs) : on complète avec l'avant-veille et les articles sans date
  const candidates = inWindow.length >= cfg.count * 2 ? inWindow : inWindow.concat(recent.slice(0, cfg.count * 4));
  return { candidates, feedsOk, feedsFailed: cfg.feeds.length - feedsOk, inWindow: inWindow.length };
}

// ---------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------
async function genJson(ai, { model, system, user, schema, temperature = 0.6, timeoutMs = 90_000, label }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const call = ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: { systemInstruction: system, responseMimeType: "application/json", responseSchema: schema, temperature, thinkingConfig: { thinkingLevel: "low" }, abortSignal: ac.signal },
      });
      const guard = new Promise((_, reject) => ac.signal.addEventListener("abort", () => reject(new Error("gemini_timeout")), { once: true }));
      const res = await Promise.race([call, guard]);
      return JSON.parse(res.text);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label}: ${String(lastErr?.message || lastErr).slice(0, 300)}`);
}

const EXCLUDED_TOPICS = `deaths and obituaries; accidents and disasters with victims; crimes, trials, police or court cases; terrorism; war or armed conflict; sexual violence, abuse, suicide; disease outbreaks or frightening health news; partisan politics (parties, elections, government disputes, strikes, protests); religion or identity controversies; immigration; a private individual's misfortune; gambling and betting`;

// Sélection éditoriale : liste classée d'index de candidats (les premiers sont traités, les suivants servent de remplaçants)
async function selectStories(ai, cfg, candidates) {
  const wanted = cfg.count + 6; // large : la diversité des rubriques est imposée ensuite par le code
  const list = candidates.map((c, i) => `[${i}] (${c.rubrique}) ${c.title}${c.description ? ` — ${c.description.slice(0, 260)}` : ""}`).join("\n");
  const out = await genJson(ai, {
    model: cfg.textModel,
    label: "sélection",
    temperature: 0.3,
    system: `You are the editor of "L'actu du jour", a daily feature in a French app that helps adults practise spoken English. From the French news items below (published yesterday), choose the stories a learner can read about in simple English and then discuss with a friendly coach.

Return up to ${wanted} items, ranked best first, using the "index" shown in brackets.

Prefer concrete, easy-to-picture stories that people chat about at the coffee machine: sport results, culture, science and discoveries, everyday life, travel, food, technology, nature, records, unusual or light stories. Prefer stories about France or that French people follow.

Variety: include at least one item from EVERY rubrique that has a suitable story, and never two items about the same event.

NEVER pick anything about: ${EXCLUDED_TOPICS}.
Also skip: items whose description is too thin to understand what happened, opinion pieces and editorials, live blogs, videos or podcasts without facts, TV listings, quizzes, advertising.

If fewer good items exist, return fewer. An empty list is acceptable.`,
    user: `NEWS ITEMS:\n${list}`,
    schema: {
      type: Type.OBJECT,
      properties: {
        picks: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER }, reason: { type: Type.STRING } }, required: ["index"] },
        },
      },
      required: ["picks"],
    },
  });
  const order = [];
  for (const p of Array.isArray(out?.picks) ? out.picks : []) {
    const i = Math.round(Number(p?.index));
    if (Number.isInteger(i) && i >= 0 && i < candidates.length && !order.includes(i)) order.push(i);
  }
  return order.map((i) => candidates[i]);
}

const LEVEL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    hard_words: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { word: { type: Type.STRING }, fr: { type: Type.STRING } }, required: ["word", "fr"] } },
    questions: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { question: { type: Type.STRING }, options: { type: Type.ARRAY, items: { type: Type.STRING } }, answer: { type: Type.NUMBER } }, required: ["question", "options", "answer"] },
    },
    openingEn: { type: Type.STRING },
    followUpsEn: { type: Type.ARRAY, items: { type: Type.STRING } },
    difficultyFollowUpEn: { type: Type.STRING },
    exampleSummaryEn: { type: Type.STRING },
    exampleDetailEn: { type: Type.STRING },
    exampleOpinionEn: { type: Type.STRING },
    exercisePromptFr: { type: Type.STRING },
    exerciseSampleEn: { type: Type.STRING },
    exerciseCriteriaEn: { type: Type.ARRAY, items: { type: Type.STRING } },
    exerciseAltPromptFr: { type: Type.STRING },
  },
  required: ["text", "hard_words", "questions", "openingEn", "followUpsEn", "difficultyFollowUpEn", "exampleSummaryEn", "exampleDetailEn", "exampleOpinionEn", "exercisePromptFr", "exerciseSampleEn", "exerciseCriteriaEn", "exerciseAltPromptFr"],
};
const STORY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    usable: { type: Type.BOOLEAN },
    titleEn: { type: Type.STRING },
    titleFr: { type: Type.STRING },
    summaryFr: { type: Type.STRING },
    imagePromptEn: { type: Type.STRING },
    A2: LEVEL_SCHEMA,
    B1: LEVEL_SCHEMA,
    B2: LEVEL_SCHEMA,
  },
  required: ["usable", "titleEn", "titleFr", "summaryFr", "imagePromptEn", "A2", "B1", "B2"],
};

const STORY_SYSTEM = `You write "L'actu du jour" for a French app that helps adults practise spoken English. From ONE French news item (title + short description), you write OUR OWN short English texts at three levels, a comprehension quiz, and what a friendly coach will ask when the learner explains the story.

FACTS — the most important rule:
- Use ONLY the facts given in the SOURCE. Never add numbers, names, places, dates, scores, results, quotes or causes that are not in the SOURCE.
- You may add at most two sentences of neutral, common-knowledge background (what the competition is, where the city is, what the object is used for).
- If the SOURCE is thin, write a shorter text. Never pad with invented details.
- Write in your own words: do not translate the source sentence by sentence.
- Neutral tone, no opinion. If the item turns out to be about one of the excluded topics (${EXCLUDED_TOPICS}), or cannot be understood, set "usable" to false and leave the other fields minimal.

SHARED FIELDS:
- "titleEn": a clear, simple English headline in sentence case (capitalise only the first word and proper nouns), at most 60 characters, no clickbait.
- "titleFr": a short French title in our own words, at most 70 characters, in correct and natural French (check agreements and past participles).
- "summaryFr": ONE French sentence saying what the story is about.
- "imagePromptEn": describe ONE simple scene that symbolises the story using only places and objects (a stadium, a street, a museum hall, an object on a table). No people at all, no faces, no text, no logos, no flags, no brand names.

FOR EACH LEVEL (A2, B1, B2):
- "text": A2 = 40 to 60 words, short sentences, very common words, present and past simple. B1 = 60 to 85 words, linking words, some less common vocabulary. B2 = 80 to 110 words, richer vocabulary and more complex sentences. The three texts tell the same facts.
- "hard_words": 3 to 5 words or short expressions taken exactly FROM that level's text that a French learner of that level might not know, each with its French translation in context.
- "questions": EXACTLY 3 multiple-choice comprehension questions in English, each with EXACTLY 3 short options and "answer" = the 0-based index of the right one. Answerable only from that level's text; wrong options plausible but clearly wrong. Vary the position of the right answer.
- "openingEn": what the coach SAYS to start the discussion: one short sentence showing they heard about the story, then ONE question asking the learner to tell what happened in a few sentences. At most 25 words. Do not reveal the details.
- "followUpsEn": EXACTLY 2 short follow-up questions: the first asks for a detail or a reason, the second asks for the learner's opinion.
- "difficultyFollowUpEn": one slightly harder question for a learner who is doing well.
- "exampleSummaryEn", "exampleDetailEn", "exampleOpinionEn": one model sentence each, at that level, that a learner could say to summarise the story, add a detail, and give an opinion.
- "exercisePromptFr": a French instruction for a 20-second transfer exercise about the same story (for example: « Raconte cette actu à un collègue en deux phrases. »).
- "exerciseSampleEn": a model answer at that level. "exerciseCriteriaEn": EXACTLY 3 short English descriptions of what a good answer contains. "exerciseAltPromptFr": another French instruction on the same story.

Respond ONLY with JSON matching the schema.`;

function sourceBlock(c) {
  return `SOURCE (rubrique: ${c.rubrique}, media: ${c.source})\nTitle: ${c.title}\nDescription: ${c.description || "(no description)"}`;
}

// Contrôle de forme : renvoie le niveau nettoyé, ou null s'il est inutilisable
function validateLevel(raw, level) {
  const text = clean(raw?.text);
  const n = wordCount(text);
  if (n < 25 || n > 170) return null;
  const lower = text.toLowerCase();
  const hard_words = (Array.isArray(raw.hard_words) ? raw.hard_words : [])
    .map((w) => ({ word: clean(w?.word), fr: clean(w?.fr) }))
    .filter((w) => w.word && w.fr && lower.includes(w.word.toLowerCase()))
    .slice(0, 5);
  const questions = [];
  for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
    const options = (Array.isArray(q?.options) ? q.options : []).map(clean).filter(Boolean);
    const answer = Math.round(Number(q?.answer));
    if (!clean(q?.question) || options.length !== 3 || !Number.isInteger(answer) || answer < 0 || answer > 2) continue;
    questions.push({ question: clean(q.question), options, answer });
  }
  if (questions.length < 3) return null;
  const followUpsEn = (Array.isArray(raw.followUpsEn) ? raw.followUpsEn : []).map(clean).filter(Boolean).slice(0, 2);
  const openingEn = clean(raw.openingEn);
  if (!openingEn || followUpsEn.length < 2) return null;
  const need = ["difficultyFollowUpEn", "exampleSummaryEn", "exampleDetailEn", "exampleOpinionEn", "exercisePromptFr", "exerciseSampleEn", "exerciseAltPromptFr"];
  const strings = Object.fromEntries(need.map((k) => [k, clean(raw[k])]));
  if (need.some((k) => !strings[k])) return null;
  const exerciseCriteriaEn = (Array.isArray(raw.exerciseCriteriaEn) ? raw.exerciseCriteriaEn : []).map(clean).filter(Boolean).slice(0, 3);
  if (exerciseCriteriaEn.length < 2) return null;
  return { level, text, hard_words, questions: questions.slice(0, 3), openingEn, followUpsEn, exerciseCriteriaEn, ...strings };
}
function validateStory(raw) {
  if (!raw || raw.usable === false) return { ok: false, why: "jugé inutilisable par le rédacteur" };
  const titleEn = clean(raw.titleEn), titleFr = clean(raw.titleFr), summaryFr = clean(raw.summaryFr);
  if (!titleEn || !titleFr || !summaryFr) return { ok: false, why: "titres manquants" };
  const levels = {};
  for (const lvl of NEWS_LEVELS) {
    const v = validateLevel(raw[lvl], lvl);
    if (!v) return { ok: false, why: `niveau ${lvl} invalide` };
    levels[lvl] = v;
  }
  return { ok: true, story: { titleEn: titleEn.slice(0, 90), titleFr: titleFr.slice(0, 100), summaryFr, imagePromptEn: clean(raw.imagePromptEn), levels } };
}

// Relecture : aucun fait précis absent de la source ne doit figurer dans les textes
async function verifyStory(ai, cfg, candidate, story) {
  const texts = NEWS_LEVELS.map((l) => `[${l}] ${story.levels[l].text}`).join("\n");
  const out = await genJson(ai, {
    model: cfg.textModel,
    label: "vérification",
    temperature: 0,
    system: `You are a careful fact-checker. Compare the TEXTS (written for English learners) with the SOURCE (a French news title and description).

List every SPECIFIC factual claim in the TEXTS or TITLES that the SOURCE does not support: numbers, names, places, dates, scores, results, quotes, causes, consequences. Neutral common-knowledge background (what a competition is, where a city is) is acceptable and must not be listed. Also list, starting with "FR:", any grammar or spelling mistake in the French title or French summary (wrong agreement, wrong past participle, missing accent). Differences of wording or simplification are acceptable.

"verdict":
- "ok": no unsupported specific claim.
- "fix": some unsupported claims that can simply be removed.
- "reject": the texts misrepresent the story, or the story is about one of these topics: ${EXCLUDED_TOPICS}.
"issues": the unsupported claims, each quoted briefly (empty when ok).`,
    user: `${sourceBlock(candidate)}\n\nTITLES: ${story.titleEn} | ${story.titleFr} | ${story.summaryFr}\n\nTEXTS:\n${texts}`,
    schema: {
      type: Type.OBJECT,
      properties: { verdict: { type: Type.STRING }, issues: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ["verdict", "issues"],
    },
  });
  const verdict = ["ok", "fix", "reject"].includes(out?.verdict) ? out.verdict : "fix";
  return { verdict, issues: (Array.isArray(out?.issues) ? out.issues : []).map(clean).filter(Boolean).slice(0, 8) };
}

// Rédaction d'un sujet : génération, contrôle de forme, relecture des faits, une seule tentative de correction
async function writeStory(ai, cfg, candidate) {
  let issues = [];
  for (let round = 0; round < 2; round++) {
    const fix = issues.length ? `\n\nA fact-checker found these claims that the SOURCE does not support. Rewrite without them:\n- ${issues.join("\n- ")}` : "";
    const raw = await genJson(ai, { model: cfg.textModel, label: "rédaction", system: STORY_SYSTEM, user: `${sourceBlock(candidate)}${fix}`, schema: STORY_SCHEMA, temperature: 0.6, timeoutMs: 120_000 });
    const v = validateStory(raw);
    if (!v.ok) { if (raw?.usable === false) return { ok: false, why: v.why }; issues = []; if (round === 1) return { ok: false, why: v.why }; continue; }
    const check = await verifyStory(ai, cfg, candidate, v.story);
    if (check.verdict === "ok") return { ok: true, story: v.story };
    if (check.verdict === "reject") return { ok: false, why: `rejeté à la relecture : ${check.issues.join(" ; ").slice(0, 200)}` };
    issues = check.issues.length ? check.issues : ["unsupported specific claims"];
  }
  return { ok: false, why: `faits non confirmés par la source : ${issues.join(" ; ").slice(0, 200)}` };
}

// ---------------------------------------------------------------
// Discussion avec le coach : même forme qu'une variante de leçon (catalogue), pour réutiliser le moteur des leçons
// ---------------------------------------------------------------
const NEWS_COACH_ROLE = "a curious English-speaking friend who heard about this French news story and wants the learner to explain it. You know the facts in NEWS CONTEXT but you let the learner tell the story; you only help, or gently correct a fact, when they are stuck or wrong. Stay neutral: never give your own opinion on political or divisive matters; ask for the learner's view and help them express it";
const NEWS_USER_ROLE = "a French person explaining a news story from France to a foreign friend";

function buildDiscussionVariant(itemId, level, story) {
  const l = story.levels[level];
  return {
    id: `${itemId}-${level}`,
    lessonId: itemId,
    kind: "news",
    contentVersion: 1,
    practiceLevel: level,
    titleFr: story.titleFr,
    objectiveFr: "Raconter cette actu en anglais : la résumer, ajouter un détail, donner ton avis.",
    coachRole: NEWS_COACH_ROLE,
    userRole: NEWS_USER_ROLE,
    newsContextEn: story.levels.B2.text,
    openingEn: l.openingEn,
    followUpsEn: l.followUpsEn,
    difficultyFollowUpEn: l.difficultyFollowUpEn,
    easierVariantHintFr: "On reprendra la même actu avec des phrases plus courtes.",
    fallbackFeedbackFr: "Tu as raconté une actu en anglais avec tes propres mots : c'est exactement l'exercice.",
    requiredCriteria: [
      { id: "summary", descriptionFr: "Résumer l'actu en une ou deux phrases", exampleEn: l.exampleSummaryEn },
      { id: "detail", descriptionFr: "Ajouter un détail ou une explication", exampleEn: l.exampleDetailEn },
      { id: "opinion", descriptionFr: "Donner ton avis", exampleEn: l.exampleOpinionEn },
    ],
    miniLesson: {
      explanationFr: "Pour raconter une actu : dis d'abord ce qui s'est passé (« It's about… »), ajoute un détail (« It happened in… », « because… »), puis donne ton avis (« I think… »).",
      examplesEn: [l.exampleSummaryEn, l.exampleDetailEn, l.exampleOpinionEn],
      optional: true,
    },
    supports: ["translate", "listen_model", "text_mode"],
    microExercise: {
      promptFr: l.exercisePromptFr,
      expectedSemanticCriteria: l.exerciseCriteriaEn,
      sampleAnswerEn: l.exerciseSampleEn,
      alternativePromptFr: l.exerciseAltPromptFr,
    },
    targetMinutes: 2,
    minUsefulTurns: 3,
    maxUsefulTurns: 4,
  };
}
// Niveau de pratique de l'utilisateur (A1 à C2) → niveau d'actu disponible (à utiliser aussi côté app)
const newsLevelFor = (practiceLevel) => (practiceLevel === "A1" || practiceLevel === "A2" ? "A2" : practiceLevel === "B1" ? "B1" : NEWS_LEVELS.includes(practiceLevel) || ["C1", "C2"].includes(practiceLevel) ? "B2" : "A2");

// ---------------------------------------------------------------
// Fichiers : audio des coachs et image d'illustration (Cloud Storage, lien de téléchargement à jeton)
// ---------------------------------------------------------------
async function saveFile(bucket, filePath, buffer, contentType) {
  const token = crypto.randomUUID();
  await bucket.file(filePath).save(buffer, {
    resumable: false,
    metadata: { contentType, cacheControl: "public, max-age=604800", metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}
async function inBatches(tasks, size) {
  const out = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

// Style par défaut des images (test du 17/11 : rendu réaliste). Réglable à chaud : config/news.imageStyle.
// Quel que soit le style : jamais de personne, de texte ni de logo — une image réaliste d'actu ne doit pas passer pour une photo de presse.
const IMAGE_STYLE = "Style: cinematic realistic photograph, 35mm lens, shallow depth of field, warm natural light, landscape format.";
const IMAGE_RULES = "Strictly no people, no faces, no text, no letters, no numbers, no logos, no flags, no brand names.";
async function generateImage(ai, model, prompt, style) {
  let lastErr;
  // Certains modèles refusent le réglage de format : second essai sans, l'image sera alors carrée
  for (const config of [{ imageConfig: { aspectRatio: "16:9" } }, null]) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const call = ai.models.generateContent({ model, contents: `${prompt}\n\n${style || IMAGE_STYLE}\n${IMAGE_RULES}`, config: { ...(config || {}), abortSignal: ac.signal } });
      const guard = new Promise((_, reject) => ac.signal.addEventListener("abort", () => reject(new Error("image_timeout")), { once: true }));
      const res = await Promise.race([call, guard]);
      const part = (res?.candidates?.[0]?.content?.parts || []).find((p) => p?.inlineData?.data);
      if (part) return { buffer: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType || "image/png" };
      lastErr = new Error("réponse sans image");
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
// PNG lourd → JPEG 1280 px (ffmpeg déjà embarqué pour l'audio). En cas d'échec, on garde l'image d'origine.
async function toJpeg(image, ffmpegPath) {
  if (!ffmpegPath) return { buffer: image.buffer, mime: image.mime, ext: image.mime.includes("jpeg") ? "jpg" : "png" };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "actu-"));
  const input = path.join(dir, "in.img"), output = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(input, image.buffer);
    await execFileAsync(ffmpegPath, ["-y", "-loglevel", "error", "-i", input, "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", output], { timeout: 30_000 });
    return { buffer: await fs.readFile(output), mime: "image/jpeg", ext: "jpg" };
  } catch (e) {
    console.warn("[actus] conversion JPEG impossible, image d'origine conservée:", e?.message || e);
    return { buffer: image.buffer, mime: image.mime, ext: image.mime.includes("jpeg") ? "jpg" : "png" };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------
// Un sujet complet : rédaction + audio + image. Renvoie l'item à publier, ou null si le sujet est écarté.
// ---------------------------------------------------------------
async function buildItem(deps, cfg, date, order, candidate) {
  const { ai, bucket, tts, ffmpegPath } = deps;
  const written = await writeStory(ai, cfg, candidate);
  if (!written.ok) { console.warn(`[actus] sujet écarté « ${candidate.title.slice(0, 80)} » : ${written.why}`); return null; }
  const story = written.story;
  const itemId = `NEWS-${date.replace(/-/g, "")}-${order}`;
  const base = `dailyNews/${date}/${order}`;

  // Audio : une lecture par niveau et par voix de coach. Un échec isolé n'écarte pas le sujet (l'app masque alors l'écoute).
  const audio = Object.fromEntries(NEWS_LEVELS.map((l) => [l, {}]));
  const audioTasks = [];
  for (const level of NEWS_LEVELS) {
    for (const voice of cfg.audioVoices) {
      audioTasks.push(async () => {
        try {
          const mp3 = await tts(`${story.titleEn}. ${story.levels[level].text}`, voice);
          audio[level][voice] = await saveFile(bucket, `${base}/${level}-${voice}.mp3`, mp3, "audio/mpeg");
        } catch (e) { console.warn(`[actus] audio ${itemId} ${level} ${voice} en échec:`, e?.message || e); }
      });
    }
  }
  // Image : facultative. Sans image, l'app affiche l'illustration de la rubrique.
  const imageTask = (async () => {
    if (!cfg.imageModel || !story.imagePromptEn) return null;
    try {
      const jpg = await toJpeg(await generateImage(ai, cfg.imageModel, story.imagePromptEn, cfg.imageStyle), ffmpegPath);
      return { url: await saveFile(bucket, `${base}/cover.${jpg.ext}`, jpg.buffer, jpg.mime) };
    } catch (e) { console.warn(`[actus] image ${itemId} en échec:`, String(e?.message || e).slice(0, 200)); return null; }
  })();
  const [, image] = await Promise.all([inBatches(audioTasks, 6), imageTask]);

  const levels = {};
  for (const level of NEWS_LEVELS) {
    const l = story.levels[level];
    levels[level] = { text: l.text, hard_words: l.hard_words, questions: l.questions, audio: audio[level], discussion: buildDiscussionVariant(itemId, level, story) };
  }
  return {
    id: itemId,
    order,
    hidden: false, // passer à true dans dailyNews/current pour retirer un sujet sans attendre l'édition suivante
    rubrique: candidate.rubrique,
    rubriqueLabelFr: rubriqueLabel(candidate.rubrique),
    titleEn: story.titleEn,
    titleFr: story.titleFr,
    summaryFr: story.summaryFr,
    image, // { url } ou null
    source: { name: candidate.source, title: candidate.title, url: candidate.link },
    levels,
  };
}

// ---------------------------------------------------------------
// Édition complète
// ---------------------------------------------------------------
async function runDailyNews(deps, now = new Date()) {
  const { db } = deps;
  const cfg = await loadConfig(db);
  if (!cfg.enabled) { console.log("[actus] désactivé (config/news.enabled = false)"); return { skipped: "disabled" }; }
  const win = editionWindow(now);
  const ref = db.doc(`dailyNews/${win.date}`);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === "published") {
    console.log(`[actus] édition ${win.date} déjà publiée, rien à faire (supprimer dailyNews/${win.date} pour la régénérer)`);
    return { skipped: "already_published", date: win.date };
  }

  const collected = await collectCandidates(cfg, win, deps.fetchText);
  console.log(`[actus] ${win.date} : ${collected.candidates.length} candidats (${collected.inWindow} de la veille), flux ${collected.feedsOk} ok / ${collected.feedsFailed} en échec`);
  if (collected.candidates.length === 0) throw new Error("aucun article lisible dans les flux RSS");

  const ranked = await selectStories(deps.ai, cfg, collected.candidates);
  if (ranked.length === 0) throw new Error("aucun sujet retenu par la sélection éditoriale");

  // Les premiers sujets en parallèle, puis les remplaçants un par un tant qu'il manque des sujets
  const bucket = cfg.bucket ? deps.storage.bucket(cfg.bucket) : deps.storage.bucket();
  const itemDeps = { ...deps, bucket };
  const items = [];
  let slot = 0;
  // Une seule actu par rubrique dans le premier choix ; les autres candidats servent de remplaçants
  const first = [], pool = [];
  for (const c of ranked) {
    if (first.length < cfg.count && !first.some((f) => f.rubrique === c.rubrique)) first.push(c); else pool.push(c);
  }
  while (first.length < cfg.count && pool.length) first.push(pool.shift()); // pas assez de rubriques ce jour-là : on complète
  const built = await Promise.all(first.map((c, i) => buildItem(itemDeps, cfg, win.date, i + 1, c).catch((e) => { console.warn(`[actus] sujet en erreur « ${c.title.slice(0, 80)} »:`, e?.message || e); return null; })));
  slot = first.length;
  for (const it of built) if (it) items.push(it);
  while (items.length < cfg.count && pool.length) {
    // remplaçant : d'abord une rubrique pas encore publiée
    const fresh = pool.findIndex((c) => !items.some((i) => i.rubrique === c.rubrique));
    const c = pool.splice(fresh >= 0 ? fresh : 0, 1)[0];
    const it = await buildItem(itemDeps, cfg, win.date, ++slot, c).catch((e) => { console.warn(`[actus] remplaçant en erreur « ${c.title.slice(0, 80)} »:`, e?.message || e); return null; });
    if (it) items.push(it);
  }
  if (items.length === 0) throw new Error("aucun sujet n'a passé la rédaction et la relecture");

  // Ordre d'affichage = ordre de la sélection éditoriale
  items.sort((a, b) => a.order - b.order);
  items.forEach((it, i) => { it.position = i + 1; });

  const edition = {
    date: win.date,
    status: "published",
    version: 1,
    levels: NEWS_LEVELS,
    voices: cfg.audioVoices,
    items,
    stats: { candidates: collected.candidates.length, fromYesterday: collected.inWindow, feedsOk: collected.feedsOk, feedsFailed: collected.feedsFailed, selected: ranked.length, published: items.length },
    generatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(ref, edition);
  batch.set(db.doc("dailyNews/current"), edition);
  await batch.commit();
  console.log(`[actus] édition ${win.date} publiée : ${items.length} sujets (${items.map((i) => i.rubrique).join(", ")})`);

  // Kit TikTok (carrousel d'images du jour, voir newsSocial.js) : un échec ici ne touche pas l'édition, déjà publiée
  try { await require("./newsSocial").buildSocialKit({ db, bucket, edition: { date: win.date, items } }); }
  catch (e) { console.warn("[actus] kit TikTok en échec:", e?.message || e); }

  // Ménage : fichiers des éditions sorties de la période de conservation (les documents Firestore, légers, sont gardés)
  for (let k = 1; k <= 3; k++) {
    const old = shiftDate(win.date, -(cfg.keepDays + k));
    bucket.deleteFiles({ prefix: `dailyNews/${old}/`, force: true }).catch((e) => console.warn(`[actus] ménage ${old} en échec:`, e?.message || e));
  }
  return { date: win.date, published: items.length, rubriques: items.map((i) => i.rubrique) };
}

// ---------------------------------------------------------------
// Fonction planifiée : tous les jours à 03:00, heure de Paris
// ---------------------------------------------------------------
const ttsClient = new textToSpeech.TextToSpeechClient();
exports.dailyNewsEdition = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Europe/Paris", region: REGION, timeoutSeconds: 540, memory: "1GiB", maxInstances: 1, retryCount: 2, secrets: [GEMINI_API_KEY] },
  async () => {
    let ffmpegPath = "";
    try { ffmpegPath = require("@ffmpeg-installer/ffmpeg").path; } catch { /* conversion JPEG ignorée si ffmpeg est absent */ }
    await refreshVoices();
    const deps = {
      db: getFirestore(),
      storage: getStorage(),
      ai: new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() }),
      fetchText: fetchFeedText,
      ffmpegPath,
      tts: async (text, voiceKey) => {
        const [res] = await ttsClient.synthesizeSpeech({ input: { text }, voice: VOICES[voiceKey], audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 } });
        return Buffer.from(res.audioContent);
      },
    };
    const result = await runDailyNews(deps);
    console.log("[actus] terminé", JSON.stringify(result));
  }
);

// Fonctions internes exposées pour les tests (non énumérable : Firebase ne les prend pas pour des Functions)
Object.defineProperty(module.exports, "_internal", {
  enumerable: false,
  value: { runDailyNews, editionWindow, parseFeed, collectCandidates, validateStory, validateLevel, buildDiscussionVariant, newsLevelFor, loadConfig, toJpeg, DEFAULTS, NEWS_LEVELS },
});
