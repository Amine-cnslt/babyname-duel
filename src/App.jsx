import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  Home,
  Info,
  LayoutGrid,
  Loader2,
  LogOut,
  Lock,
  MessageCircle,
  Music,
  PlusCircle,
  RefreshCcw,
  Send,
  Trash2,
  User,
  UserPlus,
  VolumeX,
} from "lucide-react";
import LoginPage from "./components/LoginPage";
import * as api from "./api";
import {
  extractGoogleIdToken,
  signInWithGooglePopup,
  signOutFirebase,
  getGoogleRedirectResult,
} from "./firebase";
import { createSoundscape } from "./soundscape.js";

const Button = ({ children, className = "", variant = "secondary", ...props }) => {
  const base =
    "bnd-btn inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold tracking-wide transition duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(249,115,98,0.4)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";
  const variants = {
    primary: "bnd-btn--primary",
    secondary: "bnd-btn--secondary text-slate-700",
    subtle: "bnd-btn--subtle text-slate-600 hover:text-slate-800",
    danger: "bnd-btn--danger",
    glass: "bnd-btn--subtle bg-white/70 text-slate-600",
  };
  return (
    <button className={`${base} ${variants[variant] || variants.secondary} ${className}`} {...props}>
      {children}
    </button>
  );
};

const Card = ({ children, className = "", ...props }) => (
  <div className={`bnd-card-pop ${className}`} {...props}>
    {children}
  </div>
);

const SectionCollapse = ({
  title,
  icon,
  expanded,
  onToggle,
  actions = null,
  children,
  className = "",
}) => {
  const contentId = React.useId();
  return (
    <Card className={`space-y-4 p-5 sm:p-6 ${className}`} aria-labelledby={`${contentId}-label`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-800" id={`${contentId}-label`}>
          {icon}
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/60 bg-white/70 text-slate-500 shadow-sm transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgba(249,115,98,0.35)]"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div id={contentId} role="region" aria-labelledby={`${contentId}-label`} className="space-y-4">
          {children}
        </div>
      ) : null}
    </Card>
  );
};

const FloatingDecor = React.memo(() => {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isCompact = window.matchMedia("(max-width: 640px)").matches;
    return !(prefersReducedMotion || isCompact);
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactQuery = window.matchMedia("(max-width: 640px)");
    const update = () => setEnabled(!(motionQuery.matches || compactQuery.matches));

    const add = (query) => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", update);
      } else if (typeof query.addListener === "function") {
        query.addListener(update);
      }
    };

    const remove = (query) => {
      if (typeof query.removeEventListener === "function") {
        query.removeEventListener("change", update);
      } else if (typeof query.removeListener === "function") {
        query.removeListener(update);
      }
    };

    add(motionQuery);
    add(compactQuery);
    update();

    return () => {
      remove(motionQuery);
      remove(compactQuery);
    };
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <div className="bnd-floating">
      <span style={{ top: "12%", left: "6%" }}>🍼</span>
      <span className="bnd-flower" style={{ top: "18%", right: "12%" }}>🌸</span>
      <span style={{ bottom: "16%", left: "18%" }}>🌙</span>
      <span className="bnd-flower" style={{ bottom: "28%", right: "22%" }}>🌼</span>
      <span style={{ top: "32%", left: "42%" }}>👶</span>
      <span className="bnd-bee bnd-bee-one" style={{ top: "22%", left: "12%" }}>🐝</span>
      <span className="bnd-bee bnd-bee-two" style={{ bottom: "22%", right: "18%" }}>🐝</span>
      <div className="bnd-bubble" style={{ top: "8%", right: "6%" }} />
      <div className="bnd-bubble" style={{ bottom: "10%", left: "8%" }} />
      <div className="bnd-bubble" style={{ top: "48%", left: "12%" }} />
    </div>
  );
});

const FactButton = ({ fact }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const tooltipRef = useRef(null);
  const hasFact = Boolean(fact && (fact.info || fact.audioBase64));
  const audioUrl = fact?.audioBase64
    ? `data:${fact.audioMime || "audio/mpeg"};base64,${fact.audioBase64}`
    : null;

  const handleToggle = () => {
    setOpen((prev) => !prev);
  };

  const handlePlay = () => {
    if (!audioUrl) return;
    try {
      const audio = new Audio(audioUrl);
      audio.play().catch((err) => console.error("Audio playback failed", err));
    } catch (err) {
      console.error("Audio playback failed", err);
    }
  };

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current?.offsetHeight ?? 0;
    const preferredTop = rect.bottom + 8;
    const fallbackTop = rect.top - 8 - tooltipHeight;
    const fitsBelow = preferredTop + tooltipHeight <= window.innerHeight;
    const top = Math.max(8, fitsBelow ? preferredTop : Math.max(8, fallbackTop));
    let left = rect.left + rect.width / 2;
    const margin = 16;
    left = Math.max(margin, Math.min(window.innerWidth - margin, left));
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (anchorRef.current?.contains(event.target)) return;
      if (tooltipRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const tooltip = open
    ? createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[2147483647] w-56 max-w-[min(90vw,224px)] rounded-lg border border-slate-200 bg-white p-3 text-left text-xs shadow-2xl"
          style={{ top: position.top, left: position.left, transform: "translate(-50%, 0)" }}
        >
          <div className="font-semibold text-slate-700">Name details</div>
          <div className="mt-1 whitespace-pre-line text-slate-600">
            {fact.info || "No description available yet."}
          </div>
          {fact.phonetic ? (
            <div className="mt-1 text-[11px] uppercase tracking-wide text-indigo-500">
              {fact.phonetic}
            </div>
          ) : null}
          {audioUrl ? (
            <button
              type="button"
              onClick={handlePlay}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-indigo-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-600"
            >
              ▶ Play pronunciation
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-slate-200 text-[10px] text-slate-600"
            aria-label="Close name insight"
          >
            ×
          </button>
        </div>,
        document.body,
      )
    : null;

  if (!hasFact) {
    return null;
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={handleToggle}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-indigo-500 shadow-sm transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-200"
        aria-label="Show name details"
        title="Show name details"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {tooltip}
    </>
  );
};




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

const TopNav = ({ user, onSignOut, ambientEnabled, onToggleAmbient, onProfile = () => {} }) => {
  const topNavFirstName = user ? firstNameFromEmail(user.displayName || user.email) : null;
  return (
    <header className="sticky top-0 z-30 flex w-full justify-center px-4 pb-3 pt-4">
      <div className="bnd-glass mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-3xl px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 text-slate-800">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-white/85 via-amber-50/80 to-rose-100/70 text-amber-500 shadow-inner">
            <span className="text-2xl" role="img" aria-label="Bee mascot">
              🐝
            </span>
          </div>
          <div className="flex flex-col text-left leading-tight">
            <span className="font-display text-xl font-semibold text-slate-900 sm:text-2xl">
              BabyNames <span className="text-amber-500">Hive</span>
            </span>
            <span className="text-xs font-medium text-slate-500">Curate the shortlist together.</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="glass"
            className="text-xs"
            onClick={onToggleAmbient}
            title={ambientEnabled ? "Mute lullaby ambience" : "Play gentle ambience"}
          >
            {ambientEnabled ? <VolumeX className="h-4 w-4" /> : <Music className="h-4 w-4" />}
            <span>{ambientEnabled ? "Mute" : "Lullaby"}</span>
          </Button>
          {user ? (
            <Button
              variant="glass"
              className="hidden text-xs sm:inline-flex"
              onClick={onProfile}
              title={user.email || "Profile"}
            >
              {topNavFirstName || "Profile"}
            </Button>
          ) : (
            <span className="hidden rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm sm:inline-flex">
              Not signed in
            </span>
          )}
          {user ? (
            <Button variant="secondary" onClick={() => onSignOut?.()}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
};

const MobileDock = React.memo(({ active, onNavigate, hasSession, sessionsPending = 0, alertsCount = 0 }) => (
  <nav className="bnd-mobile-nav bnd-glass" aria-label="Primary">
    <button
      type="button"
      onClick={() => onNavigate("home")}
      data-active={active === "home"}
      aria-label="Home feed"
    >
      <Home />
      <span>Home</span>
    </button>
    <button
      type="button"
      onClick={() => onNavigate("sessions")}
      data-active={active === "sessions"}
      aria-label="Sessions"
    >
      <LayoutGrid />
      <span>Sessions</span>
      {sessionsPending > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
          {sessionsPending > 9 ? "9+" : sessionsPending}
        </span>
      ) : null}
    </button>
    <button
      type="button"
      onClick={() => onNavigate("messages")}
      data-active={active === "messages"}
      aria-label="Messages"
      disabled={!hasSession}
    >
      <MessageCircle />
      <span>Chat</span>
    </button>
    <button
      type="button"
      onClick={() => onNavigate("notifications")}
      data-active={active === "notifications"}
      aria-label="Notifications"
    >
      <Bell />
      <span>Alerts</span>
      {alertsCount > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
          {alertsCount > 9 ? "9+" : alertsCount}
        </span>
      ) : null}
    </button>
    <button
      type="button"
      onClick={() => onNavigate("profile")}
      data-active={active === "profile"}
      aria-label="Profile"
    >
      <User />
      <span>Profile</span>
    </button>
  </nav>
));

const capitalize = (value) => {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const firstNameFromEmail = (email) => {
  if (!email) return "Someone";
  const name = email.split("@")[0].replace(/[._+-]+/g, " ");
  return name ? capitalize(name.split(/\s+/)[0]) : "Someone";
};

const NAME_FOCUS_LABELS = {
  girl: "Girls",
  boy: "Boys",
  mix: "Mix of both",
};

const PANEL_KEYS = ["participants", "list", "otherLists", "results", "messages"];

const buildPanelState = (overrides = {}) => {
  const state = {};
  PANEL_KEYS.forEach((key) => {
    state[key] = Boolean(overrides[key]);
  });
  return state;
};

const PANEL_STORAGE_PREFIX = "bnd_panel_state_";

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
      <Card className="space-y-2 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Bell className="h-4 w-4" />
          No notifications yet.
        </div>
      </Card>
    );
  }

  const unread = notifications.filter((note) => !note.readAt).map((note) => note.id);

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="font-display text-base font-semibold text-slate-800">Notifications</div>
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
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {notifications.map((note) => (
          <div
            key={note.id}
            className={`rounded-2xl border px-3 py-3 text-sm ${note.readAt ? "border-slate-100 bg-white/70" : "border-amber-100 bg-amber-50/80"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {note.type.replace(/_/g, " ")}
                </div>
                {(() => {
                  const copy = getNotificationCopy(note);
                  return copy.isRaw ? (
                    <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{copy.body}</pre>
                  ) : (
                    <>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{copy.heading}</div>
                      <div className="mt-0.5 text-xs text-slate-600">{copy.body}</div>
                    </>
                  );
                })()}
                {onMarkSingle ? (
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-medium text-amber-600 hover:underline"
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
      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-100 ${
        session.sid === activeSid
          ? "border-amber-300 bg-amber-50/70"
          : "border-slate-200/70 bg-white/80"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-800">{session.title}</div>
          <div className="text-xs text-slate-500">Updated {formatDate(session.updatedAt)}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="capitalize">{session.role}</div>
          <div>{session.requiredNames} names</div>
          <div>Focus: {NAME_FOCUS_LABELS[session.nameFocus] || NAME_FOCUS_LABELS.mix}</div>
        </div>
      </div>
    </button>
  );

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-display text-lg font-semibold text-slate-800">
            <span role="img" aria-hidden="true">🍼</span>
            Sessions
          </div>
          <div className="text-xs text-slate-500">Switch between active and archived sessions.</div>
        </div>
        <Button variant="primary" onClick={onOpenCreate} disabled={loading}>
          <PlusCircle className="h-4 w-4" />
          New Session
        </Button>
      </div>
      <div className="flex items-center gap-2 rounded-full bg-white/70 p-1 text-xs font-semibold text-slate-500 shadow-inner">
        {[
          { id: "active", label: "Active" },
          { id: "archived", label: "Archived" },
        ].map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-full px-4 py-2 transition ${
              tab === id ? "bg-amber-100/80 text-slate-800 shadow" : "hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {visibleSessions.length ? (
          <div className="space-y-2">
            {visibleSessions.map(renderSessionButton)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200/80 px-4 py-6 text-xs text-slate-500">
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
  const requiredOptions = useMemo(() => buildRequiredNameOptions(nameFocus), [nameFocus]);

  useEffect(() => {
    if (open) {
      setTitle("");
      setRequiredNames(10);
      setNameFocus("mix");
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
    await onCreate({ title: title.trim(), requiredNames, nameFocus });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm px-4 py-6">
      <div className="bnd-glass w-full max-w-lg rounded-3xl border border-white/45 px-6 py-6 shadow-2xl sm:px-8 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="font-display text-xl font-semibold text-slate-900">Create Session</div>
            <div className="mt-1 text-xs text-slate-500">Name your session and choose how many names each person adds. Invite collaborators once the template is ready.</div>
          </div>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="session-title">
              Session name
            </label>
            <input
              id="session-title"
              className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Spring 2024 shortlist"
              required
              disabled={busy}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="session-focus">
                Name focus
              </label>
              <select
                id="session-focus"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
                value={nameFocus}
                onChange={(e) => setNameFocus(e.target.value)}
                disabled={busy}
              >
                <option value="girl">Girls</option>
                <option value="boy">Boys</option>
                <option value="mix">Mix of both</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="session-required">
                Names per person
              </label>
              <select
                id="session-required"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
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
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {nameFocus === "mix"
              ? "Mix sessions use multiples of four so everyone can share evenly."
              : "Girls or Boys sessions use even numbers so rankings stay balanced."}
          </p>
          <div className="flex justify-end gap-2 pt-2">
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
  expanded,
  onToggle,
}) => {
  const [email, setEmail] = useState("");
  const participants = session?.participantIds || session?.voterIds || [];
  const pendingInvites = Array.isArray(session?.pendingInvites) ? session.pendingInvites : [];
  const focusLabel = NAME_FOCUS_LABELS[session?.nameFocus] || NAME_FOCUS_LABELS.mix;
  const templateReady = Boolean(session?.templateReady);

  const headerAction = isOwner ? (
    <Button onClick={onLockInvites} disabled={lockBusy || session?.invitesLocked}>
      {lockBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
      {session?.invitesLocked ? "Invites closed" : "Close invites"}
    </Button>
  ) : null;

  return (
    <SectionCollapse
      title="Participants"
      icon={<span role="img" aria-hidden="true">🤝</span>}
      expanded={expanded}
      onToggle={onToggle}
      actions={headerAction}
    >
      <div className="space-y-3">
        <div className="space-y-1 text-xs">
          <p className="text-slate-500">Only the owner can invite or remove people. Existing users join automatically.</p>
          <p className="text-indigo-600">Name focus: {focusLabel}</p>
        </div>

        {isOwner ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!email.trim()) return;
              if (!templateReady) {
                alert("Create and save your list template before inviting participants.");
                return;
              }
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
              disabled={inviteBusy || !templateReady}
            />
            <Button type="submit" variant="primary" disabled={inviteBusy || !templateReady}>
              {inviteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Invite
            </Button>
          </form>
        ) : null}

        {!templateReady && isOwner ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Create and save your list template first. Once it&apos;s ready, you can invite others.
          </div>
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
                {uid !== currentUser?.email ? (
                  <Button
                    variant="subtle"
                    className="text-xs"
                    onClick={() => onMessage(uid)}
                    disabled={directMessageBusy}
                    title="Send a private message"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                ) : null}
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
          {pendingInvites.length ? (
            <div className="mt-2 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending invites</div>
              {pendingInvites.map((invite) => (
                <div
                  key={`${invite.email}-${invite.link || invite.sentAt || "pending"}`}
                  className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-900"
                >
                  <div className="font-medium">{invite.email}</div>
                  <div className="text-xs text-indigo-600">
                    {invite.sentAt ? `Invited ${formatDate(invite.sentAt)}` : "Awaiting response"}
                  </div>
                  {invite.link ? (
                    <div className="mt-1 text-[11px] text-indigo-500 break-all">
                      {invite.link}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {!participants.length && !session?.ownerIds?.length && !pendingInvites.length ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
              No participants yet.
            </div>
          ) : null}
        </div>
      </div>
    </SectionCollapse>
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
  expanded,
  onToggle,
}) => {
  const names = listState.names;
  const ranks = listState.ranks;
  const facts = listState.facts || {};
  const entries = names
    .map((value, index) => ({ name: value, rank: ranks[index] ?? "", index }))
    .filter((item) => (canEdit ? true : Boolean(item.name && item.name.trim())));

  const statusChip = (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        listState.status === "submitted" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-600"
      }`}
    >
      {listState.status === "submitted" ? "Submitted" : "Draft"}
    </span>
  );

  return (
    <SectionCollapse
      title="Your list"
      icon={<span role="img" aria-hidden="true">🧸</span>}
      expanded={expanded}
      onToggle={onToggle}
      actions={statusChip}
    >
      <div className="space-y-3">
        <div className="space-y-1 text-xs">
          <p className="text-slate-500">
            Provide exactly {requiredNames} distinct names. Assign each a ranking from 1 to {requiredNames} with no duplicates. Drafts allow blanks or rank 0.
          </p>
          <p className="text-indigo-600">Focus: {NAME_FOCUS_LABELS[nameFocus] || NAME_FOCUS_LABELS.mix}</p>
        </div>

        {canEdit ? (
          <>
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

            <div className="flex justify-end gap-2">
              <Button onClick={onSave} disabled={!canEdit || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save draft
              </Button>
              <Button variant="primary" onClick={onSubmit} disabled={!canEdit || busy}>
                Submit for voting
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Your list has been submitted and is now read-only.
            </div>
            <div className="grid gap-2">
              {entries.map(({ name, rank, index }) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_100px] gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">{name}</div>
                    <FactButton fact={facts[name]} />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                    Rank {rank || "-"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCollapse>
  );
};

const OtherListsPanel = ({
  lists,
  scores,
  currentUser,
  requiredNames,
  nameFocus,
  draftState,
  completedScores = {},
  onSaveDraft,
  onSubmitScores,
  submitting,
  expanded,
  onToggle,
}) => {
  const myUid = currentUser?.email;
  const otherLists = useMemo(() => {
    if (!lists || !myUid) return [];
    return Object.entries(lists)
      .filter(([ownerUid, data]) => ownerUid !== myUid && data.status === "submitted")
      .map(([ownerUid, data]) => ({ ownerUid, ...data }));
  }, [lists, myUid]);

  return (
    <SectionCollapse
      title="Other participants’ lists"
      icon={<span role="img" aria-hidden="true">✨</span>}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="space-y-1 text-xs">
        <p className="text-slate-500">Assign each submitted list a full set of ranks from 1 to {requiredNames}. Use every rank exactly once.</p>
        <p className="text-indigo-600">Focus: {NAME_FOCUS_LABELS[nameFocus] || NAME_FOCUS_LABELS.mix}</p>
      </div>

      {otherLists.length ? (
        <div className="space-y-4">
          {otherLists.map((entry) => {
            const isComplete = !!completedScores?.[entry.ownerUid];
            const factsByOwner = entry.facts || {};
            return (
              <div key={entry.ownerUid} className="space-y-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{entry.ownerUid}</div>
                    <div className="text-xs text-slate-500">Use every rank exactly once.</div>
                  </div>
                  {isComplete ? (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
                      Submitted
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  {entry.names.map((name) => {
                    const scoreRow = scores[entry.ownerUid]?.[name];
                    if (isComplete) {
                      return (
                        <div key={name} className="grid grid-cols-[minmax(0,1fr)_160px] gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">{name}</div>
                            <FactButton fact={factsByOwner[name]} />
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                            Rank {scoreRow?.value || "-"}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={name} className="grid grid-cols-[minmax(0,1fr)_160px] gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">{name}</div>
                          <FactButton fact={factsByOwner[name]} />
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
                            value={scoreRow?.value ?? ""}
                            onChange={(e) => scoreRow?.set(e.target.value)}
                            disabled={submitting === entry.ownerUid}
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
                {isComplete ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    Thanks! Your scores are locked in.
                  </div>
                ) : (
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
                      {submitting === entry.ownerUid ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Submit scores
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
          No submissions yet.
        </div>
      )}
    </SectionCollapse>
  );
};

const ResultsPanel = ({
  lists,
  scores,
  requiredNames,
  invitesLocked,
  tieBreak,
  finalWinners,
  isOwner,
  onStartTieBreak,
  onSubmitTieBreak,
  onCloseTieBreak,
  tieBreakBusy,
  tieBreakSubmitBusy,
  onTopTieChange,
  expanded,
  onToggle,
}) => {
  const [celebrateKey, setCelebrateKey] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [tieDraft, setTieDraft] = useState({});

  const rawTieBreakNames = tieBreak?.names;
  const tieBreakNames = useMemo(
    () => (Array.isArray(rawTieBreakNames) ? rawTieBreakNames.map((name) => String(name)) : []),
    [rawTieBreakNames],
  );
  const tieBreakKey = tieBreakNames.join("|");
  const tieBreakActive = Boolean(tieBreak?.active);
  const tieBreakSubmitted = Boolean(tieBreak?.submitted);

  useEffect(() => {
    if (!tieBreakActive || !tieBreakNames.length) {
      setTieDraft({});
      return;
    }
    setTieDraft((prev) => {
      const next = {};
      tieBreakNames.forEach((name) => {
        next[name] = prev[name] ?? "";
      });
      return next;
    });
  }, [tieBreakActive, tieBreakKey, tieBreakNames]);

  const ConfettiOverlay = ({ seed = 72 }) => {
    const pieces = useMemo(
      () => Array.from({ length: Math.min(Math.max(seed, 24), 140) }, (_, idx) => idx),
      [seed],
    );
    return (
      <div className="bnd-confetti">
        {pieces.map((i) => {
          const left = Math.random() * 100;
          const duration = 1600 + Math.random() * 1600;
          const delay = Math.random() * 200;
          const drift = (Math.random() - 0.5) * 160;
          const hue = Math.floor(200 + Math.random() * 140);
          const sat = 75 + Math.random() * 20;
          const light = 50 + Math.random() * 10;
          const color = `hsl(${hue} ${sat}% ${light}%)`;
          const style = {
            left: `${left}%`,
            '--x': `${left}%`,
            '--drift': `${drift}px`,
            background: color,
            animationDuration: `${duration}ms`,
            animationDelay: `${delay}ms`,
          };
          return <i key={`${seed}-${i}`} style={style} />;
        })}
      </div>
    );
  };

  const aggregated = useMemo(() => {
    if (!invitesLocked || !lists) {
      return { ranking: [], topNames: [] };
    }

    const perName = {};
    Object.entries(scores || {}).forEach(([ownerUid, entries]) => {
      Object.entries(entries || {}).forEach(([name, meta]) => {
        if (typeof meta?.value !== "number") return;
        const bucket = perName[name] || {
          name,
          total: 0,
          count: 0,
          owners: {},
        };
        bucket.total += meta.value;
        bucket.count += 1;
        bucket.owners[ownerUid] = meta.value;
        perName[name] = bucket;
      });
    });

    const ranking = Object.values(perName)
      .map((entry) => ({
        ...entry,
        average: entry.count ? entry.total / entry.count : 0,
      }))
      .sort((a, b) => {
        if (a.total === b.total) {
          return a.name.localeCompare(b.name);
        }
        return a.total - b.total;
      });

    const topTotal = ranking.length ? ranking[0].total : null;
    const topNames = topTotal === null ? [] : ranking.filter((row) => row.total === topTotal);

    return { ranking, topNames };
  }, [scores, lists, invitesLocked]);

  const factIndex = useMemo(() => {
    if (!lists) return {};
    const lookup = {};
    Object.values(lists).forEach((entry) => {
      Object.entries(entry.facts || {}).forEach(([name, info]) => {
        lookup[name.toLowerCase()] = info;
      });
    });
    return lookup;
  }, [lists]);

  const topTie = aggregated.topNames.length > 1;
  const winnerNames = aggregated.topNames.map((row) => row.name);
  const winnerTotal = aggregated.topNames.length ? aggregated.topNames[0].total : null;

  const finalWinnerList = Array.isArray(finalWinners)
    ? finalWinners.filter((name) => typeof name === "string" && name.trim().length)
    : [];
  const singleFinalWinner = finalWinnerList.length === 1 ? finalWinnerList[0] : null;

  useEffect(() => {
    if (finalWinnerList.length || tieBreakActive) {
      onTopTieChange?.(false);
      return;
    }
    onTopTieChange?.(topTie);
  }, [finalWinnerList.length, tieBreakActive, topTie, onTopTieChange]);

  const displayWinner = singleFinalWinner
    || (!tieBreakActive && invitesLocked && !finalWinnerList.length && !topTie ? winnerNames[0] : null);

  useEffect(() => {
    if (!expanded) return;
    const signature = singleFinalWinner
      ? `final:${singleFinalWinner}`
      : (!tieBreakActive
          && invitesLocked
          && !finalWinnerList.length
          && !topTie
          && winnerNames[0]
          && winnerTotal !== null
        ? `live:${winnerNames[0]}:${winnerTotal}`
        : null);

    if (!signature || signature === celebrateKey) {
      if (!signature) {
        setShowConfetti(false);
        setShowBanner(false);
      }
      return;
    }

    setCelebrateKey(signature);
    setShowConfetti(true);
    setShowBanner(true);
    const t1 = setTimeout(() => setShowConfetti(false), 2400);
    const t2 = setTimeout(() => setShowBanner(false), singleFinalWinner ? 3600 : 2600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [expanded, singleFinalWinner, tieBreakActive, invitesLocked, finalWinnerList.length, topTie, winnerNames, winnerTotal, celebrateKey]);

  const tieOptions = useMemo(
    () => Array.from({ length: tieBreakNames.length }, (_, idx) => String(idx + 1)),
    [tieBreakNames.length],
  );
  const tieDraftValues = tieBreakNames.map((name) => tieDraft[name] ?? "");
  const allTieRanksSelected = tieBreakNames.length > 0 && tieDraftValues.every((value) => value !== "" && value !== undefined);
  const uniqueTieRanks = tieDraftValues.length === new Set(tieDraftValues).size;
  const disableTieSubmit = tieBreakSubmitBusy || tieBreakSubmitted || !allTieRanksSelected || !uniqueTieRanks;

  const handleTieDraftChange = useCallback((name, value) => {
    setTieDraft((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleTieSubmit = async (event) => {
    event.preventDefault();
    if (disableTieSubmit) return;
    const ranks = {};
    tieBreakNames.forEach((name) => {
      ranks[name] = Number(tieDraft[name]);
    });
    await onSubmitTieBreak?.(ranks);
  };

  const canStartTieBreak = invitesLocked && !tieBreakActive && !finalWinnerList.length && topTie && isOwner;
  const showTieBreakHint = invitesLocked && !tieBreakActive && !finalWinnerList.length && topTie && !isOwner;

  let highlightMessage;
  if (finalWinnerList.length === 1) {
    highlightMessage = (
      <>Final winner: <strong>{finalWinnerList[0]}</strong>.</>
    );
  } else if (finalWinnerList.length > 1) {
    highlightMessage = (
      <>Co-winners: <strong>{finalWinnerList.join(", ")}</strong>.</>
    );
  } else if (tieBreakActive) {
    highlightMessage = (
      <>Tie-break in progress. Rank the highlighted names below to crown a winner.</>
    );
  } else if (topTie) {
    highlightMessage = (
      <>Tie detected between <strong>{winnerNames.join(", ")}</strong>. A tie-break will decide the winner.</>
    );
  } else if (winnerNames[0]) {
    highlightMessage = (
      <>Current leader: <strong>{winnerNames[0]}</strong> with a total score of {winnerTotal}.</>
    );
  } else {
    highlightMessage = "Waiting for results.";
  }

  const highlightClass = finalWinnerList.length
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tieBreakActive
      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
      : topTie
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  let statusCopy;
  if (finalWinnerList.length) {
    statusCopy = finalWinnerList.length === 1
      ? "Session completed. Celebrate the winning name!"
      : "Session completed with co-winners sharing the spotlight.";
  } else if (tieBreakActive) {
    statusCopy = "Tie-break underway. Ranking votes will decide the final winner.";
  } else if (invitesLocked) {
    const requiredCopy = requiredNames ? ` Each list carries ${requiredNames} names.` : "";
    statusCopy = `Scores reveal once everyone finishes. Lower scores are better.${requiredCopy}`;
  } else {
    const requiredCopy = requiredNames ? ` Each list carries ${requiredNames} names.` : "";
    statusCopy = `Scores remain hidden until invites are closed.${requiredCopy}`;
  }

  let bodyContent = null;
  const hasRanking = aggregated.ranking.length > 0;

  if (expanded) {
    if (!invitesLocked) {
      bodyContent = (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
          Waiting for the owner to close invites before revealing totals.
        </div>
      );
    } else if (hasRanking || tieBreakActive || finalWinnerList.length) {
      bodyContent = (
        <div className="space-y-3">
          {showBanner && displayWinner ? (
            <div className="bnd-winner-banner">
              <span className="bnd-winner-float text-xs font-semibold text-amber-700">{singleFinalWinner ? "Final winner" : "Leader"}</span>
              <span
                className="bnd-winner-float text-lg font-extrabold"
                style={{
                  background: 'linear-gradient(90deg, #f59e0b, #ef4444, #3b82f6)',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  fontFamily: 'ui-rounded, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
                }}
              >
                {displayWinner}
              </span>
              <span className="text-xs text-slate-600">{singleFinalWinner ? "takes the crown" : "is leading the board"}</span>
            </div>
          ) : null}

          <div className={`rounded-lg border px-3 py-3 text-sm ${highlightClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>{highlightMessage}</div>
              {canStartTieBreak ? (
                <Button
                  variant="primary"
                  className="text-xs"
                  onClick={onStartTieBreak}
                  disabled={tieBreakBusy}
                >
                  {tieBreakBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Start tie-break
                </Button>
              ) : null}
            </div>
            {showTieBreakHint ? (
              <div className="mt-2 text-xs text-slate-500">
                The session owner will start a tie-break to choose the final winner.
              </div>
            ) : null}
          </div>

          {tieBreakActive ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-indigo-700">Tie-break voting</div>
                  <div className="text-xs text-slate-600">Rank these names to help crown the winner.</div>
                </div>
                {isOwner ? (
                  <Button
                    variant="secondary"
                    className="text-xs"
                    onClick={onCloseTieBreak}
                    disabled={tieBreakBusy}
                  >
                    {tieBreakBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Finalize tie-break
                  </Button>
                ) : null}
              </div>
              {tieBreakSubmitted ? (
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-700">
                  Thanks! Your tie-break vote is saved.
                </div>
              ) : (
                <form onSubmit={handleTieSubmit} className="space-y-3">
                  {tieBreakNames.map((name) => (
                    <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-white/60 bg-white px-3 py-2">
                      <span className="text-sm font-medium text-slate-700">{name}</span>
                      <select
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        value={tieDraft[name] ?? ""}
                        onChange={(event) => handleTieDraftChange(name, event.target.value)}
                        disabled={tieBreakSubmitBusy}
                      >
                        <option value="">Rank…</option>
                        {tieOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <Button type="submit" variant="primary" disabled={disableTieSubmit}>
                    {tieBreakSubmitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Submit tie-break vote
                  </Button>
                </form>
              )}
            </div>
          ) : null}

          {hasRanking ? (
            aggregated.ranking.map((row, index) => {
              const fact = factIndex[row.name.toLowerCase()];
              const isWinner = finalWinnerList.includes(row.name);
              const isTieCandidate = tieBreakActive && tieBreakNames.includes(row.name);
              const rowClass = [
                "rounded-lg border px-3 py-2 transition-colors",
                isWinner ? "border-amber-200 bg-white shadow-sm" : "border-slate-200",
                !isWinner && isTieCandidate ? "bg-indigo-50/70 border-indigo-200" : "",
              ].join(" ");
              return (
                <div key={row.name} className={rowClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-700">
                      <span>#{index + 1} · {row.name}</span>
                      <FactButton fact={fact} />
                      {isWinner ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Winner</span>
                      ) : null}
                      {!isWinner && isTieCandidate ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">Tie-break</span>
                      ) : null}
                    </div>
                    <div className="text-sm text-slate-500">Total: {row.total} · Average: {row.average.toFixed(2)}</div>
                  </div>
                  <div className="mt-1 grid gap-1 text-xs text-slate-500">
                    {Object.entries(row.owners).map(([ownerUid, score]) => (
                      <div key={ownerUid} className="flex justify-between">
                        <span>Scored by {ownerUid}</span>
                        <span>Rank: {score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
              Scores are still coming in. Once every list is ranked the leaderboard will appear here.
            </div>
          )}
        </div>
      );
    } else {
      bodyContent = (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
          No scores yet.
        </div>
      );
    }
  }

  return (
    <SectionCollapse
      title="Results"
      icon={<span role="img" aria-hidden="true">🎉</span>}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="text-xs text-slate-500">{statusCopy}</div>
      {showConfetti ? <ConfettiOverlay seed={singleFinalWinner ? 120 : 88} /> : null}
      {bodyContent}
    </SectionCollapse>
  );
};

const MessagesPanel = ({
  messages,
  onSend,
  busy,
  participants,
  currentUser,
  expanded,
  onToggle,
  variant = "panel",
  onCloseDock,
}) => {
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState("all");

  const isDock = variant === "dock";

  const handleRecipientChange = (event) => {
    setRecipient(event.target.value);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!body.trim()) return;
    await onSend({ body: body.trim(), recipient: recipient === "all" ? null : recipient });
    setBody("");
  };

  const messageItems = messages.length ? (
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
  );

  const composer = (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ${isDock ? "shadow-inner" : ""}`}
        rows={isDock ? 4 : 3}
        placeholder="Write a note or reminder"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={busy}
      />
      <div className="flex items-center justify-between gap-2">
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={recipient}
          onChange={handleRecipientChange}
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
  );

  if (isDock) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Session messages"
        className="bnd-glass flex h-[min(28rem,calc(100vh-10rem))] w-[min(420px,calc(100vw-3rem))] flex-col rounded-3xl border border-white/55 px-5 py-4 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="font-display text-lg font-semibold text-slate-900">Messages</div>
            <p className="text-xs text-slate-500">Buzz quick updates or send a private note.</p>
          </div>
          <Button variant="subtle" className="text-xs" onClick={onCloseDock}>
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">{messageItems}</div>
        <div className="pt-3">{composer}</div>
      </div>
    );
  }

  return (
    <SectionCollapse
      title="Messages"
      icon={<span role="img" aria-hidden="true">💬</span>}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">{messageItems}</div>
      {composer}
    </SectionCollapse>
  );
};

export default function App() {
  const loadStoredUser = () => {
    if (typeof window === "undefined") return null;
    try {
      return JSON.parse(window.localStorage.getItem("bnd_user") || "null");
    } catch {
      return null;
    }
  };

  const loadStoredToken = () => {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem("bnd_token");
    return value || null;
  };

  const [user, setUser] = useState(loadStoredUser);
  const [authToken, setAuthTokenState] = useState(loadStoredToken);
  const [sessions, setSessions] = useState({ active: [], archived: [] });
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [activeSid, setActiveSid] = useState(null);
  const [sessionDoc, setSessionDoc] = useState(null);
  const [lists, setLists] = useState({});
  const [scores, setScores] = useState({});
  const [messages, setMessages] = useState([]);
  const [listDraft, setListDraft] = useState({ names: [], ranks: [], status: "draft", facts: {} });
  const [scoreDrafts, setScoreDrafts] = useState({});
  const [completedScores, setCompletedScores] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [scoreSubmitting, setScoreSubmitting] = useState(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [directMessageBusy, setDirectMessageBusy] = useState(false);
  const [tieBreakBusy, setTieBreakBusy] = useState(false);
  const [tieBreakSubmitBusy, setTieBreakSubmitBusy] = useState(false);
  const [pendingJoin, setPendingJoin] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [ambientEnabled, setAmbientEnabled] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(() => buildPanelState());
  const [activeDock, setActiveDock] = useState("home");
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [chatDockOpen, setChatDockOpen] = useState(false);
  const [chatDockHasNew, setChatDockHasNew] = useState(false);

  const soundscapeRef = useRef(null);
  const notificationCountRef = useRef(0);
  const notificationsInitializedRef = useRef(false);
  const inviteMismatchRef = useRef(false);
  const lastMessageCountRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (user) {
      window.localStorage.setItem("bnd_user", JSON.stringify(user));
    } else {
      window.localStorage.removeItem("bnd_user");
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
    } else if (typeof query.addListener === "function") {
      query.addListener(update);
    }
    update();
    return () => {
      if (typeof query.removeEventListener === "function") {
        query.removeEventListener("change", update);
      } else if (typeof query.removeListener === "function") {
        query.removeListener(update);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (authToken) {
      window.localStorage.setItem("bnd_token", authToken);
    } else {
      window.localStorage.removeItem("bnd_token");
    }
    api.setAuthToken(authToken);
  }, [authToken]);

  useEffect(() => {
    if (!isDesktop) {
      setChatDockOpen(false);
      setChatDockHasNew(false);
    }
  }, [isDesktop]);

  const queryParams = useQueryParams();
  const initialResetToken = queryParams.resetToken || "";
  const inviteQueryEmail =
    typeof queryParams.email === "string" && queryParams.email
      ? queryParams.email.trim().toLowerCase()
      : "";
  const allowedLoginModes = useMemo(() => new Set(["signin", "signup", "forgot", "reset"]), []);
  const initialLoginMode = initialResetToken
    ? "reset"
    : allowedLoginModes.has(queryParams.mode)
    ? queryParams.mode
    : undefined;
  const inviteEmailRaw = inviteInfo?.email || inviteQueryEmail;
  const inviteEmail = inviteEmailRaw ? inviteEmailRaw.trim().toLowerCase() : "";
  const lockLoginEmail = Boolean(inviteEmail);
  const inviteRequiredNames = inviteInfo?.requiredNames || 0;
  const inviteNameFocus = inviteInfo?.nameFocus || null;

  const panelStorageKey = sessionDoc?.sid ? `${PANEL_STORAGE_PREFIX}${sessionDoc.sid}` : null;

  useEffect(() => {
    soundscapeRef.current = createSoundscape();
    return () => {
      soundscapeRef.current?.dispose?.();
    };
  }, []);

  useEffect(() => {
    if (sessionDoc || !inviteRequiredNames) {
      return;
    }
    setListDraft((prev) => {
      const currentLength = prev?.names?.length || 0;
      if (currentLength === inviteRequiredNames) {
        return prev;
      }
      const names = Array.from({ length: inviteRequiredNames }, (_, index) => prev.names?.[index] || "");
      const ranks = Array.from({ length: inviteRequiredNames }, (_, index) => prev.ranks?.[index] ?? "");
      return { ...prev, names, ranks };
    });
  }, [sessionDoc, inviteRequiredNames]);

  const ensureAudioContext = useCallback(() => {
    const manager = soundscapeRef.current;
    if (!manager) return null;
    return manager.init();
  }, []);

  const playToken = useCallback((type) => {
    const manager = soundscapeRef.current;
    if (!manager) return;
    manager.init();
    manager.playToken(type);
  }, []);

  const toggleAmbient = useCallback(() => {
    const manager = soundscapeRef.current;
    if (!manager) return;
    setAmbientEnabled((prev) => {
      const next = !prev;
      manager.init();
      manager.toggleAmbient(next);
      return next;
    });
  }, []);

  const processGoogleAuthResult = useCallback(
    async (result) => {
      if (!result?.user) {
        throw new Error("Google sign-in failed");
      }
      const firebaseUser = result.user;
      let backendUser = null;
      let backendAuth = null;
      let idToken = null;
      if (typeof firebaseUser.getIdToken === "function") {
        idToken = await firebaseUser.getIdToken().catch(() => null);
      }
      if (!idToken) {
        idToken = extractGoogleIdToken(result);
      }
      if (idToken && typeof api.googleLogin === "function") {
        try {
          backendAuth = await api.googleLogin({ idToken });
          backendUser = backendAuth?.user ?? null;
        } catch (err) {
          console.error("Backend Google login failed", err);
        }
      }
      const resolved = {
        uid: backendUser?.uid || firebaseUser.email || firebaseUser.uid,
        email: backendUser?.email || firebaseUser.email || "",
        displayName:
          backendUser?.displayName || firebaseUser.displayName || firebaseUser.email || "Google user",
        photoURL: backendUser?.photoURL || firebaseUser.photoURL || null,
        provider: "google",
      };
      if (!resolved.email) {
        throw new Error("Google account is missing an email address");
      }
      setUser(resolved);
      setAuthTokenState(backendAuth?.token || null);
      playToken("success");
      return resolved;
    },
    [playToken],
  );


  useEffect(() => {
    if (!queryParams.sid || !queryParams.token) {
      setInviteInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.fetchInviteInfo({ sid: queryParams.sid, token: queryParams.token });
        if (cancelled) return;
        const invite = res.invite || res;
        setInviteInfo(invite);
        setPendingJoin({
          sid: invite.sid,
          token: invite.token,
          email: invite.email,
        });
      } catch (err) {
        console.error("Invite metadata load failed", err);
        if (!cancelled) {
          setInviteInfo(null);
          setPendingJoin({
            sid: queryParams.sid,
            token: queryParams.token,
            email: inviteQueryEmail || undefined,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryParams.sid, queryParams.token, inviteQueryEmail]);

  useEffect(() => {
    const resolveRedirect = async () => {
      try {
        const result = await getGoogleRedirectResult();
        if (result) {
          await processGoogleAuthResult(result);
        }
      } catch (err) {
        console.error("Google redirect processing failed", err);
        await signOutFirebase().catch(() => {});
        alert(err.message || "Google sign-in failed");
      }
    };
    resolveRedirect();
  }, [processGoogleAuthResult]);

  useEffect(() => {
    if (!user) return;
    const loadNotifications = async () => {
      try {
        const res = await api.fetchNotifications({ email: user.email });
        setNotifications(res.notifications || []);
        const count = res.notifications?.length || 0;
        if (notificationsInitializedRef.current && count > notificationCountRef.current) {
          playToken("warning");
        }
        notificationCountRef.current = count;
        notificationsInitializedRef.current = true;
      } catch (err) {
        console.error("Notifications load failed", err);
      }
    };
    loadNotifications();
  }, [playToken, user]);

  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.fetchNotifications({ email: user.email });
      setNotifications(res.notifications || []);
      const count = res.notifications?.length || 0;
      if (notificationsInitializedRef.current && count > notificationCountRef.current) {
        playToken("warning");
      }
      notificationCountRef.current = count;
      notificationsInitializedRef.current = true;
    } catch (err) {
      console.error(err);
    }
  }, [playToken, user]);

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

  const loadSessions = useCallback(async () => {
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
  }, [activeSid, user]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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
          url.searchParams.delete("mode");
          url.searchParams.delete("email");
          url.searchParams.delete("participant");
          window.history.replaceState({}, "", url.toString());
        }
      } catch (err) {
        console.error("Join failed", err);
        alert(err.message || "Unable to join session");
        setPendingJoin(null);
      }
    };
    joinIfNeeded();
  }, [loadSessions, pendingJoin, refreshNotifications, user]);

  const hydrateSession = useCallback((payload) => {
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
    const facts = myList?.facts || {};
    setListDraft({ names, ranks, status: myList?.status || payload.session?.listStates?.[myUid]?.status || "draft", facts });

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
    const completion = {};
    Object.entries(draftScores).forEach(([ownerUid, ownerDraft]) => {
      const values = Object.values(ownerDraft || {});
      if (values.length === required) {
        const normalized = values.map((value) => Number(value));
        const unique = new Set(normalized);
        const inRange = normalized.every((rank) => Number.isInteger(rank) && rank >= 1 && rank <= required);
        if (inRange && unique.size === required) {
          completion[ownerUid] = true;
        }
      }
    });
    setCompletedScores(completion);
    setScoreDrafts(mergedDrafts);
  }, [user]);

  const loadSession = useCallback(
    async (sid) => {
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
    },
    [hydrateSession, user],
  );

  useEffect(() => {
    if (!user || !activeSid) {
      setSessionDoc(null);
      setLists({});
      setScores({});
      setMessages([]);
      setCompletedScores({});
      return;
    }
    loadSession(activeSid);
  }, [activeSid, loadSession, user]);

  useEffect(() => {
    if (!sessionDoc) {
      setChatDockOpen(false);
      setChatDockHasNew(false);
      lastMessageCountRef.current = 0;
    }
  }, [sessionDoc]);

  useEffect(() => {
    if (!sessionDoc) {
      return;
    }
    setActiveDock((prev) => (prev === "messages" || prev === "notifications" || prev === "profile" ? prev : "sessions"));
  }, [sessionDoc]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPanelExpanded(buildPanelState());
      return;
    }
    if (!panelStorageKey) {
      setPanelExpanded(buildPanelState());
      return;
    }
    try {
      const raw = window.localStorage.getItem(panelStorageKey);
      if (raw) {
        setPanelExpanded(buildPanelState(JSON.parse(raw)));
      } else {
        setPanelExpanded(buildPanelState());
      }
    } catch (err) {
      console.warn("Unable to read panel state", err);
      setPanelExpanded(buildPanelState());
    }
  }, [panelStorageKey]);

  const persistPanelState = useCallback(
    (nextState) => {
      if (!panelStorageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(panelStorageKey, JSON.stringify(nextState));
      } catch (err) {
        console.warn("Unable to persist panel state", err);
      }
    },
    [panelStorageKey],
  );

  const updatePanelState = useCallback(
    (updater) => {
      setPanelExpanded((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        persistPanelState(next);
        return next;
      });
    },
    [persistPanelState],
  );

  useEffect(() => {
    if (!isDesktop) {
      lastMessageCountRef.current = messages.length;
      return;
    }
    const previous = lastMessageCountRef.current;
    if (messages.length > previous && !chatDockOpen) {
      setChatDockHasNew(true);
    }
    lastMessageCountRef.current = messages.length;
  }, [messages, chatDockOpen, isDesktop]);

  useEffect(() => {
    if (chatDockOpen) {
      setChatDockHasNew(false);
    }
  }, [chatDockOpen]);

  const handleCreateSession = async ({ title, requiredNames, nameFocus }) => {
    if (!user) return;
    setCreatingSession(true);
    try {
      const res = await api.createSession({ email: user.email, title, requiredNames, nameFocus });
      await loadSessions();
      await refreshNotifications();
      if (res?.session?.sid) {
        setActiveSid(res.session.sid);
      }
      setCreateOpen(false);
      playToken("success");
    } catch (err) {
      console.error("Create session failed", err);
      alert(err.message || "Unable to create session");
      playToken("warning");
    } finally {
      setCreatingSession(false);
    }
  };

  const handleExitSession = useCallback(async () => {
    setActiveSid(null);
    setActiveDock("home");
    setChatDockOpen(false);
    setChatDockHasNew(false);
    lastMessageCountRef.current = 0;
    if (sessionDoc?.sid && user?.email) {
      writeScoreDraftsToStorage(sessionDoc.sid, user.email, {});
    }
    setSessionDoc(null);
    setLists({});
    setScores({});
    setMessages([]);
    setListDraft({ names: [], ranks: [], status: "draft", facts: {} });
    setScoreDrafts({});
    setCompletedScores({});
    setSessionBusy(false);
    setTieBreakBusy(false);
    setTieBreakSubmitBusy(false);
    await loadSessions();
  }, [loadSessions, sessionDoc, user]);

  const togglePanel = (key) => {
    updatePanelState((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const setAllPanels = (value) => {
    updatePanelState(() => {
      const next = {};
      PANEL_KEYS.forEach((panelKey) => {
        next[panelKey] = value;
      });
      return next;
    });
  };

  const scrollToId = useCallback((targetId) => {
    if (typeof window === "undefined") return;
    if (!targetId) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleDockNavigate = useCallback(
    (view) => {
      setActiveDock(view);
      switch (view) {
        case "home":
          if (isDesktop) {
            scrollToId(null);
          }
          if (sessionDoc) {
            void handleExitSession();
          }
          break;
        case "sessions":
          if (isDesktop) {
            scrollToId("sessions-board");
          }
          break;
        case "messages":
          if (!sessionDoc) break;
          if (isDesktop) {
            setChatDockOpen(true);
            setChatDockHasNew(false);
            setTimeout(() => {
              lastMessageCountRef.current = messages.length;
            }, 0);
          }
          break;
        case "notifications":
          if (isDesktop) {
            scrollToId("notifications-panel");
          }
          break;
        case "profile":
          if (isDesktop) {
            scrollToId("profile-panel");
          }
          break;
        default:
          break;
      }
    },
    [handleExitSession, scrollToId, sessionDoc, isDesktop, messages.length],
  );

  const allExpanded = PANEL_KEYS.every((panelKey) => panelExpanded[panelKey]);
  const allCollapsed = PANEL_KEYS.every((panelKey) => !panelExpanded[panelKey]);

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
        slotCount: required,
      });
      await loadSession(sessionDoc.sid);
      await refreshNotifications();
      playToken(finalize ? "success" : "neutral");
    } catch (err) {
      console.error("Save list failed", err);
      alert(err.message || "Unable to save list");
      playToken("warning");
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
    setCompletedScores((prev) => {
      if (!prev[ownerUid]) {
        return prev;
      }
      const next = { ...prev };
      delete next[ownerUid];
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
    if (completedScores[ownerUid]) {
      alert("Scores already submitted for this list.");
      return;
    }
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
      playToken("success");
      const stored = readScoreDraftsFromStorage(sessionDoc.sid, user.email);
      if (stored[ownerUid]) {
        delete stored[ownerUid];
        writeScoreDraftsToStorage(sessionDoc.sid, user.email, stored);
      }
      setScoreDrafts((prev) => {
        const next = { ...prev };
        next[ownerUid] = names.reduce((acc, name) => {
          acc[name] = draft[name];
          return acc;
        }, {});
        return next;
      });
      setCompletedScores((prev) => ({ ...prev, [ownerUid]: true }));
      alert("Scores submitted.");
    } catch (err) {
      console.error("Submit scores failed", err);
      alert(err.message || "Unable to submit scores");
      playToken("warning");
    } finally {
      setScoreSubmitting(null);
    }
  };

  const handleSaveScoreDraft = (ownerUid) => {
    if (!sessionDoc || !user) return;
    if (completedScores[ownerUid]) {
      alert("Scores already submitted for this list.");
      return;
    }
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
      playToken("neutral");
    } catch (err) {
      console.error("Send message failed", err);
      alert(err.message || "Unable to send message");
      playToken("warning");
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
      playToken("neutral");
    } catch (err) {
      console.error("Direct message failed", err);
      alert(err.message || "Unable to send message");
      playToken("warning");
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
          const emailNote =
            row.emailSent === undefined
              ? ""
              : row.emailSent
                ? " Email sent."
                : " Email delivery not configured.";
          if (row.status === "added") return `${row.email} added as participant.${emailNote}`;
          if (row.status === "invite-sent") return `${row.email} invited (link generated).${emailNote}`;
          if (row.status === "already-member") return `${row.email} already participating.`;
          return `${row.email}: ${row.status}${emailNote}`;
        })
        .join("\n");
      if (message) alert(message);
      await loadSession(sessionDoc.sid);
      playToken("neutral");
    } catch (err) {
      console.error("Invite failed", err);
      alert(err.message || "Unable to invite participant");
      playToken("warning");
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
      playToken("neutral");
    } catch (err) {
      console.error("Remove participant failed", err);
      alert(err.message || "Unable to remove participant");
      playToken("warning");
    }
  };

  const handleLockInvites = async () => {
    if (!sessionDoc || !user) return;
    setLockBusy(true);
    try {
      await api.lockInvites({ sid: sessionDoc.sid, email: user.email });
      await loadSession(sessionDoc.sid);
      await refreshNotifications();
      playToken("neutral");
    } catch (err) {
      console.error("Lock invites failed", err);
      alert(err.message || "Unable to lock invites");
      playToken("warning");
    } finally {
      setLockBusy(false);
    }
  };

  const handleStartTieBreak = async () => {
    if (!sessionDoc || !user) return;
    setTieBreakBusy(true);
    try {
      await api.startTieBreak({ sid: sessionDoc.sid });
      await loadSession(sessionDoc.sid);
      playToken("alert");
    } catch (err) {
      console.error("Start tie-break failed", err);
      alert(err.message || "Unable to start tie-break");
      playToken("warning");
    } finally {
      setTieBreakBusy(false);
    }
  };

  const handleSubmitTieBreakVotes = async (ranks) => {
    if (!sessionDoc || !user) return;
    setTieBreakSubmitBusy(true);
    try {
      await api.submitTieBreakVotes({ sid: sessionDoc.sid, ranks });
      await loadSession(sessionDoc.sid);
      playToken("success");
    } catch (err) {
      console.error("Submit tie-break votes failed", err);
      alert(err.message || "Unable to submit tie-break vote");
      playToken("warning");
    } finally {
      setTieBreakSubmitBusy(false);
    }
  };

  const handleCloseTieBreak = async () => {
    if (!sessionDoc || !user) return;
    setTieBreakBusy(true);
    try {
      const res = await api.closeTieBreak({ sid: sessionDoc.sid });
      await loadSession(sessionDoc.sid);
      const winners = res?.winners || [];
      playToken(winners.length === 1 ? "success" : "neutral");
    } catch (err) {
      console.error("Close tie-break failed", err);
      alert(err.message || "Unable to close tie-break");
      playToken("warning");
    } finally {
      setTieBreakBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!sessionDoc || !user) return;
    if (!window.confirm("Archive this session?")) return;
    try {
      await api.archiveSession({ sid: sessionDoc.sid, email: user.email });
      await loadSessions();
      setActiveSid(null);
      setActiveDock("home");
      playToken("neutral");
    } catch (err) {
      console.error("Archive failed", err);
      alert(err.message || "Unable to archive session");
      playToken("warning");
    }
  };

  const handleDelete = async () => {
    if (!sessionDoc || !user) return;
    if (!window.confirm("Delete this session permanently?")) return;
    try {
      await api.deleteSession({ sid: sessionDoc.sid, email: user.email });
      await loadSessions();
      setActiveSid(null);
      setActiveDock("home");
      playToken("alert");
    } catch (err) {
      console.error("Delete failed", err);
      alert(err.message || "Unable to delete session");
      playToken("warning");
    }
  };

  const handleChatLauncherToggle = useCallback(() => {
    setChatDockOpen((prev) => {
      const next = !prev;
      if (next) {
        setChatDockHasNew(false);
        lastMessageCountRef.current = messages.length;
        setActiveDock("messages");
      } else if (activeDock === "messages") {
        setActiveDock(sessionDoc ? "sessions" : "home");
      }
      return next;
    });
  }, [activeDock, messages.length, sessionDoc]);

  const handleSignOut = useCallback(
    async ({ preservePending = false } = {}) => {
      if (authToken) {
        try {
          await api.logout();
        } catch (err) {
          console.warn("Logout request failed", err);
        }
      }
      try {
        await signOutFirebase().catch(() => {});
      } finally {
        setAuthTokenState(null);
        setUser(null);
        setSessions({ active: [], archived: [] });
        setActiveSid(null);
        setSessionDoc(null);
        setLists({});
        setScores({});
        setMessages([]);
        setListDraft({ names: [], ranks: [], status: "draft", facts: {} });
        setScoreDrafts({});
        setCompletedScores({});
        setNotifications([]);
        if (!preservePending) {
          setPendingJoin(null);
        }
        setCreateOpen(false);
        setActiveDock("home");
        setChatDockOpen(false);
        setChatDockHasNew(false);
        lastMessageCountRef.current = 0;
        notificationCountRef.current = 0;
        notificationsInitializedRef.current = false;
        setAmbientEnabled(false);
        soundscapeRef.current?.toggleAmbient(false);
        setTieBreakBusy(false);
        setTieBreakSubmitBusy(false);
      }
    },
    [authToken],
  );

  const handleSignInGoogle = async () => {
    if (typeof signInWithGooglePopup !== "function") {
      alert("Google sign-in is not configured.");
      return;
    }
    try {
      const result = await signInWithGooglePopup();
      if (!result) {
        return; // redirect flow initiated; result handled after redirect
      }
      await processGoogleAuthResult(result);
    } catch (err) {
      console.error(err);
      await signOutFirebase().catch(() => {});
      alert(err.message || "Google sign-in failed");
      playToken("warning");
    }
  };

  const handleSignInEmail = async (email, password) => {
    try {
      const res = await api.login({ email, password });
      const userPayload = res.user || { email, displayName: email };
      const u = {
        uid: userPayload.uid || userPayload.email,
        email: userPayload.email,
        displayName: userPayload.displayName || userPayload.email,
      };
      setUser(u);
      setAuthTokenState(res.token || null);
      playToken("success");
    } catch (err) {
      console.error(err);
      alert(err.message || "Email sign-in failed");
      playToken("warning");
    }
  };

  useEffect(() => {
    if (!inviteEmail || !user) {
      if (!inviteEmail) inviteMismatchRef.current = false;
      return;
    }
    const lowerUser = (user.email || "").trim().toLowerCase();
    if (lowerUser && lowerUser !== inviteEmail && !inviteMismatchRef.current) {
      inviteMismatchRef.current = true;
      if (typeof window !== "undefined") {
        window.alert(
          `You are currently signed in as ${user.email}. Please join with the invited email ${inviteEmail}. We signed you out so you can continue.`,
        );
      }
      handleSignOut({ preservePending: true }).catch(() => {});
    }
  }, [inviteEmail, user, handleSignOut]);

  const handleSignUp = async (email, password, fullName) => {
    try {
      const res = await api.signup({ fullName: fullName || "User", email, password });
      const userPayload = res.user || { email, displayName: fullName || email };
      const u = {
        uid: userPayload.uid || userPayload.email,
        email: userPayload.email,
        displayName: userPayload.displayName || fullName || userPayload.email,
      };
      setUser(u);
      setAuthTokenState(res.token || null);
      playToken("success");
    } catch (err) {
      console.error(err);
      alert(err.message || "Sign up failed");
      playToken("warning");
    }
  };

  const requiredNames =
    sessionDoc?.requiredNames || sessionDoc?.maxNames || inviteRequiredNames || 0;
  const activeNameFocus =
    sessionDoc?.nameFocus || inviteNameFocus || "mix";
  const isOwner = sessionDoc?.createdBy === user?.email;
  const messageParticipants = useMemo(() => {
    if (!sessionDoc) return [];
    return [...(sessionDoc.ownerIds || []), ...(sessionDoc.participantIds || [])].filter(
      (uid) => uid && uid !== user?.email,
    );
  }, [sessionDoc, user]);
  const activeCount = Array.isArray(sessions?.active) ? sessions.active.length : 0;
  const archivedCount = Array.isArray(sessions?.archived) ? sessions.archived.length : 0;
  const pendingListCount = useMemo(() => {
    if (!Array.isArray(sessions?.active)) return 0;
    return sessions.active.filter((record) => (record.listStatus || "draft") !== "submitted").length;
  }, [sessions]);
  const unreadNotificationCount = useMemo(
    () => (Array.isArray(notifications) ? notifications.filter((note) => !note.readAt).length : 0),
    [notifications],
  );
  const activeTieBreakCount = useMemo(() => {
    if (!Array.isArray(sessions?.active)) return 0;
    return sessions.active.filter((record) => record.tieBreakActive).length;
  }, [sessions]);
  const userFirstName = firstNameFromEmail(user?.email);
  const mobileStats = useMemo(() => {
    const stats = [
      { label: "Active sessions", value: activeCount },
      { label: "Lists to finish", value: pendingListCount },
      { label: "Unread alerts", value: unreadNotificationCount },
    ];
    if (activeTieBreakCount > 0) {
      stats.push({ label: "Tie-breaks live", value: activeTieBreakCount });
    }
    return stats;
  }, [activeCount, pendingListCount, unreadNotificationCount, activeTieBreakCount]);
  const allCaughtUp = pendingListCount === 0 && unreadNotificationCount === 0 && activeTieBreakCount === 0;
  const profileNameParts = useMemo(() => {
    if (!user) {
      return { first: "", last: "" };
    }
    const display = (user.displayName || "").trim();
    if (display) {
      const parts = display.split(/\s+/);
      return {
        first: capitalize(parts[0] || userFirstName),
        last: parts.slice(1).map(capitalize).join(" "),
      };
    }
    const local = (user.email || "").split("@")[0].replace(/[._+-]+/g, " ").trim();
    if (!local) {
      return { first: userFirstName, last: "" };
    }
    const pieces = local.split(/\s+/);
    const first = pieces.length ? capitalize(pieces[0]) : userFirstName;
    const last = pieces.length > 1 ? pieces.slice(1).map(capitalize).join(" ") : "";
    return { first: first || userFirstName, last };
  }, [user, userFirstName]);
  const profileFirstName = profileNameParts.first || userFirstName;
  const profileLastName = profileNameParts.last;

  const mobileHomeContent = (
    <>
      <Card className="space-y-3 p-5">
        <div className="text-sm font-semibold text-slate-700">Hey {userFirstName}, here’s what’s happening</div>
        <div className="space-y-2 text-xs text-slate-500">
          {mobileStats.map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg border border-white/60 bg-white/80 px-3 py-2 shadow-sm"
            >
              <span>{label}</span>
              <span className="font-semibold text-slate-700">{value}</span>
            </div>
          ))}
        </div>
        {allCaughtUp ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            You’re all caught up! 🎉
          </div>
        ) : null}
        <p className="text-xs text-slate-500">Use the tabs below to manage sessions, chat, or view alerts.</p>
      </Card>
      {activeCount + archivedCount === 0 ? (
        <Card className="space-y-2 p-5">
          <div className="text-sm font-semibold text-slate-700">Start your first session</div>
          <p className="text-xs text-slate-500">
            Create a new duel to invite family and begin shortlisting favorite names.
          </p>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <PlusCircle className="h-4 w-4" />
            New session
          </Button>
        </Card>
      ) : null}
    </>
  );

  const mobileSessionsContent = (
    <>
      <SessionsDashboard
        sessions={sessions}
        activeSid={activeSid}
        onSelect={(sid) => setActiveSid(sid)}
        onOpenCreate={() => setCreateOpen(true)}
        loading={sessionsBusy}
      />
      {sessionBusy && activeSid ? (
        <Card className="flex items-center gap-2 p-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading session…
        </Card>
      ) : null}
    </>
  );

  const mobileNotificationsContent = (
    <NotificationsPanel
      notifications={notifications}
      onRefresh={refreshNotifications}
      onMarkAll={markAllNotifications}
      onMarkSingle={markNotification}
    />
  );

  const mobileProfileContent = (
    <Card className="space-y-3 p-5">
      <div className="text-sm font-semibold text-slate-700">Profile</div>
      <div className="space-y-2 text-xs text-slate-500">
        <div className="flex items-center justify-between rounded-lg border border-white/60 bg-white/80 px-3 py-2 shadow-sm">
          <span>First name</span>
          <span className="font-semibold text-slate-700">{profileFirstName || "—"}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/60 bg-white/80 px-3 py-2 shadow-sm">
          <span>Last name</span>
          <span className="font-semibold text-slate-700">{profileLastName || "—"}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/60 bg-white/80 px-3 py-2 shadow-sm">
          <span>Email</span>
          <span className="font-semibold text-slate-700">{user?.email || "—"}</span>
        </div>
      </div>
    </Card>
  );

  const mobileMessagesContent = (
    <Card className="space-y-2 p-5">
      <div className="text-sm font-semibold text-slate-700">Messages</div>
      <p className="text-xs text-slate-500">
        Open a session from the Sessions tab to chat with your crew.
      </p>
    </Card>
  );

  const mobileContent = (() => {
    switch (activeDock) {
      case "sessions":
        return mobileSessionsContent;
      case "notifications":
        return mobileNotificationsContent;
      case "profile":
        return mobileProfileContent;
      case "messages":
        return mobileMessagesContent;
      default:
        return mobileHomeContent;
    }
  })();
  return (
    <div className="bnd-app-shell relative flex min-h-screen flex-col text-slate-800">
      <FloatingDecor />
      <div className="relative z-10 flex min-h-screen flex-col">
        <TopNav
          user={user}
          onSignOut={handleSignOut}
          ambientEnabled={ambientEnabled}
          onToggleAmbient={() => {
            ensureAudioContext();
            toggleAmbient();
          }}
          onProfile={() => handleDockNavigate("profile")}
        />
        <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-10 sm:px-6 lg:px-8 lg:pb-24">
          {user ? (
            <Card
              id="profile-panel"
              className="mb-6 flex flex-wrap items-center justify-between gap-4 p-5 sm:mb-8 sm:p-6"
            >
              <div className="space-y-1">
                <div className="font-display text-lg font-semibold text-slate-900">
                  Hey {userFirstName}
                </div>
                <div className="text-xs text-slate-500">{user.email}</div>
                <div className="text-xs text-slate-500">
                  Active sessions: {activeCount} · Archived: {archivedCount}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeCount + archivedCount === 0 ? (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    <PlusCircle className="h-4 w-4" />
                    New session
                  </Button>
                ) : null}
                <Button variant="subtle" onClick={() => handleDockNavigate("sessions")}>
                  <LayoutGrid className="h-4 w-4" />
                  View sessions
                </Button>
              </div>
            </Card>
          ) : null}

          {!user ? (
            <LoginPage
              initialMode={initialLoginMode}
              initialResetToken={initialResetToken}
              initialEmail={inviteEmail}
              lockEmail={lockLoginEmail}
              onGoogleSignIn={handleSignInGoogle}
              onEmailSignIn={handleSignInEmail}
              onSignup={({ email, password, fullName }) => handleSignUp(email, password, fullName)}
              onRequestReset={(email) => api.requestPasswordReset({ email })}
              onConfirmReset={(token, newPassword) => api.resetPassword({ token, newPassword })}
            />
          ) : sessionDoc ? (
            <div className="bnd-responsive-grid">
              {sessionBusy && (
                <Card className="col-span-full flex items-center gap-2 p-4 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading session…
                </Card>
              )}

              <Card className="col-span-full space-y-3 p-6 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-display text-2xl font-semibold text-slate-900">{sessionDoc.title}</div>
                    <div className="text-xs text-slate-500">
                      Required names: {requiredNames} · Status: {sessionDoc.status}
                    </div>
                    <div className="text-xs text-slate-500">
                      Name theme: {NAME_FOCUS_LABELS[activeNameFocus] || NAME_FOCUS_LABELS.mix}
                    </div>
                    <div className="text-xs text-slate-500">
                      Created {formatDate(sessionDoc.createdAt)} by {sessionDoc.createdBy}
                    </div>
                  </div>
                  {isDesktop ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="glass" onClick={handleExitSession}>
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
                  ) : null}
                </div>
              </Card>

              <div className="col-span-full flex flex-wrap items-center justify-end gap-2">
                <Button variant="subtle" onClick={() => setAllPanels(true)} disabled={allExpanded}>
                  Expand all
                </Button>
                <Button variant="subtle" onClick={() => setAllPanels(false)} disabled={allCollapsed}>
                  Collapse all
                </Button>
              </div>

              <div className="col-span-full lg:col-span-5">
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
                  expanded={panelExpanded.participants}
                  onToggle={() => togglePanel("participants")}
                />
              </div>

              <div className="col-span-full lg:col-span-7">
                <ListEditor
                  requiredNames={requiredNames}
                  nameFocus={activeNameFocus}
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
                  expanded={panelExpanded.list}
                  onToggle={() => togglePanel("list")}
                />
              </div>

              <div className="col-span-full lg:col-span-7">
                <OtherListsPanel
                  lists={lists}
                  scores={scoringModel.result}
                  currentUser={user}
                  requiredNames={requiredNames}
                  nameFocus={activeNameFocus}
                  draftState={scoreDrafts}
                  completedScores={completedScores}
                  onSaveDraft={handleSaveScoreDraft}
                  onSubmitScores={handleSubmitScores}
                  submitting={scoreSubmitting}
                  expanded={panelExpanded.otherLists}
                  onToggle={() => togglePanel("otherLists")}
                />
              </div>

              <div className="col-span-full lg:col-span-7">
                <ResultsPanel
                  lists={lists}
                  scores={scores}
                  requiredNames={requiredNames}
                  invitesLocked={sessionDoc.invitesLocked}
                  tieBreak={sessionDoc.tieBreak}
                  finalWinners={sessionDoc.finalWinners}
                  isOwner={isOwner}
                  onStartTieBreak={handleStartTieBreak}
                  onSubmitTieBreak={handleSubmitTieBreakVotes}
                  onCloseTieBreak={handleCloseTieBreak}
                  tieBreakBusy={tieBreakBusy}
                  tieBreakSubmitBusy={tieBreakSubmitBusy}
                  onTopTieChange={(isTie) => {
                    if (isTie) {
                      playToken("alert");
                    }
                  }}
                  expanded={panelExpanded.results}
                  onToggle={() => togglePanel("results")}
                />
              </div>

              {!isDesktop ? (
                <div id="messages-panel" className="col-span-full lg:col-span-5">
                  <MessagesPanel
                    messages={messages}
                    onSend={handleSendMessage}
                    busy={messageBusy}
                    participants={messageParticipants}
                    currentUser={user}
                    expanded={panelExpanded.messages}
                    onToggle={() => togglePanel("messages")}
                  />
                </div>
              ) : null}
            </div>
        ) : isDesktop ? (
          <div className="bnd-responsive-grid">
            <div id="notifications-panel" className="col-span-full lg:col-span-5">
              <NotificationsPanel
                notifications={notifications}
                onRefresh={refreshNotifications}
                onMarkAll={markAllNotifications}
                onMarkSingle={markNotification}
              />
            </div>

            <div id="sessions-board" className="col-span-full lg:col-span-7">
              <SessionsDashboard
                sessions={sessions}
                activeSid={activeSid}
                onSelect={(sid) => setActiveSid(sid)}
                onOpenCreate={() => setCreateOpen(true)}
                loading={sessionsBusy}
              />
            </div>

            {sessionBusy && activeSid && (
              <Card className="col-span-full flex items-center gap-2 p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading session…
              </Card>
            )}
          </div>
        ) : (
          <div className="space-y-4">{mobileContent}</div>
        )}
        </main>

        {isDesktop && user && sessionDoc ? (
          <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-4">
            {chatDockOpen ? (
              <div className="pointer-events-auto">
                <MessagesPanel
                  variant="dock"
                  messages={messages}
                  onSend={handleSendMessage}
                  busy={messageBusy}
                  participants={messageParticipants}
                  currentUser={user}
                  onCloseDock={() => {
                    setChatDockOpen(false);
                    setChatDockHasNew(false);
                    if (activeDock === "messages") {
                      setActiveDock(sessionDoc ? "sessions" : "home");
                    }
                  }}
                />
              </div>
            ) : null}
            <div className="pointer-events-auto group relative">
              <Button
                variant="primary"
                className={`!gap-0 h-14 w-14 rounded-full p-0 text-white shadow-xl transition hover:shadow-2xl ${
                  chatDockOpen ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-white" : ""
                }`}
                aria-expanded={chatDockOpen}
                aria-label={chatDockOpen ? "Close chat" : "Open chat"}
                title={chatDockOpen ? "Close chat" : "Open chat"}
                onClick={handleChatLauncherToggle}
              >
                <MessageCircle className="h-6 w-6" />
                {chatDockHasNew ? (
                  <span className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-rose-500 shadow-sm" aria-hidden="true" />
                ) : null}
              </Button>
              <span className="pointer-events-none absolute right-full top-1/2 hidden -translate-x-3 -translate-y-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover:block group-hover:opacity-100">
                {chatDockOpen ? "Minimize chat" : "Chat with your crew"}
              </span>
            </div>
          </div>
        ) : null}

        {user ? (
          <MobileDock
            active={activeDock}
            onNavigate={handleDockNavigate}
            hasSession={Boolean(sessionDoc)}
            sessionsPending={pendingListCount}
            alertsCount={unreadNotificationCount}
          />
        ) : null}

        <CreateSessionModal
          open={createOpen}
          busy={creatingSession}
          onClose={() => (!creatingSession ? setCreateOpen(false) : null)}
          onCreate={handleCreateSession}
        />
      </div>
    </div>
  );
}
