// Contenu des écrans d'onboarding. Icônes en string (Feather les accepte au rendu) —
// surtout PAS d'accès à Feather.glyphMap au niveau module.
import { Goal, Feeling, Gender } from "./profile";

export const GOALS: { key: Goal; title: string; desc: string; icon: string }[] = [
  { key: "travail", title: "Le travail", desc: "Réunions, présentations, collègues", icon: "briefcase" },
  { key: "entretien", title: "Les entretiens", desc: "Décrocher un poste en anglais", icon: "user-check" },
  { key: "voyage", title: "Voyager", desc: "Aéroport, hôtel, se débrouiller partout", icon: "send" },
  { key: "quotidien", title: "Le quotidien", desc: "Small talk, rencontres, spontanéité", icon: "coffee" },
  { key: "etudes", title: "Les études", desc: "Cours, oraux, vie étudiante", icon: "book-open" },
  { key: "expat", title: "M'expatrier", desc: "Vivre et m'installer à l'étranger", icon: "map" },
  { key: "vo", title: "Films & séries en VO", desc: "Comprendre sans sous-titres", icon: "film" },
  { key: "gaming", title: "Le gaming", desc: "Jouer et parler en ligne", icon: "monitor" },
  { key: "presentations", title: "Prendre la parole", desc: "Présenter, pitcher, convaincre", icon: "mic" },
  { key: "reseautage", title: "Réseauter", desc: "Networking, events, LinkedIn", icon: "users" },
  { key: "examens", title: "Un examen", desc: "TOEIC, IELTS, TOEFL", icon: "award" },
  { key: "confiance", title: "Reprendre confiance", desc: "Oser, tout simplement", icon: "heart" },
];

export const FEELINGS: { key: Feeling; title: string; desc: string; icon: string }[] = [
  { key: "panique", title: "Je me liquéfie", desc: "Le trou noir dès qu'il faut parler", icon: "alert-circle" },
  { key: "cherche-mots", title: "Je cherche mes mots", desc: "Je comprends mais je rame à répondre", icon: "clock" },
  { key: "passer-cap", title: "Je veux passer un cap", desc: "Ça va, mais je veux être vraiment fluide", icon: "trending-up" },
];

export const GENDERS: { key: Gender; label: string }[] = [
  { key: "femme", label: "Femme" },
  { key: "homme", label: "Homme" },
  { key: "non-precise", label: "Je préfère ne pas dire" },
];

export const INTERESTS: string[] = [
  "Tech", "Science", "Business", "Voyage", "Cuisine", "Sport",
  "Cinéma", "Musique", "Art", "Nature", "Jeux vidéo", "Mode",
  "Histoire", "Politique", "Santé", "Finance",
];