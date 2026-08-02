-- ============================================================================
-- Adiciona public.tv_sessions.updated_at
--
-- Motivo: o trigger tv_sessions_updated_at (BEFORE UPDATE) executa
-- set_updated_at(), que atribui NEW.updated_at — coluna que nao existia.
-- Todo UPDATE na tabela falhava com 42703 ("record new has no field
-- updated_at"), inclusive o ON CONFLICT DO UPDATE de handle_pair_token_linked().
--
-- Efeito pratico: o primeiro pareamento de um aparelho funcionava (INSERT),
-- mas o re-pareamento do mesmo device_id abortava.
-- ============================================================================

begin;

alter table public.tv_sessions
  add column if not exists updated_at timestamptz default now();

commit;
