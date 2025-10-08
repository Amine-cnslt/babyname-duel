import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  signOut,
  browserPopupRedirectResolver,
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
  try {
    return await signInWithPopup(auth, provider, browserPopupRedirectResolver);
  } catch (err) {
    const fallbackCodes = new Set([
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment",
    ]);
    const missingInitialState = typeof err?.message === "string" && err.message.includes("missing initial state");
    if (fallbackCodes.has(err?.code) || missingInitialState) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function signOutFirebase() {
  const auth = getFirebaseAuth();
  return signOut(auth);
}

export async function getGoogleRedirectResult() {
  const auth = getFirebaseAuth();
  try {
    return await getRedirectResult(auth);
  } catch (err) {
    console.warn("Google redirect sign-in failed", err);
    return null;
  }
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
