import { useState } from "react";

/** Modern login page for BabyName Duel (footer removed) */
export default function LoginPage({ onGoogleSignIn, onEmailSignIn, onSignup }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (mode === "signup" && password !== confirm) {
      alert("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        await (onEmailSignIn?.(email, password, { remember }) ?? Promise.resolve());
      } else {
        await (onSignup?.({ fullName, email, password }) ?? Promise.resolve());
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
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mb-5 text-center text-sm text-slate-500">
            {mode === "signin" ? "Please sign in to continue your journey" : "Start your baby name journey today"}
          </p>

          {/* Google button */}
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

          {/* divider */}
          <div className="relative my-5">
            <div className="h-px w-full bg-slate-200" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 text-xs text-slate-400">
              or
            </span>
          </div>

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

            <input
              type="email"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
              placeholder="Email address"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

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

            {mode === "signup" && (
              <input
                type="password"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 outline-none ring-indigo-200 transition focus:border-indigo-400 focus:ring"
                placeholder="Confirm password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
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
                <button type="button" className="text-indigo-600 hover:underline">
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2.5 font-medium text-white shadow hover:from-indigo-500 hover:to-fuchsia-500 active:scale-[.99]"
            >
              {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              <span>→</span>
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-600">
            {mode === "signin" ? (
              <>
                Don&apos;t have an account?{" "}
                <button onClick={() => setMode("signup")} className="text-indigo-600 hover:underline">Sign up</button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => setMode("signin")} className="text-indigo-600 hover:underline">Sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
