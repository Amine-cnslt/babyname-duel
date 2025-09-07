// src/api.js — Firestore v1 (single source of truth) + Firebase init

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore, doc, setDoc, getDoc, addDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, orderBy, onSnapshot, serverTimestamp
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ---- Initialize Firebase from runtime config in index.html ----
function getFirebaseConfig() {
  if (typeof window !== "undefined" && window.__BND?.firebaseConfig) {
    return window.__BND.firebaseConfig;
  }
  throw new Error("Missing window.__BND.firebaseConfig (check index.html).");
}
const app = getApps().length ? getApp() : initializeApp(getFirebaseConfig());
const db = getFirestore(app);
const auth = getAuth(app);

// ---- Public API used by App.jsx ----
export const api = {
  // Sessions
  createSession: async ({ title, maxOwners = 2 }) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");

    const sid = crypto.randomUUID();
    const ownerToken = crypto.randomUUID();
    const voterToken = crypto.randomUUID();

    await setDoc(doc(db, "sessions", sid), {
      title: title || "Untitled",
      maxOwners,
      createdBy: user.uid,
      ownerIds: [user.uid],
      inviteOwnerToken: ownerToken,
      inviteVoterToken: voterToken,
      status: "active",
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, "sessions", sid, "members", user.uid), {
      role: "owner",
      joinedAt: serverTimestamp(),
    });

    return { sid, ownerToken, voterToken };
  },

  joinWithToken: async ({ sid, token, asOwner }) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");

    const sref = doc(db, "sessions", sid);
    const snap = await getDoc(sref);
    if (!snap.exists()) throw new Error("Session not found");
    const s = snap.data();

    if (asOwner) {
      if (s.inviteOwnerToken !== token) throw new Error("Invalid owner token");
      const ownerIds = new Set(s.ownerIds || []);
      if (ownerIds.size >= (s.maxOwners || 2)) throw new Error("Owner limit reached");
      ownerIds.add(user.uid);
      await updateDoc(sref, { ownerIds: Array.from(ownerIds) });
      await setDoc(doc(db, "sessions", sid, "members", user.uid), {
        role: "owner",
        joinedAt: serverTimestamp(),
      });
    } else {
      if (s.inviteVoterToken !== token) throw new Error("Invalid voter token");
      await setDoc(
        doc(db, "sessions", sid, "members", user.uid),
        { role: "voter", joinedAt: serverTimestamp() },
        { merge: true }
      );
    }
  },

  upsertOwnerList: async ({ sid, names, selfRanks }) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    await setDoc(
      doc(db, "sessions", sid, "lists", user.uid),
      { names, selfRanks },
      { merge: false }
    );
  },

  submitScore: async ({ sid, listOwnerUid, scoreValue, name }) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const scoreKey = `${listOwnerUid}_${user.uid}_${scoreValue}`;
    await setDoc(
      doc(db, "sessions", sid, "scores", scoreKey),
      {
        listOwnerUid,
        raterUid: user.uid,
        scoreValue: Number(scoreValue),
        name,
        createdAt: serverTimestamp(),
      },
      { merge: false }
    );
  },

  upsertTiebreakRanking: async ({ sid, tiebreakId, orderedNames }) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const tref = doc(db, "sessions", sid, "tiebreaks", tiebreakId);
    const snap = await getDoc(tref);
    const data = snap.exists() ? snap.data() : {};
    const ranking = data.ranking || {};
    ranking[user.uid] = orderedNames;
    await setDoc(tref, { ...data, ranking }, { merge: true });
  },

  deleteSession: async ({ sid }) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const sref = doc(db, "sessions", sid);
    const s = (await getDoc(sref)).data();
    if (!s || !(s.ownerIds || []).includes(user.uid)) throw new Error("Not an owner");
    await updateDoc(sref, { status: "archived" });
  },

  onSessionSnapshot: (sid, handlers) => {
    const unsub1 = onSnapshot(collection(db, "sessions", sid, "lists"), handlers.onLists);
    const unsub2 = onSnapshot(collection(db, "sessions", sid, "scores"), handlers.onScores);
    const unsub3 = onSnapshot(doc(db, "sessions", sid), handlers.onSession);
    return () => {
      try { unsub1(); } catch {}
      try { unsub2(); } catch {}
      try { unsub3(); } catch {}
    };
  },
};
