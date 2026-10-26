// Introduction du coach à la toute première leçon (une seule fois, pas en reprise), adaptée au niveau pratiqué.
// Préfixée à l'ouverture de la variante ; le serveur sait que le coach s'est déjà présenté.
import type { LessonCoach } from "./coaches";

export function coachIntroEn(coach: LessonCoach, level: string): string {
  const n = coach.displayName;
  const uk = coach.accent === "en-GB";
  switch (level) {
    case "A1":
      return `Hello! I'm ${n}. I'm your English coach. We will do short lessons together, step by step. Today, we talk about you.`;
    case "A2":
      return `Hi! I'm ${n}, your English coach. We're going to do short lessons together, one topic at a time. Let's start simple, with you.`;
    case "B1":
      return `Hi, I'm ${n}, and I'll be your English coach. In each lesson we'll have a real conversation on a theme, and I'll give you tips as we go. Let's start with something easy.`;
    default:
      return `Hi, I'm ${n}, your English coach. Over the coming lessons we'll work through real-life conversations, one theme at a time, and I'll point out what to ${uk ? "polish" : "polish up"} along the way. Let's ease in.`;
  }
}
