// Point d'entrée Firebase unique — tous les écrans importent d'ici.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFunctions } from "firebase/functions";
import { getFirestore } from "firebase/firestore";
// @ts-ignore — getReactNativePersistence existe dans le bundle RN, absent des typings web (issue firebase-js-sdk #9316)
import { initializeAuth, getReactNativePersistence, getAuth, type Auth } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ⚠️ Colle ici ton bloc firebaseConfig actuel (celui du SpikeScreen)
const firebaseConfig = {
    apiKey: "AIzaSyCrYSLy33s3uHRWG7hGIJV_FRHN8UKbFvo",
  authDomain: "erbol-1307.firebaseapp.com",
  projectId: "erbol-1307",
  storageBucket: "erbol-1307.firebasestorage.app",
  messagingSenderId: "920576203413",
  appId: "1:920576203413:web:1d92cf09de1ef0d7b3599c",
  measurementId: "G-XF41HBQX3N"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Persistance de l'auth entre les lancements (sinon nouvel utilisateur anonyme à chaque démarrage)
let _auth: Auth;
try {
  _auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  _auth = getAuth(app); // déjà initialisé (hot reload)
}
export const auth = _auth;

export const db = getFirestore(app);
export const functions = getFunctions(app, "europe-west1");