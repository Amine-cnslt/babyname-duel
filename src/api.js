// src/api.js
const runtimeOrigin =
  typeof window !== "undefined"
    ? window.__BND?.apiBase || window.location.origin
    : undefined;

const BASE_URL = import.meta.env.VITE_API_BASE ?? runtimeOrigin ?? "http://127.0.0.1:5050";

async function request(path, { method = "GET", json } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: json ? { "Content-Type": "application/json" } : undefined,
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
export async function googleLogin({ idToken }) {
  return request("/api/google-login", {
    method: "POST",
    json: { idToken },
  });
}

export async function requestPasswordReset({ email }) {
  return request("/api/reset-password-request", {
    method: "POST",
    json: { email },
  });
}

export async function resetPassword({ token, newPassword }) {
  return request("/api/reset-password", {
    method: "POST",
    json: { token, newPassword },
  });
}

export async function createSession({ email, title, requiredNames, nameFocus, invites }) {
  return request("/api/sessions", {
    method: "POST",
    json: { email, title, requiredNames, nameFocus, invites },
  });
}

export async function fetchSessions({ email }) {
  if (!email) throw new Error("email required");
  return request(`/api/sessions?email=${encodeURIComponent(email)}`);
}

export async function joinWithToken({ email, token, sid }) {
  const payload = { email, token };
  if (sid) payload.sid = sid;
  return request("/api/sessions/join", {
    method: "POST",
    json: payload,
  });
}

export async function fetchInviteInfo({ sid, token }) {
  if (!token) throw new Error("token required");
  const params = new URLSearchParams({ token });
  if (sid) params.set("sid", sid);
  return request(`/api/invite-info?${params.toString()}`);
}

export async function getSession({ email, sid }) {
  const path = email
    ? `/api/sessions/${encodeURIComponent(sid)}?email=${encodeURIComponent(email)}`
    : `/api/sessions/${encodeURIComponent(sid)}`;
  return request(path);
}

export async function upsertOwnerList({ sid, email, names, selfRanks, finalize = false }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/lists`, {
    method: "POST",
    json: { email, names, selfRanks, finalize },
  });
}

export async function submitScore({ sid, email, listOwnerUid, scoreValue, name }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/scores`, {
    method: "POST",
    json: { email, listOwnerUid, scoreValue, name },
  });
}

export async function archiveSession({ sid, email }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/archive`, {
    method: "POST",
    json: { email },
  });
}

export async function deleteSession({ sid, email }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}`, {
    method: "DELETE",
    json: { email },
  });
}

export async function lockInvites({ sid, email }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/lock-invites`, {
    method: "POST",
    json: { email },
  });
}

export async function inviteParticipants({ sid, email, participants }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/participants`, {
    method: "POST",
    json: { email, participants },
  });
}

export async function removeParticipant({ sid, email, participantEmail }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/participants`, {
    method: "DELETE",
    json: { email, participantEmail },
  });
}

export async function fetchMessages({ sid, email }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/messages?email=${encodeURIComponent(email)}`);
}

export async function sendMessage({ sid, email, body, recipient, kind }) {
  return request(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
    method: "POST",
    json: { email, body, recipient, kind },
  });
}

export async function fetchNotifications({ email }) {
  return request(`/api/notifications?email=${encodeURIComponent(email)}`);
}

export async function markNotificationsRead({ email, ids }) {
  return request("/api/notifications/mark-read", {
    method: "POST",
    json: { email, ids },
  });
}
