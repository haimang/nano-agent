import { transport, ApiRequestError } from "./transport";

export interface AuthState {
  readonly token: string;
  readonly refreshToken: string;
  readonly teamUuid: string;
  readonly userUuid: string;
}

let currentAuth: AuthState | null = null;

function authHeaders(auth: AuthState): Record<string, string> {
  return {
    authorization: `Bearer ${auth.token}`,
    "content-type": "application/json",
  };
}

export function getAuth(): AuthState | null {
  return currentAuth;
}

export function setAuth(auth: AuthState | null): void {
  currentAuth = auth;
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthState> {
  await transport.request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  return login(email, password);
}

export async function login(email: string, password: string): Promise<AuthState> {
  const body = await transport.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = (
    "data" in body ? (body as { data: Record<string, unknown> }).data : body
  ) as {
    tokens?: { access_token?: string; refresh_token?: string };
    team?: { team_uuid?: string };
    user?: { user_uuid?: string };
  };

  if (
    !data.tokens?.access_token ||
    !data.tokens.refresh_token ||
    !data.team?.team_uuid ||
    !data.user?.user_uuid
  ) {
    throw new ApiRequestError({
      kind: "request.error",
      status: 400,
      message: "login response missing token/team/user",
    });
  }

  const auth: AuthState = {
    token: data.tokens.access_token,
    refreshToken: data.tokens.refresh_token,
    teamUuid: data.team.team_uuid,
    userUuid: data.user.user_uuid,
  };

  currentAuth = auth;
  return auth;
}

export async function me(auth: AuthState): Promise<Record<string, unknown>> {
  const body = await transport.request("/me", {
    headers: authHeaders(auth),
  });
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}

export function logout(): void {
  currentAuth = null;
}

export function requireAuth(): AuthState {
  if (!currentAuth) throw new Error("login first");
  return currentAuth;
}
