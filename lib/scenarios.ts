// Métadonnées d'affichage des scénarios. Les prompts vivent côté serveur —
// les ids doivent correspondre à SCENARIOS dans functions/index.js.
export type ScenarioCategory = "pro" | "voyage" | "quotidien";

export type Scenario = {
  id: string;
  title: string;
  emoji: string;
  category: ScenarioCategory;
  description: string;
  custom?: string;
};

export const SCENARIOS: Scenario[] = [
  // Pro
  { id: "entretien-embauche", title: "Entretien d'embauche", emoji: "", category: "pro", description: "Présente-toi, défends ton parcours" },
  { id: "point-hebdo-teams", title: "Point hebdo en visio", emoji: "", category: "pro", description: "Avancement, blocages, deadlines" },
  { id: "presentation-pro", title: "Présenter un projet", emoji: "", category: "pro", description: "Expose ton idée, réponds aux questions" },
  { id: "negociation-salaire", title: "Négocier ton salaire", emoji: "", category: "pro", description: "Défends ta valeur, trouve un accord" },
  // Voyage
  { id: "arrivee-hotel", title: "Arrivée à l'hôtel", emoji: "", category: "voyage", description: "Check-in à Manhattan, avec un imprévu" },
  { id: "aeroport-controle", title: "Contrôle à l'aéroport", emoji: "", category: "voyage", description: "Passeport, motif du voyage, séjour" },
  { id: "restaurant-commande", title: "Commander au restaurant", emoji: "", category: "voyage", description: "Boissons, plats, recommandations" },
  // Quotidien
  { id: "rencontre-inconnu", title: "Rencontrer quelqu'un", emoji: "", category: "quotidien", description: "Briser la glace, small talk" },
  { id: "cafe-ami", title: "Un café entre amis", emoji: "", category: "quotidien", description: "Discuter détendu, prendre des nouvelles" },
  { id: "demander-chemin", title: "Demander son chemin", emoji: "", category: "quotidien", description: "Se repérer, comprendre la réponse" },
];

import { Goal } from "./profile";

// Associe chaque objectif d'onboarding à une catégorie de scénario
const GOAL_TO_CATEGORY: Record<Goal, ScenarioCategory> = {
  travail: "pro",
  entretien: "pro",
  presentations: "pro",
  reseautage: "pro",
  examens: "pro",
  etudes: "pro",
  voyage: "voyage",
  expat: "voyage",
  quotidien: "quotidien",
  vo: "quotidien",
  gaming: "quotidien",
  confiance: "quotidien",
};

// Première scène adaptée aux objectifs choisis. Prend le 1er objectif qui a une scène dispo,
// sinon retombe sur le tout premier scénario.
export function pickFirstScenario(goals: Goal[] | undefined): Scenario {
  if (goals) {
    for (const g of goals) {
      const cat = GOAL_TO_CATEGORY[g];
      const match = SCENARIOS.find((s) => s.category === cat);
      if (match) return match;
    }
  }
  return SCENARIOS[0];
}