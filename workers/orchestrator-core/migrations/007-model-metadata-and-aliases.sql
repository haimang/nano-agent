-- HP1 P2-01 — model metadata + alias durable truth.
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §1 + §466 (007 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.1 F1
--   * docs/design/hero-to-pro/HPX-qna.md Q4 (migration baseline 007-013)
--
-- Goal: extend `nano_models` (introduced in 003) with the 10 runtime-oriented
-- metadata columns HP2/HP3 will consume, plus a `nano_model_aliases` table
-- that backs `@alias/<name>` resolution. No model_id rows are inserted here;
-- 003's existing seed remains the canonical model catalogue. Aliases get a
-- 4-row default seed (Q4-aligned), targeting the same active models the 003
-- migration declares.
--
-- SQLite ALTER TABLE ADD COLUMN supports defaults but cannot retroactively
-- enforce CHECK on existing rows; the constraints below only apply to new
-- writes (HP2 runtime is the gate keeper; HP1 backfill values are NULL until
-- HP2 closure wires real suffixes).

-- ── 1. Extend nano_models with hero-to-pro metadata columns ──

ALTER TABLE nano_models ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE nano_models ADD COLUMN effective_context_pct REAL;
ALTER TABLE nano_models ADD COLUMN auto_compact_token_limit INTEGER;
ALTER TABLE nano_models ADD COLUMN supported_reasoning_levels TEXT; -- JSON array<string>
ALTER TABLE nano_models ADD COLUMN input_modalities TEXT;           -- JSON array<string>
ALTER TABLE nano_models ADD COLUMN provider_key TEXT;
ALTER TABLE nano_models ADD COLUMN fallback_model_id TEXT;
ALTER TABLE nano_models ADD COLUMN base_instructions_suffix TEXT;
ALTER TABLE nano_models ADD COLUMN description TEXT;
ALTER TABLE nano_models ADD COLUMN sort_priority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_nano_models_status_sort_priority
  ON nano_models(status, sort_priority DESC, model_id);

-- ── 2. nano_model_aliases — alias resolution truth ──

CREATE TABLE IF NOT EXISTS nano_model_aliases (
  alias_id TEXT PRIMARY KEY,
  target_model_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (target_model_id)
    REFERENCES nano_models(model_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nano_model_aliases_target
  ON nano_model_aliases(target_model_id);

-- ── 3. Seed the 4 default aliases (Q4 — `@alias/fast | balanced | reasoning | vision`) ──
--
-- Targets reference rows seeded by 003-usage-quota-and-models.sql. The choices
-- below are HP1 baselines; HP2 may re-point aliases as the model state machine
-- grows (rebind goes through `nano_model_aliases.target_model_id` UPDATE,
-- not a schema change).

INSERT OR REPLACE INTO nano_model_aliases (alias_id, target_model_id, created_at)
VALUES
  ('@alias/fast', '@cf/meta/llama-3.2-3b-instruct', '2026-04-30'),
  ('@alias/balanced', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '2026-04-30'),
  ('@alias/reasoning', '@cf/meta/llama-4-scout-17b-16e-instruct', '2026-04-30'),
  ('@alias/vision', '@cf/meta/llama-3.2-90b-vision-instruct', '2026-04-30');
