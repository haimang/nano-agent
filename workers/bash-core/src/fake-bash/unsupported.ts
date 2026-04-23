/**
 * Unsupported Command Handling
 *
 * Explicit list of commands that the fake-bash surface will NOT execute.
 * These are dangerous, require real OS access, or are outside the
 * capability-runtime's scope.
 *
 * Also tracks "OOM-risk" commands — compression/archive tools that can
 * easily exhaust the V8 isolate's memory limits (a few hundred MB on
 * Workers) by materialising full archives in-process. These are blocked
 * until streaming archive handlers exist.
 */

/** Set of commands that are explicitly unsupported. */
export const UNSUPPORTED_COMMANDS: ReadonlySet<string> = new Set([
  "apt",
  "apt-get",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "pip",
  "pip3",
  "sudo",
  "su",
  "chmod",
  "chown",
  "chgrp",
  "docker",
  "docker-compose",
  "podman",
  "systemctl",
  "service",
  "journalctl",
  "mount",
  "umount",
  "fdisk",
  "mkfs",
  "dd",
  "kill",
  "killall",
  "reboot",
  "shutdown",
  "poweroff",
  "iptables",
  "ufw",
  "ssh",
  "scp",
  "rsync",
  "wget",
  "crontab",
  "useradd",
  "userdel",
  "passwd",
  "groupadd",
  // A9 Phase 1 — host interpreter / shell hallucinations. Workers-native
  // fake bash rejects any attempt to spawn `python`, `node`, or a nested
  // shell — `ts-exec` is the only sanctioned script seam and must go
  // through the capability handler, not an interpreter invocation.
  "python",
  "python3",
  "node",
  "nodejs",
  "bash",
  "sh",
  "zsh",
  "deno",
  "bun",
]);

/**
 * Archive/compression tools that are blocked specifically because they
 * can OOM the V8 isolate. Worker-like runtimes typically cap heap at a
 * few hundred MB; tarball/gzip processing can easily cross that even
 * for moderately sized archives.
 */
export const OOM_RISK_COMMANDS: ReadonlySet<string> = new Set([
  "tar",
  "gzip",
  "gunzip",
  "zcat",
  "zip",
  "unzip",
  "bzip2",
  "xz",
]);

/** Check whether a command is explicitly unsupported. */
export function isUnsupported(command: string): boolean {
  return UNSUPPORTED_COMMANDS.has(command);
}

/** Check whether a command is blocked for OOM-risk reasons. */
export function isOomRisk(command: string): boolean {
  return OOM_RISK_COMMANDS.has(command);
}

/** Get a human-readable rejection message for an unsupported command. */
export function getUnsupportedMessage(command: string): string {
  return (
    `Command "${command}" is not supported in the capability runtime. ` +
    `It requires real OS access or has been explicitly blocked for safety.`
  );
}

/**
 * Get a human-readable rejection message for an OOM-risk archive
 * command. The wording explicitly calls out the V8 isolate memory
 * limit so operators know why the command is blocked.
 */
export function getOomRiskMessage(command: string): string {
  return (
    `Command "${command}" is blocked: archive/compression tooling is ` +
    `disabled in the capability runtime to avoid exhausting the V8 ` +
    `isolate memory limit (typically a few hundred MB on Workers-like ` +
    `runtimes). A streaming archive capability is required before ` +
    `"${command}" can be enabled.`
  );
}
