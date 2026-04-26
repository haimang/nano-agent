import { NanoClient, NanoClientError, type AuthState, type SessionEvent } from "./client";
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
const client = new NanoClient({
  baseUrl,
  traceUuid: uuid,
});

function appendLog(event: SessionEvent | string): void {
  const row = document.createElement("pre");
  row.textContent = typeof event === "string" ? event : JSON.stringify(event, null, 2);
  document.querySelector("#log")?.prepend(row);
}

app.innerHTML = `
  <section class="panel">
    <h1>nano-agent Z4 web client</h1>
    <label>Orchestrator URL <input id="baseUrl" value="${baseUrl}" /></label>
    <label>Email <input id="email" value="z4-${Date.now()}@nano-agent.test" /></label>
    <label>Password <input id="password" type="password" value="NanoAgent!z4-client" /></label>
    <div class="row">
      <button id="register">Register + Login</button>
      <button id="login">Login</button>
      <button id="me">/me</button>
      <button id="workerHealth">Worker Health</button>
    </div>
  </section>
  <section class="panel">
    <label>Session UUID <input id="sessionUuid" value="${sessionUuid}" /></label>
    <label>Prompt <textarea id="prompt">Reply with one short sentence and, if useful, call pwd.</textarea></label>
    <div class="row">
      <button id="start">Start</button>
      <button id="input">Follow-up</button>
      <button id="stream">Open WS</button>
      <button id="timeline">Timeline</button>
      <button id="newSession">New Session</button>
    </div>
  </section>
  <section class="panel"><h2>Events</h2><div id="log"></div></section>
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

async function run(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    const result = await task();
    appendLog({ kind: `client.${label}.ok`, result });
  } catch (error) {
    appendLog(error instanceof NanoClientError
      ? { ...error.details, kind: error.details.kind }
      : { kind: `client.${label}.error`, message: error instanceof Error ? error.message : String(error) });
  }
}

document.querySelector("#register")?.addEventListener("click", () => run("register", async () => {
  auth = await client.register(value("email"), value("password"), "Z4 Web User");
  return auth;
}));

document.querySelector("#login")?.addEventListener("click", () => run("login", async () => {
  auth = await client.login(value("email"), value("password"));
  return auth;
}));

document.querySelector("#me")?.addEventListener("click", () => run("me", () => client.me(requireAuth())));
document.querySelector("#workerHealth")?.addEventListener("click", () => run("workerHealth", () => client.workerHealth()));
document.querySelector("#start")?.addEventListener("click", () => run("start", () => client.startSession(requireAuth(), refreshSessionUuid(), value("prompt"))));
document.querySelector("#input")?.addEventListener("click", () => run("input", () => client.sendInput(requireAuth(), refreshSessionUuid(), value("prompt"))));
document.querySelector("#timeline")?.addEventListener("click", () => run("timeline", () => client.timeline(requireAuth(), refreshSessionUuid())));
document.querySelector("#stream")?.addEventListener("click", () => {
  try {
    socket?.close();
    socket = client.openStream(requireAuth(), refreshSessionUuid(), appendLog, { lastSeenSeq });
    socket.addEventListener("nano:seq", (event) => {
      const seq = (event as CustomEvent<number>).detail;
      if (Number.isFinite(seq)) lastSeenSeq = Math.max(lastSeenSeq, seq);
    });
    socket.addEventListener("open", () => appendLog("websocket open"));
    socket.addEventListener("close", () => appendLog("websocket close"));
    socket.addEventListener("error", () => appendLog("websocket error"));
  } catch (error) {
    appendLog({ kind: "client.stream.error", message: error instanceof Error ? error.message : String(error) });
  }
});
document.querySelector("#newSession")?.addEventListener("click", () => {
  sessionUuid = uuid();
  lastSeenSeq = 0;
  const input = document.querySelector<HTMLInputElement>("#sessionUuid");
  if (input) input.value = sessionUuid;
  appendLog({ kind: "client.session.new", sessionUuid });
});
