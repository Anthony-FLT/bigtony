// Parcours d'apprentissage — types partagés (catalogue, progression, tentatives).
// Tout est additif : aucun type existant de l'app n'est modifié.
import type { Level } from "../level";

export type PracticeLevel = Level; // "A1" | ... | "C2"

// ---- Catalogue (embarqué dans l'app, copie canonique côté Functions) ----

export type ChapterDefinition = {
  id: string; // "C01"
  order: number;
  titleFr: string;
  promiseFr: string;
  badgeId: string;
  published: boolean; // disponibilité éditoriale, indépendante des prérequis et de l'abonnement
};

export type LessonDefinition = {
  id: string; // "C01-L01"
  chapterId: string;
  order: number;
  titleFr: string;
  isCheckpoint: boolean;
  isFreeDiscovery: boolean; // première leçon offerte
  prerequisiteLessonId: string | null;
  published: boolean;
};

export type Criterion = { id: string; descriptionFr: string; exampleEn: string };

export type LessonVariant = {
  id: string; // "C01-L01-A1"
  lessonId: string;
  contentVersion: number;
  practiceLevel: PracticeLevel;
  titleFr: string;
  objectiveFr: string;
  coachRole: string;
  userRole: string;
  openingEn: string;
  followUpsEn: string[];
  difficultyFollowUpEn: string;
  easierVariantHintFr: string;
  fallbackFeedbackFr: string;
  requiredCriteria: Criterion[];
  miniLesson: { explanationFr: string; examplesEn: string[]; optional: boolean };
  supports: ("translate" | "sentence_starter" | "listen_model" | "text_mode")[];
  microExercise: {
    promptFr: string;
    expectedSemanticCriteria: string[];
    sampleAnswerEn: string;
    alternativePromptFr: string;
  };
  targetMinutes: number;
  maxUsefulTurns: number;
};

// ---- Progression (users/{uid}/progress/{lessonId}) — écrite par le serveur uniquement ----

export type PedagogicalStatus = "hidden_preview" | "locked_prerequisite" | "available" | "in_progress" | "needs_practice" | "validated";
export type AccessStatus = "free" | "subscription_required" | "entitled";
export type EditorialStatus = "unpublished" | "published";

export type LessonProgress = {
  lessonId: string;
  status: "validated" | "needs_practice" | "in_progress";
  validationKind?: "validated" | "validated_with_support";
  successfulVariantIds: string[];
  lastAttemptId: string | null;
  firstValidatedAt: number | null; // epoch ms
  bestEvidenceSummaryFr?: string;
};

// Vue calculée pour la carte : un nœud par leçon
export type PathNode = {
  lesson: LessonDefinition;
  chapter: ChapterDefinition;
  pedagogical: PedagogicalStatus;
  access: AccessStatus;
  editorial: EditorialStatus;
  variant: LessonVariant | null; // variante au niveau de pratique courant, si publiée
  progress: LessonProgress | null;
};

export type LearningPathView = {
  practiceLevel: PracticeLevel;
  nodes: PathNode[];
  nextNode: PathNode | null; // « Continuer ma leçon »
  chapterProgress: Record<string, { validated: number; total: number }>;
  xp: number;
};

// ---- Tentatives (users/{uid}/attempts/{attemptId}) ----

export type AttemptState =
  | "created" | "briefing" | "preparation" | "conversation" | "coaching_retry" | "validating" | "feedback" | "retry"
  | "micro_exercise" | "evaluating" | "needs_practice" | "completed"
  | "paused" | "recoverable_error" | "ended_unvalidated";

export type Modality = "voice" | "text";
export type SupportKind = "none" | "hint" | "model" | "coaching";
export type Confidence = "low" | "medium" | "high";
export type CriterionStatus = "not_observed" | "emerging" | "achieved";

export type ObservedCriterion = { criterionId: string; statusCandidate: CriterionStatus; support: SupportKind; confidence: Confidence };

export type AttemptTurn = {
  id: string; // réservé côté client avant l'appel, persisté avec la réponse
  index: number;
  user: string;
  coach: string;
  modality: Modality;
  supportUsed: SupportKind;
  at: number;
  feedbackFr?: string;
  correction?: Record<string, unknown> | null; // même forme que Correction (CorrectionCard), stockée telle quelle
  pronunciation?: { pronScore: number; accuracyScore: number; fluencyScore: number } | null;
  // observations provisoires du coach (J2) — jamais une validation
  observedCriteria?: ObservedCriterion[];
  // J5 (lessonTurn) : décision du coach et conseil éventuel, stockés avec le tour
  nextAction?: NextAction;
  targetCriterionId?: string | null;
  coaching?: Coaching | null;
};

// ---- Conversation de leçon (lessonTurn, J5) ----
export type NextAction = "ask_targeted_question" | "coach_retry" | "request_clarification" | "propose_completion";

export type Coaching = {
  explanationFr: string; // une phrase, en français
  targetPhraseEn: string; // la phrase de l'apprenant, corrigée
  requiresRetry: boolean; // true → « À toi de réessayer » (une seule fois par leçon)
  reason: string;
};

export type LessonTurnResponse = {
  heardNothing?: boolean;
  turnIndex: number;
  transcript: string;
  reply_en: string;
  reply_fr: string;
  hard_words: { word: string; fr: string }[];
  nextAction: NextAction;
  targetCriterionId: string | null;
  coaching: Coaching | null;
  observedCriteria: ObservedCriterion[];
  coveredCriteria: string[];
  allCovered: boolean;
  atCap: boolean;
  closingIn?: number | null; // échanges restants avant la conclusion une fois tout couvert (0 = cette réponse était la dernière)
  minTurns?: number;
  replyAudioBase64: string | null;
  coachingAudioFrBase64: string | null;
  coachingAudioEnBase64: string | null;
  // audioFormat "pcm24k" (coach vidéo) : segments PCM 16 bits 24 kHz mono base64 (≈ 1 s chacun), MP3 absents
  replyPcmChunks?: string[] | null;
  coachingFrPcmChunks?: string[] | null;
  coachingEnPcmChunks?: string[] | null;
};

// Résultat de finalizeAttempt (J4) — calculé et stocké côté serveur
export type AttemptResult = {
  kind: "validated" | "validated_with_support" | "needs_practice";
  criteria: { id: string; descriptionFr: string; status: CriterionStatus; evidenceEn: string; doneFr: string }[];
  transferOk: boolean;
  summaryFr: string;
  nextFocusFr: string;
  keyPhraseEn: string; // « Ta phrase à retenir » (phrase corrigée ou meilleure phrase de l'apprenant)
  keyPhraseFr: string;
  easierVariantHintFr: string;
  xpGained: number;
  xpTotal: number;
  chapterBadge: string | null;
  evaluatedBy: "gemini" | "observations";
  at: number;
};

export type LessonAttempt = {
  id: string;
  lessonId: string;
  variantId: string;
  contentVersion: number;
  practiceLevel: PracticeLevel;
  briefingEn?: string; // ouverture parlée générée à la création (bonjour + direction + première question)
  briefingFr?: string;
  firstQuestionEn?: string; // première question reformulée par le serveur (nouvelle tentative uniquement)
  state: AttemptState;
  active: boolean; // une seule tentative active par leçon ; fermée par J4 (finalizeAttempt) ou "ended_unvalidated"
  coachingUsed?: boolean;
  coveredCriteria?: string[];
  resumeState?: AttemptState; // pour recoverable_error
  modalityUsed: Modality[];
  turnCount: number;
  transfer?: { responseId: string; promptVersion: "1:primary" | "1:alternative"; text: string; modality: Modality; at: number } | null;
  result?: AttemptResult | null;
  createdAt: number;
  updatedAt: number;
};

// ---- Cohorte ----
export type FlowVersion = "legacy" | "learning_path_v1";
