// src/api.js
const runtimeOrigin =
  typeof window !== "undefined"
    ? window.__BND?.apiBase || window.location.origin
    : undefined;

const BASE_URL = import.meta.env.VITE_API_BASE ?? runtimeOrigin ?? "http://127.0.0.1:5050";

let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
}

async function request(path, { method = "GET", json, auth = true } = {}) {
  const headers = {};
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  if (auth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: json ? JSON.stringify(json) : undefined,
    credentials: "omit",
  });

  // try to parse JSON; if it fails, throw generic error
  let data = null;
  try { data = await res.json(); } catch { /* ignore non-JSON responses */ }

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
    auth: false,
    json: { fullName, email, password },
  });
}

export async function login({ email, password }) {
  return request("/api/login", {
    method: "POST",
    auth: false,
    json: { email, password },
  });
}

// optional placeholder (wire later)
export async function googleLogin({ idToken }) {
  return request("/api/google-login", {
    method: "POST",
    auth: false,
    json: { idToken },
  });
}

export async function requestPasswordReset({ email }) {
  return request("/api/reset-password-request", {
    method: "POST",
    auth: false,
    json: { email },
  });
}

export async function resetPassword({ token, newPassword }) {
  return request("/api/reset-password", {
    method: "POST",
    auth: false,
    json: { token, newPassword },
  });
}

export async function createSession({ title, requiredNames, nameFocus, email }) {
  const payload = { title, requiredNames, nameFocus };
  if (email) payload.email = email;
  return request("/api/sessions", {
    method: "POST",
    json: payload,
  });
}

export async function fetchSessions({ email } = {}) {
  const suffix = email ? `?email=${encodeURIComponent(email)}` : "";
  return request(`/api/sessions${suffix}`);
}

export async function joinWithToken({ token, sid, email }) {
  if (!token) throw new Error("token required");
  const payload = { token };
  if (sid) payload.sid = sid;
  if (email) payload.email = email;
  return request("/api/sessions/join", {
    method: "POST",
    json: payload,
  });
}

export async function fetchInviteInfo({ sid, token }) {
  if (!token) throw new Error("token required");
  const params = new URLSearchParams({ token });
  if (sid) params.set("sid", sid);
  return request(`/api/invite-info?${params.toString()}`, { auth: false });
}

export async function getSession({ sid, email }) {
  if (!sid) throw new Error("sid required");
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/sessions/${encodeURIComponent(sid)}${suffix}`);
}

export async function upsertOwnerList({ sid, names, selfRanks, finalize = false, slotCount, email }) {
  const payload = { names, selfRanks, finalize };
  if (slotCount !== undefined) payload.slotCount = slotCount;
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/lists`, {
    method: "POST",
    json: payload,
  });
}

export async function submitScore({ sid, listOwnerUid, scoreValue, name, email }) {
  const payload = { listOwnerUid, scoreValue, name };
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/scores`, {
    method: "POST",
    json: payload,
  });
}

export async function archiveSession({ sid, email }) {
  const payload = {};
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/archive`, {
    method: "POST",
    json: payload,
  });
}

export async function deleteSession({ sid, email }) {
  const payload = {};
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}`, {
    method: "DELETE",
    json: payload,
  });
}

export async function lockInvites({ sid, email }) {
  const payload = {};
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/lock-invites`, {
    method: "POST",
    json: payload,
  });
}

export async function inviteParticipants({ sid, participants, email }) {
  const payload = { participants };
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/participants`, {
    method: "POST",
    json: payload,
  });
}

export async function removeParticipant({ sid, participantEmail, email }) {
  const payload = { participantEmail };
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/participants`, {
    method: "DELETE",
    json: payload,
  });
}

export async function fetchMessages({ sid, email }) {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/sessions/${encodeURIComponent(sid)}/messages${suffix}`);
}

export async function sendMessage({ sid, body, recipient, kind, email }) {
  const payload = { body, recipient, kind };
  if (email) payload.email = email;
  return request(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
    method: "POST",
    json: payload,
  });
}

export async function fetchNotifications({ email } = {}) {
  const suffix = email ? `?email=${encodeURIComponent(email)}` : "";
  return request(`/api/notifications${suffix}`);
}

export async function markNotificationsRead({ ids, email }) {
  const payload = { ids };
  if (email) payload.email = email;
  return request("/api/notifications/mark-read", {
    method: "POST",
    json: payload,
  });
}

export async function logout() {
  return request("/api/logout", { method: "POST" });
}
