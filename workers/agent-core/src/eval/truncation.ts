/**
 * @nano-agent/eval-observability — output truncation.
 *
 * Matches the truncation strategy from codex's recorder.rs (lines 189-212):
 * outputs exceeding the byte budget are truncated with a marker indicating
 * how many bytes were dropped.
 */

/** Default maximum output size in bytes (10 KB). */
export const TRACE_OUTPUT_MAX_BYTES = 10_000;

/**
 * Truncate an output string to fit within the byte budget.
 *
 * If the UTF-8 byte length of `output` exceeds `maxBytes`, the string is
 * truncated and a `[truncated: N bytes removed]` marker is appended.
 * Returns the original string unchanged if it fits within the budget.
 */
export function truncateOutput(output: string, maxBytes: number = TRACE_OUTPUT_MAX_BYTES): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(output);

  if (bytes.byteLength <= maxBytes) {
    return output;
  }

  // Reserve space for the truncation marker.
  // Worst-case marker: "[truncated: 9999999999 bytes removed]" ~40 bytes.
  const markerReserve = 50;
  const keepBytes = Math.max(0, maxBytes - markerReserve);

  // Decode the truncated byte slice back to a string, allowing the decoder
  // to handle partial multi-byte characters gracefully.
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  const truncated = decoder.decode(bytes.slice(0, keepBytes));

  const removedBytes = bytes.byteLength - keepBytes;
  return `${truncated}\n[truncated: ${removedBytes} bytes removed]`;
}
