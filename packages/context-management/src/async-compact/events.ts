/**
 * Context-Management — async-compact lifecycle event emitter.
 *
 * Per Phase 1 freeze decision (action-plan §11.2 偏移 about
 * hooks-strict-union): the existing `@nano-agent/hooks` `HookEventName`
 * is a strict union and does NOT yet include the 5 PX-spec lifecycle
 * names. B4 therefore emits through a parallel `LifecycleEventEmitter`
 * channel; B5 will provide a bridge adapter once the hooks catalog
 * is expanded.
 *
 * This file ships:
 *   - `noopLifecycleEmitter`            — default; safe to use anywhere
 *   - `createCollectingEmitter()`       — used by tests
 *   - `bridgeToHookDispatcher()`        — factory accepting a function
 *                                         shaped like `dispatcher.emit`
 *                                         which B5 will narrow to its
 *                                         expanded `HookEventName` union
 */

import type { LifecycleEvent, LifecycleEventEmitter } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Noop default
// ═══════════════════════════════════════════════════════════════════

/** Drops every event. Safe default when no observability is wired. */
export const noopLifecycleEmitter: LifecycleEventEmitter = {
  emit() {
    /* drop */
  },
};

// ═══════════════════════════════════════════════════════════════════
// §2 — Collecting emitter (test utility)
// ═══════════════════════════════════════════════════════════════════

export interface CollectingEmitter extends LifecycleEventEmitter {
  readonly events: ReadonlyArray<LifecycleEvent>;
  clear(): void;
}

export function createCollectingEmitter(): CollectingEmitter {
  const events: LifecycleEvent[] = [];
  return {
    events,
    emit(event: LifecycleEvent) {
      events.push(event);
    },
    clear() {
      events.length = 0;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Bridge to a future HookDispatcher (B5 gate)
// ═══════════════════════════════════════════════════════════════════

/**
 * Loose dispatcher signature — kept structural so this file does NOT
 * depend on `@nano-agent/hooks` (which would force B4 to wait for
 * B5 catalog expansion).
 *
 * After B5 ships, the caller can pass `dispatcher.emit.bind(dispatcher)`
 * directly; TypeScript will check that the registered union covers
 * the lifecycle names B4 emits.
 */
export type DispatcherEmitFn = (
  eventName: string,
  payload: Readonly<Record<string, unknown>>,
) => unknown | Promise<unknown>;

/**
 * Build a `LifecycleEventEmitter` that forwards to a hooks-style
 * dispatcher. Any thrown / rejected dispatch is swallowed (with
 * optional `onError` callback) so observability never crashes the
 * compact lifecycle.
 */
export function bridgeToHookDispatcher(
  emitFn: DispatcherEmitFn,
  options: { onError?: (err: unknown) => void } = {},
): LifecycleEventEmitter {
  const onError = options.onError ?? (() => {});
  return {
    emit(event: LifecycleEvent) {
      try {
        const result = emitFn(event.name, {
          sessionUuid: event.sessionUuid,
          stateId: event.stateId,
          emittedAt: event.emittedAt,
          ...event.payload,
        });
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          (result as Promise<unknown>).catch((err: unknown) => onError(err));
        }
      } catch (err) {
        onError(err);
      }
    },
  };
}
