-- 0320_np_lead_telefones_ldr_ia.sql
-- LDR Automático — colunas de validação por telefone, feitas pelo ROBÔ (ElevenLabs).
-- Separado de propósito das colunas do LDR Trilha Humana (ldr_testado_por/ldr_testado_em/
-- ldr_resultado, migration 0286 do repo ldr-trilha-humana) — não reaproveita nem edita
-- aquelas, mesmo sendo a mesma tabela física (np_lead_telefones é compartilhada, mas cada
-- fluxo tem suas próprias colunas).
--
-- ia_resultado usa 4 valores (não 3 como o humano) porque o "data collection" já
-- configurado no agente do ElevenLabs devolve um estado a mais: INCONCLUSIVO (houve
-- interação humana, mas não deu pra confirmar nem negar) — ver conversa com o Pedro,
-- 01/09/2026.

alter table public.np_lead_telefones
  add column if not exists ia_conversation_id text,
  add column if not exists ia_testado_em timestamptz,
  add column if not exists ia_resultado text
    check (ia_resultado in ('confirmado', 'nao_confirmado', 'inconclusivo', 'sem_atendimento'));

comment on column public.np_lead_telefones.ia_conversation_id is
  'conversation_id do ElevenLabs (LDR Automático) — chamada que testou este telefone. Usado pro GET /v1/convai/conversations/{id} de conferência.';
comment on column public.np_lead_telefones.ia_testado_em is
  'Quando este telefone foi testado pelo robô LDR Automático.';
comment on column public.np_lead_telefones.ia_resultado is
  'Veredito do robô pra este telefone específico — vem do campo data_collection_results.resultado_validacao do ElevenLabs (confirmado/nao_confirmado/inconclusivo/sem_atendimento).';

create index if not exists idx_np_lead_tel_ia_resultado
  on public.np_lead_telefones (ia_resultado)
  where ia_resultado is not null;
