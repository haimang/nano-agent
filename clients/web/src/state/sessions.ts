export interface SessionSummary {
  conversation_uuid: string;
  session_uuid: string;
  status: string;
  last_phase: string;
  last_seen_at: string;
  created_at: string;
  ended_at: string | null;
}

type SessionsListener = (sessions: SessionSummary[]) => void;

let sessions: SessionSummary[] = [];
const listeners = new Set<SessionsListener>();

export function getSessions(): SessionSummary[] {
  return sessions;
}

export function setSessions(list: SessionSummary[]): void {
  sessions = list;
  for (const fn of listeners) fn(list);
}

export function subscribeSessions(fn: SessionsListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
