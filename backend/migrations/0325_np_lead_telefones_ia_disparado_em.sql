-- 0325_np_lead_telefones_ia_disparado_em.sql
-- LDR Automático — marca QUANDO o orquestrador disparou a ligação (distinto
-- de ia_testado_em, que só é gravado pelo webhook quando a ligação já
-- TERMINOU). Sem esta coluna não dá pra saber que uma ligação está "em
-- andamento" (disparada mas sem resultado ainda) nem ordenar a lista de
-- chamadas recentes por quando foram feitas.
--
-- Só a coluna nesta migration — o orquestrador (ldr-automatico-orquestrador)
-- já foi atualizado pra gravar isto junto do ia_conversation_id.

alter table public.np_lead_telefones
  add column if not exists ia_disparado_em timestamptz;
