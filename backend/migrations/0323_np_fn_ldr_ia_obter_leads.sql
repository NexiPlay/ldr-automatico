-- 0323_np_fn_ldr_ia_obter_leads.sql
-- LDR Automático — RPC própria pro coordenador puxar leads validados pelo robô.
--
-- De propósito NÃO mexe em np_fn_pool_reposicao (a função de pool compartilhada por
-- ~32 agentes, mantida pelo Guilherme — guard do LDR Trilha Humana está na migration
-- 0289 daquele repo). É uma função nova e isolada: o coordenador vai precisar de um
-- botão/ação separado pra chamar esta RPC (não cai automaticamente no "Obter novos
-- leads" de sempre). Reaproveita só a lógica de filtro regional (áreas de atuação),
-- copiada do mesmo padrão da 0289 — infraestrutura genérica, não é LDR-específica,
-- segura de reaproveitar por leitura.
--
-- Atribuição é FOR UPDATE SKIP LOCKED (mesmo cuidado da 0299/np_fn_ldr_obter_leads do
-- Guilherme) — evita corrida se dois coordenadores clicarem ao mesmo tempo.

create or replace function public.np_fn_ldr_ia_obter_leads(p_agente uuid, p_limit integer default 20)
returns setof np_leads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_escolhidos uuid[];
begin
  -- guard: só quem está ativo no roster do robô pode puxar. Quem não está,
  -- não recebe nada (não cai em nenhum comportamento alternativo — ao
  -- contrário do guard da 0289, aqui não existe "resto do time" pra esta RPC,
  -- ela só serve pra esse fluxo).
  if not exists (
    select 1 from public.np_ldr_ia_participantes
    where agente_id = p_agente and ativo
  ) then
    return;
  end if;

  with areas as (
    select array_agg(distinct a.uf) as ufs
    from public.np_areas_atuacao_membros m
    join public.np_areas_atuacao a on a.id = m.area_id
    where m.agente_id = p_agente
      and a.ano = extract(year from now())::int
  ),
  trat as (
    select uf_restrita from public.np_agente_tratamento where agente_id = p_agente limit 1
  )
  select coalesce(array_agg(x.id), '{}')
    into v_escolhidos
  from (
    select l.id
    from public.np_leads l
    cross join areas
    cross join trat
    where l.agente_id is null
      and coalesce(l.bubble_ja_existia, false) = false
      and (l.reservado_para_agente_id is null or l.reservado_para_agente_id = p_agente)
      and exists (
        select 1
        from public.np_lead_tags lt
        join public.np_tags tg on tg.id = lt.tag_id
        where lt.lead_id = l.id and tg.slug = 'qualificacao:validado-ldr-ia'
      )
      and (
        (coalesce(cardinality(areas.ufs), 0) > 0 and l.uf = any(areas.ufs))
        or
        (coalesce(cardinality(areas.ufs), 0) = 0 and (trat.uf_restrita is null or l.uf = trat.uf_restrita))
      )
    order by l.mwm_lead desc nulls last
    limit greatest(coalesce(p_limit, 0), 0)
    for update of l skip locked
  ) x;

  if array_length(v_escolhidos, 1) is null then
    return;
  end if;

  update public.np_leads set agente_id = p_agente where id = any(v_escolhidos);

  return query select * from public.np_leads where id = any(v_escolhidos);
end;
$$;

grant execute on function public.np_fn_ldr_ia_obter_leads(uuid, integer) to authenticated, service_role;
