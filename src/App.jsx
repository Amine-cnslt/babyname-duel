// Canvas reopened for copy/paste — no functional changes
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
} from "lucide-react";

// Optional Firebase (for multi‑device sessions)
// Install: npm i firebase
// Provide config via Vite env (VITE_FIREBASE_*) or a global window.__BND.firebaseConfig in index.html
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

/**
 * BabyName Duel — Single‑Page React App
 * -------------------------------------
 * ✔ Clean, modern UI with bright blue/red accents
 * ✔ SVG baby/toys imagery, responsive layout
 * ✔ Flow: Entry → Sharing/Scoring → Results → Tie‑breaker
 * ✔ Privacy: partners never see the other's scores during scoring
 * ✔ Local persistence via localStorage
 * ✔ Unique score dropdowns that remove already used numbers
 * ✔ Multi‑device sessions with Firestore (optional, zero server code)
 * ✔ Multiple sessions saved; create/join by 6‑char code; live sync
 */

// ---------- Helpers
const range = (n) => Array.from({ length: n }, (_, i) => i);
const SCORE_OPTIONS = range(10).map((i) => i + 1); // 1..10
const emptyEntry = () => ({ name: "", score: "" });
const STORAGE_KEY = "babyname-duel-state-v2";
const SESSION_META_KEY = "babyname-duel-meta";

// Firebase lazy init
function getFirebaseConfig() {
  // Prefer Vite env
  const env = import.meta?.env || {};
  if (env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
    };
  }
  // Fallback to global embedded config
  if (typeof window !== "undefined" && window.__BND?.firebaseConfig) {
    return window.__BND.firebaseConfig;
  }
  return null;
}

function useFirestoreBackend() {
  const [enabled, setEnabled] = useState(false);
  const appRef = useRef(null);
  const dbRef = useRef(null);
  const authRef = useRef(null);

  useEffect(() => {
    const cfg = getFirebaseConfig();
    if (!cfg) return;
    try {
      const app = initializeApp(cfg);
      const auth = getAuth(app);
      signInAnonymously(auth).catch(() => {});
      const db = getFirestore(app);
      appRef.current = app; dbRef.current = db; authRef.current = auth;
      setEnabled(true);
    } catch (e) {
      console.warn("Firebase unavailable:", e);
      setEnabled(false);
    }
  }, []);

  return { enabled, db: dbRef.current };
}

const defaultState = () => ({
  coupleLabel: "",
  partners: { A: "Partner A", B: "Partner B" },
  entries: { A: range(10).map(emptyEntry), B: range(10).map(emptyEntry) },
  crossScores: { A_on_B: range(10).map(() => ""), B_on_A: range(10).map(() => "") },
  phase: "SETUP", // SETUP → ENTRY_A → ENTRY_B → SCORE_A_ON_B → SCORE_B_ON_A → RESULTS → TIE*
  tie: { round: 0, candidates: [], A_on_B: [], B_on_A: [] },
});

function usePersistentState() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultState();
    } catch (e) {
      return defaultState();
    }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);
  const reset = () => setState(defaultState());
  return [state, setState, reset];
}

// ---------- SVG Illustrations (inline, no network)
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
    <rect x="0" y="0" width="200" height="200" rx="24" fill="url(#bg)" opacity="0.1" />
    <circle cx="100" cy="90" r="60" fill="url(#skin)" stroke="#f43f5e" strokeWidth="2" />
    <circle cx="75" cy="85" r="6" fill="#0f172a" />
    <circle cx="125" cy="85" r="6" fill="#0f172a" />
    <path d="M75 115 C95 130, 105 130, 125 115" stroke="#0f172a" strokeWidth="4" fill="none" strokeLinecap="round" />
    <path d="M60 65 C80 45, 120 45, 140 65" stroke="#38bdf8" strokeWidth="6" fill="none" strokeLinecap="round" />
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
    <rect x="10" y="100" width="70" height="40" rx="8" fill="url(#toyB)"/>
    <rect x="90" y="80" width="60" height="60" rx="10" fill="url(#toyR)"/>
    <rect x="160" y="60" width="50" height="80" rx="12" fill="url(#toyB)"/>
    <circle cx="45" cy="140" r="10" fill="#0f172a"/>
    <circle cx="120" cy="140" r="10" fill="#0f172a"/>
    <circle cx="185" cy="140" r="10" fill="#0f172a"/>
  </svg>
);

// ---------- UI Primitives (MISSING BEFORE — now defined)
function Card({ children, className = "" }) {
  return (
    <div className={`rounded-2xl shadow-lg border border-slate-200 bg-white ${className}`}>{children}</div>
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
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="text-slate-500 text-sm">{subtitle}</p> : null}
      </div>
    </div>
  );
}

// ---------- Validation helpers
function validateTenUniqueScores(list) {
  const values = list.map((x) => Number(x?.score || x)).filter(Boolean);
  if (values.length !== 10) return { ok: false, msg: "Please score all 10 names." };
  const set = new Set(values);
  if (set.size !== 10) return { ok: false, msg: "Use each score 1–10 exactly once." };
  const inRange = values.every((v) => v >= 1 && v <= 10);
  if (!inRange) return { ok: false, msg: "Scores must be between 1 and 10." };
  return { ok: true };
}
function validateTenNames(list) {
  const names = list.map((x) => x.name.trim()).filter(Boolean);
  if (names.length !== 10) return { ok: false, msg: "Enter all 10 names." };
  const lower = names.map((n) => n.toLowerCase());
  const set = new Set(lower);
  if (set.size !== 10) return { ok: false, msg: "Names must be unique (within your list)." };
  return { ok: true };
}

// Compute which score options should be shown for a given index so that
// no duplicate selections appear (except the current cell's existing value).
function availableScoresFor(allScores, idx) {
  const used = new Set(allScores.map((v, i) => (i === idx ? null : Number(v) || null)).filter(Boolean));
  return SCORE_OPTIONS.filter((n) => !used.has(n));
}

// ---------- Dev tests (added)
function runDevTests() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("❌ Test failed:", msg);
      throw new Error("Test failed: " + msg);
    } else {
      console.log("✅", msg);
    }
  };
  console.groupCollapsed("BabyName Duel — DEV TESTS");
  // availableScoresFor
  const empty = Array(10).fill("");
  assert(availableScoresFor(empty, 0).length === 10, "All 10 scores available when none chosen");
  const a = [1, "", "", "", "", "", "", "", "", ""];
  const opts = availableScoresFor(a, 1);
  assert(opts.length === 9 && !opts.includes(1), "Used score removed from other dropdowns");
  // validateTenUniqueScores
  const okScores = [1,2,3,4,5,6,7,8,9,10];
  assert(validateTenUniqueScores(okScores).ok, "Unique 1..10 passes");
  const dupScores = [1,2,3,4,5,6,7,8,9,9];
  assert(!validateTenUniqueScores(dupScores).ok, "Duplicate scores fail");
  // validateTenNames
  const okNames = new Array(10).fill(null).map((_,i)=>({name:"Name"+i, score:i+1}));
  assert(validateTenNames(okNames).ok, "Ten unique names pass");
  console.groupEnd();
}

// ---------- App
export default function App() {
  const [state, setState, resetLocal] = usePersistentState();
  const { partners, entries, crossScores, phase, coupleLabel, tie } = state;

  // Dev tests once (non-production)
  useEffect(() => {
    try { if (import.meta?.env?.MODE !== "production") runDevTests(); } catch {}
  }, []);

  // Session / backend
  const { enabled: firestoreEnabled, db } = useFirestoreBackend();
  const [sessionId, setSessionId] = useState("");
  const [role, setRole] = useState("A"); // 'A' or 'B'
  const [usingCloud, setUsingCloud] = useState(false);
  const remoteWriteRef = useRef(false);

  // Read session metadata from URL/localStorage
  useEffect(() => {
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("sid");
    const as = url.searchParams.get("as");
    const meta = JSON.parse(localStorage.getItem(SESSION_META_KEY) || "{}");
    if (sid) setSessionId(sid);
    if (as === "A" || as === "B") setRole(as);
    if (meta.lastSessionId && !sid) setSessionId(meta.lastSessionId);
    if (meta.lastRole && !as) setRole(meta.lastRole);
  }, []);

  // Persist session meta
  useEffect(() => {
    localStorage.setItem(SESSION_META_KEY, JSON.stringify({ lastSessionId: sessionId, lastRole: role }));
  }, [sessionId, role]);

  // Subscribe to Firestore session
  useEffect(() => {
    if (!firestoreEnabled || !db || !sessionId) return;
    const ref = doc(db, "sessions", sessionId);
    setUsingCloud(true);
    let unsub = onSnapshot(ref, (snap) => {
      const data = snap.data();
      if (data?.state) {
        remoteWriteRef.current = true; // prevent echo write
        try { setState(data.state); } finally { remoteWriteRef.current = false; }
      }
    });
    (async () => {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { createdAt: Date.now(), state });
      }
    })();
    return () => unsub && unsub();
  }, [firestoreEnabled, db, sessionId]);

  // Push local state to Firestore on changes (throttled by remoteWriteRef)
  useEffect(() => {
    if (!usingCloud || !db || !sessionId) return;
    if (remoteWriteRef.current) return; // don't echo remote → local
    const ref = doc(db, "sessions", sessionId);
    // fire and forget; small docs
    setDoc(ref, { createdAt: Date.now(), state }, { merge: true }).catch(() => {});
  }, [state, usingCloud, db, sessionId]);

  const headerAccent = "bg-gradient-to-r from-sky-500 to-rose-500";

  function nextPhase(p) { setState((s) => ({ ...s, phase: p })); }

  // Results computation
  const results = useMemo(() => {
    const list = [];
    entries.A.forEach((item, idx) => {
      const own = Number(item.score || 0);
      const partner = Number(crossScores.B_on_A[idx] || 0);
      if (!item.name.trim()) return;
      if (!own || !partner) return;
      list.push({ label: item.name.trim(), owner: "A", own, partner, total: own + partner, index: idx });
    });
    entries.B.forEach((item, idx) => {
      const own = Number(item.score || 0);
      const partner = Number(crossScores.A_on_B[idx] || 0);
      if (!item.name.trim()) return;
      if (!own || !partner) return;
      list.push({ label: item.name.trim(), owner: "B", own, partner, total: own + partner, index: idx });
    });
    list.sort((a, b) => (a.total - b.total) || a.label.localeCompare(b.label));
    return list;
  }, [entries, crossScores]);

  const hasFullBaseScores = results.length === 20;
  const tieInfo = useMemo(() => {
    if (!hasFullBaseScores) return { tied: false, min: null, names: [] };
    const min = results[0]?.total ?? null;
    if (min === null) return { tied: false, min: null, names: [] };
    const names = results.filter((r) => r.total === min);
    return { tied: names.length > 1, min, names };
  }, [results, hasFullBaseScores]);

  // Actions
  function saveEntries(owner, idx, field, value) {
    setState((s) => {
      const copy = structuredClone(s);
      copy.entries[owner][idx][field] = field === "score" ? String(value) : value;
      return copy;
    });
  }
  function saveCross(ownerFrom, idx, value) {
    setState((s) => {
      const copy = structuredClone(s);
      if (ownerFrom === "A_on_B") copy.crossScores.A_on_B[idx] = String(value);
      else copy.crossScores.B_on_A[idx] = String(value);
      return copy;
    });
  }

  // Tie‑breaker state transitions
  function startTieBreaker() {
    if (!tieInfo.tied) return;
    const candidates = tieInfo.names.map((n) => ({ owner: n.owner, index: n.index, label: n.label }));
    setState((s) => ({ ...s, tie: { round: s.tie.round + 1, candidates, A_on_B: [], B_on_A: [] }, phase: "TIE_A_ON_B" }));
  }
  function saveTieScore(side, idx, value) {
    setState((s) => { const c = structuredClone(s); c.tie[side][idx] = String(value); return c; });
  }
  const tieResults = useMemo(() => {
    if (!tie.round) return [];
    const t = [];
    const tiedA = tie.candidates.filter((c) => c.owner === "A");
    const tiedB = tie.candidates.filter((c) => c.owner === "B");
    tiedA.forEach((c, i) => {
      const own = Number(entries.A[c.index]?.score || 0);
      const partner = Number(tie.B_on_A[i] || 0);
      if (own && partner) t.push({ label: c.label, owner: "A", own, partner, total: own + partner });
    });
    tiedB.forEach((c, i) => {
      const own = Number(entries.B[c.index]?.score || 0);
      const partner = Number(tie.A_on_B[i] || 0);
      if (own && partner) t.push({ label: c.label, owner: "B", own, partner, total: own + partner });
    });
    t.sort((a, b) => (a.total - b.total) || a.label.localeCompare(b.label));
    return t;
  }, [tie, entries]);
  const hasCompleteTieScores = useMemo(() => {
    if (!tie.round) return false;
    const countA = tie.candidates.filter((c) => c.owner === "A").length;
    const countB = tie.candidates.filter((c) => c.owner === "B").length;
    const okA = tie.A_on_B.length === countB && tie.A_on_B.every(Boolean);
    const okB = tie.B_on_A.length === countA && tie.B_on_A.every(Boolean);
    return okA && okB;
  }, [tie]);
  function finalizeTieResults() {
    if (!hasCompleteTieScores) return;
    const min = tieResults[0]?.total;
    const tied = tieResults.filter((r) => r.total === min);
    if (tied.length === 1) setState((s) => ({ ...s, phase: "RESULTS" }));
    else {
      const candidates = tied.map((n) => ({ owner: n.owner, index: entries[n.owner].findIndex((e) => e.name.trim() === n.label), label: n.label }));
      setState((s) => ({ ...s, tie: { round: s.tie.round + 1, candidates, A_on_B: [], B_on_A: [] }, phase: "TIE_A_ON_B" }));
    }
  }

  // ---------- UI
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className={`${headerAccent} text-white`}>
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl"><Baby size={22} /></div>
            <div className="font-semibold text-lg tracking-tight">BabyName Duel</div>
            <span className="text-white/70 text-sm ml-2 hidden sm:inline">Agree on a baby name—fairly.</span>
          </div>
          <button
            onClick={() => { resetLocal(); setSessionId(""); setUsingCloud(false); }}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 transition px-3 py-2 text-sm"
            title="Reset local state"
          >
            <RefreshCcw size={16} /> Reset
          </button>
        </div>
      </header>

      {/* Session Bar */}
      <div className="max-w-5xl mx-auto px-4 mt-4">
        <SessionBar
          firestoreEnabled={firestoreEnabled}
          usingCloud={usingCloud}
          sessionId={sessionId}
          setSessionId={setSessionId}
          role={role}
          setRole={setRole}
        />
      </div>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-4 mt-4">
        <Card className="p-5">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <BabySVG className="w-28 h-28" />
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold">Find a name you both love</h1>
              <p className="text-slate-600 mt-1">Simple 1–10 rankings, hidden while scoring. Lowest total wins. Automatic tie‑breaker if needed.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="px-2 py-1 rounded-lg bg-sky-100 text-sky-700">{usingCloud ? "Synced via Firestore" : "No backend (local)"}</span>
                <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700">Mobile friendly</span>
              </div>
            </div>
            <ToysSVG className="w-28 h-28" />
          </div>
        </Card>
      </div>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 mt-6 mb-20">
        {phase === "SETUP" && (
          <SetupCard state={state} setState={setState} onNext={() => (role === "A" ? nextPhase("ENTRY_A") : nextPhase("ENTRY_B"))} />
        )}
        {phase === "ENTRY_A" && (
          <EntryCard
            title={`${partners.A}: Enter your 10 names & rank 1–10`}
            owner="A"
            entries={entries.A}
            onChange={saveEntries}
            onNext={() => {
              const vNames = validateTenNames(entries.A);
              const vScores = validateTenUniqueScores(entries.A);
              if (!vNames.ok) return alert(vNames.msg);
              if (!vScores.ok) return alert(vScores.msg);
              nextPhase("ENTRY_B");
            }}
          />
        )}
        {phase === "ENTRY_B" && (
          <EntryCard
            title={`${partners.B}: Enter your 10 names & rank 1–10`}
            owner="B"
            entries={entries.B}
            onChange={saveEntries}
            onNext={() => {
              const vNames = validateTenNames(entries.B);
              const vScores = validateTenUniqueScores(entries.B);
              if (!vNames.ok) return alert(vNames.msg);
              if (!vScores.ok) return alert(vScores.msg);
              nextPhase("SCORE_A_ON_B");
            }}
          />
        )}
        {phase === "SCORE_A_ON_B" && (
          <ScoreCard
            title={`${partners.A}: Score ${partners.B}’s names (1–10, each once)`}
            subtitle="You won’t see their original ranks."
            names={entries.B.map((x) => x.name)}
            scores={crossScores.A_on_B}
            onChange={(idx, v) => saveCross("A_on_B", idx, v)}
            getOptions={(idx) => availableScoresFor(crossScores.A_on_B, idx)}
            onNext={() => {
              const ok = validateTenUniqueScores(crossScores.A_on_B);
              if (!ok.ok) return alert(ok.msg);
              nextPhase("SCORE_B_ON_A");
            }}
          />
        )}
        {phase === "SCORE_B_ON_A" && (
          <ScoreCard
            title={`${partners.B}: Score ${partners.A}’s names (1–10, each once)`}
            subtitle="You won’t see their original ranks."
            names={entries.A.map((x) => x.name)}
            scores={crossScores.B_on_A}
            onChange={(idx, v) => saveCross("B_on_A", idx, v)}
            getOptions={(idx) => availableScoresFor(crossScores.B_on_A, idx)}
            onNext={() => {
              const ok = validateTenUniqueScores(crossScores.B_on_A);
              if (!ok.ok) return alert(ok.msg);
              nextPhase("RESULTS");
            }}
          />
        )}

        {phase === "RESULTS" && (
          <ResultsCard
            partners={partners}
            results={results}
            coupleLabel={coupleLabel}
            hasTie={tieInfo.tied}
            tieMin={tieInfo.min}
            onStartTie={startTieBreaker}
            sessionId={sessionId}
            role={role}
          />
        )}

        {phase === "TIE_A_ON_B" && (
          <TieScoreCard
            round={tie.round}
            title={`${partners.A}: Tie‑break round ${tie.round} — score ${partners.B}’s tied names`}
            names={tie.candidates.filter((c) => c.owner === "B").map((c) => c.label)}
            scores={tie.A_on_B}
            onChange={(idx, v) => saveTieScore("A_on_B", idx, v)}
            getOptions={(idx) => availableScoresFor(tie.A_on_B, idx)}
            onNext={() => {
              const count = tie.candidates.filter((c) => c.owner === "B").length;
              if (count && (!tie.A_on_B.length || tie.A_on_B.some((x) => !x))) return alert("Please score all tied names (unique 1–10).");
              nextPhase("TIE_B_ON_A");
            }}
          />
        )}

        {phase === "TIE_B_ON_A" && (
          <TieScoreCard
            round={tie.round}
            title={`${partners.B}: Tie‑break round ${tie.round} — score ${partners.A}’s tied names`}
            names={tie.candidates.filter((c) => c.owner === "A").map((c) => c.label)}
            scores={tie.B_on_A}
            onChange={(idx, v) => saveTieScore("B_on_A", idx, v)}
            getOptions={(idx) => availableScoresFor(tie.B_on_A, idx)}
            onNext={() => {
              const count = tie.candidates.filter((c) => c.owner === "A").length;
              if (count && (!tie.B_on_A.length || tie.B_on_A.some((x) => !x))) return alert("Please score all tied names (unique 1–10).");
              finalizeTieResults();
            }}
          />
        )}

        {phase.startsWith("TIE_") && tieResults.length > 0 && (
          <TieResultsPreview results={tieResults} />
        )}
      </main>

      {/* Footer */}
      <footer className="text-center text-sm text-slate-500 py-10">
        Built with ❤️ using React & Tailwind. {usingCloud ? "Synced in the cloud." : "Your data stays in your browser."}
      </footer>
    </div>
  );
}

// ---------- Subcomponents
function SetupCard({ state, setState, onNext }) {
  const { coupleLabel, partners } = state;
  return (
    <Card className="p-5">
      <SectionTitle icon={Users} title="Set up your session" subtitle="Give your session a label and partner names (for the UI only)." />
      <div className="grid sm:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">Session label (optional)</span>
          <input
            className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="e.g., Sweet Pea Session"
            value={coupleLabel}
            onChange={(e) => setState((s) => ({ ...s, coupleLabel: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">Partner A</span>
          <input
            className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={partners.A}
            onChange={(e) => setState((s) => ({ ...s, partners: { ...s.partners, A: e.target.value || "Partner A" } }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">Partner B</span>
          <input
            className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={partners.B}
            onChange={(e) => setState((s) => ({ ...s, partners: { ...s.partners, B: e.target.value || "Partner B" } }))}
          />
        </label>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <PrivacyCurtainNote />
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 font-medium hover:opacity-95"
          onClick={onNext}
        >
          Start <Heart size={16} />
        </button>
      </div>
    </Card>
  );
}

function EntryCard({ title, owner, entries, onChange, onNext }) {
  return (
    <Card className="p-5">
      <SectionTitle icon={Baby} title={title} subtitle="Use each score 1–10 once. 1 = favorite, 10 = least." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entries.map((row, idx) => (
          <div key={idx} className="grid grid-cols-[1fr,110px] gap-2">
            <input
              className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder={`Name ${idx + 1}`}
              value={row.name}
              onChange={(e) => onChange(owner, idx, "name", e.target.value)}
            />
            <select
              className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-400"
              value={row.score}
              onChange={(e) => onChange(owner, idx, "score", e.target.value)}
            >
              <option value="">Score</option>
              {SCORE_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500">Tip: Make names unique in your list.</span>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 font-medium hover:opacity-95"
          onClick={onNext}
        >
          Done
        </button>
      </div>
    </Card>
  );
}

function ScoreCard({ title, subtitle, names, scores, onChange, getOptions, onNext }) {
  return (
    <Card className="p-5">
      <SectionTitle icon={Heart} title={title} subtitle={subtitle} />
      <PrivacyCurtain />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        {names.map((label, idx) => (
          <div key={idx} className="grid grid-cols-[1fr,110px] gap-2 items-center">
            <div className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">{label}</div>
            <select
              className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={scores[idx]}
              onChange={(e) => onChange(idx, e.target.value)}
            >
              <option value="">Score</option>
              {getOptions(idx).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-end">
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 font-medium hover:opacity-95"
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </Card>
  );
}

function ResultsCard({ partners, results, coupleLabel, hasTie, tieMin, onStartTie, sessionId, role }) {
  const winner = results[0];
  const shareUrlA = sessionId ? `${location.origin}${location.pathname}?sid=${sessionId}&as=A` : "";
  const shareUrlB = sessionId ? `${location.origin}${location.pathname}?sid=${sessionId}&as=B` : "";
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle icon={Trophy} title="Results" subtitle={coupleLabel ? `Session: ${coupleLabel}` : undefined} />
        {winner ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-500 to-rose-500 text-white">
              <Crown size={28} />
            </div>
            <div className="flex-1">
              <div className="text-2xl font-bold">Winner: <span className="text-rose-600">{winner.label}</span></div>
              <div className="text-slate-600 mt-1 text-sm">Total score {winner.total} — entered by {winner.owner === 'A' ? partners.A : partners.B}</div>
              {hasTie ? (
                <div className="mt-2 text-rose-700 bg-rose-50 inline-block px-3 py-1 rounded-lg">Tie at {tieMin}. Start tie‑breaker below.</div>
              ) : null}
            </div>
            {hasTie ? (
              <button onClick={onStartTie} className="rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 font-medium hover:opacity-95">
                Start tie‑breaker
              </button>
            ) : null}
          </div>
      ) : (
          <div className="text-slate-600">Results will appear once both partners finish scoring.</div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-3 font-semibold">Ranked list (lowest total first)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {results.map((r, i) => (
            <div key={`${r.owner}-${r.label}`} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{i + 1}. {r.label}</div>
                <div className="text-xs text-slate-600">{r.owner === 'A' ? 'Entered by ' + partners.A : 'Entered by ' + partners.B}</div>
              </div>
              <div className="text-sm">
                <span className="px-2 py-1 rounded-lg bg-sky-100 text-sky-700 mr-1">Own: {r.own}</span>
                <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700">Spouse: {r.partner}</span>
                <span className="ml-2 font-semibold">= {r.total}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {sessionId ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-sky-400 to-rose-500 text-white"><Link2 size={18} /></div>
            <div className="flex-1">
              <div className="font-semibold">Share this session</div>
              <div className="text-sm text-slate-600">Send these links so each partner can open and score on their own device.</div>
              <div className="mt-2 grid sm:grid-cols-2 gap-2 text-sm">
                <CopyRow label="Partner A link" value={shareUrlA} />
                <CopyRow label="Partner B link" value={shareUrlB} />
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <ShareTipsCard />
    </div>
  );
}

function TieScoreCard({ round, title, names, scores, onChange, getOptions, onNext }) {
  return (
    <Card className="p-5">
      <SectionTitle icon={Crown} title={title} subtitle="Re‑score only the tied names. Lowest total wins. Repeat until there’s a single winner." />
      <PrivacyCurtain />
      {names.length === 0 ? (
        <div className="text-slate-600">No tied names from this partner. Continue.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {names.map((label, idx) => (
            <div key={idx} className="grid grid-cols-[1fr,110px] gap-2 items-center">
              <div className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">{label}</div>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={scores[idx] || ""}
                onChange={(e) => onChange(idx, e.target.value)}
              >
                <option value="">Score</option>
                {getOptions(idx).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 flex items-center justify-end">
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-4 py-2 font-medium hover:opacity-95"
          onClick={onNext}
        >
          Continue
        </button>
      </div>
    </Card>
  );
}

function TieResultsPreview({ results }) {
  return (
    <Card className="p-5 mt-4">
      <div className="font-semibold mb-2">Tie‑break preview</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {results.map((r, i) => (
          <div key={`${r.owner}-${r.label}`} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{i + 1}. {r.label}</div>
              <div className="text-xs text-slate-600">Tie‑round scores</div>
            </div>
            <div className="text-sm">
              <span className="px-2 py-1 rounded-lg bg-sky-100 text-sky-700 mr-1">Own: {r.own}</span>
              <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700">Spouse: {r.partner}</span>
              <span className="ml-2 font-semibold">= {r.total}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ShareTipsCard() {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-sky-400 to-rose-500 text-white"><Share2 size={18} /></div>
        <div>
          <div className="font-semibold">Share & privacy tips</div>
          <ul className="list-disc pl-5 text-sm text-slate-600 mt-1 space-y-1">
            <li>Use the built‑in privacy curtain while scoring so your partner can’t see your picks.</li>
            <li>Local mode stores data in your browser. Cloud sessions sync live across devices and are saved per session.</li>
            <li>To enable cloud sessions, add a Firebase config (see instructions below).</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function PrivacyCurtainNote() {
  return (
    <div className="text-sm text-slate-600 flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-rose-500" />
      Use the privacy curtain on scoring screens so each partner’s scores stay hidden.
    </div>
  );
}

function PrivacyCurtain() {
  const [covered, setCovered] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setCovered((v) => !v)}
        className="mb-3 text-sm px-3 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-2"
        title="Hide current screen with a colored overlay while your partner sits down"
      >
        {covered ? "Disable" : "Enable"} privacy curtain
      </button>
      {covered && (
        <div className="absolute inset-0 z-10 rounded-xl bg-gradient-to-br from-sky-400/70 to-rose-500/70 backdrop-blur-sm grid place-items-center text-white text-lg font-semibold">
          Screen hidden — tap to reveal
          <div className="absolute inset-0" onClick={() => setCovered(false)} />
        </div>
      )}
    </div>
  );
}

function CopyRow({ label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-600 whitespace-nowrap">{label}</span>
      <input className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" readOnly value={value} />
      <button
        className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-90"
        onClick={() => { navigator.clipboard.writeText(value); }}
      >Copy</button>
    </div>
  );
}

function SessionBar({ firestoreEnabled, usingCloud, sessionId, setSessionId, role, setRole }) {
  const [joinId, setJoinId] = useState("");
  const [copied, setCopied] = useState(false);

  function newCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }

  const makeLink = (sid, as) => `${location.origin}${location.pathname}?sid=${sid}&as=${as}`;

  return (
    <Card className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-gradient-to-br from-sky-400 to-rose-500 text-white"><KeyRound size={16} /></div>
          <div className="font-medium">Session</div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-2 py-1 text-sm">
            <option value="A">I am Partner A</option>
            <option value="B">I am Partner B</option>
          </select>
        </div>

        {!firestoreEnabled ? (
          <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
            Cloud sync disabled — add Firebase config to enable multi‑device sessions.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-90"
              onClick={() => {
                const sid = newCode();
                setSessionId(sid);
                setCopied(false);
                const url = makeLink(sid, role);
                navigator.clipboard.writeText(url).then(() => setCopied(true));
              }}
            >
              <PlusCircle size={16} /> Create session
            </button>
            <div className="flex items-center gap-2">
              <input value={joinId} onChange={(e) => setJoinId(e.target.value.toUpperCase())} placeholder="Enter code" className="rounded-lg border border-slate-300 px-2 py-2 text-sm w-28" />
              <button
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-rose-500 text-white px-3 py-2 text-sm hover:opacity-95"
                onClick={() => setSessionId(joinId)}
              >
                <LogIn size={16} /> Join
              </button>
            </div>
            {sessionId ? (
              <div className="text-sm text-slate-600 flex items-center gap-2 ml-2">
                <span>Code:</span>
                <code className="px-2 py-1 rounded bg-slate-100">{sessionId}</code>
                <button
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                  onClick={() => navigator.clipboard.writeText(makeLink(sessionId, role))}
                >Copy my link</button>
                {copied ? <span className="text-slate-500">(copied)</span> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
