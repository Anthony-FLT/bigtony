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
  // Pro — 8 scènes
  {
    id: "entretien-embauche",
    title: "Entretien d'embauche",
    emoji: "",
    category: "pro",
    description: "Présente-toi, défends ton parcours",
  },
  {
    id: "point-hebdo-teams",
    title: "Point hebdo en visio",
    emoji: "",
    category: "pro",
    description: "Avancement, blocages, deadlines",
  },
  {
    id: "presentation-pro",
    title: "Présenter un projet",
    emoji: "",
    category: "pro",
    description: "Expose ton idée, réponds aux questions",
  },
  {
    id: "negociation-salaire",
    title: "Négocier ton salaire",
    emoji: "",
    category: "pro",
    description: "Défends ta valeur, trouve un accord",
  },
  {
    id: "premier-jour-travail",
    title: "Ton premier jour au travail",
    emoji: "",
    category: "pro",
    description: "Présente-toi à l'équipe, découvre ton poste",
  },
  {
    id: "expliquer-metier",
    title: "Parler de ton métier",
    emoji: "",
    category: "pro",
    description: "Explique ton rôle et tes missions simplement",
  },
  {
    id: "desaccord-reunion",
    title: "Donner ton avis en réunion",
    emoji: "",
    category: "pro",
    description: "Exprime un désaccord, propose une alternative",
  },
  {
    id: "annoncer-retard-projet",
    title: "Annoncer un retard",
    emoji: "",
    category: "pro",
    description: "Explique le problème, négocie un nouveau délai",
  },

  // Voyage — 10 scènes
  {
    id: "arrivee-hotel",
    title: "Arrivée à l'hôtel",
    emoji: "",
    category: "voyage",
    description: "Check-in à Manhattan, avec un imprévu",
  },
  {
    id: "aeroport-controle",
    title: "Contrôle à l'aéroport",
    emoji: "",
    category: "voyage",
    description: "Passeport, motif du voyage, séjour",
  },
  {
    id: "restaurant-commande",
    title: "Commander au restaurant",
    emoji: "",
    category: "voyage",
    description: "Boissons, plats, recommandations",
  },
  {
    id: "bagage-perdu",
    title: "Ta valise a disparu",
    emoji: "",
    category: "voyage",
    description: "Décris ton bagage, organise sa livraison",
  },
  {
    id: "train-annule",
    title: "Ton train est annulé",
    emoji: "",
    category: "voyage",
    description: "Trouve un autre trajet, échange ton billet",
  },
  {
    id: "location-voiture",
    title: "Louer une voiture",
    emoji: "",
    category: "voyage",
    description: "Compare les options, clarifie les conditions",
  },
  {
    id: "probleme-chambre",
    title: "Un problème dans ta chambre",
    emoji: "",
    category: "voyage",
    description: "Signale le souci, demande une solution",
  },
  {
    id: "allergie-restaurant",
    title: "Préciser une allergie",
    emoji: "",
    category: "voyage",
    description: "Explique ton allergie, vérifie les ingrédients",
  },
  {
    id: "reserver-activite",
    title: "Réserver une excursion",
    emoji: "",
    category: "voyage",
    description: "Renseigne-toi sur les horaires, le prix et le programme",
  },
  {
    id: "trajet-taxi",
    title: "Prendre un taxi",
    emoji: "",
    category: "voyage",
    description: "Donne l'adresse, précise le trajet et le paiement",
  },

  // Quotidien — 12 scènes
  {
    id: "rencontre-inconnu",
    title: "Rencontrer quelqu'un",
    emoji: "",
    category: "quotidien",
    description: "Briser la glace, small talk",
  },
  {
    id: "cafe-ami",
    title: "Un café entre amis",
    emoji: "",
    category: "quotidien",
    description: "Discuter détendu, prendre des nouvelles",
  },
  {
    id: "demander-chemin",
    title: "Demander son chemin",
    emoji: "",
    category: "quotidien",
    description: "Se repérer, comprendre la réponse",
  },
  {
    id: "se-presenter",
    title: "Te présenter simplement",
    emoji: "",
    category: "quotidien",
    description: "Dis qui tu es, d'où tu viens et où tu vis",
  },
  {
    id: "parler-proches",
    title: "Parler de tes proches",
    emoji: "",
    category: "quotidien",
    description: "Présente une personne et ce que vous faites ensemble",
  },
  {
    id: "loisirs-passions",
    title: "Partager tes passions",
    emoji: "",
    category: "quotidien",
    description: "Parle de tes loisirs et explique ce qui te plaît",
  },
  {
    id: "raconter-weekend",
    title: "Raconter ton week-end",
    emoji: "",
    category: "quotidien",
    description: "Raconte ce que tu as fait et tes impressions",
  },
  {
    id: "decrire-journee",
    title: "Décrire ta journée",
    emoji: "",
    category: "quotidien",
    description: "Parle de tes habitudes, du réveil au coucher",
  },
  {
    id: "organiser-sortie",
    title: "Organiser une sortie",
    emoji: "",
    category: "quotidien",
    description: "Propose une activité, trouvez un créneau ensemble",
  },
  {
    id: "retour-achat",
    title: "Retourner un achat",
    emoji: "",
    category: "quotidien",
    description: "Explique le souci, demande un échange ou un remboursement",
  },
  {
    id: "prendre-rendez-vous",
    title: "Prendre rendez-vous au téléphone",
    emoji: "",
    category: "quotidien",
    description: "Explique ta demande, confirme la date et l'heure",
  },
  {
    id: "mot-oublie",
    title: "Le mot t'échappe",
    emoji: "",
    category: "quotidien",
    description: "Décris un objet pour te faire comprendre sans le nommer",
  },
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