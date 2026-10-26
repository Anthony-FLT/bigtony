// Catalogue des coachs vidéo (côté app : affichage uniquement). Le mapping avatar_id vit dans config/liveAvatar (serveur).
// Le coach découle de la voix choisie à l'onboarding (profil.voice) : pas d'écran de sélection supplémentaire.
export type VoiceKey = "us-male" | "us-female" | "uk-male" | "uk-female";
export type CoachId = "us_male" | "us_female" | "uk_male" | "uk_female";

export type LessonCoach = {
  id: CoachId;
  voice: VoiceKey;
  displayName: string;
  accent: "en-US" | "en-GB";
  accentLabel: string;
  presentation: "male" | "female";
  poster: any; // require(...) — portrait fixe (connexion, audio seul)
  cutout: any; // require(...) — buste détouré (PNG transparent) pour l'accueil
  paywall: any; // require(...) — visuel du paywall (buste sur forme colorée, PNG transparent)
  tint: string; // couleur du carré derrière le buste détouré
  enabled: boolean;
};

export const COACHES: Record<CoachId, LessonCoach> = {
  us_male:   { id: "us_male",   voice: "us-male",   displayName: "Sam",   accent: "en-US", accentLabel: "Accent américain",  presentation: "male",   poster: require("../../assets/coaches/us_male.jpg"),   cutout: require("../../assets/coaches/us_male_cutout.png"), paywall: require("../../assets/coaches/us_male_paywall.png"),   tint: "#FDDCBE", enabled: true },
  us_female: { id: "us_female", voice: "us-female", displayName: "Emma",  accent: "en-US", accentLabel: "Accent américain",  presentation: "female", poster: require("../../assets/coaches/us_female.jpg"), cutout: require("../../assets/coaches/us_female_cutout.png"), paywall: require("../../assets/coaches/us_female_paywall.png"), tint: "#ECEBFC", enabled: true },
  uk_male:   { id: "uk_male",   voice: "uk-male",   displayName: "James", accent: "en-GB", accentLabel: "Accent britannique", presentation: "male",   poster: require("../../assets/coaches/uk_male.jpg"),   cutout: require("../../assets/coaches/uk_male_cutout.png"), paywall: require("../../assets/coaches/uk_male_paywall.png"),   tint: "#FBE4A8", enabled: true },
  uk_female: { id: "uk_female", voice: "uk-female", displayName: "Alice", accent: "en-GB", accentLabel: "Accent britannique", presentation: "female", poster: require("../../assets/coaches/uk_female.jpg"), cutout: require("../../assets/coaches/uk_female_cutout.png"), paywall: require("../../assets/coaches/uk_female_paywall.png"), tint: "#E6F4EC", enabled: true },
};

export const DEFAULT_COACH_ID: CoachId = "us_male";

// Voix du profil → coach. Toute valeur inconnue retombe sur Sam.
export function coachIdForVoice(voice: string | null | undefined): CoachId {
  const found = (Object.values(COACHES) as LessonCoach[]).find((c) => c.voice === voice && c.enabled);
  return found ? found.id : DEFAULT_COACH_ID;
}

export function coachForVoice(voice: string | null | undefined): LessonCoach {
  return COACHES[coachIdForVoice(voice)];
}
