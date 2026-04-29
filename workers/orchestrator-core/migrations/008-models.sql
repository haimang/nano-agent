-- RH2 P2-03 — `/models` D1 truth source(per RHX Q3 + design RH2 §3.2)。
--
-- 决策回顾:
-- 1. `/models` 必须从 D1 真相源 read,不允许硬编码;runtime capability 是
--    "执行真相",但 catalog/policy 由 D1 决定。
-- 2. team policy = team-level boolean disable(per RHX Q3 owner-signed):
--    `nano_team_model_policy(team_uuid, model_id, allowed)`,默认 implicit allowed
--    (无 row = allowed),业主可显式 disable 高成本模型。
-- 3. 不引入 per-model quota(RH5 仅记 usage event,不做 enforcement)。
-- 4. RH5 P5-01 会做 11+ 模型 seed;RH2 仅 seed Workers AI 已 wire 的最小集合,
--    确保 endpoint 可在 RH2 deploy 后立即返回非空列表。
--
-- Schema:
-- - `nano_models`:model catalog 真相源(全局唯一)
-- - `nano_team_model_policy`:per-team disable 策略(default 不存在 = allowed)

CREATE TABLE IF NOT EXISTS nano_models (
  model_id TEXT PRIMARY KEY,
  family TEXT NOT NULL,                    -- e.g. 'workers-ai/llama', 'workers-ai/mistral'
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 0,
  is_reasoning INTEGER NOT NULL DEFAULT 0  -- 0/1 boolean
    CHECK (is_reasoning IN (0, 1)),
  is_vision INTEGER NOT NULL DEFAULT 0
    CHECK (is_vision IN (0, 1)),
  is_function_calling INTEGER NOT NULL DEFAULT 0
    CHECK (is_function_calling IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'experimental')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nano_models_family ON nano_models(family);
CREATE INDEX IF NOT EXISTS idx_nano_models_status ON nano_models(status);

CREATE TABLE IF NOT EXISTS nano_team_model_policy (
  team_uuid TEXT NOT NULL,
  model_id TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1
    CHECK (allowed IN (0, 1)),
  -- 业主直接配置时记录的人;runtime 自动 deny 时为 'system'。
  configured_by TEXT NOT NULL DEFAULT 'system',
  configured_at TEXT NOT NULL,
  PRIMARY KEY (team_uuid, model_id)
);

CREATE INDEX IF NOT EXISTS idx_nano_team_model_policy_team
  ON nano_team_model_policy(team_uuid);

-- RH2 baseline seed:Workers AI 已经 deploy live 的两个最小可用模型。RH5 P5-01
-- 会扩展到 13(function-calling)+ 4(vision)+ 8(reasoning)模型,作为 production
-- catalog 的真实 source。
INSERT OR IGNORE INTO nano_models
  (model_id, family, display_name, context_window, is_reasoning, is_vision,
   is_function_calling, status, created_at, updated_at)
VALUES
  ('@cf/meta/llama-3.1-8b-instruct',
   'workers-ai/llama',
   'Llama 3.1 8B Instruct',
   8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.2-11b-vision-instruct',
   'workers-ai/llama',
   'Llama 3.2 11B Vision Instruct',
   8192, 0, 1, 1, 'active', '2026-04-29', '2026-04-29');
