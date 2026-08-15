// Notification quotidienne locale : "c'est l'heure de ta discussion".
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

// Planifie (ou replanifie) le rappel quotidien à l'heure donnée
export async function scheduleDailyReminder(hour: number, minute: number): Promise<void> {
  await ensureChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "C'est l'heure de ta discussion",
      body: "Dix minutes d'anglais t'attendent. On y va ?",
    },
    trigger: { channelId: "daily-reminder", hour, minute, repeats: true },
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
  await Notifications.cancelAllScheduledNotificationsAsync();
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

export async function scheduleExpressionReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(EXPRESSION_NOTIF_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: EXPRESSION_NOTIF_ID,
    content: {
      title: "Ton expression du jour",
      body: "Une nouvelle expression t'attend. 30 secondes pour l'apprendre.",
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 9, minute: 0 },
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