-- HP2 schema correction — fallback_reason durable audit.
--
-- Frozen source:
--   * docs/charter/plan-hero-to-pro.md §7.3 In-Scope §7 + §504(R8 correction law)
--   * docs/design/hero-to-pro/HPX-qna.md Q8 owner-approved addendum
--
-- Why this correction exists:
--   008 introduced `requested_*` / `effective_*` + `fallback_used`, but the
--   approved HP2 law also requires a dedicated `fallback_reason` column so
--   requested/effective divergence remains explainable and future chain-based
--   fallback can extend via additive schema instead of mutating existing field
--   meaning.

ALTER TABLE nano_conversation_turns
  ADD COLUMN fallback_reason TEXT;
