// Labo de prononciation — phrases d'entraînement et appel de scoring scripté.
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const labAssess = httpsCallable(functions, "labAssess", { timeout: 70000 });

export type Phoneme = { phoneme: string; score: number };
export type WordScore = { word: string; score: number; errorType: string; phonemes: Phoneme[] };
export type LabResult = {
  recognized: string;
  pronScore: number;
  accuracyScore: number;
  fluencyScore: number;
  words: WordScore[];
};

// Phrases ciblant les pièges classiques des francophones.
export type Drill = { id: string; text: string; focus: string };
export const DRILLS: Drill[] = [
  { id: "through", text: "I looked through the report", focus: "le son « th » + « r »" },
  { id: "thirty", text: "Thirty-three thirsty travelers", focus: "le « th » répété" },
  { id: "hungry", text: "I am very hungry and angry", focus: "le « h » aspiré" },
  { id: "world", text: "The whole world heard the word", focus: "« w » et « r »" },
  { id: "focus", text: "We should focus on the schedule", focus: "voyelles longues" },
];

export async function assessDrill(referenceText: string, audioBase64: string, mimeType = "audio/mp4"): Promise<LabResult> {
  const res: any = await labAssess({ audioBase64, mimeType, referenceText });
  return res.data as LabResult;
}