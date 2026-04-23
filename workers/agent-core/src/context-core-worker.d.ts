declare module "@haimang/context-core-worker/context-api/append-initial-context-layer" {
  import type { SessionStartInitialContext } from "@haimang/nacp-session";
  import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";

  export function buildInitialContextLayers(
    payload: SessionStartInitialContext,
    baselinePriorityOffset?: number,
  ): ContextLayer[];

  export function appendInitialContextLayer(
    assembler: object,
    payload: SessionStartInitialContext,
  ): void;

  export function drainPendingInitialContextLayers(assembler: object): ContextLayer[];

  export function peekPendingInitialContextLayers(
    assembler: object,
  ): readonly ContextLayer[];
}
