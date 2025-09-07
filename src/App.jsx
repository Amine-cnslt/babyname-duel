
import React, { useEffect, useMemo, useState } from "react";
import {
  Baby,
  Share2,
  X,
  Trash2,
  LogOut,
  Copy,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut as fbSignOut,
} from "firebase/auth";
import { api } from "./api";

// ---------- Small UI helpers ----------
const Button = ({ children, className = "", ...props }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-slate-200 hover:bg-slate-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

const PrimaryButton = ({ children, className = "", ...props }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 via-indigo-500 to-rose-500 hover:opacity-90 ${className}`}
    {...props}
  >
    {children}
  </button>
);

const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl bg-white shadow-sm border border-slate-200 ${className}`}>
    {children}
  </div>
);

// ---------- Header / Nav ----------
const TopNav = ({ user, onReset, onSignOut }) => {
  return (
    <div className="sticky top-0 z-10 w-full bg-white/70 backdrop-blur border-b border-slate-200">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <div className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-50">
            <Baby className="h-4 w-4 text-blue-600" />
          </div>
          BabyName Duel
          <span className="ml-3 text-xs font-normal text-slate-500">
            Owners + voters, fair scoring.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onReset} title="Clear current session">
            ⟳ Reset
          </Button>
          {user ? (
            <Button onClick={onSignOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ---------- Session Header (compact; replaces old banner) ----------
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
        <Button onClick={onOpenInvite}>
          <Share2 className="h-4 w-4" />
          Invite
        </Button>
        {onExit ? (
          <Button onClick={onExit}>
            <X className="h-4 w-4" />
            Exit
          </Button>
        ) : null}
      </div>
    </div>
  );
};

// ---------- Invite Modal ----------
const InviteModal = ({ open, onClose, sid, session }) => {
  if (!open) return null;

  const ownerLink =
    typeof window !== "undefined" && session
      ? `${window.location.origin}/?sid=${sid}&owner=1&token=${session.inviteOwnerToken}`
      : "";
  const voterLink =
    typeof window !== "undefined" && session
      ? `${window.location.origin}/?sid=${sid}&voter=1&token=${session.inviteVoterToken}`
      : "";

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied!");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Invite</h3>
          <button onClick={onClose}>
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {!session ? (
          <p className="mt-4 text-sm text-slate-600">
            Loading session details...
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-sm font-medium text-slate-700 mb-1">
                Owner link
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={ownerLink}
                />
                <Button onClick={() => copy(ownerLink)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Max owners: {session?.maxOwners ?? 2}
              </p>
            </div>

            <div>
              <div className="text-sm font-medium text-slate-700 mb-1">
                Voter link
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={voterLink}
                />
                <Button onClick={() => copy(voterLink)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Unlimited voters.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};

// ---------- Auth Card ----------
const AuthCard = ({ onGoogle, onEmailSignIn, onEmailSignUp, busy }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold">Welcome to BabyName Duel</h2>
      <p className="mt-1 text-sm text-slate-600">
        Please sign in to continue.
      </p>

      <div className="mt-6">
        <div className="relative my-2 text-center text-sm text-slate-500">
          Continue with Google
        </div>
        <PrimaryButton
          className="w-full justify-center"
          onClick={onGoogle}
          disabled={busy}
        >
          <Users className="h-4 w-4" />
          Sign in with Google
        </PrimaryButton>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PrimaryButton
          className="col-span-2 justify-center"
          onClick={() => onEmailSignIn(email, password)}
          disabled={busy}
        >
          Sign in
        </PrimaryButton>
        <button
          className="col-span-2 text-left text-sm text-blue-600 hover:underline"
          onClick={() => onEmailSignUp(email, password)}
          disabled={busy}
        >
          Need an account? Sign up
        </button>
      </div>
    </Card>
  );
};

// ---------- Create / Join ----------
const CreateJoin = ({ onCreate, onJoinOwner, onJoinVoter, busy }) => {
  const [title, setTitle] = useState("");
  const [maxOwners, setMaxOwners] = useState(2);

  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="text-lg font-semibold">Create a session</h3>
        <div className="mt-3 space-y-3">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Session title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Max owners</label>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={maxOwners}
              onChange={(e) => setMaxOwners(Number(e.target.value))}
            >
              <option value={2}>2</option>
              <option value={3}>3 (throuple)</option>
            </select>
          </div>
          <PrimaryButton
            onClick={() => onCreate({ title: title || "Untitled", maxOwners })}
            disabled={busy}
          >
            <UserPlus className="h-4 w-4" />
            Create
          </PrimaryButton>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-lg font-semibold">Join with token</h3>
        <div className="mt-3 space-y-3">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Session ID"
            value={sid}
            onChange={(e) => setSid(e.target.value.trim())}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Invite token"
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
          />
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={() => onJoinOwner({ sid, token })} disabled={busy}>
              Join as Owner
            </PrimaryButton>
            <Button onClick={() => onJoinVoter({ sid, token })} disabled={busy}>
              Join as Voter
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ---------- Owner List Editor (10 names + 1..10 self ranks) ----------
const OwnerListEditor = ({ initial, onSave, busy }) => {
  const [rows, setRows] = useState(() => {
    if (initial?.names?.length === 10) {
      return initial.names.map((n, idx) => ({
        name: n,
        rank: initial.selfRanks?.[n] ?? idx + 1,
      }));
    }
    // default 10 rows
    return Array.from({ length: 10 }, (_, i) => ({ name: "", rank: i + 1 }));
  });

  const usedRanks = useMemo(() => new Set(rows.map((r) => Number(r.rank))), [rows]);

  const setRow = (i, patch) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const canSave =
    rows.every((r) => r.name.trim().length > 0) &&
    new Set(rows.map((r) => r.name.trim().toLowerCase())).size === 10 &&
    rows.every((r) => r.rank >= 1 && r.rank <= 10) &&
    new Set(rows.map((r) => Number(r.rank))).size === 10;

  const handleSave = () => {
    const names = rows.map((r) => r.name.trim());
    const selfRanks = {};
    rows.forEach((r) => (selfRanks[r.name.trim()] = Number(r.rank)));
    onSave({ names, selfRanks });
  };

  return (
    <Card className="p-5">
      <h3 className="text-lg font-semibold">Your list (10 unique names)</h3>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={`Name #${i + 1}`}
              value={r.name}
              onChange={(e) => setRow(i, { name: e.target.value })}
            />
            <select
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={r.rank}
              onChange={(e) => setRow(i, { rank: Number(e.target.value) })}
            >
              {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          Ranks must be 1–10 and used exactly once.
        </div>
        <PrimaryButton onClick={handleSave} disabled={!canSave || busy}>
          Save list
        </PrimaryButton>
      </div>
    </Card>
  );
};

// ---------- Scoring Panel ----------
const ScoringPanel = ({ lists, userUid, onSubmitScore, busy }) => {
  // For each OTHER owner's list, the rater assigns 1..10 uniquely.
  const [selections, setSelections] = useState({}); // key: ownerUid -> { [name]: scoreValue }

  useEffect(() => {
    // Reset when lists change
    setSelections({});
  }, [lists]);

  const submitForOwner = async (ownerUid, mapping) => {
    const values = Object.values(mapping || {});
    const valid =
      values.length === 10 &&
      values.every((v) => v >= 1 && v <= 10) &&
      new Set(values).size === 10;
    if (!valid) {
      alert("Please assign each score 1..10 exactly once for this list.");
      return;
    }
    // Write each (scoreValue, name)
    for (const [name, scoreValue] of Object.entries(mapping)) {
      // Owner cannot score own list (enforced by rules; we avoid calling too)
      if (ownerUid === userUid) continue;
      // eslint-disable-next-line no-await-in-loop
      await onSubmitScore(ownerUid, Number(scoreValue), name);
    }
    alert("Scores submitted for that list!");
  };

  return (
    <div className="space-y-4">
      {Object.entries(lists).map(([ownerUid, list]) => {
        if (!list?.names?.length || ownerUid === userUid) return null;
        const mapping = selections[ownerUid] || {};
        const used = new Set(Object.values(mapping).map(Number));

        return (
          <Card key={ownerUid} className="p-5">
            <h3 className="text-lg font-semibold">Score list: {ownerUid.slice(0, 6)}</h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {list.names.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {name}
                  </div>
                  <select
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={mapping[name] || ""}
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [ownerUid]: { ...(prev[ownerUid] || {}), [name]: e.target.value },
                      }))
                    }
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
                      <option key={n} value={n} disabled={used.has(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <PrimaryButton
                onClick={() => submitForOwner(ownerUid, mapping)}
                disabled={busy}
              >
                Submit scores
              </PrimaryButton>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

// ---------- Results Panel ----------
const ResultsPanel = ({ lists, scores }) => {
  // Compute totals per listOwner per name
  const rows = useMemo(() => {
    const out = [];
    const scoresByOwner = {};
    for (const s of scores) {
      if (!scoresByOwner[s.listOwnerUid]) scoresByOwner[s.listOwnerUid] = {};
      scoresByOwner[s.listOwnerUid][s.name] =
        (scoresByOwner[s.listOwnerUid][s.name] || 0) + Number(s.scoreValue || 0);
    }

    Object.entries(lists).forEach(([ownerUid, list]) => {
      if (!list?.names?.length) return;
      list.names.forEach((name) => {
        const self = Number(list.selfRanks?.[name] ?? 0);
        const crowd = Number(scoresByOwner?.[ownerUid]?.[name] ?? 0);
        out.push({
          ownerUid,
          name,
          self,
          crowd,
          total: self + crowd,
        });
      });
    });
    // sort ascending by total
    out.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
    return out;
  }, [lists, scores]);

  // Detect tie at the top (optional display)
  const topTotal = rows.length ? rows[0].total : null;
  const topNames = rows.filter((r) => r.total === topTotal).map((r) => r.name);
  const tie = topNames.length > 1;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Live results</h3>
        {tie ? (
          <div className="text-xs font-medium text-rose-600">
            Tie detected: {topNames.join(", ")} — use tie-breaker
          </div>
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Owner</th>
              <th className="py-2 pr-4">Self</th>
              <th className="py-2 pr-4">Crowd</th>
              <th className="py-2 pr-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-t">
                <td className="py-2 pr-4">{r.name}</td>
                <td className="py-2 pr-4 text-slate-500">{r.ownerUid.slice(0, 6)}</td>
                <td className="py-2 pr-4">{r.self}</td>
                <td className="py-2 pr-4">{r.crowd}</td>
                <td className="py-2 pr-4 font-semibold">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// ---------- Main App ----------
export default function App() {
  const auth = getAuth();

  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const [activeSid, setActiveSid] = useState(null);
  const [sessionDoc, setSessionDoc] = useState(null);
  const [lists, setLists] = useState({}); // ownerUid -> { names, selfRanks }
  const [scores, setScores] = useState([]); // [{listOwnerUid, raterUid, scoreValue, name, ...}]

  const [inviteOpen, setInviteOpen] = useState(false);

  // --- Auth state listener ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, [auth]);

  // --- Parse invite query on sign-in ---
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("sid");
    const owner = url.searchParams.get("owner");
    const voter = url.searchParams.get("voter");
    const token = url.searchParams.get("token");

    const join = async () => {
      if (!sid || !token) return;
      try {
        setBusy(true);
        await api.joinWithToken({
          sid,
          token,
          asOwner: Boolean(owner) && owner !== "0",
        });
        setActiveSid(sid);
        // Keep URL clean
        window.history.replaceState({}, "", window.location.pathname);
      } catch (e) {
        console.error(e);
        alert(`Join failed: ${e.message || String(e)}`);
      } finally {
        setBusy(false);
      }
    };
    join();
  }, [user]);

  // --- Session live listeners ---
  useEffect(() => {
    if (!activeSid) return;
    const unsub = api.onSessionSnapshot(activeSid, {
      onLists: (qsnap) => {
        const m = {};
        qsnap.forEach((d) => (m[d.id] = d.data()));
        setLists(m);
      },
      onScores: (qsnap) => {
        const a = [];
        qsnap.forEach((d) => a.push({ id: d.id, ...d.data() }));
        setScores(a);
      },
      onSession: (dsnap) => {
        setSessionDoc(dsnap.data());
      },
    });
    return () => unsub();
  }, [activeSid]);

  // --- Auth handlers ---
  const signInGoogle = async () => {
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      console.error(e);
      alert(e.message || "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const signInEmail = async (email, password) => {
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      console.error(e);
      alert(e.message || "Email sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const signUpEmail = async (email, password) => {
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      console.error(e);
      alert(e.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await fbSignOut(auth);
      setActiveSid(null);
      setSessionDoc(null);
      setLists({});
      setScores([]);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // --- Session actions ---
  const createSession = async ({ title, maxOwners }) => {
    setBusy(true);
    try {
      const { sid } = await api.createSession({ title, maxOwners });
      setActiveSid(sid);
    } catch (e) {
      console.error(e);
      alert(e.message || "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const joinAsOwner = async ({ sid, token }) => {
    setBusy(true);
    try {
      await api.joinWithToken({ sid, token, asOwner: true });
      setActiveSid(sid);
    } catch (e) {
      console.error(e);
      alert(e.message || "Join failed");
    } finally {
      setBusy(false);
    }
  };

  const joinAsVoter = async ({ sid, token }) => {
    setBusy(true);
    try {
      await api.joinWithToken({ sid, token, asOwner: false });
      setActiveSid(sid);
    } catch (e) {
      console.error(e);
      alert(e.message || "Join failed");
    } finally {
      setBusy(false);
    }
  };

  const saveOwnerList = async ({ names, selfRanks }) => {
    setBusy(true);
    try {
      await api.upsertOwnerList({ sid: activeSid, names, selfRanks });
    } catch (e) {
      console.error(e);
      alert(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const submitScore = async (listOwnerUid, scoreValue, name) => {
    setBusy(true);
    try {
      await api.submitScore({ sid: activeSid, listOwnerUid, scoreValue, name });
    } catch (e) {
      console.error(e);
      alert(e.message || "Score failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteSession = async () => {
    if (!window.confirm("Archive this session?")) return;
    setBusy(true);
    try {
      await api.deleteSession({ sid: activeSid });
      alert("Session archived. You can leave this page.");
    } catch (e) {
      console.error(e);
      alert(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const isOwner = useMemo(
    () => Boolean(user && sessionDoc?.ownerIds?.includes(user.uid)),
    [user, sessionDoc]
  );

  const myList = user ? lists[user.uid] : null;

  // --- Reset button clears current session context ---
  const doReset = () => {
    setActiveSid(null);
    setSessionDoc(null);
    setLists({});
    setScores([]);
    // clear URL
    window.history.replaceState({}, "", window.location.pathname);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <TopNav user={user} onReset={doReset} onSignOut={signOut} />

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Session header only when authenticated AND a session is active */}
        {user && activeSid ? (
          <SessionHeader
            sid={activeSid}
            onOpenInvite={() => setInviteOpen(true)}
            onExit={doReset}
          />
        ) : null}

        {!user ? (
          // ---------- Landing (no extra banner) ----------
          <div className="mt-4">
            <AuthCard
              onGoogle={signInGoogle}
              onEmailSignIn={signInEmail}
              onEmailSignUp={signUpEmail}
              busy={busy}
            />
            <p className="mt-8 text-center text-xs text-slate-500">
              Built with ❤️ using React & Tailwind. Sign in to use cloud.
            </p>
          </div>
        ) : !activeSid ? (
          // ---------- Dashboard: Create / Join ----------
          <div className="mt-4 space-y-4">
            <CreateJoin
              onCreate={createSession}
              onJoinOwner={joinAsOwner}
              onJoinVoter={joinAsVoter}
              busy={busy}
            />
          </div>
        ) : (
          // ---------- In-session ----------
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="p-5">
                <h3 className="text-lg font-semibold">Session</h3>
                {sessionDoc ? (
                  <div className="mt-2 text-sm text-slate-600">
                    <div>Title: <span className="font-medium">{sessionDoc.title}</span></div>
                    <div>Owners: {sessionDoc.ownerIds?.length || 1} / {sessionDoc.maxOwners || 2}</div>
                    <div>Status: {sessionDoc.status}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button onClick={() => setInviteOpen(true)}>
                        <Share2 className="h-4 w-4" /> Invite
                      </Button>
                      {isOwner ? (
                        <Button onClick={deleteSession} className="text-rose-600">
                          <Trash2 className="h-4 w-4" /> Archive
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600">Loading…</div>
                )}
              </Card>

              {isOwner ? (
                <OwnerListEditor initial={myList} onSave={saveOwnerList} busy={busy} />
              ) : (
                <Card className="p-5">
                  <h3 className="text-lg font-semibold">You are a voter</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Score each owner’s list using 1–10 exactly once per list.
                  </p>
                </Card>
              )}
            </div>

            <ScoringPanel
              lists={lists}
              userUid={user?.uid}
              onSubmitScore={submitScore}
              busy={busy}
            />

            <ResultsPanel lists={lists} scores={scores} />
          </div>
        )}
      </main>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        sid={activeSid}
        session={sessionDoc}
      />
    </div>
  );
}
