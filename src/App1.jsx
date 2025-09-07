import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Baby,
  Heart,
  Users,
  Crown,
  Trophy,
  RefreshCcw,
  Share2,
  Link2,
  LogIn,
  PlusCircle,
  KeyRound,
  LogOut,
  Mail,
  UserPlus,
  UserSquare2,
  ListChecks,
  Trash2,
} from "lucide-react";

// Firebase
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot as onQuerySnapshot,
  arrayUnion,
  deleteDoc,
} from "firebase/firestore";

// (Local API wiring kept for future use)
import {
  apiMe,
  listMySessions,
  createSession,
  getSession,
  saveSessionState,
} from "./api";
import { Sparkles, Share2, X } from "lucide-react"; // adjust icons if needed

const SessionHeader = ({ sid, onOpenInvite, onExit }) => {
  if (!sid) return null;
  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white/80 px-4 py-3 backdrop-blur flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-sm font-medium text-pink-700">
          <Sparkles className="h-4 w-4" />
          Session
        </span>
        <code className="text-xs text-slate-500">#{String(sid).slice(0, 6)}</code>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenInvite}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          <Share2 className="h-4 w-4" />
          Invite
        </button>
        {onExit && (
          <button
            onClick={onExit}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            Exit
          </button>
        )}
      </div>
    </div>
  );
};


/** ----------------- helpers ----------------- */
const range = (n) => Array.from({ length: n }, (_, i) => i);
const SCORES_1_10 = range(10).map((i) => i + 1);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
const makeLink = (sid, params) =>
  `${location.origin}${location.pathname}?${new URLSearchParams({
    sid,
    ...params,
  }).toString()}`;

function getFirebaseConfig() {
  const env = import.meta?.env || {};
  if (env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
    };
  }
  if (typeof window !== "undefined" && window.__BND?.firebaseConfig) {
    return window.__BND.firebaseConfig;
  }
  return null;
}

function useFirebase() {
  const [enabled, setEnabled] = useState(false);
  const dbRef = useRef(null);
  const authRef = useRef(null);
  useEffect(() => {
    const cfg = getFirebaseConfig();
    if (!cfg) return;
    try {
      const app = getApps().length ? getApp() : initializeApp(cfg);
      const auth = getAuth(app);
      const db = getFirestore(app);
      authRef.current = auth;
      dbRef.current = db;
      setEnabled(true);
    } catch (e) {
      console.warn("Firebase init failed:", e);
      setEnabled(false);
    }
  }, []);
  return { enabled, db: dbRef.current, auth: authRef.current };
}

function optionsFor(list, idx) {
  const used = new Set(
    list.map((v, i) => (i === idx ? null : Number(v) || null)).filter(Boolean)
  );
  return SCORES_1_10.filter((n) => !used.has(n));
}

function ensure10(list) {
  const base = Array.isArray(list) ? list.slice(0, 10) : [];
  while (base.length < 10) base.push({ label: "", self: "" });
  return base;
}

/** ----------------- default state ----------------- */
const STORAGE_KEY = "bnd-multi-state";
const defaultState = () => ({
  sessionLabel: "",
  owners: [], // { id, email, displayName, names:[{label,self}], createdBy? }
  scores: {}, // scores[ownerId][raterId] = [10]
  tie: { round: 0, candidates: [], scoresByRater: {} },
  maxOwners: 2, // or 3
});

/** ----------------- persistence (local) ----------------- */
function usePersistentState() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultState();
    } catch {
      return defaultState();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);
  const reset = () => setState(defaultState());
  return [state, setState, reset];
}

/** ----------------- UI primitives ----------------- */
function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-2xl shadow-lg border border-slate-200 bg-white ${className}`}
    >
      {children}
    </div>
  );
}
function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {Icon ? (
        <div className="p-2 rounded-xl bg-gradient-to-br from-sky-400 to-rose-500 text-white">
          <Icon size={18} />
        </div>
      ) : null}
      <div>
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-slate-500 text-sm">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

const BabySVG = ({ className = "w-24 h-24" }) => (
  <svg viewBox="0 0 200 200" className={className} aria-hidden>
    <defs>
      <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFE0CA" />
        <stop offset="100%" stopColor="#FFC7A8" />
      </linearGradient>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#f43f5e" />
      </linearGradient>
    </defs>
    <rect
      x="0"
      y="0"
      width="200"
      height="200"
      rx="24"
      fill="url(#bg)"
      opacity="0.1"
    />
    <circle cx="100" cy="90" r="60" fill="url(#skin)" stroke="#f43f5e" strokeWidth="2" />
    <circle cx="75" cy="85" r="6" fill="#0f172a" />
    <circle cx="125" cy="85" r="6" fill="#0f172a" />
    <path
      d="M75 115 C95 130, 105 130, 125 115"
      stroke="#0f172a"
      strokeWidth="4"
      fill="none"
      strokeLinecap="round"
    />
    <path
      d="M60 65 C80 45, 120 45, 140 65"
      stroke="#38bdf8"
      strokeWidth="6"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const ToysSVG = ({ className = "w-28 h-28" }) => (
  <svg viewBox="0 0 220 160" className={className} aria-hidden>
    <defs>
      <linearGradient id="toyR" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#fb7185" />
      </linearGradient>
      <linearGradient id="toyB" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#0ea5e9" />
      </linearGradient>
    </defs>
    <rect x="10" y="100" width="70" height="40" rx="8" fill="url(#toyB)" />
    <rect x="90" y="80" width="60" height="60" rx="10" fill="url(#toyR)" />
    <rect x="160" y="60" width="50" height="80" rx="12" fill="url(#toyB)" />
    <circle cx="45" cy="140" r="10" fill="#0f172a" />
    <circle cx="120" cy="140" r="10" fill="#0f172a" />
    <circle cx="185" cy="140" r="10" fill="#0f172a" />
  </svg>
);

/** ----------------- dev sanity ----------------- */
function runDevTests() {
  const assert = (c, m) => {
    if (!c) throw new Error("Test failed: " + m);
  };
  assert(optionsFor(Array(10).fill(""), 0).length === 10, "10 options when none chosen");
  const arr = ["1", "", "", "", "", "", "", "", "", ""];
  assert(!optionsFor(arr, 1).includes(1), "used 1 is removed");
}

/** ----------------- App ----------------- */
export default function App() {
  const [state, setState, resetLocal] = usePersistentState();
  useEffect(() => {
    try {
      if (import.meta?.env?.MODE !== "production") runDevTests();
    } catch {}
  }, []);

  // Firebase / auth
  const { enabled: fbEnabled, db, auth } = useFirebase();
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, [auth]);

  const authRequired = !!fbEnabled;
  const needsAuth = authRequired && !user;

  // Session wiring
  const [sessionId, setSessionId] = useState("");
  const [roleHint, setRoleHint] = useState("voter"); // owner | voter
  const [usingCloud, setUsingCloud] = useState(false);
  const remoteWriteRef = useRef(false);

  // Parse URL for sid/role
  useEffect(() => {
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("sid");
    const role = url.searchParams.get("role");
    if (sid) setSessionId(sid);
    if (role === "owner" || role === "voter") setRoleHint(role);
  }, []);

  // Subscribe to session
  useEffect(() => {
    if (!fbEnabled || !db || !sessionId) return;
    const ref = doc(db, "sessions", sessionId);
    setUsingCloud(true);

    const unsub = onSnapshot(ref, async (snap) => {
      const data = snap.data();
      // membership tracking
      if (auth?.currentUser) {
        const uid = auth.currentUser.uid;
        const members = data?.members || [];
        if (!members.includes(uid)) {
          try {
            await updateDoc(ref, { members: arrayUnion(uid) });
          } catch {}
        }
      }
      // state
      if (data?.state) {
        remoteWriteRef.current = true;
        try {
          const migrated = {
            ...data.state,
            owners: (data.state.owners || []).map((o) => ({
              ...o,
              names: ensure10(o.names),
            })),
          };
          setState(migrated);
        } finally {
          remoteWriteRef.current = false;
        }
      }
    });

    (async () => {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // seed
        if (auth?.currentUser) {
          const me = auth.currentUser;
          const meOwner = {
            id: me.uid,
            email: me.email || "",
            displayName: me.displayName || me.email || "Owner",
            createdBy: true,
            names: ensure10([]),
          };
          await setDoc(ref, {
            createdAt: Date.now(),
            ownerId: me.uid,
            ownerEmail: me.email || null,
            members: [me.uid],
            ownerIds: [me.uid],
            voterIds: [],
            maxOwners: 2,
            state: { ...defaultState(), owners: [meOwner], maxOwners: 2 },
          });
        } else {
          await setDoc(ref, {
            createdAt: Date.now(),
            members: [],
            ownerIds: [],
            voterIds: [],
            maxOwners: 2,
            state: defaultState(),
          });
        }
      }
    })();

    return () => unsub();
  }, [fbEnabled, db, sessionId]);

  // Push local -> Firestore
  useEffect(() => {
    if (!usingCloud || !db || !sessionId) return;
    if (remoteWriteRef.current) return;
    const ref = doc(db, "sessions", sessionId);
    setDoc(ref, { updatedAt: Date.now(), state }, { merge: true }).catch(() => {});
  }, [state, usingCloud, db, sessionId]);

  // Results compute & completion flag
  const computed = useComputedResults(state);
  useEffect(() => {
    if (!usingCloud || !db || !sessionId) return;
    if (computed.finalWinner && !computed.hasTie) {
      const ref = doc(db, "sessions", sessionId);
      setDoc(ref, { completedAt: Date.now() }, { merge: true }).catch(() => {});
    }
  }, [computed.finalWinner, computed.hasTie, usingCloud, db, sessionId]);

  // Join link role hint → auto-add as owner when possible
  useEffect(() => {
    if (!fbEnabled || !db || !sessionId || !user || !state) return;
    const amOwner = state.owners.some((o) => o.id === user.uid);
    if (amOwner) return;
    if (roleHint !== "owner") return;
    if ((state.owners || []).length >= (state.maxOwners || 2)) return;
    setState((s) => {
      const next = { ...s };
      next.owners = [
        ...s.owners,
        {
          id: user.uid,
          email: user.email || "",
          displayName: user.displayName || user.email || "Owner",
          names: ensure10([]),
        },
      ];
      return next;
    });
    const ref = doc(db, "sessions", sessionId);
    updateDoc(ref, { ownerIds: arrayUnion(user.uid) }).catch(() => {});
  }, [fbEnabled, db, sessionId, user, roleHint, state?.owners?.length, state?.maxOwners]);

  const headerAccent = "bg-gradient-to-r from-sky-500 to-rose-500";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className={`${headerAccent} text-white`}>
        <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Baby size={22} />
            </div>
            <div className="font-semibold text-lg tracking-tight">
              BabyName Duel
            </div>
            <span className="text-white/70 text-sm ml-2 hidden sm:inline">
              Owners + voters, fair scoring.
            </span>
          </div>
          <button
            onClick={() => {
              resetLocal();
              setSessionId("");
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 transition px-3 py-2 text-sm"
            title="Reset local state (does not delete cloud data)"
          >
            <RefreshCcw size={16} /> Reset
          </button>
        </div>
      </header>

      {/* Session bar */}
      <div className="max-w-6xl mx-auto px-4 mt-4">
        <SessionBar
          fbEnabled={fbEnabled}
          db={db}
          auth={auth}
          user={user}
          needsAuth={needsAuth}
          sessionId={sessionId}
          setSessionId={setSessionId}
          state={state}
          setState={setState}
        />
      </div>

      {/* Auth gate or app */}
      {needsAuth ? (
        <div className="max-w-6xl mx-auto px-4 mt-6 mb-20">
          <AuthGate auth={auth} />
        </div>
      ) : (
        <>
          {/* Dashboard */}
          <div className="max-w-6xl mx-auto px-4 mt-4">
            <UserSessions db={db} user={user} onOpenSession={(id) => setSessionId(id)} />
          </div>

          {/* Hero */}
          <div className="max-w-6xl mx-auto px-4 mt-4">
            <Card className="p-5">
              <div className="flex flex-col sm:flex-row items-center gap-5">
                <BabySVG className="w-28 h-28" />
                <div className="flex-1">
                  <h1 className="text-2xl sm:text-3xl font-bold">
                    Find a name you all love
                  </h1>
                  <p className="text-slate-600 mt-1">
                    Owners enter lists, everyone scores with unique 1–10 per list. Lowest
                    total wins. Tie-break keeps it fair.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="px-2 py-1 rounded-lg bg-sky-100 text-sky-700">
                      {fbEnabled
                        ? user
                          ? `Signed in${user.email ? `: ${user.email}` : ""}`
                          : "Sign in required"
                        : "Local mode"}
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700">
                      Mobile friendly
                    </span>
                  </div>
                </div>
                <ToysSVG className="w-28 h-28" />
              </div>
            </Card>
          </div>

          {/* Main */}
          <main className="max-w-6xl mx-auto px-4 mt-6 mb-20 space-y-6">
            <OwnersEntry state={state} setState={setState} user={user} sessionId={sessionId} db={db} />
            <ScoringSection state={state} setState={setState} user={user} />
            <ResultsSection state={state} computed={computed} user={user} sessionId={sessionId} />
          </main>
        </>
      )}

      <footer className="text-center text-sm text-slate-500 py-10">
        Built with ❤️ using React & Tailwind.{" "}
        {fbEnabled ? (user ? "Cloud sync active." : "Sign in to use cloud.") : "Local only."}
      </footer>
    </div>
  );
}

/** ----------------- Session bar (invite + delete) ----------------- */
function SessionBar({
  fbEnabled,
  db,
  auth,
  user,
  needsAuth,
  sessionId,
  setSessionId,
  state,
  setState,
}) {
  const [showAuth, setShowAuth] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState("signin");
  const [authMsg, setAuthMsg] = useState("");

  const [joinId, setJoinId] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const canCreate = fbEnabled && !!user;

  // owner detection for Delete button
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    if (!db || !user || !sessionId) {
      setIsOwner(false);
      return;
    }
    const ref = doc(db, "sessions", sessionId);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data();
      setIsOwner(!!data && data.ownerId === user.uid);
    });
    return () => unsub && unsub();
  }, [db, user?.uid, sessionId]);

  function newCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }

  async function doCreate() {
    if (!canCreate) {
      setShowAuth(true);
      return;
    }
    const sid = newCode();
    setSessionId(sid);

    try {
      if (db && auth?.currentUser) {
        const me = auth.currentUser;
        const meOwner = {
          id: me.uid,
          email: me.email || "",
          displayName: me.displayName || me.email || "Owner",
          createdBy: true,
          names: ensure10([]),
        };
        await setDoc(
          doc(db, "sessions", sid),
          {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ownerId: me.uid,
            ownerEmail: me.email || null,
            members: [me.uid],
            ownerIds: [me.uid],
            voterIds: [],
            maxOwners: 2,
            state: { ...defaultState(), owners: [meOwner], maxOwners: 2 },
          },
          { merge: true }
        );
      }
    } catch {}

    setShowInvite(true);
  }

  async function deleteCurrent() {
    if (!db || !sessionId) return;
    if (!isOwner) {
      alert("Only the session owner can delete this session.");
      return;
    }
    const ok = window.confirm("Delete this session for everyone? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "sessions", sessionId));
      setSessionId("");
    } catch (e) {
      console.error(e);
      alert("Failed to delete session. Please try again.");
    }
  }

  async function onAuthSubmit(e) {
    e?.preventDefault();
    if (!auth) return;
    setAuthMsg("");
    try {
      if (mode === "signin") await signInWithEmailAndPassword(auth, email.trim(), pw);
      else await createUserWithEmailAndPassword(auth, email.trim(), pw);
      setShowAuth(false);
      setEmail("");
      setPw("");
    } catch (err) {
      setAuthMsg(err.message || "Authentication error");
    }
  }

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-sky-400 to-rose-500 text-white">
              <KeyRound size={16} />
            </div>
            <div className="font-medium">Session</div>
          </div>

        {!fbEnabled ? (
          <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
            Cloud disabled — add Firebase config to enable login & multi-device sessions.
          </div>
        ) : (
          <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-2">
              {user ? (
                <div className="text-sm text-slate-700">
                  Signed in{user.email ? `: ${user.email}` : ""}
                </div>
              ) : (
                <button
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={() => setShowAuth(true)}
                >
                  <LogIn size={16} className="inline mr-1" /> Sign in
                </button>
              )}
              {user ? (
                <button
                  className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-90"
                  onClick={() => signOut(auth)}
                >
                  <LogOut size={16} className="inline mr-1" /> Sign out
                </button>
              ) : null}
            </div>

            {!needsAuth && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={`inline-flex items-center gap-2 rounded-xl ${
                    canCreate
                      ? "bg-slate-900 text-white hover:opacity-90"
                      : "bg-slate-200 text-slate-500 cursor-not-allowed"
                  } px-3 py-2 text-sm`}
                  onClick={doCreate}
                  title={canCreate ? "Create a new session & invite" : "Sign in to create a session"}
                >
                  <PlusCircle size={16} /> Create session
                </button>

                <div className="flex items-center gap-2">
                  <input
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                    placeholder="Enter code"
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm w-28"
                  />
                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-3 py-2 text-sm hover:opacity-95"
                    onClick={() => joinId && setSessionId(joinId)}
                  >
                    <LogIn size={16} /> Join
                  </button>
                </div>

                {/* Permanent Invite button when a session is active */}
                {sessionId && fbEnabled && user && (
                  <button
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => setShowInvite(true)}
                    title="Invite owners/voters to this session"
                  >
                    <UserPlus size={16} /> Invite
                  </button>
                )}

                {/* Owner-only Delete button */}
                {sessionId && isOwner && (
                  <button
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-300 text-rose-700 px-3 py-2 text-sm hover:bg-rose-50"
                    onClick={deleteCurrent}
                    title="Delete this session for everyone"
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                )}

                {sessionId ? (
                  <div className="text-sm text-slate-600 flex items-center gap-2 ml-2">
                    <span>Code:</span>
                    <code className="px-2 py-1 rounded bg-slate-100">{sessionId}</code>
                    <button
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          `Owner link: ${makeLink(sessionId, { role: "owner" })}\nVoter link: ${makeLink(
                            sessionId,
                            { role: "voter" }
                          )}`
                        )
                      }
                    >
                      Copy links
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
        </div>

        {/* inline auth */}
        {showAuth && (
          <div className="mt-4 border rounded-xl p-4 bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">
                {mode === "signin" ? "Sign in" : "Create account"}
              </div>
              <button
                className="text-sm text-slate-600 underline"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
              </button>
            </div>
            <form onSubmit={onAuthSubmit} className="grid sm:grid-cols-3 gap-2">
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                type="password"
                required
                placeholder="Password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <button className="rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-3 py-2">
                {mode === "signin" ? "Sign in" : "Sign up"}
              </button>
            </form>
            {authMsg ? <div className="text-sm text-rose-600 mt-2">{authMsg}</div> : null}
          </div>
        )}
      </Card>

      {/* Invite modal */}
      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        sessionId={sessionId}
        db={db}
        state={state}
        setState={setState}
        creator={user}
      />
    </>
  );
}

/** ----------------- Invite Modal ----------------- */
function InviteModal({ open, onClose, sessionId, db, state, setState, creator }) {
  const [rows, setRows] = useState([{ email: "", role: "owner" }]);
  const [maxOwners, setMaxOwners] = useState(2);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setRows([{ email: "", role: "owner" }]);
    setMaxOwners(state?.maxOwners || 2);
    setErr("");
  }, [open]);

  if (!open) return null;
  const ownersCount = 1 + rows.filter((r) => r.role === "owner" && r.email.trim()).length;

  function setRow(i, patch) {
    setRows((prev) => {
      const copy = prev.slice();
      copy[i] = { ...copy[i], ...patch };
      if (i === prev.length - 1 && (copy[i].email || "").trim() && prev.length < 20) {
        copy.push({ email: "", role: "voter" });
      }
      return copy;
    });
  }
  function removeRow(i) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function sendInvites() {
    setErr("");
    if (!sessionId) {
      setErr("Missing session id");
      return;
    }
    const cleaned = rows
      .map((r) => ({ email: r.email.trim(), role: r.role }))
      .filter((r) => r.email);
    if (!cleaned.length) return setErr("Enter at least one email.");
    if (cleaned.some((r) => !isEmail(r.email))) return setErr("One or more emails are invalid.");
    if (ownersCount > maxOwners) return setErr(`Max ${maxOwners} owners (including you).`);

    try {
      if (db) {
        await setDoc(
          doc(db, "sessions", sessionId),
          { maxOwners, invited: cleaned, state: { ...state, maxOwners } },
          { merge: true }
        );
      }
      setState((s) => ({ ...s, maxOwners }));
    } catch (e) {
      console.warn("Failed to save invite list:", e);
    }

    const owners = cleaned.filter((r) => r.role === "owner").map((r) => r.email);
    const voters = cleaned.filter((r) => r.role === "voter").map((r) => r.email);
    const ownerLink = makeLink(sessionId, { role: "owner" });
    const voterLink = makeLink(sessionId, { role: "voter" });

    const subject = encodeURIComponent("You're invited to BabyName Duel");
    const bodyOwner = encodeURIComponent(
      `${creator?.email || "A friend"} invited you as an OWNER.\n\nOpen this link, sign in, and enter your 10 names:\n${ownerLink}\n\nThen score others’ lists 1–10 (each number once per list).`
    );
    const bodyVoter = encodeURIComponent(
      `${creator?.email || "A friend"} invited you as a VOTER.\n\nOpen this link, sign in, and score the owners’ lists:\n${voterLink}\n\nUse each number 1–10 exactly once per list.`
    );

    if (owners.length) {
      const to = encodeURIComponent(owners.join(","));
      window.open(`mailto:${to}?subject=${subject}&body=${bodyOwner}`, "_blank");
    }
    if (voters.length) {
      const to = encodeURIComponent(voters.join(","));
      window.open(`mailto:${to}?subject=${subject}&body=${bodyVoter}`, "_blank");
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center">
      <div className="w-[min(720px,92vw)] rounded-2xl bg-white shadow-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-lg flex items-center gap-2">
            <UserPlus size={18} /> Invite people
          </div>
          <button className="text-slate-500 hover:text-slate-700" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <label className="sm:col-span-1 text-sm text-slate-600">Max owners (incl. you)</label>
          <select
            className="sm:col-span-2 rounded-xl border border-slate-300 px-3 py-2"
            value={maxOwners}
            onChange={(e) => setMaxOwners(Number(e.target.value))}
          >
            <option value={2}>2 (couple)</option>
            <option value={3}>3 (throuple)</option>
          </select>
        </div>

        <div className="text-sm text-slate-700 font-medium mb-1">Invitees</div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr,160px,90px] gap-2">
              <input
                type="email"
                placeholder={`person${i + 1}@example.com`}
                className="rounded-xl border border-slate-300 px-3 py-2"
                value={r.email}
                onChange={(e) => setRow(i, { email: e.target.value })}
              />
              <select
                className="rounded-xl border border-slate-300 px-3 py-2"
                value={r.role}
                onChange={(e) => setRow(i, { role: e.target.value })}
              >
                <option value="owner">Owner</option>
                <option value="voter">Voter</option>
              </select>
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                onClick={() => removeRow(i)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="text-xs text-slate-500 mt-2">
          Owners (including you): {ownersCount} / {maxOwners}
        </div>
        {err ? <div className="text-sm text-rose-600 mt-2">{err}</div> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 text-sm"
            onClick={sendInvites}
          >
            <Mail size={16} className="inline mr-1" /> Send invites
          </button>
        </div>
      </div>
    </div>
  );
}

/** ----------------- Dashboard ----------------- */
function useUserSessions(db, user) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    if (!db || !user) return;
    const col = collection(db, "sessions");

    const unsubOwner = onQuerySnapshot(
      query(col, where("ownerId", "==", user.uid)),
      (snap) => {
        setSessions((prev) => {
          const map = new Map(prev.map((s) => [s.id, s]));
          snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
          return Array.from(map.values());
        });
      }
    );
    const unsubMember = onQuerySnapshot(
      query(col, where("members", "array-contains", user.uid)),
      (snap) => {
        setSessions((prev) => {
          const map = new Map(prev.map((s) => [s.id, s]));
          snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
          return Array.from(map.values());
        });
      }
    );
    return () => {
      unsubOwner();
      unsubMember();
    };
  }, [db, user]);

  const sorted = [...sessions].sort((a, b) => {
    const au = a.updatedAt || a.completedAt || a.createdAt || 0;
    const bu = b.updatedAt || b.completedAt || b.createdAt || 0;
    return bu - au;
  });

  const active = sorted.filter((s) => !s.completedAt);
  const history = sorted.filter((s) => !!s.completedAt);
  return { active, history };
}

function UserSessions({ db, user, onOpenSession }) {
  const { active, history } = useUserSessions(db, user);
  const [tab, setTab] = useState("active");
  const list = tab === "active" ? active : history;

  async function deleteById(id) {
    if (!db) return;
    const ok = window.confirm("Delete this session for everyone? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "sessions", id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete session.");
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <ListChecks size={16} /> Your Sessions
        </div>
        <div className="flex gap-2 text-sm">
          <button
            className={`px-3 py-1 rounded-lg border ${
              tab === "active"
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-300 hover:bg-slate-50"
            }`}
            onClick={() => setTab("active")}
          >
            Active ({active.length})
          </button>
          <button
            className={`px-3 py-1 rounded-lg border ${
              tab === "history"
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-300 hover:bg-slate-50"
            }`}
            onClick={() => setTab("history")}
          >
            History ({history.length})
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="text-sm text-slate-600 mt-3">
          {tab === "active" ? "No active sessions yet." : "No completed sessions yet."}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((s) => {
            const label = s?.state?.sessionLabel || "(no label)";
            const created = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
            const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "";
            const isOwner = s.ownerId === user?.uid;

            const a = makeLink(s.id, { role: "owner" });
            const v = makeLink(s.id, { role: "voter" });

            return (
              <div key={s.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Session {s.id}</div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      s.completedAt ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {s.completedAt ? "Completed" : "Active"}
                  </span>
                </div>
                <div className="text-sm text-slate-600 mt-1">{label}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {created && (
                    <>
                      Created: {created}
                      <br />
                    </>
                  )}
                  {updated && <>Updated: {updated}</>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-90"
                    onClick={() => onOpenSession(s.id)}
                  >
                    Open
                  </button>
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() =>
                      navigator.clipboard.writeText(
                        `Owner link: ${a}\nVoter link: ${v}`
                      )
                    }
                  >
                    Copy links
                  </button>
                  {isOwner && (
                    <button
                      className="rounded-lg border border-rose-300 text-rose-700 px-3 py-2 text-sm hover:bg-rose-50"
                      onClick={() => deleteById(s.id)}
                    >
                      <Trash2 className="inline mr-1" size={14} /> Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** ----------------- Owners entry ----------------- */
function OwnersEntry({ state, setState, user }) {
  const meId = user?.uid || "local";
  const owners = state.owners || [];

  function setOwnerName(ownerId, idx, field, value) {
    setState((s) => {
      const next = structuredClone(s);
      const owner = next.owners.find((o) => o.id === ownerId);
      if (!owner) return s;
      owner.names = ensure10(owner.names);
      if (field === "self") owner.names[idx].self = String(value);
      else owner.names[idx].label = value;
      return next;
    });
  }

  function hasFullOwner(owner) {
    const names = ensure10(owner.names);
    const labels = names.map((n) => n.label.trim()).filter(Boolean);
    if (labels.length !== 10) return false;
    const lowers = labels.map((l) => l.toLowerCase());
    if (new Set(lowers).size !== 10) return false;
    const selfVals = names.map((n) => Number(n.self || 0)).filter(Boolean);
    if (selfVals.length !== 10) return false;
    if (new Set(selfVals).size !== 10) return false;
    if (!selfVals.every((v) => v >= 1 && v <= 10)) return false;
    return true;
  }

  return (
    <Card className="p-5">
      <SectionTitle
        icon={Users}
        title="Owners: enter your 10 names & self-rank 1–10"
        subtitle="Each owner fills exactly 10 names and uses each number 1–10 once."
      />
      {owners.length === 0 ? (
        <div className="text-slate-600">
          No owners yet. The session creator can invite owners from the top bar.
        </div>
      ) : null}

      <div className="space-y-6">
        {owners.map((o) => {
          const mine = o.id === meId;
          const done = hasFullOwner(o);
          return (
            <div key={o.id || o.email || Math.random()} className="rounded-xl border border-slate-200">
              <div className="p-3 flex items-center justify-between bg-slate-50 rounded-t-xl">
                <div className="font-semibold flex items-center gap-2">
                  <UserSquare2 size={16} /> {o.displayName || o.email || "Owner"}
                  {mine ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700">
                      You
                    </span>
                  ) : null}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {done ? "Complete" : "Incomplete"}
                </span>
              </div>
              <div className="p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ensure10(o.names).map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr,110px] gap-2">
                      <input
                        className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                        placeholder={`Name ${idx + 1}`}
                        value={row.label}
                        onChange={(e) =>
                          mine && setOwnerName(o.id, idx, "label", e.target.value)
                        }
                        readOnly={!mine}
                      />
                      <select
                        className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-400"
                        value={row.self}
                        onChange={(e) =>
                          mine && setOwnerName(o.id, idx, "self", e.target.value)
                        }
                        disabled={!mine}
                      >
                        <option value="">Self</option>
                        {SCORES_1_10.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {!mine ? (
                  <div className="text-xs text-slate-500 mt-2">
                    Only this owner can edit their list.
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** ----------------- Scoring ----------------- */
function ScoringSection({ state, setState, user }) {
  const meId = user?.uid || "local";
  const owners = state.owners || [];

  function getScores(ownerId) {
    return state.scores?.[ownerId]?.[meId] || Array(10).fill("");
  }
  function setScore(ownerId, idx, value) {
    setState((s) => {
      const next = structuredClone(s);
      next.scores = next.scores || {};
      next.scores[ownerId] = next.scores[ownerId] || {};
      const arr = (next.scores[ownerId][meId] || Array(10).fill("")).slice();
      arr[idx] = String(value);
      next.scores[ownerId][meId] = arr;
      return next;
    });
  }

  function listDone(ownerId) {
    const arr = getScores(ownerId);
    const vals = arr.map(Number).filter(Boolean);
    return vals.length === 10 && new Set(vals).size === 10;
  }

  return (
    <Card className="p-5">
      <SectionTitle
        icon={Heart}
        title="Score owners’ lists"
        subtitle="For each list, use each number 1–10 exactly once."
      />
      {owners.length <= 1 ? (
        <div className="text-slate-600">
          Waiting for more owners to join and/or fill their lists.
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-1 gap-6">
        {owners.map((o) => {
          const mine = o.id === meId;
          const names = ensure10(o.names);
          const myScores = getScores(o.id);
          return (
            <div key={o.id || o.email || Math.random()} className="rounded-xl border border-slate-200">
              <div className="p-3 flex items-center justify-between bg-slate-50 rounded-t-xl">
                <div className="font-semibold">{o.displayName || o.email || "Owner"}’s list</div>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    listDone(o.id) ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {listDone(o.id) ? "Done" : "Incomplete"}
                </span>
              </div>
              <div className="p-3">
                {mine ? (
                  <div className="text-sm text-slate-600 mb-2">
                    You don’t score your own list.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {names.map((n, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr,110px] gap-2 items-center">
                        <div className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">
                          {n.label || <span className="text-slate-400">Name {idx + 1}</span>}
                        </div>
                        <select
                          className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                          value={myScores[idx]}
                          onChange={(e) => setScore(o.id, idx, e.target.value)}
                        >
                          <option value="">Score</option>
                          {optionsFor(myScores, idx).map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** ----------------- Results & tie ----------------- */
function useComputedResults(state) {
  const owners = state.owners || [];
  const scores = state.scores || {};
  const rows = [];
  owners.forEach((o) => {
    const names = ensure10(o.names);
    names.forEach((n, i) => {
      const label = (n.label || "").trim();
      const self = Number(n.self || 0);
      if (!label || !self) return;
      let total = self;
      const perOwner = scores[o.id] || {};
      Object.entries(perOwner).forEach(([raterId, arr]) => {
        if (raterId === o.id) return;
        const v = Number(arr?.[i] || 0);
        if (v) total += v;
      });
      rows.push({
        ownerId: o.id,
        ownerName: o.displayName || o.email || "Owner",
        label,
        index: i,
        total,
        self,
      });
    });
  });
  rows.sort((a, b) => a.total - b.total || a.label.localeCompare(b.label));
  const hasAny = rows.length > 0;
  const min = hasAny ? rows[0].total : null;
  const tied = hasAny ? rows.filter((r) => r.total === min) : [];
  const hasTie = tied.length > 1;
  const finalWinner = hasAny && !hasTie ? rows[0] : null;
  return { rows, hasAny, hasTie, tied, min, finalWinner };
}

function ResultsSection({ state, computed, user, sessionId }) {
  const { rows, hasAny, hasTie, min, tied, finalWinner } = computed;
  const [showTie, setShowTie] = useState(false);

  return (
    <Card className="p-5">
      <SectionTitle icon={Trophy} title="Results" subtitle="Lowest total wins. Live as people score." />
      {!hasAny ? (
        <div className="text-slate-600">
          Results will appear as owners finish self-ranking and people score.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 p-3 mb-3">
            {finalWinner ? (
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-sky-500 to-rose-500 text-white">
                  <Crown size={24} />
                </div>
                <div>
                  <div className="text-xl font-semibold">
                    Winner: <span className="text-rose-600">{finalWinner.label}</span>
                  </div>
                  <div className="text-sm text-slate-600">
                    Total {finalWinner.total} — from {finalWinner.ownerName}
                  </div>
                </div>
              </div>
            ) : hasTie ? (
              <div className="text-rose-700 bg-rose-50 px-3 py-2 rounded-lg inline-block">
                Tie at {min}. Re-score tied names to break it.
              </div>
            ) : null}
          </div>

          <div className="mb-2 font-semibold">Ranked list (lowest total first)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rows.map((r, i) => (
              <div
                key={`${r.ownerId}-${r.index}`}
                className="rounded-xl border border-slate-200 p-3 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">
                    {i + 1}. {r.label}
                  </div>
                  <div className="text-xs text-slate-600">From {r.ownerName}</div>
                </div>
                <div className="text-sm">
                  <span className="px-2 py-1 rounded-lg bg-sky-100 text-sky-700 mr-1">
                    Self: {r.self}
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700">
                    Total: {r.total}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {hasTie ? (
            <div className="mt-4">
              <button
                className="rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 font-medium hover:opacity-95"
                onClick={() => setShowTie(true)}
              >
                Start tie-breaker
              </button>
            </div>
          ) : null}

          {sessionId ? (
            <Card className="p-4 mt-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-sky-400 to-rose-500 text-white">
                  <Link2 size={18} />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">Share links</div>
                  <div className="text-sm text-slate-600">
                    Owners share the Owner link to add another owner; share the Voter link for
                    family & friends.
                  </div>
                  <div className="mt-2 grid sm:grid-cols-2 gap-2 text-sm">
                    <CopyRow label="Owner link" value={makeLink(sessionId, { role: "owner" })} />
                    <CopyRow label="Voter link" value={makeLink(sessionId, { role: "voter" })} />
                  </div>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      )}

      {/* Tie modal (UI only; can expand later to persist tie rounds) */}
      {hasTie && showTie ? (
        <TieModal onClose={() => setShowTie(false)} computed={computed} state={state} user={user} />
      ) : null}
    </Card>
  );
}

function CopyRow({ label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-600 whitespace-nowrap">{label}</span>
      <input className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" readOnly value={value} />
      <button
        className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-90"
        onClick={() => {
          navigator.clipboard.writeText(value);
        }}
      >
        Copy
      </button>
    </div>
  );
}

/** ----------------- Tie modal ----------------- */
function TieModal({ onClose, computed, state, user }) {
  const meId = user?.uid || "local";
  const candidates = computed.tied.map((t) => ({
    ownerId: t.ownerId,
    label: t.label,
    index: t.index,
  }));
  const myArr = (state.tie?.scoresByRater?.[meId] || Array(candidates.length).fill("")).slice();

  function setVal(idx, v) {
    const arr = myArr.slice();
    arr[idx] = String(v);
    state.tie = {
      round: state.tie?.round || 1,
      candidates,
      scoresByRater: { ...(state.tie?.scoresByRater || {}), [meId]: arr },
    };
  }

  const done = (() => {
    const vals = myArr.map(Number).filter(Boolean);
    return vals.length === candidates.length && new Set(vals).size === candidates.length;
  })();

  function options(idx) {
    const used = new Set(myArr.map((v, i) => (i === idx ? null : Number(v) || null)).filter(Boolean));
    const N = candidates.length;
    return Array.from({ length: N }, (_, i) => i + 1).filter((n) => !used.has(n));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center">
      <div className="w-[min(720px,92vw)] rounded-2xl bg-white shadow-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-lg flex items-center gap-2">
            <Crown size={18} /> Tie-breaker — score tied names
          </div>
          <button className="text-slate-500 hover:text-slate-700" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {candidates.map((c, idx) => (
            <div key={`${c.ownerId}-${c.index}`} className="grid grid-cols-[1fr,120px] gap-2 items-center">
              <div className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">{c.label}</div>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={myArr[idx] || ""}
                onChange={(e) => setVal(idx, e.target.value)}
              >
                <option value="">Score</option>
                {options(idx).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50" onClick={onClose}>
            Close
          </button>
          <button
            className="rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 text-sm disabled:opacity-50"
            disabled={!done}
            onClick={onClose}
          >
            Done
          </button>
        </div>

        <div className="text-xs text-slate-500 mt-2">
          Everyone can score the tie; totals will include the sum of tie-scores across all raters.
        </div>
      </div>
    </div>
  );
}

/** ----------------- Auth Gate ----------------- */
function AuthGate({ auth }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e?.preventDefault();
    if (!auth) return;
    setMsg("");
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setMsg(err.message || "Authentication error");
    }
  }

  async function google() {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      if (window.matchMedia("(max-width: 640px)").matches) {
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (err) {
      setMsg(err.message || "Google sign-in failed");
    }
  }

  return (
    <Card className="p-6">
      <SectionTitle title="Welcome to BabyName Duel" subtitle="Please sign in to continue." />
      <div className="grid sm:grid-cols-3 gap-3">
        <button
          onClick={google}
          className="sm:col-span-3 rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          title="Sign in with Google"
        >
          Continue with Google
        </button>

        <form onSubmit={submit} className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2"
          />
          <button className="rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-3 py-2">
            {mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <div className="sm:col-span-3 text-sm text-slate-600 mt-2">
          {mode === "signin" ? (
            <>
              Need an account?{" "}
              <button className="underline" onClick={() => setMode("signup")}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Have an account?{" "}
              <button className="underline" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          )}
        </div>

        {msg ? <div className="sm:col-span-3 text-sm text-rose-600">{msg}</div> : null}
      </div>
    </Card>
  );
}
