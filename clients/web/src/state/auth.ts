import type { AuthState } from "../apis/auth";

type AuthListener = (auth: AuthState | null) => void;

let currentAuth: AuthState | null = null;
const listeners = new Set<AuthListener>();

function loadPersisted(): AuthState | null {
  try {
    const raw = localStorage.getItem("nano.auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    if (parsed.token && parsed.userUuid) return parsed;
    return null;
  } catch {
    return null;
  }
}

function persist(auth: AuthState | null): void {
  if (auth) {
    localStorage.setItem("nano.auth", JSON.stringify(auth));
  } else {
    localStorage.removeItem("nano.auth");
  }
}

export function getAuthState(): AuthState | null {
  return currentAuth;
}

export function setAuthState(auth: AuthState | null): void {
  currentAuth = auth;
  persist(auth);
  for (const fn of listeners) fn(auth);
}

export function subscribeAuth(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useAuth(): AuthState | null {
  return currentAuth;
}

currentAuth = loadPersisted();
