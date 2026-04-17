/**
 * NACP Error Types
 *
 * All NACP validation / admissibility / tenant-boundary failures
 * throw one of these typed errors so callers can pattern-match on .code.
 */

export class NacpValidationError extends Error {
  public readonly errors: string[];
  public readonly code: string;

  constructor(errors: string[], code = "NACP_VALIDATION_FAILED") {
    super(`NACP validation failed: ${errors.join("; ")}`);
    this.name = "NacpValidationError";
    this.errors = errors;
    this.code = code;
  }
}

export class NacpAdmissibilityError extends Error {
  public readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `NACP admissibility check failed: ${code}`);
    this.name = "NacpAdmissibilityError";
    this.code = code;
  }
}
