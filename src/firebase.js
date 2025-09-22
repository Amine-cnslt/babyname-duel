import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";

let appInstance = null;
let authInstance = null;
let googleProvider = null;

function getRuntimeFirebaseConfig() {
  if (typeof window === "undefined") return null;
  const cfg = window.__BND?.firebaseConfig;
  if (!cfg) {
    console.warn("Firebase config missing on window.__BND.firebaseConfig");
    return null;
  }
  return cfg;
}

function ensureApp() {
  if (appInstance) return appInstance;
  const config = getRuntimeFirebaseConfig();
  if (!config) {
    throw new Error("Firebase config not found; ensure index.html injects window.__BND.firebaseConfig");
  }
  if (!getApps().length) {
    appInstance = initializeApp(config);
  } else {
    appInstance = getApps()[0];
  }
  return appInstance;
}

export function getFirebaseAuth() {
  if (!authInstance) {
    const app = ensureApp();
    authInstance = getAuth(app);
    authInstance.useDeviceLanguage?.();
  }
  return authInstance;
}

export function getGoogleProvider() {
  if (!googleProvider) {
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });
  }
  return googleProvider;
}

export async function signInWithGooglePopup() {
  const auth = getFirebaseAuth();
  const provider = getGoogleProvider();
  return signInWithPopup(auth, provider);
}

export async function signOutFirebase() {
  const auth = getFirebaseAuth();
  return signOut(auth);
}

export function extractGoogleIdToken(result) {
  try {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    return credential?.idToken ?? null;
  } catch (err) {
    console.warn("Unable to extract Google ID token", err);
    return null;
  }
}
