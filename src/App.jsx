import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Baby,
  Bell,
  Loader2,
  LogOut,
  Lock,
  MessageCircle,
  PlusCircle,
  RefreshCcw,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import LoginPage from "./components/LoginPage";
import * as api from "./api";
import { extractGoogleIdToken, signInWithGooglePopup, signOutFirebase } from "./firebase";

const Button = ({ children, className = "", variant = "secondary", ...props }) => {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition";
  const variants = {
    primary: "text-white bg-gradient-to-r from-blue-500 via-indigo-500 to-rose-500 hover:opacity-90",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    subtle: "text-slate-600 hover:bg-slate-100",
    danger: "border border-rose-200 text-rose-600 hover:bg-rose-50",
  };
  return (
    <button className={`${base} ${variants[variant] || variants.secondary} ${className}`} {...props}>
      {children}
    </button>
  );
};

const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl bg-white shadow-sm border border-slate-200 ${className}`}>{children}</div>
);

const formatDate = (value) => {
  if (!value) return "";
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
};

const useQueryParams = () => {
  if (typeof window === "undefined") {
    return {};
  }
  const params = new URLSearchParams(window.location.search || "");
  const entries = {};
  params.forEach((value, key) => {
    entries[key] = value;
  });
  return entries;
};

const TopNav = ({ user, onSignOut }) => (
  <div className="sticky top-0 z-20 w-full bg-white/80 backdrop-blur border-b border-slate-200">
    <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 text-slate-800 font-semibold">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50">
          <Baby className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold">
            BabyName <span className="font-extrabold text-pink-500">Duel</span>
          </span>
          <span className="text-xs font-normal text-slate-500">Owners, lists, fair scoring.</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {user ? (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            {user.email}
          </span>
        ) : (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            Not signed in
          </span>
        )}
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

const firstNameFromEmail = (email) => {
  if (!email) return "Someone";
  const name = email.split("@")[0].replace(/[._+\-]+/g, " ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Someone";
};

const NAME_FOCUS_LABELS = {
  girl: "Girls",
  boy: "Boys",
  mix: "Mix of both",
};

const buildRequiredNameOptions = (focus) => {
  const options = [];
  if (focus === "mix") {
    for (let n = 4; n <= 100; n += 4) {
      options.push(n);
    }
  } else {
    for (let n = 4; n <= 100; n += 2) {
      options.push(n);
    }
  }
  return options;
};

const getScoreDraftStorageKey = (sid, uid) =>
  sid && uid ? `bnd_score_drafts_${sid}_${uid}` : null;

const readScoreDraftsFromStorage = (sid, uid) => {
  if (typeof window === "undefined") return {};
  const key = getScoreDraftStorageKey(sid, uid);
  if (!key) return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) || {} : {};
  } catch (err) {
    console.warn("Unable to read score drafts", err);
    return {};
  }
};

const writeScoreDraftsToStorage = (sid, uid, drafts) => {
  if (typeof window === "undefined") return;
  const key = getScoreDraftStorageKey(sid, uid);
  if (!key) return;
  try {
    if (drafts && Object.keys(drafts).length) {
      window.localStorage.setItem(key, JSON.stringify(drafts));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn("Unable to persist score drafts", err);
  }
};

const getNotificationCopy = (note) => {
  const payload = (note && typeof note.payload === "object" && !Array.isArray(note.payload)) ? note.payload : {};
  const sessionTitle = payload.title ? `"${payload.title}"` : "this session";
  switch (note?.type) {
    case "session_invite":
      return {
        heading: "You’re invited!",
        body: `${firstNameFromEmail(payload.invitedBy)} invited you to be part of the magic moments crafting baby names for ${sessionTitle}.`,
      };
    case "participant_joined":
      return {
        heading: "New teammate arrived",
        body: `${firstNameFromEmail(payload.email)} just joined the fun. Give them a warm welcome!`,
      };
    case "list_submitted":
      return {
        heading: "Another list is ready",
        body: `${firstNameFromEmail(payload.by)} shared their shortlist. Time to sprinkle in your thoughts!`,
      };
    case "list_scored":
      return {
        heading: "Someone scored your list",
        body: `${firstNameFromEmail(payload.by)} finished scoring your names. The reveal is getting closer!`,
      };
    case "invites_locked":
      return {
        heading: "Invites are closed",
        body: `Invites for ${sessionTitle} are now closed—let the naming magic brew.`,
      };
    case "message":
      if (payload.direct) {
        return {
          heading: "A note just for you",
          body: `${firstNameFromEmail(payload.from)} sent you a private message. Take a peek when you can!`,
        };
      }
      return {
        heading: "New message",
        body: `${firstNameFromEmail(payload.from)} left a note for the crew. Take a peek when you can!`,
      };
    case "nudge":
      return {
        heading: "Friendly nudge",
        body: `${firstNameFromEmail(payload.from || payload.by)} is gently reminding you to share your list.`,
      };
    default:
      return {
        heading: "Update",
        body: "You have a new update in this session.",
      };
  }
};

const NotificationsPanel = ({ notifications, onRefresh, onMarkAll, onMarkSingle }) => {
  if (!notifications?.length) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Bell className="h-4 w-4" />
          No notifications yet.
        </div>
      </Card>
    );
  }

  const unread = notifications.filter((note) => !note.readAt).map((note) => note.id);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-700">Notifications</div>
          <Button variant="subtle" className="text-xs" onClick={onRefresh}>
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        {unread.length && onMarkAll ? (
          <Button onClick={onMarkAll} variant="subtle" className="text-xs">
            Mark all read
          </Button>
        ) : null}
      </div>
      <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
        {notifications.map((note) => (
          <div
            key={note.id}
            className={`rounded-lg border px-3 py-3 text-sm ${note.readAt ? "border-slate-100 bg-slate-50" : "border-indigo-100 bg-indigo-50"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {note.type.replace(/_/g, " ")}
                </div>
                {(() => {
                  const copy = getNotificationCopy(note);
                  return copy.isRaw ? (
                    <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{copy.body}</pre>
                  ) : (
                    <>
                      <div className="mt-1 text-sm font-semibold text-slate-700">{copy.heading}</div>
                      <div className="mt-0.5 text-xs text-slate-600">{copy.body}</div>
                    </>
                  );
                })()}
                {onMarkSingle ? (
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-medium text-indigo-600 hover:underline"
                    onClick={() => onMarkSingle(note.id)}
                  >
                    Mark as read
                  </button>
                ) : null}
              </div>
              <span className="text-[11px] uppercase tracking-wide text-slate-400">
                {formatDate(note.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const SessionsDashboard = ({ sessions, activeSid, onSelect, onOpenCreate, loading }) => {
  const activeSessions = sessions?.active ?? [];
  const archivedSessions = sessions?.archived ?? [];
  const [tab, setTab] = useState("active");

  useEffect(() => {
    if (tab === "active" && !activeSessions.length && archivedSessions.length) {
      setTab("archived");
    } else if (tab === "archived" && !archivedSessions.length && activeSessions.length) {
      setTab("active");
    }
  }, [tab, activeSessions.length, archivedSessions.length]);

  const visibleSessions = tab === "active" ? activeSessions : archivedSessions;
  const emptyMessage = tab === "active" ? "No active sessions yet." : "No archived sessions yet.";

  const renderSessionButton = (session) => (
    <button
      key={session.sid}
      onClick={() => onSelect(session.sid)}
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
        session.sid === activeSid ? "border-indigo-400 bg-indigo-50" : "border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-700">{session.title}</div>
          <div className="text-xs text-slate-500">Updated {formatDate(session.updatedAt)}</div>
        </div>
        <div className="text-xs text-slate-500 text-right">
          <div className="capitalize">{session.role}</div>
          <div>{session.requiredNames} names</div>
          <div>Focus: {NAME_FOCUS_LABELS[session.nameFocus] || NAME_FOCUS_LABELS.mix}</div>
        </div>
      </div>
    </button>
  );

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div>
          <div className="text-base font-semibold text-slate-700">Sessions</div>
          <div className="text-xs text-slate-500">Switch between active and archived duels.</div>
        </div>
        <Button variant="primary" onClick={onOpenCreate} disabled={loading}>
          <PlusCircle className="h-4 w-4" />
          New session
        </Button>
      </div>
      <div className="mt-5 flex border-b border-slate-200 px-5">
        {[
          { id: "active", label: "Active" },
          { id: "archived", label: "Archived" },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative -mb-px rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === id
                ? "bg-white text-indigo-600 border border-slate-200 border-b-white"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-2 px-5 pb-5 pt-4">
        {visibleSessions.length ? (
          <div className="space-y-2">
            {visibleSessions.map(renderSessionButton)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </Card>
  );
};

const CreateSessionModal = ({ open, busy, onClose, onCreate }) => {
  const [title, setTitle] = useState("");
  const [requiredNames, setRequiredNames] = useState(10);
  const [nameFocus, setNameFocus] = useState("mix");
  const [invites, setInvites] = useState([""]);
  const requiredOptions = useMemo(() => buildRequiredNameOptions(nameFocus), [nameFocus]);

  useEffect(() => {
    if (open) {
      setTitle("");
      setRequiredNames(10);
      setNameFocus("mix");
      setInvites([""]);
    }
  }, [open]);

  useEffect(() => {
    if (!requiredOptions.includes(requiredNames)) {
      setRequiredNames(requiredOptions[0] || 4);
    }
  }, [requiredOptions, requiredNames]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    const cleanedInvites = invites
      .map((value) => value.trim())
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .map((email) => ({ email }));
    await onCreate({ title: title.trim(), requiredNames, nameFocus, invites: cleanedInvites });
  };

  const updateInvite = (index, value) => {
    setInvites((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const addInviteField = () => {
    setInvites((prev) => [...prev, ""]);
  };

  const removeInviteField = (index) => {
    setInvites((prev) => (prev.length === 1 ? [""] : prev.filter((_, i) => i !== index)));
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-800">Create session</div>
            <div className="text-xs text-slate-500">Set the session details and add participants.</div>
          </div>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold text-slate-600">Session name</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Spring 2024 shortlist"
              required
              disabled={busy}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Name theme</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nameFocus}
              onChange={(e) => setNameFocus(e.target.value)}
              disabled={busy}
            >
              <option value="girl">Girls</option>
              <option value="boy">Boys</option>
              <option value="mix">Mix of both</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Required names per participant</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={requiredNames}
              onChange={(e) => setRequiredNames(Number(e.target.value))}
              disabled={busy}
            >
              {requiredOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">{nameFocus === "mix" ? "Mix sessions use multiples of four so everyone can share evenly." : "Single-focus sessions use even numbers so rankings stay balanced."}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600">Invite participants</label>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:underline"
                onClick={addInviteField}
                disabled={busy}
              >
                Add participant
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {invites.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="participant@example.com"
                    value={value}
                    onChange={(e) => updateInvite(index, e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                    onClick={() => removeInviteField(index)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="subtle" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              Create session
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ParticipantsPanel = ({
  session,
  isOwner,
  inviteBusy,
  onInvite,
  onRemove,
  onLockInvites,
  lockBusy,
  onMessage,
  directMessageBusy,
  currentUser,
}) => {
  const [email, setEmail] = useState("");
  const participants = session?.participantIds || session?.voterIds || [];
  const focusLabel = NAME_FOCUS_LABELS[session?.nameFocus] || NAME_FOCUS_LABELS.mix;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-slate-800">Participants</div>
          <div className="text-xs text-slate-500">Owner can invite or remove participants. Existing users join automatically.</div>
          <div className="text-xs text-indigo-600">Name theme: {focusLabel}</div>
        </div>
        {isOwner ? (
          <Button onClick={onLockInvites} disabled={lockBusy || session?.invitesLocked}>
            {lockBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {session?.invitesLocked ? "Invites locked" : "Lock invites"}
          </Button>
        ) : null}
      </div>

      {isOwner ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!email.trim()) return;
            await onInvite(email.trim());
            setEmail("");
          }}
          className="flex gap-2"
        >
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Invite by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={inviteBusy}
          />
          <Button type="submit" variant="primary" disabled={inviteBusy}>
            {inviteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Invite
          </Button>
        </form>
      ) : null}

      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {(session?.ownerIds || []).map((uid) => (
          <div key={uid} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-700">{uid}</div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-600">Owner</span>
          </div>
        ))}
        {participants.map((uid) => (
          <div key={uid} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div>
              <div className="font-medium text-slate-700">{uid}</div>
              <div className="text-xs text-slate-500">List status: {session?.listStates?.[uid]?.status || "draft"}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="subtle"
                className="text-xs"
                onClick={() => onMessage(uid)}
                disabled={directMessageBusy}
                title="Send a private message"
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
              {isOwner ? (
                <Button
                  variant="danger"
                  className="text-xs"
                  onClick={() => onRemove(uid)}
                  disabled={uid === currentUser?.email}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {!participants.length && !session?.ownerIds?.length ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
            No participants yet.
          </div>
        ) : null}
      </div>
    </Card>
  );
};

const ListEditor = ({
  requiredNames,
  nameFocus,
  listState,
  onChangeName,
  onChangeRank,
  onSave,
  onSubmit,
  canEdit,
  busy,
}) => {
  const names = listState.names;
  const ranks = listState.ranks;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-slate-800">Your list</div>
          <div className="text-xs text-slate-500">
            Provide exactly {requiredNames} distinct names. Assign each a ranking from 1 to {requiredNames} with no duplicates. Drafts allow blanks or rank 0.
          </div>
          <div className="text-xs text-indigo-600">Focus: {NAME_FOCUS_LABELS[nameFocus] || NAME_FOCUS_LABELS.mix}</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          listState.status === "submitted" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-600"
        }`}>
          {listState.status === "submitted" ? "Submitted" : "Draft"}
        </span>
      </div>

      <div className="grid gap-2">
        {names.map((value, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={`Name ${index + 1}`}
              value={value}
              onChange={(e) => {
                if (!canEdit || busy) return;
                onChangeName(index, e.target.value);
              }}
              disabled={!canEdit || busy}
            />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={ranks[index] ?? ""}
              onChange={(e) => {
                if (!canEdit || busy) return;
                onChangeRank(index, Number(e.target.value));
              }}
              disabled={!canEdit || busy}
            >
              <option value="">Rank</option>
              <option value={0}>0</option>
              {Array.from({ length: requiredNames }, (_, i) => i + 1).map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button onClick={onSave} disabled={!canEdit || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save draft
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={!canEdit || busy}>
            Submit for voting
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Your list has been submitted and is now read-only.
        </div>
      )}
    </Card>
  );
};

const ScoringPanel = ({
  lists,
  scores,
  currentUser,
  requiredNames,
  nameFocus,
  draftState,
  onSaveDraft,
  onSubmitScores,
  submitting,
}) => {
  const myUid = currentUser?.email;
  const otherLists = useMemo(() => {
    if (!lists || !myUid) return [];
    return Object.entries(lists)
      .filter(([ownerUid, data]) => ownerUid !== myUid && data.status === "submitted")
      .map(([ownerUid, data]) => ({ ownerUid, ...data }));
  }, [lists, myUid]);

  if (!otherLists.length) {
    return (
      <Card className="p-5">
        <div className="text-sm text-slate-500">No submitted lists from other participants yet.</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {otherLists.map((entry) => (
        <Card key={entry.ownerUid} className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold text-slate-800">Score {entry.ownerUid}</div>
              <div className="text-xs text-slate-500">Assign each name a rank 1…{requiredNames}. Use every rank exactly once.</div>
              <div className="text-xs text-indigo-600">Focus: {NAME_FOCUS_LABELS[nameFocus] || NAME_FOCUS_LABELS.mix}</div>
            </div>
          </div>
          <div className="grid gap-2">
            {entry.names.map((name) => {
              const scoreRow = scores[entry.ownerUid]?.[name];
              return (
                <div key={name} className="grid grid-cols-[minmax(0,1fr)_160px] gap-2 text-sm">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">{name}</div>
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
                      value={scoreRow?.value ?? ""}
                      onChange={(e) => scoreRow?.set(e.target.value)}
                    >
                      <option value="">Rank</option>
                      {Array.from({ length: requiredNames }, (_, i) => i + 1).map((rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => onSaveDraft(entry.ownerUid)}
              disabled={
                submitting === entry.ownerUid ||
                !(draftState?.[entry.ownerUid] && Object.keys(draftState[entry.ownerUid]).length)
              }
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              onClick={() => onSubmitScores(entry.ownerUid)}
              disabled={submitting === entry.ownerUid}
            >
              {submitting === entry.ownerUid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit scores
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
};

const ResultsPanel = ({ lists, scores, requiredNames, invitesLocked }) => {
  const aggregated = useMemo(() => {
    if (!invitesLocked || !lists) return [];
    const tally = {};
    Object.entries(scores || {}).forEach(([ownerUid, entries]) => {
      Object.entries(entries).forEach(([name, meta]) => {
        if (typeof meta.value !== "number") return;
        tally[ownerUid] = tally[ownerUid] || { total: 0, count: 0, names: {} };
        tally[ownerUid].total += meta.value;
        tally[ownerUid].count += 1;
        tally[ownerUid].names[name] = (tally[ownerUid].names[name] || 0) + meta.value;
      });
    });
    return Object.entries(tally)
      .map(([ownerUid, entry]) => ({
        ownerUid,
        average: entry.count ? entry.total / entry.count : 0,
        detail: entry.names,
      }))
      .sort((a, b) => a.average - b.average);
  }, [scores, lists, invitesLocked]);

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-slate-800">Results</div>
        <div className="text-xs text-slate-500">
          {invitesLocked
            ? "Scores reveal once everyone finishes. Lower scores are better."
            : "Scores remain hidden until invites are locked."}
        </div>
      </div>

      {!invitesLocked ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
          Waiting for the owner to lock invites before revealing totals.
        </div>
      ) : (
        <div className="space-y-3">
          {aggregated.length ? (
            aggregated.map((row, index) => (
              <div key={row.ownerUid} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-700">
                    #{index + 1} · {row.ownerUid}
                  </div>
                  <div className="text-sm text-slate-500">Average rank: {row.average.toFixed(2)}</div>
                </div>
                <div className="mt-1 grid gap-1 text-xs text-slate-500">
                  {Object.entries(row.detail).map(([name, value]) => (
                    <div key={name} className="flex justify-between">
                      <span>{name}</span>
                      <span>Score sum: {value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
              No scores yet.
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const MessagesPanel = ({ messages, onSend, busy, participants, currentUser }) => {
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState("all");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!body.trim()) return;
    await onSend({ body: body.trim(), recipient: recipient === "all" ? null : recipient });
    setBody("");
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="text-base font-semibold text-slate-800">Messages</div>
      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
        {messages.length ? (
          messages.map((message) => (
            <div key={message.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {message.sender === currentUser?.email ? "You" : message.sender}
                  {message.recipient ? (
                    <>
                      {" → "}
                      {message.recipient === currentUser?.email ? "You" : message.recipient}
                    </>
                  ) : " → All"}
                </span>
                <span>{formatDate(message.createdAt)}</span>
              </div>
              <div className="mt-1 text-slate-700">{message.body}</div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
            No messages yet.
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          placeholder="Write a note or reminder"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy}
        />
        <div className="flex items-center justify-between">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={busy}
          >
            <option value="all">All participants</option>
            {participants.map((uid) => (
              <option key={uid} value={uid}>
                {uid}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("bnd_user") || "null");
    } catch {
      return null;
    }
  });
  const [sessions, setSessions] = useState({ active: [], archived: [] });
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [activeSid, setActiveSid] = useState(null);
  const [sessionDoc, setSessionDoc] = useState(null);
  const [lists, setLists] = useState({});
  const [scores, setScores] = useState({});
  const [messages, setMessages] = useState([]);
  const [listDraft, setListDraft] = useState({ names: [], ranks: [], status: "draft" });
  const [scoreDrafts, setScoreDrafts] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [scoreSubmitting, setScoreSubmitting] = useState(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [directMessageBusy, setDirectMessageBusy] = useState(false);
  const [pendingJoin, setPendingJoin] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const queryParams = useQueryParams();

  useEffect(() => {
    if (queryParams.sid && queryParams.token) {
      setPendingJoin({ sid: queryParams.sid, token: queryParams.token });
    }
  }, [queryParams.sid, queryParams.token]);

  useEffect(() => {
    if (!user) return;
    const loadNotifications = async () => {
      try {
        const res = await api.fetchNotifications({ email: user.email });
        setNotifications(res.notifications || []);
      } catch (err) {
        console.error("Notifications load failed", err);
      }
    };
    loadNotifications();
  }, [user]);

  const refreshNotifications = async () => {
    if (!user) return;
    try {
      const res = await api.fetchNotifications({ email: user.email });
      setNotifications(res.notifications || []);
    } catch (err) {
      console.error(err);
    }
  };

  const markNotifications = async (ids) => {
    if (!user || !ids.length) return;
    try {
      await api.markNotificationsRead({ email: user.email, ids });
      await refreshNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const markAllNotifications = async () => {
    if (!notifications.length) return;
    await markNotifications(notifications.map((note) => note.id));
  };

  const markNotification = async (id) => {
    await markNotifications([id]);
  };

  const loadSessions = async () => {
    if (!user) return;
    setSessionsBusy(true);
    try {
      const res = await api.fetchSessions({ email: user.email });
      setSessions({
        active: res.active || [],
        archived: res.archived || [],
      });
      if (activeSid) {
        const stillExists = [...(res.active || []), ...(res.archived || [])].some(
          (session) => session.sid === activeSid,
        );
        if (!stillExists) {
          setActiveSid(null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    } finally {
      setSessionsBusy(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadSessions();
  }, [user]);

  useEffect(() => {
    const joinIfNeeded = async () => {
      if (!user || !pendingJoin) return;
      try {
        await api.joinWithToken({ email: user.email, ...pendingJoin });
        await loadSessions();
        setActiveSid(pendingJoin.sid);
        await refreshNotifications();
        setPendingJoin(null);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("sid");
          url.searchParams.delete("token");
          window.history.replaceState({}, "", url.toString());
        }
      } catch (err) {
        console.error("Join failed", err);
        alert(err.message || "Unable to join session");
        setPendingJoin(null);
      }
    };
    joinIfNeeded();
  }, [user, pendingJoin]);

  const hydrateSession = (payload) => {
    const sessionData = {
      ...payload.session,
      nameFocus: payload.session?.nameFocus || "mix",
    };
    setSessionDoc(sessionData);
    setLists(payload.lists || {});
    const groupedScores = {};
    (payload.scores || []).forEach((row) => {
      groupedScores[row.listOwnerUid] = groupedScores[row.listOwnerUid] || {};
      groupedScores[row.listOwnerUid][row.name] = {
        value: row.scoreValue,
        rater: row.raterUid,
      };
    });
    setScores(groupedScores);
    setMessages(payload.messages || []);

    const sessionInfo = sessionData;
    const required = sessionInfo?.requiredNames || sessionInfo?.maxNames || 0;
    const myUid = user?.email;
    const myList = myUid ? (payload.lists || {})[myUid] : null;
    const names = Array.from({ length: required }, (_, i) => myList?.names?.[i] || "");
    const ranks = Array.from({ length: required }, (_, i) => {
      if (!myList || !myList.names?.[i]) return 0;
      const name = myList.names[i];
      return myList.selfRanks?.[name] ?? i + 1;
    });
    setListDraft({ names, ranks, status: myList?.status || payload.session?.listStates?.[myUid]?.status || "draft" });

    const draftScores = {};
    const myScores = (payload.scores || []).filter((row) => row.raterUid === myUid);
    myScores.forEach((row) => {
      draftScores[row.listOwnerUid] = draftScores[row.listOwnerUid] || {};
      draftScores[row.listOwnerUid][row.name] = row.scoreValue;
    });
    let mergedDrafts = { ...draftScores };
    const storedDrafts = readScoreDraftsFromStorage(sessionData.sid, user?.email);
    const cleanedStoredDrafts = {};
    if (storedDrafts && typeof storedDrafts === "object") {
      Object.entries(storedDrafts).forEach(([ownerUid, ownerDraft]) => {
        const listNames = (payload.lists || {})[ownerUid]?.names || [];
        const filtered = {};
        listNames.forEach((listName) => {
          const storedValue = ownerDraft?.[listName];
          const numeric = Number(storedValue);
          if (!Number.isNaN(numeric) && (mergedDrafts[ownerUid]?.[listName] === undefined)) {
            const duplicate = Object.entries(mergedDrafts[ownerUid] || {}).some(
              ([otherName, otherValue]) => otherName !== listName && otherValue === numeric,
            );
            if (!duplicate) {
              filtered[listName] = numeric;
            }
          }
        });
        if (Object.keys(filtered).length) {
          mergedDrafts[ownerUid] = { ...(mergedDrafts[ownerUid] || {}), ...filtered };
          cleanedStoredDrafts[ownerUid] = filtered;
        }
      });
    }
    writeScoreDraftsToStorage(sessionData.sid, user?.email, cleanedStoredDrafts);
    setScoreDrafts(mergedDrafts);
  };

  const loadSession = async (sid) => {
    if (!user || !sid) return;
    setSessionBusy(true);
    try {
      const res = await api.getSession({ email: user.email, sid });
      hydrateSession(res);
    } catch (err) {
      console.error("Failed to load session", err);
      alert(err.message || "Unable to load session");
    } finally {
      setSessionBusy(false);
    }
  };

  useEffect(() => {
    if (!user || !activeSid) {
      setSessionDoc(null);
      setLists({});
      setScores({});
      setMessages([]);
      return;
    }
    loadSession(activeSid);
  }, [user, activeSid]);

  const handleCreateSession = async ({ title, requiredNames, nameFocus, invites }) => {
    if (!user) return;
    setCreatingSession(true);
    try {
      const res = await api.createSession({ email: user.email, title, requiredNames, nameFocus, invites });
      await loadSessions();
      await refreshNotifications();
      if (res?.session?.sid) {
        setActiveSid(res.session.sid);
      }
      setCreateOpen(false);
    } catch (err) {
      console.error("Create session failed", err);
      alert(err.message || "Unable to create session");
    } finally {
      setCreatingSession(false);
    }
  };

  const handleExitSession = async () => {
    setActiveSid(null);
    if (sessionDoc?.sid && user?.email) {
      writeScoreDraftsToStorage(sessionDoc.sid, user.email, {});
    }
    setSessionDoc(null);
    setLists({});
    setScores({});
    setMessages([]);
    setListDraft({ names: [], ranks: [], status: "draft" });
    setScoreDrafts({});
    setSessionBusy(false);
    await loadSessions();
  };

  const handleSaveList = async (finalize = false) => {
    if (!user || !sessionDoc) return;
    if (listDraft.status === "submitted") {
      return;
    }
    const required = sessionDoc.requiredNames || sessionDoc.maxNames || 0;
    const pairs = listDraft.names
      .map((name, index) => ({ name: (name || "").trim(), index }))
      .filter((item) => item.name.length > 0);

    const seenLower = new Set();
    for (const item of pairs) {
      const lowered = item.name.toLowerCase();
      if (seenLower.has(lowered)) {
        alert("Names must be unique.");
        return;
      }
      seenLower.add(lowered);
    }

    const selfRanks = {};
    pairs.forEach((item) => {
      const rank = Number(listDraft.ranks[item.index] || 0);
      selfRanks[item.name] = rank;
    });

    if (finalize) {
      if (pairs.length !== required) {
        alert(`Exactly ${required} names are required to submit.`);
        return;
      }
      const allRanks = pairs.map((item) => Number(selfRanks[item.name]));
      if (allRanks.some((rank) => rank < 1 || rank > required)) {
        alert(`Ranks must be between 1 and ${required}.`);
        return;
      }
      if (new Set(allRanks).size !== required) {
        alert("Each rank must be used exactly once.");
        return;
      }
    }

    setSessionBusy(true);
    try {
      await api.upsertOwnerList({
        sid: sessionDoc.sid,
        email: user.email,
        names: pairs.map((item) => item.name),
        selfRanks,
        finalize,
      });
      await loadSession(sessionDoc.sid);
      await refreshNotifications();
    } catch (err) {
      console.error("Save list failed", err);
      alert(err.message || "Unable to save list");
    } finally {
      setSessionBusy(false);
    }
  };

  const handleScoreChange = (ownerUid, name, value) => {
    const parsed = value === "" ? "" : Number(value);
    setScoreDrafts((prev) => {
      const next = { ...prev };
      const ownerScores = { ...(next[ownerUid] || {}) };
      if (parsed === "" || Number.isNaN(parsed)) {
        delete ownerScores[name];
      } else {
        Object.entries(ownerScores).forEach(([otherName, otherValue]) => {
          if (otherName !== name && otherValue === parsed) {
            delete ownerScores[otherName];
          }
        });
        ownerScores[name] = parsed;
      }
      if (Object.keys(ownerScores).length) {
        next[ownerUid] = ownerScores;
      } else {
        delete next[ownerUid];
      }
      return next;
    });
  };

  const scoringModel = useMemo(() => {
    const required = sessionDoc?.requiredNames || sessionDoc?.maxNames || 0;
    const result = {};
    Object.entries(lists || {}).forEach(([ownerUid, data]) => {
      if (ownerUid === user?.email) return;
      if (data.status !== "submitted") return;
      const ownerScores = scoreDrafts?.[ownerUid] || {};
      result[ownerUid] = {};
      data.names.forEach((name) => {
        const currentScore = ownerScores[name];
        result[ownerUid][name] = {
          value: currentScore === undefined ? "" : String(currentScore),
          set: (val) => handleScoreChange(ownerUid, name, val),
        };
      });
      Object.keys(ownerScores).forEach((scoredName) => {
        if (!result[ownerUid][scoredName]) {
          delete ownerScores[scoredName];
        }
      });
    });
    return { required, result };
  }, [lists, scoreDrafts, sessionDoc, user]);

  const handleSubmitScores = async (ownerUid) => {
    if (!sessionDoc || !user) return;
    const required = sessionDoc.requiredNames || sessionDoc.maxNames || 0;
    const listEntry = lists?.[ownerUid];
    if (!listEntry) return;
    const draft = scoreDrafts?.[ownerUid] || {};
    const names = listEntry.names || [];
    if (names.length !== required) {
      alert("Owner list is incomplete.");
      return;
    }
    const ranks = names.map((name) => draft[name]);
    if (ranks.some((rank) => !Number.isInteger(rank))) {
      alert(`Please assign every name a unique rank between 1 and ${required}.`);
      return;
    }
    if (ranks.some((rank) => rank < 1 || rank > required)) {
      alert(`Each score must be between 1 and ${required}.`);
      return;
    }
    if (new Set(ranks).size !== required) {
      alert("Each rank must be used once per list.");
      return;
    }

    setScoreSubmitting(ownerUid);
    try {
      for (const name of names) {
        await api.submitScore({
          sid: sessionDoc.sid,
          email: user.email,
          listOwnerUid: ownerUid,
          scoreValue: draft[name],
          name,
        });
      }
      await loadSession(sessionDoc.sid);
      await refreshNotifications();
      const stored = readScoreDraftsFromStorage(sessionDoc.sid, user.email);
      if (stored[ownerUid]) {
        delete stored[ownerUid];
        writeScoreDraftsToStorage(sessionDoc.sid, user.email, stored);
      }
    } catch (err) {
      console.error("Submit scores failed", err);
      alert(err.message || "Unable to submit scores");
    } finally {
      setScoreSubmitting(null);
    }
  };

  const handleSaveScoreDraft = (ownerUid) => {
    if (!sessionDoc || !user) return;
    const ownerScores = scoreDrafts?.[ownerUid];
    if (!ownerScores || !Object.keys(ownerScores).length) {
      alert("Choose at least one rank before saving a draft.");
      return;
    }
    const stored = readScoreDraftsFromStorage(sessionDoc.sid, user.email);
    stored[ownerUid] = ownerScores;
    writeScoreDraftsToStorage(sessionDoc.sid, user.email, stored);
    alert("Draft saved.");
  };

  const handleSendMessage = async ({ body, recipient }) => {
    if (!sessionDoc || !user) return;
    setMessageBusy(true);
    try {
      await api.sendMessage({
        sid: sessionDoc.sid,
        email: user.email,
        body,
        recipient,
        kind: recipient ? "message" : "message",
      });
      await loadSession(sessionDoc.sid);
    } catch (err) {
      console.error("Send message failed", err);
      alert(err.message || "Unable to send message");
    } finally {
      setMessageBusy(false);
    }
  };

  const handleDirectMessage = async (target) => {
    if (!sessionDoc || !user) return;
    const promptText = window.prompt(`Send a private message to ${target}`, "");
    if (promptText === null) return;
    const body = promptText.trim();
    if (!body) return;
    setDirectMessageBusy(true);
    try {
      await api.sendMessage({
        sid: sessionDoc.sid,
        email: user.email,
        recipient: target,
        kind: "message",
        body,
      });
      await refreshNotifications();
      await loadSession(sessionDoc.sid);
    } catch (err) {
      console.error("Direct message failed", err);
      alert(err.message || "Unable to send message");
    } finally {
      setDirectMessageBusy(false);
    }
  };

  const handleInvite = async (inviteEmail) => {
    if (!sessionDoc || !user) return;
    setInviteBusy(true);
    try {
      const res = await api.inviteParticipants({
        sid: sessionDoc.sid,
        email: user.email,
        participants: [inviteEmail],
      });
      const message = (res.results || [])
        .map((row) => {
          if (row.status === "added") return `${row.email} added as participant.`;
          if (row.status === "invite-sent") return `${row.email} invited (link generated).`;
          if (row.status === "already-member") return `${row.email} already participating.`;
          return `${row.email}: ${row.status}`;
        })
        .join("\n");
      if (message) alert(message);
      await loadSession(sessionDoc.sid);
    } catch (err) {
      console.error("Invite failed", err);
      alert(err.message || "Unable to invite participant");
    } finally {
      setInviteBusy(false);
    }
  };

  const handleRemove = async (target) => {
    if (!sessionDoc || !user) return;
    if (!window.confirm(`Remove ${target} from this session?`)) return;
    try {
      await api.removeParticipant({
        sid: sessionDoc.sid,
        email: user.email,
        participantEmail: target,
      });
      await loadSession(sessionDoc.sid);
    } catch (err) {
      console.error("Remove participant failed", err);
      alert(err.message || "Unable to remove participant");
    }
  };

  const handleLockInvites = async () => {
    if (!sessionDoc || !user) return;
    setLockBusy(true);
    try {
      await api.lockInvites({ sid: sessionDoc.sid, email: user.email });
      await loadSession(sessionDoc.sid);
      await refreshNotifications();
    } catch (err) {
      console.error("Lock invites failed", err);
      alert(err.message || "Unable to lock invites");
    } finally {
      setLockBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!sessionDoc || !user) return;
    if (!window.confirm("Archive this session?")) return;
    try {
      await api.archiveSession({ sid: sessionDoc.sid, email: user.email });
      await loadSessions();
      setActiveSid(null);
    } catch (err) {
      console.error("Archive failed", err);
      alert(err.message || "Unable to archive session");
    }
  };

  const handleDelete = async () => {
    if (!sessionDoc || !user) return;
    if (!window.confirm("Delete this session permanently?")) return;
    try {
      await api.deleteSession({ sid: sessionDoc.sid, email: user.email });
      await loadSessions();
      setActiveSid(null);
    } catch (err) {
      console.error("Delete failed", err);
      alert(err.message || "Unable to delete session");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutFirebase().catch(() => {});
    } finally {
      setUser(null);
      localStorage.removeItem("bnd_user");
      setSessions({ active: [], archived: [] });
      setActiveSid(null);
      setSessionDoc(null);
      setLists({});
      setScores({});
      setMessages([]);
    }
  };

  const handleSignInGoogle = async () => {
    if (typeof signInWithGooglePopup !== "function") {
      alert("Google sign-in is not configured.");
      return;
    }
    try {
      const result = await signInWithGooglePopup();
      const firebaseUser = result?.user;
      if (!firebaseUser) throw new Error("Google sign-in failed");
      let backendUser = null;
      let idToken = null;
      if (typeof firebaseUser.getIdToken === "function") {
        idToken = await firebaseUser.getIdToken().catch(() => null);
      }
      if (!idToken) {
        idToken = extractGoogleIdToken(result);
      }
      if (idToken && typeof api.googleLogin === "function") {
        const res = await api.googleLogin({ idToken });
        backendUser = res?.user ?? null;
      }
      const resolved = {
        uid: backendUser?.uid || firebaseUser.email || firebaseUser.uid,
        email: backendUser?.email || firebaseUser.email || "",
        displayName: backendUser?.displayName || firebaseUser.displayName || firebaseUser.email || "Google user",
        photoURL: backendUser?.photoURL || firebaseUser.photoURL || null,
        provider: "google",
      };
      if (!resolved.email) {
        throw new Error("Google account is missing an email address");
      }
      setUser(resolved);
      localStorage.setItem("bnd_user", JSON.stringify(resolved));
    } catch (err) {
      console.error(err);
      await signOutFirebase().catch(() => {});
      alert(err.message || "Google sign-in failed");
    }
  };

  const handleSignInEmail = async (email, password) => {
    try {
      const res = await api.login({ email, password });
      const u = { uid: res.user.email, email: res.user.email, displayName: res.user.displayName };
      setUser(u);
      localStorage.setItem("bnd_user", JSON.stringify(u));
    } catch (err) {
      console.error(err);
      alert(err.message || "Email sign-in failed");
    }
  };

  const handleSignUp = async (email, password, fullName) => {
    try {
      const res = await api.signup({ fullName: fullName || "User", email, password });
      const u = { uid: res.user.email, email: res.user.email, displayName: res.user.displayName };
      setUser(u);
      localStorage.setItem("bnd_user", JSON.stringify(u));
    } catch (err) {
      console.error(err);
      alert(err.message || "Sign up failed");
    }
  };

  const requiredNames = sessionDoc?.requiredNames || sessionDoc?.maxNames || 0;
  const isOwner = sessionDoc?.createdBy === user?.email;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <TopNav
        user={user}
        onSignOut={handleSignOut}
      />

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!user ? (
          <LoginPage
            onGoogleSignIn={handleSignInGoogle}
            onEmailSignIn={handleSignInEmail}
            onSignup={({ email, password, fullName }) => handleSignUp(email, password, fullName)}
            onRequestReset={(email) => api.requestPasswordReset({ email })}
            onConfirmReset={(token, newPassword) => api.resetPassword({ token, newPassword })}
          />
        ) : sessionDoc ? (
          <div className="space-y-4">
            {sessionBusy && (
              <Card className="p-4 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading session…
              </Card>
            )}

            <Card className="p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xl font-semibold text-slate-800">{sessionDoc.title}</div>
                <div className="text-xs text-slate-500">
                  Required names: {requiredNames} · Status: {sessionDoc.status}
                </div>
                <div className="text-xs text-slate-500">
                  Name theme: {NAME_FOCUS_LABELS[sessionDoc.nameFocus] || NAME_FOCUS_LABELS.mix}
                </div>
                <div className="text-xs text-slate-500">
                  Created {formatDate(sessionDoc.createdAt)} by {sessionDoc.createdBy}
                </div>
              </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="subtle" onClick={handleExitSession}>
                    <ArrowLeft className="h-4 w-4" />
                    Back to dashboard
                  </Button>
                  {isOwner ? (
                    <>
                      <Button variant="secondary" onClick={handleArchive}>
                        Archive
                      </Button>
                      <Button variant="danger" onClick={handleDelete}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>

            <ParticipantsPanel
              session={sessionDoc}
              isOwner={isOwner}
              inviteBusy={inviteBusy}
              onInvite={handleInvite}
              onRemove={handleRemove}
              onLockInvites={handleLockInvites}
              lockBusy={lockBusy}
              onMessage={handleDirectMessage}
              directMessageBusy={directMessageBusy}
              currentUser={user}
            />

                <ListEditor
                  requiredNames={requiredNames}
                  nameFocus={sessionDoc.nameFocus}
                  listState={listDraft}
                  onChangeName={(index, value) =>
                    setListDraft((prev) => {
                      const names = [...prev.names];
                      names[index] = value;
                  return { ...prev, names };
                })
              }
              onChangeRank={(index, value) =>
                setListDraft((prev) => {
                  const ranks = [...prev.ranks];
                  ranks[index] = value;
                  return { ...prev, ranks };
                })
              }
              onSave={() => handleSaveList(false)}
              onSubmit={() => handleSaveList(true)}
              canEdit={listDraft.status !== "submitted"}
              busy={sessionBusy}
            />

            <ScoringPanel
              lists={lists}
              scores={scoringModel.result}
              currentUser={user}
              requiredNames={requiredNames}
              nameFocus={sessionDoc.nameFocus}
              draftState={scoreDrafts}
              onSaveDraft={handleSaveScoreDraft}
              onSubmitScores={handleSubmitScores}
              submitting={scoreSubmitting}
            />

            <ResultsPanel
              lists={lists}
              scores={scores}
              requiredNames={requiredNames}
              invitesLocked={sessionDoc.invitesLocked}
            />

            <MessagesPanel
              messages={messages}
              onSend={handleSendMessage}
              busy={messageBusy}
              participants={[...(sessionDoc.ownerIds || []), ...(sessionDoc.participantIds || [])].filter(
                (uid) => uid !== user?.email,
              )}
              currentUser={user}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <NotificationsPanel
              notifications={notifications}
              onRefresh={refreshNotifications}
              onMarkAll={markAllNotifications}
              onMarkSingle={markNotification}
            />

            <SessionsDashboard
              sessions={sessions}
              activeSid={activeSid}
              onSelect={(sid) => setActiveSid(sid)}
              onOpenCreate={() => setCreateOpen(true)}
              loading={sessionsBusy}
            />

            {sessionBusy && activeSid && (
              <Card className="p-4 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading session…
              </Card>
            )}
          </div>
        )}
      </main>

      <CreateSessionModal
        open={createOpen}
        busy={creatingSession}
        onClose={() => (!creatingSession ? setCreateOpen(false) : null)}
        onCreate={handleCreateSession}
      />
    </div>
  );
}
