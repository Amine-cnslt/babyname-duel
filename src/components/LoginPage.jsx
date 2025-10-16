import { useCallback, useEffect, useRef, useState } from "react";

/** Modern login page for BabyNames Hive (footer removed) */
const MODES = new Set(["signin", "signup", "forgot", "reset"]);

export default function LoginPage({
  initialMode = "signin",
  initialResetToken = "",
  initialEmail = "",
  lockEmail = false,
  onGoogleSignIn,
  onEmailSignIn,
  onSignup,
  onRequestReset,
  onConfirmReset,
}) {
  const [mode, setMode] = useState(() => (MODES.has(initialMode) ? initialMode : "signin"));
  const normalizedInitialEmail = (initialEmail || "").trim().toLowerCase();
  const [email, setEmail] = useState(normalizedInitialEmail);
  const [emailLocked, setEmailLocked] = useState(Boolean(lockEmail && normalizedInitialEmail));
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showResetPwd, setShowResetPwd] = useState(false);
  const resetPwdRef = useRef(null);
  const resetConfirmRef = useRef(null);
  const applyResetType = useCallback((visible) => {
    const nextType = visible ? "text" : "password";
    const security = visible ? "none" : "";
    [resetPwdRef.current, resetConfirmRef.current].forEach((input) => {
      if (!input) return;
      input.setAttribute("type", nextType);
      if (security) {
        input.style.WebkitTextSecurity = security;
      } else {
        input.style.removeProperty("WebkitTextSecurity");
      }
    });
  }, []);
  const scheduleResetType = useCallback((visible) => {
    applyResetType(visible);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => applyResetType(visible));
    }
    setTimeout(() => applyResetType(visible), 0);
    setTimeout(() => applyResetType(visible), 60);
  }, [applyResetType]);
  useEffect(() => {
    scheduleResetType(showResetPwd);
  }, [scheduleResetType, showResetPwd]);
  const toggleResetVisibility = () => {
    setShowResetPwd((prev) => {
      const next = !prev;
      scheduleResetType(next);
      return next;
    });
  };
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState(initialResetToken || "");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [notice, setNotice] = useState(null);
  const [noticeType, setNoticeType] = useState("info");

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  useEffect(() => {
    const normalized = (initialEmail || "").trim().toLowerCase();
    setEmail(normalized);
    setEmailLocked(Boolean(lockEmail && normalized));
  }, [initialEmail, lockEmail]);

  const switchMode = (next) => {
    setMode(next);
    setLoading(false);
    setNotice(null);
    setNoticeType("info");
    setShowPwd(false);
    setShowResetPwd(false);
    scheduleResetType(false);
    if (next === "signin") {
      setPassword("");
      setConfirm("");
    }
    if (next === "signup") {
      setPassword("");
      setConfirm("");
    }
    if (next === "forgot") {
      setResetToken("");
      setResetPassword("");
      setResetConfirm("");
    }
    if (next === "reset") {
      setResetToken("");
      setResetPassword("");
      setResetConfirm("");
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setNotice(null);
    if ((mode === "signup" || mode === "forgot") && !emailPattern.test(email)) {
      setNotice("Please enter a valid email address.");
      setNoticeType("error");
      return;
    }
    if (mode === "signup" && password !== confirm) {
      alert("Passwords do not match.");
      return;
    }
    if (mode === "reset" && resetPassword !== resetConfirm) {
      setNotice("Passwords do not match.");
      setNoticeType("error");
      return;
    }
    if (mode === "reset" && (!resetToken.trim() || resetPassword.length < 6)) {
      setNotice("Your reset link is missing or expired. Please request another.");
      setNoticeType("error");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        await (onEmailSignIn?.(email, password, { remember }) ?? Promise.resolve());
      } else {
        if (mode === "signup") {
          await (onSignup?.({ fullName, email, password }) ?? Promise.resolve());
        } else if (mode === "forgot") {
          try {
            const res = await (onRequestReset?.(email) ?? Promise.resolve());
            const msg = res?.message || "If the email exists, a reset link has been sent.";
            setNotice(msg);
            setNoticeType("success");
          } catch (err) {
            setNotice(err?.message || "Unable to process reset request.");
            setNoticeType("error");
          }
        } else if (mode === "reset") {
          try {
            const res = await (onConfirmReset?.(resetToken.trim(), resetPassword) ?? Promise.resolve());
            const msg = res?.message || "Password reset successfully. You can now sign in.";
            switchMode("signin");
            setNotice(msg);
            setNoticeType("success");
            setPassword("");
            setResetToken("");
            setResetPassword("");
            setResetConfirm("");
          } catch (err) {
            setNotice(err?.message || "Unable to reset password.");
            setNoticeType("error");
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center px-4 py-12 sm:py-16">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(255,204,160,0.2),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(186,226,255,0.2),transparent_60%),linear-gradient(135deg,rgba(255,255,255,0.45),transparent_60%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center">
        <div className="w-full max-w-md">
          <div className="bnd-glass w-full rounded-3xl border border-white/45 px-6 py-8 shadow-2xl sm:px-8">
          {/* Brand */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-100 via-white to-rose-100 text-amber-500 shadow-inner">
              🐝
            </div>
            <h1 className="font-display text-3xl font-semibold leading-tight text-slate-900">
              BabyNames <span className="text-amber-500">Hive</span>
            </h1>
            <p className="mt-2 text-sm text-slate-500">Curate names together with a joyful, social flow.</p>
          </div>

          <h2 className="mb-2 text-center font-display text-2xl font-semibold text-slate-900">
            {mode === "signin" && "Welcome back"}
            {mode === "signup" && "Create your account"}
            {mode === "forgot" && "Forgot your password?"}
            {mode === "reset" && "Reset your password"}
          </h2>
          <p className="mb-6 text-center text-sm text-slate-500 whitespace-pre-line">
            {mode === "signin" && "Please sign in to continue your journey"}
            {mode === "signup" && "Start your baby name journey today"}
            {mode === "forgot" && "Enter the email you used at signup and we'll send you reset instructions."}
            {mode === "reset" && "Use the link in your email to choose a new password."}
          </p>

          {/* Google button */}
          {mode !== "reset" && (
            <button
              type="button"
              onClick={() => onGoogleSignIn?.()}
              className="bnd-btn bnd-btn--secondary mb-4 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-slate-700"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3A12 12 0 1 1 24 12a11.9 11.9 0 0 1 8.4 3.3l5.6-5.6A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3.2 0 6.1 1.2 8.4 3.3l5.6-5.6A20 20 0 0 0 4 24l2.3-9.3z"/>
                <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.7-5.3l-6.3-5.2A12 12 0 0 1 12.9 29l-6.6 5.1A20 20 0 0 0 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.4l6.3 5.2C39.8 36.5 44 30 44 24c0-1.2-.1-2.3-.4-3.5z"/>
              </svg>
              <span className="font-medium">Continue with Google</span>
            </button>
          )}

          {/* divider */}
          {mode !== "reset" && (
            <div className="relative my-5">
              <div className="h-px w-full bg-white/60" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 px-3 text-xs uppercase tracking-wide text-slate-400">
                or
              </span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <input
                type="text"
                className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
                placeholder="Full name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            )}

            {(mode === "signin" || mode === "signup" || mode === "forgot") && (
              <>
                <input
                  type="email"
                  className={`w-full rounded-2xl border border-slate-200/70 px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60 ${
                    emailLocked ? "bg-slate-100/80 cursor-not-allowed" : "bg-white/90"
                  }`}
                  placeholder="Email address"
                  autoComplete="email"
                  value={email}
                  readOnly={emailLocked}
                  aria-readonly={emailLocked}
                  onChange={(e) => {
                    if (emailLocked) return;
                    setEmail(e.target.value);
                  }}
                  required
                />
                {emailLocked && (mode === "signup" || mode === "signin") ? (
                  <p className="text-xs text-amber-600">
                    You&apos;re joining as <span className="font-medium">{email}</span>. Ask the host for a new invite if this isn&apos;t you.
                  </p>
                ) : null}
              </>
            )}

            {(mode === "signin" || mode === "signup") && (
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 pr-12 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
                  placeholder="Password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/70 px-2 py-1 text-xs text-slate-500 shadow hover:bg-white"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            )}

            {mode === "signup" && (
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 pr-12 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/70 px-2 py-1 text-xs text-slate-500 shadow hover:bg-white"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            )}

            {mode === "reset" && (
              <>
                <div className="relative">
                  <input
                    ref={resetPwdRef}
                    type={showResetPwd ? "text" : "password"}
                    className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 pr-12 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
                    placeholder="New password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={toggleResetVisibility}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/70 px-2 py-1 text-xs text-slate-500 shadow hover:bg-white"
                    aria-label={showResetPwd ? "Hide password" : "Show password"}
                  >
                    {showResetPwd ? "🙈" : "👁️"}
                  </button>
                </div>
                <div className="relative">
                  <input
                    ref={resetConfirmRef}
                    type={showResetPwd ? "text" : "password"}
                    className="w-full rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 pr-12 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
                    placeholder="Confirm password"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={toggleResetVisibility}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/70 px-2 py-1 text-xs text-slate-500 shadow hover:bg-white"
                    aria-label={showResetPwd ? "Hide password" : "Show password"}
                  >
                    {showResetPwd ? "🙈" : "👁️"}
                  </button>
                </div>
              </>
            )}

            {mode === "signin" && (
              <div className="flex items-center justify-between text-xs text-slate-600 sm:text-sm">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-300"
                    checked={remember}
                    onChange={() => setRemember((v) => !v)}
                  />
                  <span>Remember me</span>
                </label>
                <button type="button" className="text-amber-600 hover:underline" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              </div>
            )}

            {notice && (
              <div
                className={`rounded-2xl border px-3 py-2 text-xs shadow-inner sm:text-sm ${
                  noticeType === "error"
                    ? "border-rose-200/70 bg-rose-50/85 text-rose-700"
                    : "border-emerald-200/70 bg-emerald-50/85 text-emerald-700"
                }`}
              >
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="bnd-btn bnd-btn--primary mt-2 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-white"
            >
              {loading
                ? "Please wait…"
                : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                ? "Send reset link"
                : "Update password"}
              <span>→</span>
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            {mode === "signin" && (
              <>
                Don&apos;t have an account?{" "}
                <button onClick={() => switchMode("signup")} className="text-amber-600 hover:underline">Sign up</button>
              </>
            )}
            {mode === "signup" && (
              <>
                Already have an account?{" "}
                <button onClick={() => switchMode("signin")} className="text-amber-600 hover:underline">Sign in</button>
              </>
            )}
            {mode === "forgot" && (
              <>
                Remember your password?{" "}
                <button onClick={() => switchMode("signin")} className="text-amber-600 hover:underline">Back to sign in</button>
              </>
            )}
            {mode === "reset" && (
              <>
                Need a new link?{" "}
                <button onClick={() => switchMode("forgot")} className="text-amber-600 hover:underline">Request again</button>
                <br />
                Ready to sign in?{" "}
                <button onClick={() => switchMode("signin")} className="text-amber-600 hover:underline">Back to sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  </div>
  );
}
