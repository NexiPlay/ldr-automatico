-- 0324_np_fn_ldr_ia_painel_serie.sql
-- LDR Automático — série diária real pro Painel do LDR (troca do mock em
-- ldr-automatico-painel.js). Mesmo shape de campos que o mock já usava
-- (data, leads_trabalhados, numeros_testados, numeros_validos,
-- numeros_declinados, numeros_declinados_puro, sem_resposta), pra
-- ldr-coordenador.js não precisar mudar nada — só o painel.js troca a fonte.
--
-- Conta QUALQUER telefone testado (ia_testado_em not null), independente da
-- origem do lead — inclusive os leads de teste (origem='ldr-automatico-teste'
-- criados pelo popup de disparo manual). Não faz sentido esconder esses do
-- painel: é literalmente o dado que existe até o piloto de verdade começar.
--
-- 'inconclusivo' entra junto com 'nao_confirmado' em numeros_declinados_puro
-- (não tem bucket próprio no desenho atual do painel/gráfico).

create or replace function public.np_fn_ldr_ia_painel_serie(p_dias integer default 30)
returns table (
  data date,
  leads_trabalhados integer,
  numeros_testados integer,
  numeros_validos integer,
  numeros_declinados integer,
  numeros_declinados_puro integer,
  sem_resposta integer
)
language sql
stable
as $$
  with dias as (
    select generate_series(
      (current_date - (greatest(coalesce(p_dias, 30), 1) - 1)),
      current_date,
      interval '1 day'
    )::date as data
  ),
  testes as (
    select
      (lt.ia_testado_em)::date as data,
      lt.lead_id,
      lt.ia_resultado
    from public.np_lead_telefones lt
    where lt.ia_testado_em is not null
      and lt.ia_testado_em::date >= (current_date - (greatest(coalesce(p_dias, 30), 1) - 1))
  )
  select
    d.data,
    count(distinct t.lead_id)::integer as leads_trabalhados,
    count(t.lead_id)::integer as numeros_testados,
    count(*) filter (where t.ia_resultado = 'confirmado')::integer as numeros_validos,
    count(*) filter (where t.ia_resultado in ('nao_confirmado', 'inconclusivo', 'sem_atendimento'))::integer as numeros_declinados,
    count(*) filter (where t.ia_resultado in ('nao_confirmado', 'inconclusivo'))::integer as numeros_declinados_puro,
    count(*) filter (where t.ia_resultado = 'sem_atendimento')::integer as sem_resposta
  from dias d
  left join testes t on t.data = d.data
  group by d.data
  order by d.data;
$$;

grant execute on function public.np_fn_ldr_ia_painel_serie(integer) to authenticated, service_role;
