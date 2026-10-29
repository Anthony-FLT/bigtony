// Parcours d'apprentissage — Functions additives. Rien ici ne modifie les Functions existantes.
// Chargé depuis index.js par : Object.assign(exports, require("./learningPath"));
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI, Type } = require("@google/genai");
const textToSpeech = require("@google-cloud/text-to-speech");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

if (!getApps().length) initializeApp();
const db = getFirestore();

const REGION = "europe-west1";

// Secrets (même registre que index.js : un nom déclaré deux fois n'est enregistré qu'une fois)
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const REVENUECAT_API_KEY = defineSecret("REVENUECAT_API_KEY"); // clé SECRÈTE RevenueCat (API v1), jamais dans l'app
const REVENUECAT_WEBHOOK_AUTH = defineSecret("REVENUECAT_WEBHOOK_AUTH"); // valeur de l'en-tête Authorization configurée dans le webhook RevenueCat
const RC_ENTITLEMENT_ID = "Elan Pro";

// Voix TTS (mêmes identifiants que index.js) + une voix française pour les conseils de Sam
// Voix TTS : table par défaut + surcharge à chaud via config/voices (voir voices.js)
const { VOICES, FR_VOICE, refreshVoices } = require("./voices");

const COACH_IDENTITY = {
  "us-male":   { name: "Sam",   english: "American English" },
  "us-female": { name: "Emma",  english: "American English" },
  "uk-male":   { name: "James", english: "British English (British spelling and vocabulary)" },
  "uk-female": { name: "Alice", english: "British English (British spelling and vocabulary)" },
};
const coachIdentity = (voice) => COACH_IDENTITY[voice] || COACH_IDENTITY["us-male"];
const ttsClient = new textToSpeech.TextToSpeechClient();
async function synthesize(text, voice, rate) {
  await refreshVoices(); // les objets voix sont mis à jour en place : la référence reçue est déjà la bonne
  const [res] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice,
    audioConfig: { audioEncoding: "MP3", speakingRate: Math.max(0.5, Math.min(1.5, Number(rate) || 0.95)) },
  });
  return Buffer.from(res.audioContent).toString("base64");
}
const MAX_AUDIO_BASE64_LENGTH = 2_500_000;

// ---------------------------------------------------------------
// Catalogue canonique (copie serveur, même version que l'app)
// ---------------------------------------------------------------
const structure = require("./catalog/structure.json");
const chapterFiles = [require("./catalog/chapter-01.json")];

const LESSONS = new Map(structure.lessons.map((l) => [l.id, l]));
const CHAPTERS = new Map(structure.chapters.map((c) => [c.id, c]));
const VARIANTS = new Map();
for (const f of chapterFiles) for (const v of f.variants) VARIANTS.set(v.id, v);
// Leçon découverte de l'onboarding (« Commander un café », C00-L01) : hors parcours, offerte, même moteur que les leçons
const discovery = require("./catalog/discovery.json");
for (const c of discovery.chapters) CHAPTERS.set(c.id, c);
for (const l of discovery.lessons) LESSONS.set(l.id, l);
for (const v of discovery.variants) VARIANTS.set(v.id, v);
const DISCOVERY_LESSON_ID = discovery.lessons[0].id;

function getVariant(lessonId, level) {
  return VARIANTS.get(`${lessonId}-${level}`) || null;
}
function isPublished(lessonId) {
  const l = LESSONS.get(lessonId);
  return !!l && l.published && !!CHAPTERS.get(l.chapterId)?.published;
}

// Vérification au chargement : un catalogue incohérent empêche le déploiement de servir du faux
(function checkCatalog() {
  const problems = [];
  if (structure.lessons.length !== 36) problems.push("36 leçons attendues");
  for (const l of structure.lessons.filter((x) => isPublished(x.id))) {
    for (const lvl of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      const v = getVariant(l.id, lvl);
      if (!v) problems.push(`variante manquante ${l.id}-${lvl}`);
      else if (!Array.isArray(v.requiredCriteria) || v.requiredCriteria.length < 2) problems.push(`${v.id}: critères insuffisants`);
    }
  }
  if (problems.length) console.error("[catalogue serveur] " + problems.join(" ; "));
})();

// ---------------------------------------------------------------
// Flag serveur : config/featureFlags { learningPathEnabled: bool, learningPathRatio: 0..1 }
// Absent → désactivé. Désactiver n'affecte que les NOUVELLES assignations.
// ---------------------------------------------------------------
// Réglages de génération (config/lesson) : { thinkingLevel: "low" | "minimal" | "high" } — cache 60 s, lu en parallèle des autres lectures
const THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);
let lessonConfigCache = { at: 0, value: { thinkingLevel: "low" } };
async function readLessonConfig() {
  if (Date.now() - lessonConfigCache.at < 60_000) return lessonConfigCache.value;
  try {
    const d = (await db.doc("config/lesson").get()).data() || {};
    const thinkingLevel = THINKING_LEVELS.has(d.thinkingLevel) ? d.thinkingLevel : "low";
    lessonConfigCache = { at: Date.now(), value: { thinkingLevel } };
  } catch (e) { console.warn("readLessonConfig échoué:", e); lessonConfigCache.at = Date.now(); }
  return lessonConfigCache.value;
}

async function readFlags() {
  try {
    const snap = await db.doc("config/featureFlags").get();
    const d = snap.data() || {};
    return {
      enabled: d.learningPathEnabled === true,
      ratio: typeof d.learningPathRatio === "number" ? Math.min(1, Math.max(0, d.learningPathRatio)) : 1,
    };
  } catch (e) {
    console.warn("readFlags échoué:", e);
    return { enabled: false, ratio: 0 };
  }
}

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connexion requise");
  return uid;
}

// ---------------------------------------------------------------
// assignFlowVersion — une seule assignation par compte, atomique, côté serveur.
// - Champ déjà présent → renvoyé tel quel (idempotent).
// - Profil déjà onboardé sans champ → legacy, écrit pour figer (utilisateur existant, jamais tiré au sort).
// - Nouveau profil → learning_path_v1 si flag activé et tirage < ratio, sinon legacy.
// ---------------------------------------------------------------
exports.assignFlowVersion = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = requireAuth(request);
  const flags = await readFlags();
  const ref = db.doc(`users/${uid}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    if (data.flowVersion === "legacy" || data.flowVersion === "learning_path_v1") {
      return { flowVersion: data.flowVersion, assigned: false };
    }
    const isExistingUser = data.onboarded === true;
    const draw = Math.random();
    const flowVersion = !isExistingUser && flags.enabled && draw < flags.ratio ? "learning_path_v1" : "legacy";
    tx.set(ref, { flowVersion, flowAssignedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { flowVersion, assigned: true };
  });
});

// ---------------------------------------------------------------
// getLearningPathServer — vue serveur minimale (J1) : progression + état d'apprentissage.
// Les droits viennent de users/{uid}/learning/entitlement, alimenté par le webhook RevenueCat (J4).
// En attendant J4, le client passe par getAccess() comme aujourd'hui ; cette fonction sert aux tests.
// ---------------------------------------------------------------
exports.getLearningPathServer = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = requireAuth(request);
  const [progressSnap, stateSnap] = await Promise.all([
    db.collection(`users/${uid}/progress`).get(),
    db.doc(`users/${uid}/learning/state`).get(),
  ]);
  const progress = {};
  progressSnap.forEach((d) => (progress[d.id] = d.data()));
  const state = stateSnap.data() || { practiceLevel: "A2", xp: 0 };
  return { progress, state, structureVersion: structure.structureVersion };
});

// ===============================================================
// J2 — Tentatives de leçon (users/{uid}/attempts/{attemptId} + sous-collection turns)
// Le client ne peut pas écrire ces documents (règles) : tout passe par ces trois Functions.
// L'évaluation finale (finalizeAttempt) arrive en J4 ; ici on ne valide jamais rien.
// ===============================================================
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const MODALITIES = new Set(["voice", "text"]);
const SUPPORTS = new Set(["none", "hint", "model", "coaching"]);
const CRITERION_STATUSES = new Set(["not_observed", "emerging", "achieved"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
// États que le client a le droit de poser lui-même (les états terminaux "completed" / "needs_practice" sont réservés à J4)
const CLIENT_STATES = new Set(["briefing", "preparation", "conversation", "feedback", "retry", "micro_exercise", "evaluating", "paused", "ended_unvalidated"]);
const ACTIVE_CONVERSATION_STATES = new Set(["briefing", "conversation", "coaching_retry", "paused", "retry", "feedback"]);
const MAX_TEXT = 2000;

function str(v, max = MAX_TEXT) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

async function resolvePracticeLevel(uid, userData) {
  const st = await db.doc(`users/${uid}/learning/state`).get();
  const lvl = st.data()?.practiceLevel || userData?.level;
  return LEVELS.includes(lvl) ? lvl : "A2";
}

// Droits côté serveur : users/{uid}/learning/entitlement { active: bool, expiresAt?: ms } — alimenté par le webhook RevenueCat (J4).
// Tant que J4 n'est pas livré, seule la leçon découverte (isFreeDiscovery) est accessible.
async function hasEntitlement(uid) {
  const snap = await db.doc(`users/${uid}/learning/entitlement`).get();
  const d = snap.data();
  if (!d || d.active !== true) return false;
  if (typeof d.expiresAt === "number" && d.expiresAt < Date.now()) return false;
  return true;
}

// Nettoie un tour envoyé par le client : liste blanche de champs, longueurs bornées,
// observations restreintes aux critères de la variante (jamais une validation).
function sanitizeTurn(turn, variant) {
  const allowedCriteria = new Set((variant?.requiredCriteria || []).map((c) => c.id));
  const observed = Array.isArray(turn.observedCriteria)
    ? turn.observedCriteria
        .filter((o) => o && allowedCriteria.has(o.criterionId) && CRITERION_STATUSES.has(o.statusCandidate))
        .slice(0, 10)
        .map((o) => ({
          criterionId: o.criterionId,
          statusCandidate: o.statusCandidate,
          support: SUPPORTS.has(o.support) ? o.support : "none",
          confidence: CONFIDENCES.has(o.confidence) ? o.confidence : "low",
        }))
    : [];
  const pron = turn.pronunciation && typeof turn.pronunciation === "object"
    ? {
        pronScore: Number(turn.pronunciation.pronScore) || 0,
        accuracyScore: Number(turn.pronunciation.accuracyScore) || 0,
        fluencyScore: Number(turn.pronunciation.fluencyScore) || 0,
      }
    : null;
  return {
    id: str(turn.id, 64),
    index: Math.max(0, Math.floor(Number(turn.index) || 0)),
    user: str(turn.user),
    coach: str(turn.coach),
    modality: MODALITIES.has(turn.modality) ? turn.modality : "voice",
    supportUsed: SUPPORTS.has(turn.supportUsed) ? turn.supportUsed : "none",
    feedbackFr: str(turn.feedbackFr),
    correction: turn.correction && typeof turn.correction === "object" ? turn.correction : null,
    pronunciation: pron,
    observedCriteria: observed,
    at: typeof turn.at === "number" ? turn.at : Date.now(),
  };
}

// ---------------------------------------------------------------
// startOrResumeLesson({ lessonId }) → { attempt, turns, variant, resumed }
// Refus : not-found (leçon non publiée / variante absente), failed-precondition "prerequisite_not_validated",
// permission-denied "subscription_required".
// ---------------------------------------------------------------
// Ouverture parlée de la leçon : bonjour + plan de ce qu'on va travailler + première question (verbatim).
// Générée une fois à la création de la tentative, stockée dessus (briefingEn / briefingFr). Repli : modèle simple.
async function makeLessonBriefing({ variant, lesson, coachVoice, learnerName, isFirstLesson, learner = null }) {
  const who = coachIdentity(coachVoice);
  const name = learnerName ? ` ${learnerName}` : "";
  // Première question de repli : celle du catalogue, sans son « Hi, I'm Sam » (le briefing a déjà salué et présenté le coach)
  const stripGreeting = (q) => String(q || "").replace(/^\s*(hi|hello|hey)[\s,!.]*(i'?m|i am|my name is)\s+[A-Z][a-z]+[.!,]?\s*/i, "").replace(/^\s*(hi|hello|hey)[\s,!.]+/i, "").trim();
  const fallback = {
    en: `Hi${name}! ${isFirstLesson ? `I'm ${who.name}, your English coach. ` : ""}Today we'll practise: ${lesson.titleFr}.`,
    fr: `Salut${name} ! ${isFirstLesson ? `Je suis ${who.name}, ton coach d'anglais. ` : ""}Aujourd'hui on travaille : ${lesson.titleFr}.`,
    question: stripGreeting(variant.openingEn) || variant.openingEn,
  };
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const objectives = variant.requiredCriteria.map((c, i) => `${i + 1}. ${c.descriptionFr}`).join("\n");
    const res = await genWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: "Write the spoken opening." }] }],
      config: {
        systemInstruction: `You are ${who.name}, a warm English coach (${who.english}) opening a short lesson with ${learnerName || "the learner"} (level ${variant.practiceLevel}).
Lesson: "${lesson.titleFr}" — ${variant.objectiveFr || ""}. In the conversation you play: ${variant.coachRole}.
What the learner must manage to do today (in French, translate into simple English):
${objectives}
${isFirstLesson ? `This is their very first lesson: say who you are in the SAME sentence as the hello ("Hi ${learnerName || "there"}, I'm ${who.name}, your English coach.").` : "You already know each other: no self-introduction."}
Write "opening_en", what you SAY: (1) hello with their first name${isFirstLesson ? " and who you are" : ""}; (2) ONE short sentence giving the direction of the lesson in simple English for ${variant.practiceLevel} ("Today we'll practise introducing yourself: your name, your job, and a question for me."); (3) ONE short transition ("Let's start.", "Ready? Let's go."). 3 sentences maximum, about 25 to 35 words in total: it is spoken, keep it short. No question in opening_en.
Then write "question_en": the first question of the lesson, said right after as a separate message. Reformulate this reference naturally for a real conversation, same purpose, same simplicity: "${variant.openingEn}" (e.g. "What do you do?" becomes "So, what do you do for a living?"). ONE question, no greeting, no self-introduction, no name of the learner.
Rules: never say "objective", "criteria", "lesson plan". Warm, natural, no emoji.
Respond ONLY with JSON {"opening_en": "...", "opening_fr": "<French translation of opening_en>", "question_en": "..."}.`,
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: { opening_en: { type: Type.STRING }, opening_fr: { type: Type.STRING }, question_en: { type: Type.STRING } }, required: ["opening_en", "opening_fr", "question_en"] },
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    const p = JSON.parse(res.text);
    const en = typeof p.opening_en === "string" ? p.opening_en.trim() : "";
    const q = typeof p.question_en === "string" ? stripGreeting(p.question_en).slice(0, 300) : "";
    if (en.length > 20) return { en: en.replace(/\?+\s*$/, ".").slice(0, 600), fr: String(p.opening_fr || "").slice(0, 600), question: /\?\s*$/.test(q) ? q : fallback.question };
    return fallback;
  } catch (e) { console.warn("briefing fallback:", e?.message); return fallback; }
}

exports.startOrResumeLesson = onCall({ region: REGION, maxInstances: 5, secrets: [GEMINI_API_KEY], timeoutSeconds: 30 }, async (request) => {
  const uid = requireAuth(request);
  if (request.data?.warmup === true) return { ok: true }; // préchauffage depuis l'accueil : instance prête avant le tap « Reprendre »
  const { lessonId, isFirstLesson = false } = request.data || {};
  const lesson = typeof lessonId === "string" ? LESSONS.get(lessonId) : null;
  if (!lesson || !isPublished(lessonId)) throw new HttpsError("not-found", "lesson_unavailable");

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data() || {};
  // Voix : celle du profil (le client n'a plus besoin d'attendre loadProfile avant d'appeler), sinon celle envoyée
  const voice = typeof user.voice === "string" && user.voice ? user.voice : (request.data?.voice || "us-male");

  if (lesson.prerequisiteLessonId) {
    const prev = await db.doc(`users/${uid}/progress/${lesson.prerequisiteLessonId}`).get();
    if (prev.data()?.status !== "validated") throw new HttpsError("failed-precondition", "prerequisite_not_validated");
  }
  if (!lesson.isFreeDiscovery && !(await hasEntitlement(uid))) {
    throw new HttpsError("permission-denied", "subscription_required");
  }

  const practiceLevel = await resolvePracticeLevel(uid, user);
  const variant = getVariant(lessonId, practiceLevel);
  if (!variant) throw new HttpsError("not-found", "variant_missing");

  // Reprise : au plus une tentative active par leçon
  const attemptsCol = db.collection(`users/${uid}/attempts`);
  const activeSnap = await attemptsCol.where("lessonId", "==", lessonId).where("active", "==", true).limit(1).get();
  if (!activeSnap.empty) {
    const doc = activeSnap.docs[0];
    const turnsSnap = await doc.ref.collection("turns").orderBy("index").get();
    return { attempt: { ...doc.data(), id: doc.id }, turns: turnsSnap.docs.map((d) => d.data()), variant, resumed: true };
  }

  const now = Date.now();
  const ref = attemptsCol.doc();
  const briefing = await makeLessonBriefing({ variant, lesson, coachVoice: voice, learnerName: typeof user.name === "string" ? user.name.trim().slice(0, 40) : "", isFirstLesson: isFirstLesson === true, learner: learnerContextOf(user) });
  const attempt = {
    id: ref.id,
    lessonId,
    variantId: variant.id,
    contentVersion: variant.contentVersion,
    practiceLevel,
    briefingEn: briefing.en, // ouverture parlée (bonjour + direction de la leçon + première question)
    briefingFr: briefing.fr,
    firstQuestionEn: briefing.question, // première question reformulée (sans « Hi, I'm Sam » : le briefing l'a déjà dit)
    coachStyle: coachStyleOf(user), // ton du coach choisi à l'onboarding (doux / équilibré / exigeant + défi)
    learnerContext: learnerContextOf(user), // blocages, aisance, échéance déclarés à l'onboarding
    state: "briefing",
    active: true,
    modalityUsed: [],
    turnCount: 0,
    transfer: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  const progRef = db.doc(`users/${uid}/progress/${lessonId}`);
  const prog = await progRef.get();
  const batch = db.batch();
  batch.set(ref, attempt);
  if (!prog.exists) {
    batch.set(progRef, { lessonId, status: "in_progress", successfulVariantIds: [], lastAttemptId: ref.id, firstValidatedAt: null });
  } else if (prog.data().status !== "validated") {
    batch.set(progRef, { status: "in_progress", lastAttemptId: ref.id }, { merge: true });
  } else {
    batch.set(progRef, { lastAttemptId: ref.id }, { merge: true });
  }
  await batch.commit();
  return { attempt, turns: [], variant, resumed: false };
});

// ---------------------------------------------------------------
// recordLessonTurn({ attemptId, turn }) — idempotent sur turn.id (un ré-envoi écrase le même document).
// ---------------------------------------------------------------
exports.recordLessonTurn = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = requireAuth(request);
  const { attemptId, turn } = request.data || {};
  if (typeof attemptId !== "string" || !turn || typeof turn !== "object" || typeof turn.id !== "string") {
    throw new HttpsError("invalid-argument", "attemptId / turn manquants");
  }
  const ref = db.doc(`users/${uid}/attempts/${attemptId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const a = snap.data();
    if (!a || a.active !== true) throw new HttpsError("failed-precondition", "attempt_not_active");
    const clean = sanitizeTurn(turn, VARIANTS.get(a.variantId));
    tx.set(ref.collection("turns").doc(clean.id), clean);
    tx.set(
      ref,
      {
        state: "conversation",
        turnCount: Math.max(a.turnCount || 0, clean.index + 1),
        modalityUsed: FieldValue.arrayUnion(clean.modality),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  });
  return { ok: true };
});

// ---------------------------------------------------------------
// updateAttemptState({ attemptId, state, transfer? })
// - transfer (micro-exercice) : { responseId, promptVersion: "1:primary"|"1:alternative", text, modality }
// - "ended_unvalidated" clôt la tentative (active=false) sans rien valider ; "evaluating" la laisse ouverte pour J4.
// ---------------------------------------------------------------
exports.updateAttemptState = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = requireAuth(request);
  const { attemptId, state, transfer } = request.data || {};
  if (typeof attemptId !== "string" || !CLIENT_STATES.has(state)) {
    throw new HttpsError("invalid-argument", "attemptId / state invalides");
  }
  const ref = db.doc(`users/${uid}/attempts/${attemptId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const a = snap.data();
    if (!a || a.active !== true) throw new HttpsError("failed-precondition", "attempt_not_active");
    const patch = { state, updatedAt: Date.now() };
    if (state === "ended_unvalidated") patch.active = false;
    if (transfer && typeof transfer === "object") {
      patch.transfer = {
        responseId: str(transfer.responseId, 64),
        promptVersion: transfer.promptVersion === "1:alternative" ? "1:alternative" : "1:primary",
        text: str(transfer.text),
        modality: MODALITIES.has(transfer.modality) ? transfer.modality : "text",
        at: Date.now(),
      };
    }
    tx.set(ref, patch, { merge: true });
  });
  return { ok: true };
});

// ===============================================================
// J4 — Évaluation finale groupée, récompenses idempotentes, droits RevenueCat côté serveur
// ===============================================================
const XP_REWARD = { validated: 50, validated_with_support: 35, needs_practice: 10 };

// Délai maximum d'UN appel Gemini : au-delà on annule et on réessaie une fois (un appel qui pend bloquait le tour
// jusqu'au timeout de 60 s de la fonction, sans réponse du coach ni message d'erreur)
const GEMINI_ATTEMPT_TIMEOUT_MS = 22_000;
async function genWithRetry(ai, config) {
  const delays = [500, 1000];
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), GEMINI_ATTEMPT_TIMEOUT_MS);
    try {
      const call = ai.models.generateContent({ ...config, config: { ...(config.config || {}), abortSignal: ac.signal } });
      // Ceinture et bretelles : si le SDK ignorait abortSignal, la course garantit quand même la sortie
      const guard = new Promise((_, reject) => ac.signal.addEventListener("abort", () => reject(new Error("gemini_timeout")), { once: true }));
      return await Promise.race([call, guard]);
    } catch (e) {
      const msg = String(e?.message ?? e);
      const timedOut = ac.signal.aborted || /gemini_timeout|aborted|AbortError/i.test(msg);
      // Niveau de raisonnement refusé par l'API (valeur inconnue pour ce modèle) → on retombe sur "low" plutôt que d'échouer le tour
      const lvl = config?.config?.thinkingConfig?.thinkingLevel;
      if (!timedOut && lvl && lvl !== "low" && /thinking/i.test(msg)) {
        console.warn(`thinkingLevel "${lvl}" refusé, repli sur low:`, msg.slice(0, 160));
        config = { ...config, config: { ...config.config, thinkingConfig: { thinkingLevel: "low" } } };
        continue;
      }
      if (timedOut && attempt < 1) { console.warn(`Gemini sans réponse après ${GEMINI_ATTEMPT_TIMEOUT_MS} ms, nouvel essai`); continue; }
      if (!timedOut && /\b503\b|UNAVAILABLE|high demand|overloaded|try again later/i.test(msg) && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      if (timedOut) throw new HttpsError("unavailable", "coach_unavailable");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Évaluation groupée par Gemini : uniquement sur les phrases de l'apprenant (tours + micro-exercice).
async function evaluateAttempt(variant, turns, transfer) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const criteriaText = variant.requiredCriteria
    .map((c) => `- ${c.id}: ${c.descriptionFr} (e.g. "${c.exampleEn}")`)
    .join("\n");
  const turnsText = turns.length
    ? turns.map((t) => `[turn ${t.index + 1}${t.supportUsed !== "none" ? `, help used: ${t.supportUsed}` : ""}] Coach: ${t.coach}\nLearner: ${t.user}`).join("\n")
    : "(no turns)";
  const transferText = transfer?.text
    ? `Prompt (French): ${transfer.promptVersion === "1:alternative" ? variant.microExercise.alternativePromptFr : variant.microExercise.promptFr}\nExpected: ${variant.microExercise.expectedSemanticCriteria.join(" / ")}\nLearner's answer: ${transfer.text}`
    : "(none)";

  const res = await genWithRetry(ai, {
    model: "gemini-3.6-flash",
    contents: [{ role: "user", parts: [{ text: `LESSON OBJECTIVES (level ${variant.practiceLevel}):\n${criteriaText}\n\nCONVERSATION:\n${turnsText}\n\nTRANSFER EXERCISE:\n${transferText}` }] }],
    config: {
      systemInstruction: `You are an honest, kind English teacher assessing a French learner's short guided lesson. Judge ONLY what the learner actually said or wrote (never the coach's lines). For EACH objective, decide: "achieved" if the learner clearly did it at least once in understandable English (small mistakes are fine if the meaning is clear), "emerging" if attempted but incomplete or too faulty to count, "not_observed" otherwise. Give a confidence ("low"|"medium"|"high"), quote the learner's best evidence verbatim (empty string if none), and write "done_fr": a very short French sentence in the past tense, tutoiement, stating what the learner did for this objective (e.g. "Tu t'es présenté.", "Tu as relancé avec une question."); if not achieved, what remains to do (e.g. "Pose une question à ton coach."). Never mark "achieved" on a guess. Also judge the transfer exercise: "transfer_ok" true if the answer meets the expected points. Then write "summary_fr": ONE sentence EN FRANÇAIS, tutoiement, chaleureuse et concrète, qui décrit ce que la personne a réussi (pas de paragraphe, pas de liste d'erreurs). "next_focus_fr": une phrase courte en français sur le point principal à travailler, avec la bonne formulation entre guillemets s'il y a eu une vraie erreur ; chaîne vide si rien à signaler. "key_phrase_en": THE one English sentence worth remembering from this lesson: if the learner was corrected, the corrected version of their own sentence; otherwise their best correct sentence, verbatim. Never a sentence containing an error. "key_phrase_fr": its natural French translation. Respond ONLY with JSON matching the schema.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                criterion_id: { type: Type.STRING },
                status: { type: Type.STRING },
                confidence: { type: Type.STRING },
                evidence_en: { type: Type.STRING },
                done_fr: { type: Type.STRING },
              },
              required: ["criterion_id", "status", "confidence", "evidence_en", "done_fr"],
            },
          },
          transfer_ok: { type: Type.BOOLEAN },
          summary_fr: { type: Type.STRING },
          next_focus_fr: { type: Type.STRING },
          key_phrase_en: { type: Type.STRING },
          key_phrase_fr: { type: Type.STRING },
        },
        required: ["criteria", "transfer_ok", "summary_fr", "next_focus_fr", "key_phrase_en", "key_phrase_fr"],
      },
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "low" },
    },
  });
  return JSON.parse(res.text);
}

// Repli sans Gemini : meilleure observation par critère sur les tours (jamais "achieved" avec confiance basse).
function evaluateFromObservations(variant, turns) {
  const rank = { not_observed: 0, emerging: 1, achieved: 2 };
  const best = {};
  for (const c of variant.requiredCriteria) best[c.id] = { status: "not_observed", confidence: "low" };
  for (const t of turns) {
    for (const o of t.observedCriteria || []) {
      if (!(o.criterionId in best)) continue;
      const st = o.statusCandidate === "achieved" && o.confidence === "low" ? "emerging" : o.statusCandidate;
      if (rank[st] > rank[best[o.criterionId].status]) best[o.criterionId] = { status: st, confidence: o.confidence };
    }
  }
  return {
    criteria: variant.requiredCriteria.map((c) => ({ criterion_id: c.id, status: best[c.id].status, confidence: best[c.id].confidence, evidence_en: "", done_fr: c.descriptionFr })),
    transfer_ok: false,
    summary_fr: variant.fallbackFeedbackFr,
    next_focus_fr: "",
    key_phrase_en: "",
    key_phrase_fr: "",
    fallback: true,
  };
}

// ---------------------------------------------------------------
// finalizeAttempt({ attemptId }) → { kind, criteria, summaryFr, nextFocusFr, xpGained, xpTotal, chapterBadge }
// Idempotent : une tentative déjà clôturée renvoie son résultat stocké sans ré-attribuer d'XP.
// ---------------------------------------------------------------
exports.finalizeAttempt = onCall({ region: REGION, maxInstances: 5, secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  const uid = requireAuth(request);
  if (request.data?.warmup === true) return { ok: true }; // préchauffage (voir lessonTurn)
  const { attemptId } = request.data || {};
  if (typeof attemptId !== "string") throw new HttpsError("invalid-argument", "attemptId manquant");
  const tStart = Date.now();
  const ref = db.doc(`users/${uid}/attempts/${attemptId}`);
  const [snap, turnsSnap] = await Promise.all([ref.get(), ref.collection("turns").orderBy("index").get()]);
  const a = snap.data();
  if (!a) throw new HttpsError("not-found", "attempt_not_found");
  if (a.result && a.active !== true) return a.result; // déjà clôturée
  const variant = VARIANTS.get(a.variantId);
  if (!variant) throw new HttpsError("failed-precondition", "variant_missing");
  const lesson = LESSONS.get(a.lessonId);

  const turns = turnsSnap.docs.map((d) => d.data());
  if (turns.length === 0) throw new HttpsError("failed-precondition", "no_turns");
  const tRead = Date.now() - tStart;

  let evalResult;
  const tEval0 = Date.now();
  try {
    evalResult = await evaluateAttempt(variant, turns, a.transfer);
  } catch (e) {
    console.error("finalizeAttempt Gemini error", e);
    evalResult = evaluateFromObservations(variant, turns);
  }
  const evalMs = Date.now() - tEval0;

  // Décision : tous les critères "achieved" avec confiance ≥ medium → validé ; aide « modèle » utilisée → validé avec aide.
  const byId = new Map((evalResult.criteria || []).map((c) => [c.criterion_id, c]));
  // Un objectif validé pendant la conversation (coché vert à l'écran) reste validé au bilan : l'évaluation groupée
  // apporte le texte (ce que tu as réussi, phrase à retenir) mais ne peut pas rétrograder ce que l'apprenant a vu.
  const coveredInConversation = new Set(coveredFromTurns(variant, turns));
  const criteria = variant.requiredCriteria.map((c) => {
    const r = byId.get(c.id) || { status: "not_observed", confidence: "low", evidence_en: "" };
    const achieved = coveredInConversation.has(c.id) || (r.status === "achieved" && r.confidence !== "low");
    return {
      id: c.id,
      descriptionFr: c.descriptionFr,
      status: achieved ? "achieved" : r.status === "not_observed" ? "not_observed" : "emerging",
      evidenceEn: str(r.evidence_en, 300),
      doneFr: str(r.done_fr, 160) || c.descriptionFr,
    };
  });
  const allAchieved = criteria.every((c) => c.status === "achieved");
  const usedModel = turns.some((t) => t.supportUsed === "model" || t.supportUsed === "coaching");
  const kind = allAchieved ? (usedModel ? "validated_with_support" : "validated") : "needs_practice";
  const xpGained = XP_REWARD[kind];
  const now = Date.now();

  const result = {
    kind,
    criteria,
    transferOk: evalResult.transfer_ok === true,
    summaryFr: str(evalResult.summary_fr) || variant.fallbackFeedbackFr,
    nextFocusFr: str(evalResult.next_focus_fr, 300),
    keyPhraseEn: str(evalResult.key_phrase_en, 300),
    keyPhraseFr: str(evalResult.key_phrase_fr, 300),
    easierVariantHintFr: kind === "needs_practice" ? variant.easierVariantHintFr : "",
    xpGained,
    xpTotal: 0,
    chapterBadge: null,
    evaluatedBy: evalResult.fallback ? "observations" : "gemini",
    at: now,
  };

  // Écriture atomique : tentative, progression, XP et badge (idempotence garantie par active=true → false dans la transaction)
  const progRef = db.doc(`users/${uid}/progress/${a.lessonId}`);
  const stateRef = db.doc(`users/${uid}/learning/state`);
  const chapterLessonIds = [...LESSONS.values()].filter((l) => l.chapterId === lesson.chapterId).map((l) => l.id);
  const chapterProgRefs = chapterLessonIds.map((id) => db.doc(`users/${uid}/progress/${id}`));

  await db.runTransaction(async (tx) => {
    const [aSnap, pSnap, sSnap, ...cSnaps] = await Promise.all([tx.get(ref), tx.get(progRef), tx.get(stateRef), ...chapterProgRefs.map((r) => tx.get(r))]);
    const cur = aSnap.data();
    if (!cur || cur.active !== true) { result.xpGained = 0; return; } // clôturée entre-temps : pas de double récompense
    const state = sSnap.data() || {};
    const prog = pSnap.data() || { lessonId: a.lessonId, status: "in_progress", successfulVariantIds: [], firstValidatedAt: null };
    const wasValidated = prog.status === "validated";
    const badges = Array.isArray(state.badges) ? state.badges : [];

    if (kind !== "needs_practice") {
      const succ = new Set(prog.successfulVariantIds || []); succ.add(variant.id);
      tx.set(progRef, {
        lessonId: a.lessonId,
        status: "validated",
        validationKind: wasValidated && prog.validationKind === "validated" ? "validated" : kind,
        successfulVariantIds: [...succ],
        lastAttemptId: attemptId,
        firstValidatedAt: prog.firstValidatedAt ?? now,
        bestEvidenceSummaryFr: result.summaryFr,
      }, { merge: true });
    } else {
      tx.set(progRef, { lessonId: a.lessonId, status: wasValidated ? "validated" : "needs_practice", lastAttemptId: attemptId }, { merge: true });
    }

    // Badge de chapitre : toutes les leçons du chapitre validées (en comptant celle-ci)
    const validatedIds = new Set(cSnaps.filter((s) => s.data()?.status === "validated").map((s) => s.id));
    if (kind !== "needs_practice") validatedIds.add(a.lessonId);
    const chapter = CHAPTERS.get(lesson.chapterId);
    let chapterBadge = null;
    // (le chapitre découverte C00 n'a pas de badge : badgeId absent → jamais de valeur undefined écrite dans Firestore)
    if (chapter && typeof chapter.badgeId === "string" && chapterLessonIds.every((id) => validatedIds.has(id)) && !badges.includes(chapter.badgeId)) {
      chapterBadge = chapter.badgeId;
      badges.push(chapter.badgeId);
    }
    // XP : une leçon déjà validée ne rapporte plus que le bonus « pratique »
    const xp = wasValidated && kind !== "needs_practice" ? XP_REWARD.needs_practice : xpGained;
    result.xpGained = xp;
    result.xpTotal = (state.xp || 0) + xp;
    result.chapterBadge = chapterBadge;
    tx.set(stateRef, { xp: result.xpTotal, badges, practiceLevel: state.practiceLevel || a.practiceLevel, updatedAt: now }, { merge: true });

    tx.set(ref, { state: kind === "needs_practice" ? "needs_practice" : "completed", active: false, result, updatedAt: now }, { merge: true });
    writeReviewCards(tx, uid, reviewCardsForResult(attemptId, a.lessonId, turns, result, now)); // matière du point du jour
  });
  console.log("finalizeAttempt timings", JSON.stringify({ read_ms: tRead, eval_ms: evalMs, total_ms: Date.now() - tStart, evaluatedBy: result.evaluatedBy }));

  return result;
});

// ---------------------------------------------------------------
// lessonTurn({ attemptId, audioBase64? | text, mimeType?, voice?, speakingRate?, clientTurnId? })
// Un tour de conversation de leçon, piloté par les objectifs : le coach ne pose une question que pour un
// critère restant, propose la fin dès que tout est couvert, et peut glisser UN conseil (reprise max une fois).
// Persiste le tour et l'état de la tentative côté serveur.
// ---------------------------------------------------------------
const NEXT_ACTIONS = new Set(["ask_targeted_question", "coach_retry", "request_clarification", "propose_completion"]);

function coveredFromTurns(variant, turns) {
  const covered = new Set();
  for (const t of turns) {
    for (const o of t.observedCriteria || []) {
      if (o.statusCandidate === "achieved" && o.confidence !== "low") covered.add(o.criterionId);
    }
  }
  return [...covered].filter((id) => variant.requiredCriteria.some((c) => c.id === id));
}

// ---------------------------------------------------------------
// Cartes de révision (point du jour) : users/{uid}/learning/review/items/{id} (sous learning → lecture seule côté client, purgé avec le reste)
// Créées à la clôture d'une leçon : 1 phrase à retenir, 1 point à travailler, jusqu'à 2 corrections. Idempotent par id.
// Espacement : nextDueAt = lastSeenAt + [1, 3, 7, 14] j selon successCount ; 3 réussites → acquise (plus tirée).
// ---------------------------------------------------------------
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14];
const DAY_MS = 24 * 3600 * 1000;
function reviewCardsForResult(attemptId, lessonId, turns, result, now) {
  const cards = [];
  const push = (kind, phraseEn, noteFr, idx) => {
    const phrase = String(phraseEn || "").trim();
    if (!phrase || phrase.length > 200) return;
    cards.push({ id: `${attemptId}_${kind}${idx != null ? `_${idx}` : ""}`, kind, phraseEn: phrase, noteFr: String(noteFr || "").slice(0, 200), fromLessonId: lessonId, fromAttemptId: attemptId,
      createdAt: now, lastSeenAt: null, seenCount: 0, successCount: 0, nextDueAt: now + DAY_MS, acquired: false });
  };
  push("key_phrase", result.keyPhraseEn, result.keyPhraseFr);
  if (result.nextFocusFr) {
    // Le point à travailler est en français ; on en extrait la formulation anglaise entre guillemets s'il y en a une
    const m = /[«"“]([^»"”]{3,120})[»"”]/.exec(result.nextFocusFr);
    if (m && /[a-zA-Z]/.test(m[1])) push("focus", m[1], result.nextFocusFr);
  }
  let n = 0;
  for (const t of turns) {
    if (n >= 2) break;
    if (t.coaching && t.coaching.targetPhraseEn) { push("correction", t.coaching.targetPhraseEn, t.coaching.explanationFr, n); n++; }
  }
  return cards;
}
function writeReviewCards(batchOrTx, uid, cards) {
  for (const c of cards) batchOrTx.set(db.doc(`users/${uid}/learning/review/items/${c.id}`), c, { merge: true });
}

// Nombre minimum de réponses de l'apprenant avant de pouvoir conclure, même si tout est couvert (sinon la leçon tient en 3 échanges secs)
const MIN_TURNS_BEFORE_CLOSING = 5;
const minTurnsOf = (variant) => Number(variant.minUsefulTurns) || MIN_TURNS_BEFORE_CLOSING;

// Style de coaching choisi à l'onboarding (profil users/{uid}) : feedbackStyle soft|balanced|strict, challenge true|false
function coachStyleOf(user) {
  const feedback = ["soft", "balanced", "strict"].includes(user?.feedbackStyle) ? user.feedbackStyle : "balanced";
  const challenge = user?.challenge !== false;
  return { feedback, challenge };
}
// Ce que l'apprenant a dit de lui à l'onboarding (blocages, aisance, échéance) : contexte pour le briefing et les leçons
const BLOCKER_EN = { words: "struggles to find words", mistakes: "is afraid of making mistakes", dare: "understands but does not dare to speak", accent: "feels self-conscious about their accent", natives: "panics when talking to native speakers", listening: "has trouble understanding spoken English, especially when people speak fast" };
const DEADLINE_EN = { interview: "a job interview", trip: "a trip", job: "starting a new job", exam: "an exam" };
const HORIZON_EN = { "1m": "in less than a month", "3m": "in 1 to 3 months", "6m": "in 3 to 6 months" };
function learnerContextOf(user) {
  const blockers = Array.isArray(user?.blockers) ? user.blockers.filter((b) => BLOCKER_EN[b]).slice(0, 3) : [];
  const confidence = Number.isInteger(user?.confidence) && user.confidence >= 1 && user.confidence <= 5 ? user.confidence : null;
  const kind = user?.deadline?.kind && DEADLINE_EN[user.deadline.kind] ? user.deadline.kind : null;
  const horizon = kind && HORIZON_EN[user?.deadline?.horizon] ? user.deadline.horizon : null;
  return { blockers, confidence, deadline: kind ? { kind, horizon } : null };
}
function learnerContextLines(ctx) {
  if (!ctx) return "";
  const lines = [];
  if (ctx.blockers?.length) lines.push(`- Main blockers they named: ${ctx.blockers.map((b) => BLOCKER_EN[b]).join("; ")}. The FIRST time you give a coaching card in this lesson, open explanation_fr with one short reassuring clause about that blocker (e.g. "Se tromper ici, c'est normal :" / "Tu as cherché tes mots, c'est le but :"), then the explanation.`);
  if (ctx.confidence) lines.push(`- Self-rated speaking confidence: ${ctx.confidence}/5${ctx.confidence <= 2 ? " (very nervous: reassure, slow down, celebrate every attempt)" : ctx.confidence >= 4 ? " (comfortable: you can be a bit more demanding)" : ""}.`);
  if (ctx.deadline) lines.push(`- They are preparing ${DEADLINE_EN[ctx.deadline.kind]}${ctx.deadline.horizon ? ` ${HORIZON_EN[ctx.deadline.horizon]}` : ""}: when natural, connect the lesson to it.`);
  return lines.length ? `WHAT THE LEARNER TOLD YOU ABOUT THEMSELVES (use it with tact, never recite it back as a list):
${lines.join("\n")}
` : "";
}

function coachStyleRules(style) {
  const s = style || { feedback: "balanced", challenge: true };
  const feedback =
    s.feedback === "soft" ? "COACHING STYLE: gentle. Encourage first. Only give a \"coaching\" card for an error that blocks understanding; let small slips go. Never more than one correction per reply, and prefer requires_retry=false."
    : s.feedback === "strict" ? "COACHING STYLE: demanding (the learner asked for it). Point out every error that matters (grammar, word choice, missing words), one per reply, with a precise correction. Use the coaching retry whenever a useful error appears. Stay kind, but do not let mistakes slide."
    : "COACHING STYLE: balanced. Correct what matters for being understood or sounding natural; ignore tiny slips. One point per reply.";
  const challenge = s.challenge
    ? "When the learner answers comfortably, you may ask one slightly harder follow-up (one notch above their level) to stretch them."
    : "Stay strictly at the learner's level: never raise the difficulty, consolidate instead.";
  return `${feedback} ${challenge}`;
}

function buildLessonSystemPrompt(variant, state, isText, voice = "us-male", style = null, learner = null) {
  const criteriaLines = variant.requiredCriteria
    .map((c) => `  - ${c.id} [${state.covered.includes(c.id) ? "COVERED" : "remaining"}]: ${c.descriptionFr} (e.g. "${c.exampleEn}")`)
    .join("\n");
  const asked = state.askedQuestions.length ? state.askedQuestions.map((q) => `  - "${q}"`).join("\n") : "  (none yet)";
  const followUps = variant.followUpsEn.filter((q) => !state.askedQuestions.includes(q)).map((q) => `  - "${q}"`).join("\n") || "  (all used — write a new, different one)";
  const who = coachIdentity(voice);
  return `You are ${who.name}, a warm English coach who speaks ${who.english}. In the conversation you play: ${variant.coachRole}. The learner plays: ${variant.userRole}. Learner level: ${variant.practiceLevel} — keep your English simple and natural for that level, 1 to 2 short sentences per reply, ONE question at a time. The learner is French and hesitant: be kind, never condescending. You already said hello and introduced yourself when the lesson started: never introduce yourself again, never restart with "Hi".
${coachStyleRules(style)}
${learnerContextLines(learner)}${isText ? "The learner TYPED their answer (do not comment on pronunciation)." : "The learner's answer is in the attached audio. First transcribe it verbatim in \"transcript\" (keep their mistakes). If the audio has no intelligible speech, set transcript to \"\" exactly and never invent words."}

LESSON OBJECTIVES (the only thing that matters — each question you ask must serve a REMAINING objective):
${criteriaLines}

QUESTIONS YOU ALREADY ASKED (never ask these again, nor a rephrasing of them):
${asked}
Suggested follow-ups still unused (use each at most once, only if it serves a remaining objective):
${followUps}

AFTER READING THE LEARNER'S ANSWER, decide:
1. "observed_criteria": for EACH objective, {criterion_id, status, confidence} judged on THIS answer only. "achieved" = clearly done in understandable English (small mistakes allowed if the meaning is clear); "emerging" = attempted but incomplete; "not_observed" otherwise. Never "achieved" on a guess. One answer may achieve several objectives at once.
2. "next_action":
   - "propose_completion" ONLY if, counting this answer, ALL objectives are covered AND closing is allowed (${state.canClose ? "closing IS allowed now" : `NOT YET: this is answer ${state.turnNumber} of at least ${state.minTurns} — keep the conversation going even if every objective is covered`}): "reply_en" reacts briefly to what the learner just said, then a short warm goodbye. No question, no summary of the lesson, no "great job on your objectives".
   - if every objective is covered but closing is not allowed yet: react to the learner's answer and ask ONE natural follow-up that builds on something THEY said (same simple level). "target_criterion_id" null.
   - "request_clarification" if the answer is unintelligible or off-topic: ask gently to repeat or rephrase, without asserting a mistake.
   - "coach_retry" ONLY if ${state.coachingUsed ? "NEVER (the one allowed coaching retry was already used — choose another action)" : "the answer contains ONE error worth fixing right now AND the meaning is clear: give a coaching card and invite the learner to say the corrected sentence. Use it at most once per lesson, for a useful point, not for a tiny slip."}
   - otherwise "ask_targeted_question": a natural acknowledgement + ONE new question aimed at a remaining objective ("target_criterion_id").
   Conversation style: you are a person chatting, not a teacher running a checklist. React to the content of what the learner said (one short genuine reaction) before your question. Never ask "What would you like to know about me?" or "Do you have any questions?". If a remaining objective needs the LEARNER to ask a question, create the opening instead: share one concrete detail about yourself (where you live, your job, a hobby) and stop there — a natural pause invites a question; if the learner still doesn't ask on the next turn, nudge once, lightly: "You can ask me something too, if you like."
3. "coaching": null, or {explanation_fr, target_phrase_en, requires_retry, reason} when there is a real error worth teaching (also allowed with ask_targeted_question / propose_completion as a side note with requires_retry=false). explanation_fr: ONE short French sentence (tutoiement) explaining the point, no absolute false rules (e.g. "love to read" is also correct — never say -ing is mandatory). target_phrase_en: the learner's own sentence, corrected, natural, same meaning (do not pluralise or change meaning by default). If the learner says you already asked something, acknowledge it briefly and move on.
Respond ONLY with JSON matching the schema.`;
}

exports.lessonTurn = onCall({ region: REGION, maxInstances: 5, secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  const uid = requireAuth(request);
  // Préchauffage : appelé par l'app à l'ouverture de la mission pour que l'instance (et ses modules) soit prête au premier tour
  if (request.data?.warmup === true) return { ok: true };
  const { attemptId, audioBase64 = null, mimeType = "audio/mp4", text = null, voice = "us-male", speakingRate = 0.95, clientTurnId = null, audioFormat = "mp3" } = request.data || {};
  const wantPcm = audioFormat === "pcm24k"; // coach vidéo : segments PCM 16 bits 24 kHz pour LiveAvatar (lisibles aussi en local via un en-tête WAV)
  if (typeof attemptId !== "string") throw new HttpsError("invalid-argument", "attemptId manquant");
  const isText = typeof text === "string" && text.trim().length > 0;
  if (!isText && (typeof audioBase64 !== "string" || !audioBase64)) throw new HttpsError("invalid-argument", "audio ou texte manquant");
  if (!isText && audioBase64.length > MAX_AUDIO_BASE64_LENGTH) throw new HttpsError("invalid-argument", "Audio trop long");
  if (isText && text.length > 2000) throw new HttpsError("invalid-argument", "Texte trop long");

  const tStart = Date.now();
  const ref = db.doc(`users/${uid}/attempts/${attemptId}`);
  const [snap, turnsSnap, genCfg] = await Promise.all([ref.get(), ref.collection("turns").orderBy("index").get(), readLessonConfig()]);
  const a = snap.data();
  if (!a || a.active !== true || !ACTIVE_CONVERSATION_STATES.has(a.state)) throw new HttpsError("failed-precondition", "attempt_not_active");
  const variant = VARIANTS.get(a.variantId);
  if (!variant) throw new HttpsError("failed-precondition", "variant_missing");

  const turns = turnsSnap.docs.map((d) => d.data());
  const tRead = Date.now() - tStart;
  // Idempotence : même clientTurnId déjà traité (double tap, retry réseau) → renvoyer le tour stocké (sans audio)
  if (clientTurnId) {
    const dup = turns.find((t) => t.clientTurnId === clientTurnId);
    if (dup && dup.response) return dup.response;
  }
  const index = turns.length;
  const atCap = index + 1 >= variant.maxUsefulTurns;
  const minTurns = minTurnsOf(variant);
  const state = {
    covered: coveredFromTurns(variant, turns),
    askedQuestions: [variant.openingEn, ...turns.map((t) => t.coach).filter((c) => c && c.includes("?"))],
    coachingUsed: a.coachingUsed === true,
    turnNumber: index + 1,
    minTurns,
    canClose: atCap || index + 1 >= minTurns,
  };

  const historyText = [`You: ${variant.openingEn}`, ...turns.map((t) => `Learner: ${t.user}\nYou: ${t.coach}`)].join("\n");
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const parts = isText
    ? [{ text: `Conversation so far:\n${historyText}\n\nThe learner's new written answer:\n"${text.trim()}"` }]
    : [{ text: `Conversation so far:\n${historyText}\n\nThe learner's new spoken answer is in the attached audio.` }, { inlineData: { mimeType, data: audioBase64 } }];

  let parsed;
  const tGemini0 = Date.now();
  try {
    const res = await genWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: buildLessonSystemPrompt(variant, state, isText, voice, a.coachStyle || null, a.learnerContext || null),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcript: { type: Type.STRING },
            reply_en: { type: Type.STRING },
            next_action: { type: Type.STRING },
            target_criterion_id: { type: Type.STRING },
            observed_criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { criterion_id: { type: Type.STRING }, status: { type: Type.STRING }, confidence: { type: Type.STRING } },
                required: ["criterion_id", "status", "confidence"],
              },
            },
            coaching: {
              type: Type.OBJECT,
              nullable: true,
              properties: {
                explanation_fr: { type: Type.STRING },
                target_phrase_en: { type: Type.STRING },
                requires_retry: { type: Type.BOOLEAN },
                reason: { type: Type.STRING },
              },
              required: ["explanation_fr", "target_phrase_en", "requires_retry", "reason"],
            },
          },
          required: ["transcript", "reply_en", "next_action", "observed_criteria"],
        },
        temperature: 0.6,
        thinkingConfig: { thinkingLevel: genCfg.thinkingLevel }, // config/lesson.thinkingLevel (défaut low)
      },
    });
    parsed = JSON.parse(res.text);
  } catch (e) {
    console.error("lessonTurn Gemini error", e);
    throw new HttpsError("internal", "coach_unavailable");
  }

  const transcript = isText ? text.trim() : str(parsed.transcript);
  if (!transcript) {
    // Rien d'intelligible : pas de tour enregistré, le client affiche une invitation à réessayer
    return { heardNothing: true, reply_en: str(parsed.reply_en) || "Sorry, I didn't catch that — could you say it again?", reply_fr: "", replyAudioBase64: null };
  }

  const geminiMs = Date.now() - tGemini0;

  // --- Contrôles serveur sur la sortie du modèle ---
  const allowed = new Set(variant.requiredCriteria.map((c) => c.id));
  const observed = (Array.isArray(parsed.observed_criteria) ? parsed.observed_criteria : [])
    .filter((o) => o && allowed.has(o.criterion_id) && CRITERION_STATUSES.has(o.status))
    .map((o) => ({ criterionId: o.criterion_id, statusCandidate: o.status, support: a.state === "coaching_retry" ? "coaching" : "none", confidence: CONFIDENCES.has(o.confidence) ? o.confidence : "low" }));
  const coveredNow = new Set(state.covered);
  for (const o of observed) if (o.statusCandidate === "achieved" && o.confidence !== "low") coveredNow.add(o.criterionId);
  const allCovered = variant.requiredCriteria.every((c) => coveredNow.has(c.id));

  const coaching = parsed.coaching && typeof parsed.coaching === "object" && str(parsed.coaching.target_phrase_en)
    ? { explanationFr: str(parsed.coaching.explanation_fr, 300), targetPhraseEn: str(parsed.coaching.target_phrase_en, 300), requiresRetry: parsed.coaching.requires_retry === true, reason: str(parsed.coaching.reason, 120) }
    : null;
  let nextAction = NEXT_ACTIONS.has(parsed.next_action) ? parsed.next_action : "ask_targeted_question";
  if (coaching && state.coachingUsed) coaching.requiresRetry = false; // une seule reprise par leçon
  if (nextAction === "coach_retry" && (!coaching || !coaching.requiresRetry)) nextAction = allCovered ? "propose_completion" : "ask_targeted_question";
  if (allCovered && nextAction === "ask_targeted_question" && state.canClose) nextAction = "propose_completion";
  if (nextAction === "propose_completion" && !state.canClose) nextAction = "ask_targeted_question"; // trop tôt : la conversation continue
  if (atCap && nextAction !== "coach_retry") nextAction = "propose_completion"; // plafond : conclusion accompagnée, jamais de nouvelle question
  if (nextAction !== "coach_retry" && coaching) coaching.requiresRetry = false;
  const replyEn = str(parsed.reply_en, 500);
  const targetCriterionId = allowed.has(parsed.target_criterion_id) ? parsed.target_criterion_id : null;

  // --- Audio : uniquement la réplique du coach (voix choisie par l'utilisateur).
  // Le conseil n'est plus lu : la carte s'affiche, l'apprenant la lit, « Écouter » reste disponible à la demande.
  // Les champs coachingAudio*/coachingPcm* restent dans la réponse (null) pour les versions déjà installées.
  const v = VOICES[voice] || VOICES["us-male"];
  let replyAudioBase64 = null, coachingAudioFrBase64 = null, coachingAudioEnBase64 = null;
  let replyPcmChunks = null, coachingFrPcmChunks = null, coachingEnPcmChunks = null;
  const tTts0 = Date.now();
  const synth = wantPcm ? require("./liveAvatar")._internal.synthesizePcmChunks : synthesize;
  const ttsPromise = (replyEn ? synth(replyEn, v, speakingRate) : Promise.resolve(null))
    .then((r) => { if (wantPcm) replyPcmChunks = r; else replyAudioBase64 = r; })
    .catch((e) => { console.error("lessonTurn TTS error", e); }); // l'écrit reste disponible

  const now = Date.now();
  const response = {
    turnIndex: index,
    transcript,
    reply_en: replyEn,
    reply_fr: "", // traduction à la demande (bouton « Traduire » → translateText), plus générée à chaque tour
    hard_words: [],
    nextAction,
    targetCriterionId,
    coaching,
    observedCriteria: observed,
    coveredCriteria: [...coveredNow],
    allCovered,
    atCap,
    // Échanges restants avant la conclusion (après celui-ci) : min. de tours, borné par le plafond. null tant que tout n'est pas couvert.
    closingIn: nextAction === "propose_completion" ? 0 : allCovered ? Math.max(0, Math.min(minTurns, variant.maxUsefulTurns) - (index + 1)) : null,
    minTurns,
    replyAudioBase64,
    coachingAudioFrBase64,
    coachingAudioEnBase64,
    replyPcmChunks,
    coachingFrPcmChunks,
    coachingEnPcmChunks,
  };
  const turnDoc = {
    id: `t${String(index).padStart(2, "0")}`,
    index,
    clientTurnId: clientTurnId ? str(clientTurnId, 64) : null,
    user: transcript,
    coach: replyEn,
    modality: isText ? "text" : "voice",
    supportUsed: a.state === "coaching_retry" ? "coaching" : "none",
    feedbackFr: coaching ? coaching.explanationFr : "",
    correction: coaching ? { has_errors: true, targetPhraseEn: coaching.targetPhraseEn } : null,
    pronunciation: null,
    observedCriteria: observed,
    nextAction,
    targetCriterionId,
    coaching,
    response: { ...response, replyAudioBase64: null, coachingAudioFrBase64: null, coachingAudioEnBase64: null, replyPcmChunks: null, coachingFrPcmChunks: null, coachingEnPcmChunks: null },
    at: now,
  };
  const newState = nextAction === "propose_completion" ? "validating" : nextAction === "coach_retry" ? "coaching_retry" : "conversation";
  const batch = db.batch();
  batch.set(ref.collection("turns").doc(turnDoc.id), turnDoc);
  batch.set(ref, {
    state: newState,
    turnCount: index + 1,
    modalityUsed: FieldValue.arrayUnion(turnDoc.modality),
    coachingUsed: a.coachingUsed === true || nextAction === "coach_retry",
    coveredCriteria: [...coveredNow],
    updatedAt: now,
  }, { merge: true });
  // TTS et écriture Firestore en parallèle (le tour stocké ne contient pas l'audio)
  await Promise.all([ttsPromise, batch.commit()]);
  const ttsMs = Date.now() - tTts0;
  response.replyAudioBase64 = replyAudioBase64;
  response.replyPcmChunks = replyPcmChunks;
  response.timings = { read_ms: tRead, gemini_ms: geminiMs, tts_db_ms: ttsMs, total_ms: Date.now() - tStart, pcm: wantPcm, text: isText };
  console.log("lessonTurn timings", JSON.stringify(response.timings));
  return response;
});

// ---------------------------------------------------------------
// Droits RevenueCat → users/{uid}/learning/entitlement { active, expiresAt, productId, source, updatedAt }
// ---------------------------------------------------------------
async function writeEntitlement(uid, data) {
  await db.doc(`users/${uid}/learning/entitlement`).set({ ...data, updatedAt: Date.now() }, { merge: true });
}

// Webhook RevenueCat (POST). Dans le dashboard RevenueCat : Integrations → Webhooks → URL de cette Function,
// en-tête Authorization = valeur du secret REVENUECAT_WEBHOOK_AUTH. App User ID = uid Firebase (Purchases.logIn(uid) côté app).
exports.revenuecatWebhook = onRequest({ region: REGION, maxInstances: 5, secrets: [REVENUECAT_WEBHOOK_AUTH] }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("method_not_allowed"); return; }
  const expected = REVENUECAT_WEBHOOK_AUTH.value();
  if (!expected || req.get("authorization") !== expected) { res.status(401).send("unauthorized"); return; }
  const ev = req.body?.event;
  if (!ev || typeof ev.app_user_id !== "string") { res.status(400).send("bad_event"); return; }
  const uid = ev.app_user_id;
  // Les ID anonymes RevenueCat ($RCAnonymousID:…) ne correspondent à aucun utilisateur Firebase : ignorés (l'app fait logIn(uid)).
  if (uid.startsWith("$RCAnonymousID")) { res.status(200).send("ignored_anonymous"); return; }
  const ents = Array.isArray(ev.entitlement_ids) ? ev.entitlement_ids : [];
  const concernsPro = ents.length === 0 || ents.includes(RC_ENTITLEMENT_ID);
  if (!concernsPro) { res.status(200).send("ignored_entitlement"); return; }
  const expiresAt = typeof ev.expiration_at_ms === "number" ? ev.expiration_at_ms : null;
  let active;
  switch (ev.type) {
    case "INITIAL_PURCHASE": case "RENEWAL": case "UNCANCELLATION": case "PRODUCT_CHANGE": case "NON_RENEWING_PURCHASE": case "TRANSFER":
      active = expiresAt === null || expiresAt > Date.now(); break;
    case "CANCELLATION": case "BILLING_ISSUE": case "SUBSCRIPTION_PAUSED":
      active = expiresAt !== null && expiresAt > Date.now(); break; // reste actif jusqu'à la fin de la période payée
    case "EXPIRATION":
      active = false; break;
    default:
      res.status(200).send("ignored_type"); return;
  }
  try {
    await writeEntitlement(uid, { active, expiresAt, productId: ev.product_id || null, source: "webhook", lastEvent: ev.type, lastEventAt: ev.event_timestamp_ms || Date.now() });
    res.status(200).send("ok");
  } catch (e) {
    console.error("revenuecatWebhook write error", e);
    res.status(500).send("error");
  }
});

// Vérification à la demande (après un achat, ou si le webhook n'est pas encore passé) : interroge l'API REST RevenueCat
// avec la clé secrète et met à jour learning/entitlement. Appelée par l'app juste après onPurchased.
exports.syncEntitlement = onCall({ region: REGION, maxInstances: 5, secrets: [REVENUECAT_API_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const key = REVENUECAT_API_KEY.value();
  if (!key) throw new HttpsError("failed-precondition", "revenuecat_key_missing");
  const resp = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    console.error("syncEntitlement RevenueCat", resp.status, await resp.text().catch(() => ""));
    throw new HttpsError("unavailable", "revenuecat_unavailable");
  }
  const body = await resp.json();
  const ent = body?.subscriber?.entitlements?.[RC_ENTITLEMENT_ID];
  const expiresAt = ent?.expires_date ? Date.parse(ent.expires_date) : null;
  const active = !!ent && (expiresAt === null || expiresAt > Date.now());
  await writeEntitlement(uid, { active, expiresAt, productId: ent?.product_identifier || null, source: "sync" });
  return { active, expiresAt };
});

// ---------------------------------------------------------------
// purgeLearningData() — suppression de compte : efface les sous-collections que le client n'a pas le droit d'écrire
// (attempts + turns, progress, learning, drafts). Appelée par deleteAccount() avant la suppression du compte Auth.
// ---------------------------------------------------------------
async function deleteCollection(ref) {
  const snap = await ref.get();
  for (const d of snap.docs) {
    const subs = await d.ref.listCollections();
    for (const sc of subs) await deleteCollection(sc);
    await d.ref.delete();
  }
}
// ---------------------------------------------------------------
// awardXp({ source: "exercise" | "scene", key, dateKey }) — XP des exercices du jour et des scènes.
// Barème fixe et plafonds journaliers côté serveur ; idempotent par (jour, source, clé).
// Journal : users/{uid}/learning/xp/ledger/{dateKey}_{source}_{key}  ·  compteurs : users/{uid}/learning/xp/days/{dateKey}
// ---------------------------------------------------------------
const XP_RULES = {
  exercise: { xp: 5, maxPerDay: 3 },   // écoute, lecture, traduction : 5 XP chacun, 15 max/jour
  scene: { xp: 15, maxPerDay: 2 },     // scène terminée (débrief affiché) : 15 XP, 2 max/jour
};
exports.awardXp = onCall({ region: REGION, maxInstances: 5, timeoutSeconds: 20 }, async (request) => {
  const uid = requireAuth(request);
  const { source, key, dateKey } = request.data || {};
  const rule = XP_RULES[source];
  if (!rule) throw new HttpsError("invalid-argument", "source inconnue");
  if (typeof key !== "string" || !key || key.length > 80) throw new HttpsError("invalid-argument", "key invalide");
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new HttpsError("invalid-argument", "dateKey invalide");
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, "_");
  const ledgerRef = db.doc(`users/${uid}/learning/xp/ledger/${dateKey}_${source}_${safeKey}`);
  const dayRef = db.doc(`users/${uid}/learning/xp/days/${dateKey}`);
  const stateRef = db.doc(`users/${uid}/learning/state`);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const [lSnap, dSnap, sSnap] = await Promise.all([tx.get(ledgerRef), tx.get(dayRef), tx.get(stateRef)]);
    if (lSnap.exists) return { xpGained: 0, xpTotal: sSnap.data()?.xp || 0, reason: "duplicate" };
    const day = dSnap.data() || {};
    const doneToday = Number(day[source]) || 0;
    if (doneToday >= rule.maxPerDay) {
      tx.set(ledgerRef, { source, key: safeKey, xp: 0, at: now, capped: true });
      return { xpGained: 0, xpTotal: sSnap.data()?.xp || 0, reason: "daily_cap" };
    }
    const xpTotal = (sSnap.data()?.xp || 0) + rule.xp;
    tx.set(ledgerRef, { source, key: safeKey, xp: rule.xp, at: now });
    tx.set(dayRef, { [source]: doneToday + 1, updatedAt: now }, { merge: true });
    tx.set(stateRef, { xp: xpTotal, updatedAt: now }, { merge: true });
    return { xpGained: rule.xp, xpTotal, reason: "ok" };
  });
});

exports.purgeLearningData = onCall({ region: REGION, maxInstances: 5, timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  for (const sub of ["attempts", "progress", "learning", "drafts"]) {
    try { await deleteCollection(db.collection(`users/${uid}/${sub}`)); }
    catch (e) { console.error(`purge ${sub} échouée`, e); throw new HttpsError("internal", `purge_${sub}_failed`); }
  }
  return { ok: true };
});

// Exposé hors de la vue du chargeur Firebase
Object.defineProperty(module.exports, "_internal", {
  value: { db, LESSONS, CHAPTERS, VARIANTS, getVariant, isPublished, readFlags, requireAuth, hasEntitlement,
    // partagé avec dailyTalk.js
    VOICES, FR_VOICE, refreshVoices, synthesize, coachIdentity, genWithRetry, MAX_AUDIO_BASE64_LENGTH, REVIEW_INTERVALS_DAYS, DAY_MS, readLessonConfig },
  enumerable: false,
});
