// src/api.js
const BASE_URL = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:5050";

async function request(path, { method = "GET", json } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: json ? { "Content-Type": "application/json" } : undefined,
    body: json ? JSON.stringify(json) : undefined,
    credentials: "omit",
  });

  // try to parse JSON; if it fails, throw generic error
  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function signup({ fullName, email, password }) {
  return request("/api/signup", {
    method: "POST",
    json: { fullName, email, password },
  });
}

export async function login({ email, password }) {
  return request("/api/login", {
    method: "POST",
    json: { email, password },
  });
}

// optional placeholder (wire later)
export async function googleLogin() {
  throw new Error("Google login not wired yet");
}
