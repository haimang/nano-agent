import { transport } from "./transport";

export async function catalog(
  kind: "skills" | "commands" | "agents",
): Promise<Record<string, unknown>> {
  const body = await transport.request(`/catalog/${kind}`);
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}
