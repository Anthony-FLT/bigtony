// Rappels quotidiens locaux : les actus du jour le matin (8 h) et l'expression du jour en fin de journée (18 h).
// L'ancien rappel « C'est l'heure de ta discussion » n'est plus proposé (17/11) : il est annulé au démarrage chez ceux qui l'avaient.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Affiche les notifs même app au premier plan
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Canal Android (obligatoire en build, sinon les notifs planifiées ne sortent pas)
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("daily-reminder", {
    name: "Rappel quotidien",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function requestNotifPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

// ANCIEN rappel de discussion — plus proposé dans l'app. Fonctions conservées pour les fichiers qui les importeraient encore.
// Planifie (ou replanifie) le rappel quotidien à l'heure donnée
export async function scheduleDailyReminder(hour: number, minute: number): Promise<void> {
  await ensureChannel();
  await Notifications.cancelScheduledNotificationAsync("discussion-daily").catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: "discussion-daily",
    content: {
      title: "C'est l'heure de ta discussion",
      body: "Dix minutes d'anglais t'attendent. On y va ?",
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: "daily-reminder" },
  });
  // Mémorise le réglage
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      await setDoc(doc(db, "users", uid), { reminderHour: hour, reminderMinute: minute, reminderOn: true }, { merge: true });
    } catch (e) { console.warn("save reminder échoué:", e); }
  }
}

export async function cancelDailyReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync("discussion-daily").catch(() => {});
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      await setDoc(doc(db, "users", uid), { reminderOn: false }, { merge: true });
    } catch (e) { console.warn("cancel reminder échoué:", e); }
  }
}

export async function getReminderSetting(): Promise<{ on: boolean; hour: number; minute: number }> {
  const uid = auth.currentUser?.uid;
  const def = { on: false, hour: 19, minute: 0 };
  if (!uid) return def;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const d = snap.data();
    if (!d) return def;
    return { on: !!d.reminderOn, hour: d.reminderHour ?? 19, minute: d.reminderMinute ?? 0 };
  } catch (e) {
    console.warn("getReminderSetting échoué:", e);
    return def;
  }
}

const EXPRESSION_NOTIF_ID = "expression-daily";
const EXPRESSION_KEY = "notif:expression";
export const EXPRESSION_REMINDER_HOUR = 18; // fin de journée (9 h jusqu'au 17/11 : trop proche du rappel des actus)

export async function scheduleExpressionReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(EXPRESSION_NOTIF_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: EXPRESSION_NOTIF_ID,
    content: {
      title: "Ton expression du jour",
      body: "Avant de finir ta journée : une expression à retenir, en 30 secondes.",
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: EXPRESSION_REMINDER_HOUR, minute: 0 },
  });
  await AsyncStorage.setItem(EXPRESSION_KEY, "on");
}

export async function cancelExpressionReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(EXPRESSION_NOTIF_ID).catch(() => {});
  await AsyncStorage.setItem(EXPRESSION_KEY, "off");
}

export async function getExpressionReminderEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(EXPRESSION_KEY)) !== "off";
}

// ---------------------------------------------------------------
// Actus du jour : chaque matin à 8 h (l'édition est prête depuis 3 h)
// ---------------------------------------------------------------
const NEWS_NOTIF_ID = "news-daily";
const NEWS_KEY = "notif:news";
export const NEWS_REMINDER_HOUR = 8;

export async function scheduleNewsReminder(): Promise<void> {
  await ensureChannel();
  await Notifications.cancelScheduledNotificationAsync(NEWS_NOTIF_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: NEWS_NOTIF_ID,
    content: {
      title: "Tes actus du jour sont prêtes",
      body: "3 minutes pour en lire une en anglais, puis la raconter à ton coach.",
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: NEWS_REMINDER_HOUR, minute: 0, channelId: "daily-reminder" },
  });
  await AsyncStorage.setItem(NEWS_KEY, "on");
}

export async function cancelNewsReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NEWS_NOTIF_ID).catch(() => {});
  await AsyncStorage.setItem(NEWS_KEY, "off");
}

export async function getNewsReminderEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(NEWS_KEY)) !== "off";
}

// ---------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------
export async function hasNotifPermission(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).status === "granted"; } catch { return false; }
}

// Enregistre les choix de l'utilisateur (onboarding, paramètres). Demande l'autorisation du système si au moins un rappel
// est voulu ; renvoie true si elle est accordée. Sans autorisation, les choix sont quand même mémorisés.
export async function applyReminderChoices(choices: { news: boolean; expression: boolean }): Promise<boolean> {
  const granted = choices.news || choices.expression ? await requestNotifPermission().catch(() => false) : await hasNotifPermission();
  try {
    if (choices.news && granted) await scheduleNewsReminder(); else { await Notifications.cancelScheduledNotificationAsync(NEWS_NOTIF_ID).catch(() => {}); await AsyncStorage.setItem(NEWS_KEY, choices.news ? "on" : "off"); }
    if (choices.expression && granted) await scheduleExpressionReminder(); else { await Notifications.cancelScheduledNotificationAsync(EXPRESSION_NOTIF_ID).catch(() => {}); await AsyncStorage.setItem(EXPRESSION_KEY, choices.expression ? "on" : "off"); }
  } catch (e) { console.warn("applyReminderChoices échoué:", e); }
  return granted;
}

// Au démarrage de l'app : annule l'ancien rappel de discussion, puis (re)programme les rappels activés si l'autorisation est accordée.
export async function syncReminders(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync("discussion-daily").catch(() => {});
    if (!(await hasNotifPermission())) return;
    if (await getNewsReminderEnabled()) await scheduleNewsReminder();
    if (await getExpressionReminderEnabled()) await scheduleExpressionReminder();
  } catch (e) { console.warn("syncReminders échoué:", e); }
}
