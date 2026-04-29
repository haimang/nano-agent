-- RH5 — Multi-model / multimodal / reasoning capability seed.
--
-- D1 remains the product catalog truth for /models. Runtime capability checks
-- still happen inside agent-core before provider dispatch.

ALTER TABLE nano_usage_events ADD COLUMN model_id TEXT;
ALTER TABLE nano_usage_events ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nano_usage_events ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nano_usage_events ADD COLUMN estimated_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE nano_usage_events ADD COLUMN is_reasoning INTEGER NOT NULL DEFAULT 0 CHECK (is_reasoning IN (0, 1));
ALTER TABLE nano_usage_events ADD COLUMN is_vision INTEGER NOT NULL DEFAULT 0 CHECK (is_vision IN (0, 1));
ALTER TABLE nano_usage_events ADD COLUMN request_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_nano_usage_events_team_model_created
  ON nano_usage_events(team_uuid, model_id, created_at DESC);

INSERT OR REPLACE INTO nano_models
  (model_id, family, display_name, context_window, is_reasoning, is_vision,
   is_function_calling, status, created_at, updated_at)
VALUES
  ('@cf/ibm-granite/granite-4.0-h-micro', 'workers-ai/granite', 'Granite 4.0 H Micro', 131072, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-4-scout-17b-16e-instruct', 'workers-ai/llama', 'Llama 4 Scout 17B 16E Instruct', 131072, 1, 1, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'workers-ai/llama', 'Llama 3.3 70B Instruct FP8 Fast', 131072, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.1-8b-instruct', 'workers-ai/llama', 'Llama 3.1 8B Instruct', 8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.1-70b-instruct', 'workers-ai/llama', 'Llama 3.1 70B Instruct', 8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.2-1b-instruct', 'workers-ai/llama', 'Llama 3.2 1B Instruct', 8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.2-3b-instruct', 'workers-ai/llama', 'Llama 3.2 3B Instruct', 8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.2-11b-vision-instruct', 'workers-ai/llama', 'Llama 3.2 11B Vision Instruct', 8192, 0, 1, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/meta/llama-3.2-90b-vision-instruct', 'workers-ai/llama', 'Llama 3.2 90B Vision Instruct', 8192, 0, 1, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/mistral/mistral-7b-instruct-v0.2', 'workers-ai/mistral', 'Mistral 7B Instruct v0.2', 32768, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/mistral/mistral-small-3.1-24b-instruct', 'workers-ai/mistral', 'Mistral Small 3.1 24B Instruct', 131072, 0, 1, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/qwen/qwen1.5-14b-chat-awq', 'workers-ai/qwen', 'Qwen 1.5 14B Chat AWQ', 32768, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/qwen/qwen1.5-7b-chat-awq', 'workers-ai/qwen', 'Qwen 1.5 7B Chat AWQ', 32768, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/qwen/qwen2.5-coder-32b-instruct', 'workers-ai/qwen', 'Qwen 2.5 Coder 32B Instruct', 32768, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/google/gemma-7b-it', 'workers-ai/gemma', 'Gemma 7B IT', 8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'workers-ai/deepseek', 'DeepSeek R1 Distill Qwen 32B', 32768, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/deepseek-ai/deepseek-r1-distill-qwen-14b', 'workers-ai/deepseek', 'DeepSeek R1 Distill Qwen 14B', 32768, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/deepseek-ai/deepseek-r1-distill-llama-70b', 'workers-ai/deepseek', 'DeepSeek R1 Distill Llama 70B', 32768, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/deepseek-ai/deepseek-math-7b-instruct', 'workers-ai/deepseek', 'DeepSeek Math 7B Instruct', 8192, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/qwen/qwq-32b', 'workers-ai/qwen', 'QwQ 32B', 32768, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/qwen/qwen3-32b', 'workers-ai/qwen', 'Qwen3 32B', 32768, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/qwen/qwen2.5-72b-instruct', 'workers-ai/qwen', 'Qwen 2.5 72B Instruct', 32768, 1, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/openchat/openchat-3.5-0106', 'workers-ai/openchat', 'OpenChat 3.5 0106', 8192, 0, 0, 1, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/microsoft/phi-2', 'workers-ai/phi', 'Phi-2', 2048, 0, 0, 0, 'active', '2026-04-29', '2026-04-29'),
  ('@cf/tinyllama/tinyllama-1.1b-chat-v1.0', 'workers-ai/tinyllama', 'TinyLlama 1.1B Chat v1.0', 2048, 0, 0, 0, 'active', '2026-04-29', '2026-04-29');
