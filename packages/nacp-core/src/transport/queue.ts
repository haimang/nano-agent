/**
 * Queue Transport — Cloudflare Queues producer / consumer.
 *
 * Producer: encodeEnvelope → env.QUEUE.send(json)
 * Consumer: decodeEnvelope → verifyTenantBoundary → checkAdmissibility → handler
 * DLQ: tenants/{team_uuid}/dlq/{message_uuid}
 */

import { encodeEnvelope, decodeEnvelope, type NacpEnvelope } from "../envelope.js";
import { NacpValidationError, NacpAdmissibilityError } from "../errors.js";
import { verifyTenantBoundary, type TenantBoundaryContext } from "../tenancy/boundary.js";
import { checkAdmissibility, type AdmissibilityContext } from "../admissibility.js";
import { decideRetry } from "../retry.js";
import { resolveErrorDefinition, isRetryableCategory, type NacpErrorCategory } from "../error-registry.js";
import type { NacpHandler, NacpSendOptions, NacpTransport } from "./types.js";

export interface QueueLike {
  send(body: string): Promise<void>;
}

export interface QueueMessageLike {
  readonly body: string;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

export interface QueueDlqWriterLike {
  put(key: string, value: string): Promise<unknown>;
}

export class QueueProducer implements NacpTransport {
  readonly kind = "queue" as const;

  constructor(private readonly queue: QueueLike) {}

  async send(envelope: NacpEnvelope, _opts?: NacpSendOptions): Promise<void> {
    const json = encodeEnvelope(envelope);
    await this.queue.send(json);
  }
}

export interface QueueConsumerOptions {
  boundary: TenantBoundaryContext;
  admissibility?: AdmissibilityContext;
  dlqBucket?: QueueDlqWriterLike;
  retryPolicy?: {
    max_attempts: number;
    base_delay_ms: number;
    max_delay_ms: number;
    jitter_ratio: number;
  };
}

export async function handleQueueMessage(
  msg: QueueMessageLike,
  handler: NacpHandler,
  opts: QueueConsumerOptions,
): Promise<void> {
  let envelope: NacpEnvelope;

  try {
    envelope = decodeEnvelope(msg.body);
  } catch (e) {
    // Invalid message — cannot retry, send to DLQ or ack
    if (opts.dlqBucket) {
      await opts.dlqBucket.put(
        `tenants/_unroutable/dlq/${Date.now()}-parse-error`,
        JSON.stringify({ raw: msg.body, error: String(e) }),
      );
    }
    msg.ack();
    return;
  }

  try {
    await verifyTenantBoundary(envelope, opts.boundary);
    checkAdmissibility(envelope, opts.admissibility);
    await handler(envelope, { boundary: opts.boundary });
    msg.ack();
  } catch (e) {
    const attempt = envelope.control?.retry_context?.attempt ?? 0;

    // Classify error using the error registry taxonomy (GPT code-review §2.6)
    let errorCode = "UNKNOWN";
    if (e instanceof NacpValidationError) {
      errorCode = e.code;
    } else if (e instanceof NacpAdmissibilityError) {
      errorCode = e.code;
    }

    let retryable = false;
    const registryDef = resolveErrorDefinition(errorCode);
    if (registryDef) {
      retryable = registryDef.retryable;
    } else {
      // Unknown errors: treat as transient (retryable) to be safe
      retryable = true;
    }

    const policy = opts.retryPolicy ?? {
      max_attempts: 3,
      base_delay_ms: 200,
      max_delay_ms: 10_000,
      jitter_ratio: 0.2,
    };
    const decision = decideRetry(attempt, policy, retryable);

    if (decision.should_retry) {
      msg.retry({ delaySeconds: Math.ceil(decision.next_delay_ms / 1000) });
    } else {
      // DLQ
      if (opts.dlqBucket) {
        const teamUuid = envelope.authority?.team_uuid ?? "_unroutable";
        const msgUuid = envelope.header?.message_uuid ?? `${Date.now()}`;
        await opts.dlqBucket.put(
          `tenants/${teamUuid}/dlq/${msgUuid}`,
          JSON.stringify({
            envelope: JSON.parse(msg.body),
            last_error: String(e),
            attempts: attempt + 1,
          }),
        );
      }
      msg.ack();
    }
  }
}
