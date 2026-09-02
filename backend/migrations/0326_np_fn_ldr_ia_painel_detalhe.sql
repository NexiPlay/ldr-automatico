-- 0326_np_fn_ldr_ia_painel_detalhe.sql
-- LDR Automático — lista de chamadas individuais (não agregado) pro Painel
-- do LDR: uma linha por telefone discado, com status calculado, pra dar
-- visibilidade e permitir reprocessar (retry) um "sem resposta"/"inconclusivo"
-- direto do painel. Complementa np_fn_ldr_ia_painel_serie (0324), que só
-- devolve contagens agregadas por dia.
--
-- status:
--   'em_andamento'   — ia_conversation_id gravado, webhook ainda não voltou
--   'confirmado' / 'nao_confirmado' / 'inconclusivo' / 'sem_atendimento'
--                    — copiado de ia_resultado quando o webhook já respondeu
--
-- Só entra na lista quem já foi discado pelo menos uma vez
-- (ia_conversation_id not null) — exatamente o mesmo universo 100%
-- LDR Automático usado em np_fn_ldr_ia_painel_serie (o LDR humano nunca
-- escreve nessas colunas).

create or replace function public.np_fn_ldr_ia_painel_detalhe(p_dias integer default 7)
returns table (
  telefone_id uuid,
  lead_id uuid,
  empresa text,
  e164 text,
  status text,
  ia_conversation_id text,
  disparado_em timestamptz,
  testado_em timestamptz
)
language sql
stable
as $$
  select
    lt.id as telefone_id,
    lt.lead_id,
    coalesce(nullif(l.nome_exibicao, ''), nullif(l.razao_social, ''), '(sem nome)') as empresa,
    lt.e164,
    coalesce(lt.ia_resultado, 'em_andamento') as status,
    lt.ia_conversation_id,
    lt.ia_disparado_em as disparado_em,
    lt.ia_testado_em as testado_em
  from public.np_lead_telefones lt
  join public.np_leads l on l.id = lt.lead_id
  where lt.ia_conversation_id is not null
    and coalesce(lt.ia_disparado_em, lt.ia_testado_em, now())
        >= (now() - (greatest(coalesce(p_dias, 7), 1) || ' days')::interval)
  order by coalesce(lt.ia_disparado_em, lt.ia_testado_em) desc nulls first
  limit 200;
$$;

grant execute on function public.np_fn_ldr_ia_painel_detalhe(integer) to authenticated, service_role;
