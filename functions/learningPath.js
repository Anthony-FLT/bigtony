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
const VOICES = {
  "us-male":   { languageCode: "en-US", name: "en-US-Neural2-D" },
  "us-female": { languageCode: "en-US", name: "en-US-Neural2-F" },
  "uk-male":   { languageCode: "en-GB", name: "en-GB-Neural2-B" },
  "uk-female": { languageCode: "en-GB", name: "en-GB-Neural2-A" },
};
const FR_VOICE = { languageCode: "fr-FR", name: "fr-FR-Neural2-B" };
const ttsClient = new textToSpeech.TextToSpeechClient();
async function synthesize(text, voice, rate) {
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
exports.startOrResumeLesson = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = requireAuth(request);
  const { lessonId } = request.data || {};
  const lesson = typeof lessonId === "string" ? LESSONS.get(lessonId) : null;
  if (!lesson || !isPublished(lessonId)) throw new HttpsError("not-found", "lesson_unavailable");

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data() || {};

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
  const attempt = {
    id: ref.id,
    lessonId,
    variantId: variant.id,
    contentVersion: variant.contentVersion,
    practiceLevel,
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

async function genWithRetry(ai, config) {
  const delays = [500, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(config);
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (/\b503\b|UNAVAILABLE|high demand|overloaded|try again later/i.test(msg) && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw e;
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
      systemInstruction: `You are an honest, kind English teacher assessing a French learner's short guided lesson. Judge ONLY what the learner actually said or wrote (never the coach's lines). For EACH objective, decide: "achieved" if the learner clearly did it at least once in understandable English (small mistakes are fine if the meaning is clear), "emerging" if attempted but incomplete or too faulty to count, "not_observed" otherwise. Give a confidence ("low"|"medium"|"high"), quote the learner's best evidence verbatim (empty string if none), and write "done_fr": a very short French sentence in the past tense, tutoiement, stating what the learner did for this objective (e.g. "Tu t'es présenté.", "Tu as relancé avec une question."); if not achieved, what remains to do (e.g. "Pose une question à Sam."). Never mark "achieved" on a guess. Also judge the transfer exercise: "transfer_ok" true if the answer meets the expected points. Then write "summary_fr": ONE sentence EN FRANÇAIS, tutoiement, chaleureuse et concrète, qui décrit ce que la personne a réussi (pas de paragraphe, pas de liste d'erreurs). "next_focus_fr": une phrase courte en français sur le point principal à travailler, avec la bonne formulation entre guillemets s'il y a eu une vraie erreur ; chaîne vide si rien à signaler. "key_phrase_en": THE one English sentence worth remembering from this lesson: if the learner was corrected, the corrected version of their own sentence; otherwise their best correct sentence, verbatim. Never a sentence containing an error. "key_phrase_fr": its natural French translation. Respond ONLY with JSON matching the schema.`,
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
  const { attemptId } = request.data || {};
  if (typeof attemptId !== "string") throw new HttpsError("invalid-argument", "attemptId manquant");
  const ref = db.doc(`users/${uid}/attempts/${attemptId}`);
  const snap = await ref.get();
  const a = snap.data();
  if (!a) throw new HttpsError("not-found", "attempt_not_found");
  if (a.result && a.active !== true) return a.result; // déjà clôturée
  const variant = VARIANTS.get(a.variantId);
  if (!variant) throw new HttpsError("failed-precondition", "variant_missing");
  const lesson = LESSONS.get(a.lessonId);

  const turnsSnap = await ref.collection("turns").orderBy("index").get();
  const turns = turnsSnap.docs.map((d) => d.data());
  if (turns.length === 0) throw new HttpsError("failed-precondition", "no_turns");

  let evalResult;
  try {
    evalResult = await evaluateAttempt(variant, turns, a.transfer);
  } catch (e) {
    console.error("finalizeAttempt Gemini error", e);
    evalResult = evaluateFromObservations(variant, turns);
  }

  // Décision : tous les critères "achieved" avec confiance ≥ medium → validé ; aide « modèle » utilisée → validé avec aide.
  const byId = new Map((evalResult.criteria || []).map((c) => [c.criterion_id, c]));
  const criteria = variant.requiredCriteria.map((c) => {
    const r = byId.get(c.id) || { status: "not_observed", confidence: "low", evidence_en: "" };
    const achieved = r.status === "achieved" && r.confidence !== "low";
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
    if (chapter && chapterLessonIds.every((id) => validatedIds.has(id)) && !badges.includes(chapter.badgeId)) {
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
  });

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

function buildLessonSystemPrompt(variant, state, isText) {
  const criteriaLines = variant.requiredCriteria
    .map((c) => `  - ${c.id} [${state.covered.includes(c.id) ? "COVERED" : "remaining"}]: ${c.descriptionFr} (e.g. "${c.exampleEn}")`)
    .join("\n");
  const asked = state.askedQuestions.length ? state.askedQuestions.map((q) => `  - "${q}"`).join("\n") : "  (none yet)";
  const followUps = variant.followUpsEn.filter((q) => !state.askedQuestions.includes(q)).map((q) => `  - "${q}"`).join("\n") || "  (all used — write a new, different one)";
  return `You are Sam, a warm English coach. In the conversation you play: ${variant.coachRole}. The learner plays: ${variant.userRole}. Learner level: ${variant.practiceLevel} — keep your English simple and natural for that level, 1 to 2 short sentences per reply, ONE question at a time. The learner is French and hesitant: be kind, never condescending.
${isText ? "The learner TYPED their answer (do not comment on pronunciation)." : "The learner's answer is in the attached audio. First transcribe it verbatim in \"transcript\" (keep their mistakes). If the audio has no intelligible speech, set transcript to \"\" exactly and never invent words."}

LESSON OBJECTIVES (the only thing that matters — each question you ask must serve a REMAINING objective):
${criteriaLines}

QUESTIONS YOU ALREADY ASKED (never ask these again, nor a rephrasing of them):
${asked}
Suggested follow-ups still unused (use each at most once, only if it serves a remaining objective):
${followUps}

AFTER READING THE LEARNER'S ANSWER, decide:
1. "observed_criteria": for EACH objective, {criterion_id, status, confidence} judged on THIS answer only. "achieved" = clearly done in understandable English (small mistakes allowed if the meaning is clear); "emerging" = attempted but incomplete; "not_observed" otherwise. Never "achieved" on a guess. One answer may achieve several objectives at once.
2. "next_action":
   - "propose_completion" if, counting this answer, ALL objectives are covered: "reply_en" is a short, warm closing line WITHOUT any question.
   - "request_clarification" if the answer is unintelligible or off-topic: ask gently to repeat or rephrase, without asserting a mistake.
   - "coach_retry" ONLY if ${state.coachingUsed ? "NEVER (the one allowed coaching retry was already used — choose another action)" : "the answer contains ONE error worth fixing right now AND the meaning is clear: give a coaching card and invite the learner to say the corrected sentence. Use it at most once per lesson, for a useful point, not for a tiny slip."}
   - otherwise "ask_targeted_question": a natural acknowledgement + ONE new question aimed at a remaining objective ("target_criterion_id").
3. "coaching": null, or {explanation_fr, target_phrase_en, requires_retry, reason} when there is a real error worth teaching (also allowed with ask_targeted_question / propose_completion as a side note with requires_retry=false). explanation_fr: ONE short French sentence (tutoiement) explaining the point, no absolute false rules (e.g. "love to read" is also correct — never say -ing is mandatory). target_phrase_en: the learner's own sentence, corrected, natural, same meaning (do not pluralise or change meaning by default). If the learner says you already asked something, acknowledge it briefly and move on.
4. "reply_fr": French translation of reply_en. "hard_words": 0-3 {word, fr} from reply_en that this level may not know.
Respond ONLY with JSON matching the schema.`;
}

exports.lessonTurn = onCall({ region: REGION, maxInstances: 5, secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  const uid = requireAuth(request);
  const { attemptId, audioBase64 = null, mimeType = "audio/mp4", text = null, voice = "us-male", speakingRate = 0.95, clientTurnId = null } = request.data || {};
  if (typeof attemptId !== "string") throw new HttpsError("invalid-argument", "attemptId manquant");
  const isText = typeof text === "string" && text.trim().length > 0;
  if (!isText && (typeof audioBase64 !== "string" || !audioBase64)) throw new HttpsError("invalid-argument", "audio ou texte manquant");
  if (!isText && audioBase64.length > MAX_AUDIO_BASE64_LENGTH) throw new HttpsError("invalid-argument", "Audio trop long");
  if (isText && text.length > 2000) throw new HttpsError("invalid-argument", "Texte trop long");

  const ref = db.doc(`users/${uid}/attempts/${attemptId}`);
  const snap = await ref.get();
  const a = snap.data();
  if (!a || a.active !== true || !ACTIVE_CONVERSATION_STATES.has(a.state)) throw new HttpsError("failed-precondition", "attempt_not_active");
  const variant = VARIANTS.get(a.variantId);
  if (!variant) throw new HttpsError("failed-precondition", "variant_missing");

  const turnsSnap = await ref.collection("turns").orderBy("index").get();
  const turns = turnsSnap.docs.map((d) => d.data());
  // Idempotence : même clientTurnId déjà traité (double tap, retry réseau) → renvoyer le tour stocké (sans audio)
  if (clientTurnId) {
    const dup = turns.find((t) => t.clientTurnId === clientTurnId);
    if (dup && dup.response) return dup.response;
  }
  const index = turns.length;
  const state = {
    covered: coveredFromTurns(variant, turns),
    askedQuestions: [variant.openingEn, ...turns.map((t) => t.coach).filter((c) => c && c.includes("?"))],
    coachingUsed: a.coachingUsed === true,
  };
  const atCap = index + 1 >= variant.maxUsefulTurns;

  const historyText = [`You: ${variant.openingEn}`, ...turns.map((t) => `Learner: ${t.user}\nYou: ${t.coach}`)].join("\n");
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const parts = isText
    ? [{ text: `Conversation so far:\n${historyText}\n\nThe learner's new written answer:\n"${text.trim()}"` }]
    : [{ text: `Conversation so far:\n${historyText}\n\nThe learner's new spoken answer is in the attached audio.` }, { inlineData: { mimeType, data: audioBase64 } }];

  let parsed;
  try {
    const res = await genWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: buildLessonSystemPrompt(variant, state, isText),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcript: { type: Type.STRING },
            reply_en: { type: Type.STRING },
            reply_fr: { type: Type.STRING },
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
            hard_words: {
              type: Type.ARRAY,
              items: { type: Type.OBJECT, properties: { word: { type: Type.STRING }, fr: { type: Type.STRING } }, required: ["word", "fr"] },
            },
          },
          required: ["transcript", "reply_en", "reply_fr", "next_action", "observed_criteria", "hard_words"],
        },
        temperature: 0.6,
        thinkingConfig: { thinkingLevel: "low" },
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
    return { heardNothing: true, reply_en: str(parsed.reply_en) || "Sorry, I didn't catch that — could you say it again?", reply_fr: str(parsed.reply_fr), replyAudioBase64: null };
  }

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
  if (allCovered && nextAction === "ask_targeted_question") nextAction = "propose_completion";
  if (atCap && nextAction !== "coach_retry") nextAction = "propose_completion"; // plafond : conclusion accompagnée, jamais de nouvelle question
  if (nextAction !== "coach_retry" && coaching) coaching.requiresRetry = false;
  const replyEn = str(parsed.reply_en, 500);
  const targetCriterionId = allowed.has(parsed.target_criterion_id) ? parsed.target_criterion_id : null;

  // --- Audio : réplique (voix choisie par l'utilisateur) + conseil (FR puis EN), jamais superposés côté client ---
  const v = VOICES[voice] || VOICES["us-male"];
  let replyAudioBase64 = null, coachingAudioFrBase64 = null, coachingAudioEnBase64 = null;
  try {
    const jobs = [replyEn ? synthesize(replyEn, v, speakingRate) : Promise.resolve(null)];
    if (coaching) {
      jobs.push(synthesize(coaching.explanationFr, FR_VOICE, 1.0));
      jobs.push(synthesize(coaching.targetPhraseEn, v, Math.min(Number(speakingRate) || 0.95, 0.9)));
    }
    const [r, cf, ce] = await Promise.all(jobs);
    replyAudioBase64 = r; coachingAudioFrBase64 = cf || null; coachingAudioEnBase64 = ce || null;
  } catch (e) {
    console.error("lessonTurn TTS error", e); // l'écrit reste disponible
  }

  const now = Date.now();
  const response = {
    turnIndex: index,
    transcript,
    reply_en: replyEn,
    reply_fr: str(parsed.reply_fr, 500),
    hard_words: Array.isArray(parsed.hard_words) ? parsed.hard_words.slice(0, 3) : [],
    nextAction,
    targetCriterionId,
    coaching,
    observedCriteria: observed,
    coveredCriteria: [...coveredNow],
    allCovered,
    atCap,
    replyAudioBase64,
    coachingAudioFrBase64,
    coachingAudioEnBase64,
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
    response: { ...response, replyAudioBase64: null, coachingAudioFrBase64: null, coachingAudioEnBase64: null },
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
  await batch.commit();
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
  value: { db, LESSONS, CHAPTERS, VARIANTS, getVariant, isPublished, readFlags, requireAuth, hasEntitlement },
  enumerable: false,
});
