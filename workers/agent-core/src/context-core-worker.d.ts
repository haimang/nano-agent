declare module "@haimang/context-core-worker/context-api/append-initial-context-layer" {
  import type { SessionStartInitialContext } from "@haimang/nacp-session";
  import type {
    ContextAssembler,
    ContextLayer,
  } from "@nano-agent/workspace-context-artifacts";

  export function buildInitialContextLayers(
    payload: SessionStartInitialContext,
    baselinePriorityOffset?: number,
  ): ContextLayer[];

  export function appendInitialContextLayer(
    assembler: ContextAssembler,
    payload: SessionStartInitialContext,
  ): void;

  export function drainPendingInitialContextLayers(
    assembler: ContextAssembler,
  ): ContextLayer[];

  export function peekPendingInitialContextLayers(
    assembler: ContextAssembler,
  ): readonly ContextLayer[];
}
