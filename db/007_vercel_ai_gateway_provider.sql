-- Add Vercel AI Gateway as an OpenAI-compatible model routing provider.

alter table org_model_configs
  drop constraint if exists org_model_configs_provider_chk;

alter table org_model_configs
  add constraint org_model_configs_provider_chk
    check (provider in ('openrouter', 'ollama', 'vercel-ai-gateway'));
