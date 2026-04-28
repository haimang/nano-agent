// Retired DOM demo — no longer the canonical UI entry.
// Kept for reference. The product UI now lives in main.tsx + App.tsx.
import { openSessionStream, type AuthState, type SessionEvent } from "./client";
import "./styles.css";

const DEFAULT_BASE_URL = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev";
const envBaseUrl = (import.meta as ImportMeta & { readonly env?: { readonly VITE_NANO_BASE_URL?: string } })
  .env?.VITE_NANO_BASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");

let auth: AuthState | null = null;
let sessionUuid = uuid();
let socket: WebSocket | null = null;
let lastSeenSeq = 0;
const baseUrl = localStorage.getItem("nano.baseUrl") || envBaseUrl || DEFAULT_BASE_URL;

function appendLog(event: SessionEvent | string): void {
  const row = document.createElement("pre");
  row.textContent = typeof event === "string" ? event : JSON.stringify(event, null, 2);
  document.querySelector("#log")?.prepend(row);
}

app.innerHTML = `
  <section class="panel">
    <h1>nano-agent web client (retired demo)</h1>
    <p>This DOM demo has been retired. The product UI lives in the React app.</p>
  </section>
`;

function value(id: string): string {
  return (document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "").trim();
}

function requireAuth(): AuthState {
  if (!auth) throw new Error("login first");
  return auth;
}

function refreshSessionUuid(): string {
  sessionUuid = value("sessionUuid") || sessionUuid;
  return sessionUuid;
}

// This file is intentionally left as a reference; it is no longer the active UI entry.
console.log("[nano-agent] DOM demo retired. Use the React app (main.tsx) instead.");
