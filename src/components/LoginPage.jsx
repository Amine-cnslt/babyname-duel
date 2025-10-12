import { useCallback, useEffect, useRef, useState } from "react";

/** Modern login page for BabyName Duel (footer removed) */
const MODES = new Set(["signin", "signup", "forgot", "reset"]);

export default function LoginPage({
  initialMode = "signin",
  initialResetToken = "",
  onGoogleSignIn,
  onEmailSignIn,
  onSignup,
  onRequestReset,
  onConfirmReset,
}) {
  const [mode, setMode] = useState(() => (MODES.has(initialMode) ? initialMode : "signin"));
  const [email, setEmail] = useState("");
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
      setNotice("Reset token and a password of at least 6 characters are required.");
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
            const tokenMsg = res?.token ? `\nToken: ${res.token}` : "";
            setNotice(`${msg}${tokenMsg}`);
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
    <div className="relative min-h-screen w-full overflow-hidden bg-[radial-gradient(80%_60%_at_0%_0%,#f43f5e_0%,#db2777_35%,transparent_60%),radial-gradient(80%_60%_at_100%_100%,#6366f1_0%,#7c3aed_40%,transparent_65%)]">
      {/* floating emoji bubbles */}
      <div className="pointer-events-none absolute -left-8 top-16 grid h-40 w-40 place-items-center rounded-full bg-white/10 backdrop-blur-sm text-3xl">👶</div>
      <div className="pointer-events-none absolute right-24 top-40 grid h-28 w-28 place-items-center rounded-full bg-white/10 backdrop-blur-sm text-2xl">🍼</div>
      <div className="pointer-events-none absolute bottom-20 right-28 grid h-32 w-32 place-items-center rounded-full bg-white/10 backdrop-blur-sm text-3xl">😊</div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl bg-white/95 p-8 shadow-2xl backdrop-blur">
          {/* Brand */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-indigo-50 text-indigo-600">🤝</div>
            <h1 className="text-3xl font-extrabold leading-tight text-slate-800 whitespace-nowrap"><span className="text-indigo-600">BabyName</span>{" "}<span className="font-extrabold text-pink-500">Duel</span> <span className="ml-2">👶👱‍♂️🍼</span></h1>
            <p className="mt-1 text-sm text-slate-500">Owners + voters, fair scoring.</p>
          </div>

          <h2 className="mb-1 text-center text-xl font-semibold text-slate-900">
            {mode === "signin" && "Welcome back"}
            {mode === "signup" && "Create your account"}
            {mode === "forgot" && "Forgot your password?"}
            {mode === "reset" && "Reset your password"}
          </h2>
          <p className="mb-5 text-center text-sm text-slate-500 whitespace-pre-line">
            {mode === "signin" && "Please sign in to continue your journey"}
            {mode === "signup" && "Start your baby name journey today"}
            {mode === "forgot" && "Enter the email you used at signup. We'll send instructions and show a dev token here."}
            {mode === "reset" && "Paste the reset token and choose a new password."}
          </p>

          {/* Google button */}
          {mode !== "reset" && (
            <button
              type="button"
              onClick={() => onGoogleSignIn?.()}
              className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[.99]"
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
              <div className="h-px w-full bg-slate-200" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 text-xs text-slate-400">
                or
              </span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <input
                type="text"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
                placeholder="Full name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            )}

            {(mode === "signin" || mode === "signup" || mode === "forgot") && (
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
                placeholder="Email address"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}

            {(mode === "signin" || mode === "signup") && (
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-10 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"
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
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-10 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            )}

            {mode === "reset" && (
              <>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
                  placeholder="Reset token"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  required
                />
                <div className="relative">
                  <input
                    ref={resetPwdRef}
                    type={showResetPwd ? "text" : "password"}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-10 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"
                    aria-label={showResetPwd ? "Hide password" : "Show password"}
                  >
                    {showResetPwd ? "🙈" : "👁️"}
                  </button>
                </div>
                <div className="relative">
                  <input
                    ref={resetConfirmRef}
                    type={showResetPwd ? "text" : "password"}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-10 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"
                    aria-label={showResetPwd ? "Hide password" : "Show password"}
                  >
                    {showResetPwd ? "🙈" : "👁️"}
                  </button>
                </div>
              </>
            )}

            {mode === "signin" && (
              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex cursor-pointer items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    checked={remember}
                    onChange={() => setRemember((v) => !v)}
                  />
                  Remember me
                </label>
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              </div>
            )}

            {notice && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm ${
                  noticeType === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2.5 font-medium text-white shadow hover:from-indigo-500 hover:to-fuchsia-500 active:scale-[.99]"
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

          <p className="mt-4 text-center text-sm text-slate-600">
            {mode === "signin" && (
              <>
                Don&apos;t have an account?{" "}
                <button onClick={() => switchMode("signup")} className="text-indigo-600 hover:underline">Sign up</button>
              </>
            )}
            {mode === "signup" && (
              <>
                Already have an account?{" "}
                <button onClick={() => switchMode("signin")} className="text-indigo-600 hover:underline">Sign in</button>
              </>
            )}
            {mode === "forgot" && (
              <>
                Remember your password?{" "}
                <button onClick={() => switchMode("signin")} className="text-indigo-600 hover:underline">Back to sign in</button>
                <br />
                Have a token already?{" "}
                <button onClick={() => switchMode("reset")} className="text-indigo-600 hover:underline">Enter token</button>
              </>
            )}
            {mode === "reset" && (
              <>
                Need a token?{" "}
                <button onClick={() => switchMode("forgot")} className="text-indigo-600 hover:underline">Request reset</button>
                <br />
                Ready to sign in?{" "}
                <button onClick={() => switchMode("signin")} className="text-indigo-600 hover:underline">Back to sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
