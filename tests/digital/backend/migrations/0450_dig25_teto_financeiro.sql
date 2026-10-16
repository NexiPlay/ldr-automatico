-- DIG-2.5: orçamento exclusivo, reserva ANTES do provedor e razão por tentativa.
-- Não altera degrau, filas, agentes ou autoriza telefonemas. USD, sem câmbio implícito.
begin;

create table public.np_digital_orcamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  moeda text not null default 'USD' check (moeda = 'USD'),
  inicio timestamptz not null,
  fim timestamptz not null check (fim > inicio),
  teto_dia numeric(14,6) not null check (teto_dia > 0 and teto_dia < 'Infinity'::numeric),
  teto_campanha numeric(14,6) not null check (teto_campanha >= teto_dia and teto_campanha < 'Infinity'::numeric),
  voz_reserva_minuto numeric(14,6) check (voz_reserva_minuto >= 0 and voz_reserva_minuto < 'Infinity'::numeric),
  telefonia_reserva_minuto numeric(14,6) check (telefonia_reserva_minuto >= 0 and telefonia_reserva_minuto < 'Infinity'::numeric),
  telefonia_reserva_conexao numeric(14,6) check (telefonia_reserva_conexao >= 0 and telefonia_reserva_conexao < 'Infinity'::numeric),
  max_segundos integer not null default 120 check (max_segundos between 1 and 3600),
  -- Arredondamento para cima da reserva, inclusive chamadas menores que um minuto.
  bloco_segundos integer not null default 60 check (bloco_segundos between 1 and 3600),
  fonte_tarifas text,
  aprovado_por text not null check (length(btrim(aprovado_por)) > 0),
  ativo boolean not null default false,
  suspenso_motivo text,
  criado_em timestamptz not null default now(),
  check (not ativo or (voz_reserva_minuto is not null and telefonia_reserva_minuto is not null
    and telefonia_reserva_conexao is not null and length(btrim(fonte_tarifas)) > 0
    and fonte_tarifas is not null and voz_reserva_minuto + telefonia_reserva_minuto > 0))
);

-- Associação explícita, controlada pelo servidor. Nunca inferir Digital de "EDP"/Grupo B.
create table public.np_digital_orcamento_leads (
  lead_id uuid primary key references public.np_leads(id),
  orcamento_id uuid not null references public.np_digital_orcamentos(id),
  fonte text not null check (length(btrim(fonte)) > 0),
  criado_em timestamptz not null default now()
);
create index on public.np_digital_orcamento_leads(orcamento_id);

create table public.np_digital_gastos (
  id uuid primary key, -- chave gerada no servidor; não é autorização reutilizável
  orcamento_id uuid not null references public.np_digital_orcamentos(id),
  lead_id uuid not null references public.np_leads(id),
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  engine text not null check (engine in ('ldr','sdr')),
  reservado_em timestamptz not null default clock_timestamp(),
  dia date not null,
  reserva_voz numeric(14,6) not null check (reserva_voz >= 0),
  reserva_telefonia numeric(14,6) not null check (reserva_telefonia >= 0),
  max_segundos integer not null,
  tarifas_snapshot jsonb not null,
  conversation_id text unique,
  finalizada boolean not null default false,
  voz_usd numeric(14,6) check (voz_usd >= 0 and voz_usd < 'Infinity'::numeric),
  telefonia_usd numeric(14,6) check (telefonia_usd >= 0 and telefonia_usd < 'Infinity'::numeric),
  fonte_telefonia text,
  atualizado_em timestamptz not null default clock_timestamp(),
  check (telefonia_usd is null or (fonte_telefonia is not null and length(btrim(fonte_telefonia)) > 0))
);
create index on public.np_digital_gastos(orcamento_id,dia);
create unique index np_digital_gastos_em_curso on public.np_digital_gastos(lead_id,engine)
  where not finalizada;

create table public.np_digital_gasto_eventos (
  id bigint generated always as identity primary key,
  orcamento_id uuid references public.np_digital_orcamentos(id),
  tentativa_id uuid,
  ocorrido_em timestamptz not null default clock_timestamp(),
  tipo text not null,
  detalhe jsonb not null
);

-- Tarifas/intervalo não podem mudar retroativamente a conta de chamadas existentes.
create function public.np_fn_digital_orcamento_imutavel() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists(select 1 from np_digital_gastos where orcamento_id=old.id) and
     (to_jsonb(new) - array['ativo','suspenso_motivo','teto_dia','teto_campanha']) is distinct from
     (to_jsonb(old) - array['ativo','suspenso_motivo','teto_dia','teto_campanha']) then
    raise exception 'Orçamento com tentativas: criar nova campanha para alterar tarifas/período';
  end if;
  return new;
end $$;
create trigger np_digital_orcamento_imutavel before update on public.np_digital_orcamentos
for each row execute function public.np_fn_digital_orcamento_imutavel();

create function public.np_fn_digital_vinculo_protegido() returns trigger
language plpgsql set search_path=public as $$
begin
  -- Impede retirar um lead do recorte para contornar reservas em andamento.
  perform 1 from np_digital_orcamentos where id=old.orcamento_id for update;
  if exists(select 1 from np_digital_orcamentos where id=old.orcamento_id and ativo)
     or exists(select 1 from np_digital_gastos where lead_id=old.lead_id and not finalizada) then
    raise exception 'Pausar orçamento e conciliar chamadas antes de alterar vínculo Digital';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger np_digital_vinculo_protegido before update or delete on public.np_digital_orcamento_leads
for each row execute function public.np_fn_digital_vinculo_protegido();

create function public.np_fn_digital_gasto_reservar(
  p_tentativa uuid, p_lead uuid, p_e164 text, p_engine text,
  p_max_segundos integer, p_exigir_digital boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b np_digital_orcamentos%rowtype;
  v_ids uuid[]; v_leads uuid[]; v_id uuid; v_lead uuid;
  v_agora timestamptz := clock_timestamp(); v_dia date;
  v_voz numeric; v_tel numeric; v_dia_usado numeric; v_total numeric; v_motivo text;
begin
  if p_tentativa is null or p_e164 is null or p_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_engine is null or p_engine not in ('ldr','sdr') or p_exigir_digital is null then
    raise exception 'Identidade da tentativa inválida';
  end if;
  -- Também cobre o discador manual por número: omitir projeto/lead não contorna o teto.
  select array_agg(distinct m.orcamento_id), array_agg(distinct m.lead_id)
    into v_ids, v_leads
    from np_digital_orcamento_leads m join np_leads l on l.id=m.lead_id
    where m.lead_id=p_lead or exists(select 1 from np_lead_telefones t
      where t.lead_id=m.lead_id and t.e164=p_e164)
      or regexp_replace(coalesce(l.telefone,''),'[^0-9]','','g') in
        (substring(p_e164 from 2), substring(p_e164 from 4));
  if v_ids is null then
    if p_exigir_digital or exists(select 1 from np_leads l where
      (l.id=p_lead or exists(select 1 from np_lead_telefones t where t.lead_id=l.id and t.e164=p_e164)
       or regexp_replace(coalesce(l.telefone,''),'[^0-9]','','g') in
         (substring(p_e164 from 2),substring(p_e164 from 4)))
      and (lower(l.origem)='digital' or exists(select 1 from np_lead_tags lt join np_tags t on t.id=lt.tag_id
        where lt.lead_id=l.id and t.slug='origem:digital'))) then
      v_motivo := 'digital_sem_orcamento';
    else
      return jsonb_build_object('permitido',true,'digital',false);
    end if;
  elsif cardinality(v_ids) <> 1 or p_lead is null or not(p_lead=any(v_leads)) then
    v_motivo := 'identidade_digital_ambigua';
  else
    v_id := v_ids[1]; v_lead := p_lead;
    if not exists(select 1 from np_lead_telefones t where t.lead_id=p_lead and t.e164=p_e164)
       and not exists(select 1 from np_leads l where l.id=p_lead and
         regexp_replace(coalesce(l.telefone,''),'[^0-9]','','g') in
           (substring(p_e164 from 2),substring(p_e164 from 4))) then
      v_motivo := 'telefone_nao_pertence_ao_lead';
    end if;
  end if;
  if v_motivo is null then
    -- Serializa reservas E liquidações da mesma campanha (fila e direto, LDR e SDR).
    select * into strict b from np_digital_orcamentos where id=v_id for update;
    v_dia := (v_agora at time zone 'America/Sao_Paulo')::date;
    select coalesce(sum(coalesce(voz_usd,reserva_voz)+coalesce(telefonia_usd,reserva_telefonia)),0),
      coalesce(sum(coalesce(voz_usd,reserva_voz)+coalesce(telefonia_usd,reserva_telefonia)) filter(where dia=v_dia),0)
      into v_total,v_dia_usado from np_digital_gastos where orcamento_id=b.id;
    v_voz := ceil(b.max_segundos::numeric/b.bloco_segundos)*b.bloco_segundos/60*b.voz_reserva_minuto;
    v_tel := ceil(b.max_segundos::numeric/b.bloco_segundos)*b.bloco_segundos/60*b.telefonia_reserva_minuto+b.telefonia_reserva_conexao;
    -- Arredondar para CIMA na mesma precisão da coluna: jamais reservar menos por truncagem.
    v_voz := ceil(v_voz*1000000)/1000000; v_tel := ceil(v_tel*1000000)/1000000;
    v_motivo := case
      when not exists(select 1 from np_digital_orcamento_leads where lead_id=v_lead and orcamento_id=b.id) then 'vinculo_alterado'
      when not b.ativo then 'orcamento_inativo'
      when b.suspenso_motivo is not null then 'orcamento_suspenso'
      when v_agora < b.inicio or v_agora >= b.fim then 'fora_periodo'
      when v_voz is null or v_tel is null or v_voz+v_tel <= 0 then 'tarifas_ausentes'
      when p_max_segundos is null or p_max_segundos < 1 or p_max_segundos > b.max_segundos then 'duracao_nao_coberta'
      when exists(select 1 from np_digital_gastos where id=p_tentativa) then 'tentativa_ja_reservada'
      when exists(select 1 from np_digital_gastos where lead_id=v_lead and engine=p_engine and not finalizada) then 'chamada_em_curso'
      when v_total+v_voz+v_tel > b.teto_campanha then 'teto_campanha'
      when v_dia_usado+v_voz+v_tel > b.teto_dia then 'teto_dia'
      else null end;
  end if;
  if v_motivo is not null then
    insert into np_digital_gasto_eventos(orcamento_id,tentativa_id,tipo,detalhe)
      values(v_id,p_tentativa,'bloqueio',jsonb_build_object('motivo',v_motivo,'dia',v_dia,
        'comprometido_dia',v_dia_usado,'comprometido_campanha',v_total,'teto_dia',b.teto_dia,
        'teto_campanha',b.teto_campanha,'reserva_proxima',v_voz+v_tel));
    return jsonb_build_object('permitido',false,'digital',true,'motivo',v_motivo);
  end if;
  insert into np_digital_gastos(id,orcamento_id,lead_id,e164,engine,dia,reserva_voz,reserva_telefonia,max_segundos,tarifas_snapshot)
    values(p_tentativa,b.id,v_lead,p_e164,p_engine,v_dia,v_voz,v_tel,b.max_segundos,
      jsonb_build_object('moeda',b.moeda,'voz_minuto',b.voz_reserva_minuto,
        'telefonia_minuto',b.telefonia_reserva_minuto,'telefonia_conexao',b.telefonia_reserva_conexao,
        'bloco_segundos',b.bloco_segundos,'fonte',b.fonte_tarifas));
  insert into np_digital_gasto_eventos(orcamento_id,tentativa_id,tipo,detalhe)
    values(b.id,p_tentativa,'reserva',jsonb_build_object('voz',v_voz,'telefonia',v_tel,'moeda','USD'));
  return jsonb_build_object('permitido',true,'digital',true,'tentativa_id',p_tentativa,
    'reserva_voz',v_voz,'reserva_telefonia',v_tel);
end $$;

-- Resposta do provedor ou webhook autenticado. Sem expiração automática de reservas.
-- Telefonia só vira custo apurado com CDR/fatura; minutos ElevenLabs NÃO são uma fatura 3CX.
create function public.np_fn_digital_gasto_registrar(
  p_tentativa uuid, p_conversation text, p_finalizada boolean default false,
  p_voz_usd numeric default null, p_telefonia_usd numeric default null, p_fonte_telefonia text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare g np_digital_gastos%rowtype; v_id uuid;
begin
  if p_conversation is null or length(btrim(p_conversation))=0 or p_finalizada is null
    or (p_voz_usd is not null and not(p_voz_usd>=0 and p_voz_usd<'Infinity'::numeric))
    or (p_telefonia_usd is not null and not(p_telefonia_usd>=0 and p_telefonia_usd<'Infinity'::numeric))
    or (p_telefonia_usd is not null and (p_fonte_telefonia is null or length(btrim(p_fonte_telefonia))=0)) then
    raise exception 'Custo ou correlação inválidos';
  end if;
  select orcamento_id into v_id from np_digital_gastos
    where (p_tentativa is not null and id=p_tentativa) or conversation_id=p_conversation limit 1;
  if v_id is null then
    if p_tentativa is not null then raise exception 'Tentativa Digital não encontrada'; end if;
    return jsonb_build_object('digital',false);
  end if;
  perform 1 from np_digital_orcamentos where id=v_id for update;
  select * into strict g from np_digital_gastos where orcamento_id=v_id and
    ((p_tentativa is not null and id=p_tentativa) or conversation_id=p_conversation) for update;
  if (p_tentativa is not null and p_tentativa<>g.id) or
     (g.conversation_id is not null and g.conversation_id<>p_conversation) then
    raise exception 'Correlação Digital divergente';
  end if;
  if not(g.finalizada or p_finalizada) and (p_voz_usd is not null or p_telefonia_usd is not null) then
    raise exception 'Não liberar reserva de chamada ainda em curso';
  end if;
  update np_digital_gastos set conversation_id=p_conversation,
    finalizada=finalizada or p_finalizada,
    -- Reentrega ou resposta antiga não apaga custo nem reabre tentativa finalizada.
    voz_usd=greatest(voz_usd,p_voz_usd), telefonia_usd=greatest(telefonia_usd,p_telefonia_usd),
    fonte_telefonia=coalesce(p_fonte_telefonia,fonte_telefonia), atualizado_em=clock_timestamp()
    where id=g.id;
  if p_voz_usd>g.reserva_voz or p_telefonia_usd>g.reserva_telefonia then
    update np_digital_orcamentos set suspenso_motivo='custo_excedeu_reserva' where id=v_id;
  end if;
  insert into np_digital_gasto_eventos(orcamento_id,tentativa_id,tipo,detalhe)
    values(v_id,g.id,'conciliacao',jsonb_build_object('conversation_id',p_conversation,
      'voz_usd',p_voz_usd,'telefonia_usd',p_telefonia_usd,'finalizada',p_finalizada));
  return jsonb_build_object('digital',true,'tentativa_id',g.id);
end $$;

create view public.vw_np_digital_gastos with (security_invoker=true) as
select b.id,b.nome,b.moeda,b.inicio,b.fim,b.ativo,b.suspenso_motivo,b.teto_dia,b.teto_campanha,
  count(g.id) as tentativas,
  coalesce(sum(g.voz_usd),0) as voz_apurada,
  coalesce(sum(g.telefonia_usd),0) as telefonia_apurada,
  coalesce(sum(case when g.voz_usd is null then g.reserva_voz else 0 end),0) as voz_reservada,
  coalesce(sum(case when g.telefonia_usd is null then g.reserva_telefonia else 0 end),0) as telefonia_reservada,
  coalesce(sum(coalesce(g.voz_usd,g.reserva_voz)+coalesce(g.telefonia_usd,g.reserva_telefonia)),0) as comprometido,
  coalesce(sum(coalesce(g.voz_usd,g.reserva_voz)+coalesce(g.telefonia_usd,g.reserva_telefonia))
    filter(where g.dia=(now() at time zone 'America/Sao_Paulo')::date),0) as comprometido_hoje
from public.np_digital_orcamentos b left join public.np_digital_gastos g on g.orcamento_id=b.id group by b.id;

alter table public.np_digital_orcamentos enable row level security;
alter table public.np_digital_orcamento_leads enable row level security;
alter table public.np_digital_gastos enable row level security;
alter table public.np_digital_gasto_eventos enable row level security;
revoke all on public.np_digital_orcamentos,public.np_digital_orcamento_leads,public.np_digital_gastos,
  public.np_digital_gasto_eventos,public.vw_np_digital_gastos from public,anon,authenticated;
grant all on public.np_digital_orcamentos,public.np_digital_orcamento_leads,public.np_digital_gastos,
  public.np_digital_gasto_eventos to service_role;
grant select on public.vw_np_digital_gastos to service_role;
grant usage,select on sequence public.np_digital_gasto_eventos_id_seq to service_role;
revoke all on function public.np_fn_digital_orcamento_imutavel() from public,anon,authenticated;
revoke all on function public.np_fn_digital_vinculo_protegido() from public,anon,authenticated;
revoke all on function public.np_fn_digital_gasto_reservar(uuid,uuid,text,text,integer,boolean) from public,anon,authenticated;
revoke all on function public.np_fn_digital_gasto_registrar(uuid,text,boolean,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.np_fn_digital_gasto_reservar(uuid,uuid,text,text,integer,boolean) to service_role;
grant execute on function public.np_fn_digital_gasto_registrar(uuid,text,boolean,numeric,numeric,text) to service_role;
commit;
