-- DIG-2.4: subteto Digital, subordinado ao degrau compartilhado do Sonar.
-- Instala em ZERO. Não altera Sonar, orçamento, origem, agente ou campanha.
begin;

create table public.np_digital_degraus (
  id bigint generated always as identity primary key,
  valor_dia integer not null check (valor_dia between 0 and 33581),
  desde timestamptz not null default clock_timestamp(),
  inicio_degrau timestamptz not null,
  motivo text not null check (length(btrim(motivo)) > 0),
  definido_por text not null check (length(btrim(definido_por)) > 0),
  capacidade jsonb,
  valido_ate timestamptz,
  gate_b jsonb,
  gate_c jsonb,
  check (valor_dia = 0 or (capacidade is not null and valido_ate is not null
    and gate_b is not null and gate_c is not null))
);
insert into public.np_digital_degraus(valor_dia,inicio_degrau,motivo,definido_por)
values(0,clock_timestamp(),'DIG-2.4: aguardando capacidade comprovada, gates e aceite','migration DIG-2.4');

alter table public.np_digital_degraus enable row level security;
revoke all on public.np_digital_degraus from public,anon,authenticated,service_role;
grant select on public.np_digital_degraus to service_role;
revoke all on sequence public.np_digital_degraus_id_seq from public,anon,authenticated,service_role;

alter table public.np_digital_gastos add column degrau_id bigint references public.np_digital_degraus(id);
alter table public.np_digital_gastos add column origem text;
create index np_digital_gastos_dia on public.np_digital_gastos(dia);

-- A versão antiga com seis argumentos continua disponível para outros lotes.
-- Para Digital, ela falha sem origem; só o servidor consulta a origem no provedor.
create function public.np_fn_digital_gasto_reservar(
  p_tentativa uuid,p_lead uuid,p_e164 text,p_engine text,p_max_segundos integer,
  p_exigir_digital boolean,p_origem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare resultado jsonb; anterior text:=current_setting('nexi.digital_origem',true);
begin
  perform set_config('nexi.digital_origem',coalesce(p_origem,''),true);
  resultado:=np_fn_digital_gasto_reservar(p_tentativa,p_lead,p_e164,p_engine,p_max_segundos,p_exigir_digital);
  perform set_config('nexi.digital_origem',coalesce(anterior,''),true);
  return resultado;
end $$;
revoke all on function public.np_fn_digital_gasto_reservar(uuid,uuid,text,text,integer,boolean,text)
  from public,anon,authenticated;
grant execute on function public.np_fn_digital_gasto_reservar(uuid,uuid,text,text,integer,boolean,text) to service_role;

-- Todas as campanhas Digital, engines e caminhos compartilham esta contagem.
-- Reserva com timeout continua consumida, inclusive depois da conciliação.
create function public.np_fn_digital_degrau_atual()
returns table(id bigint,valor_dia integer,desde timestamptz,valido_ate timestamptz,
  usado_hoje bigint,resta bigint)
language sql volatile security definer set search_path=public as $$
  select d.id,d.valor_dia,d.inicio_degrau,d.valido_ate,u.n,
    case when d.valido_ate > clock_timestamp() then greatest(0,d.valor_dia-u.n) else 0 end
  from (select * from np_digital_degraus order by id desc limit 1) d
  cross join lateral(select count(*) n from np_digital_gastos
    where dia=(clock_timestamp() at time zone 'America/Sao_Paulo')::date) u;
$$;

-- A capacidade é um recibo fornecido pelo operador: canais homologados e
-- limite diário de CADA origem aquecida, com fontes. Não é previsão de calendário.
create function public.np_fn_digital_degrau_definir(
  p_valor integer,p_motivo text,p_definido_por text,
  p_gate_c_aprovado_por text default null,p_capacidade jsonb default null
) returns public.np_digital_degraus
language plpgsql security definer set search_path=public as $$
declare
  anterior np_digital_degraus; novo np_digital_degraus;
  agora timestamptz; validade timestamptz; dia_local date;
  origem jsonb; quantidade integer; limite_origens bigint:=0; limite_canais integer;
  gate_b jsonb; gate_c jsonb; origens_validas integer;
  financeiro_resta numeric; usadas bigint; sonar record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'DIG-2.4 exige READ COMMITTED para decisão após espera por lock';
  end if;
  if p_valor is null or p_valor not between 0 and 33581
     or coalesce(length(btrim(p_motivo)),0)=0 or coalesce(length(btrim(p_definido_por)),0)=0 then
    raise exception 'DIG-2.4: valor, motivo e responsável inválidos';
  end if;
  perform pg_advisory_xact_lock(240024,1);
  agora:=clock_timestamp(); dia_local:=(agora at time zone 'America/Sao_Paulo')::date;
  select * into strict anterior from np_digital_degraus order by id desc limit 1;

  -- Redução é imediata. Não renova validade nem produz um novo aceite de gates.
  if p_valor=0 or p_valor<anterior.valor_dia then
    insert into np_digital_degraus(valor_dia,inicio_degrau,motivo,definido_por,
      capacidade,valido_ate,gate_b,gate_c)
    values(p_valor,agora,p_motivo,p_definido_por,anterior.capacidade,
      anterior.valido_ate,anterior.gate_b,anterior.gate_c) returning * into novo;
    return novo;
  end if;
  if p_valor>(case when anterior.valor_dia=0 then 50 else anterior.valor_dia*2 end) then
    raise exception 'DIG-2.4: salto recusado; primeiro degrau até 50, demais até o dobro';
  end if;
  if p_valor>anterior.valor_dia and anterior.valor_dia>0
     and dia_local-(anterior.inicio_degrau at time zone 'America/Sao_Paulo')::date<3 then
    raise exception 'DIG-2.4: subida exige pelo menos 3 dias no degrau';
  end if;
  select * into strict sonar from np_fn_sonar_degrau_atual();
  if sonar.valor_dia is null or p_valor>sonar.valor_dia then
    raise exception 'DIG-2.4: subteto não pode exceder o degrau global do Sonar';
  end if;
  if jsonb_typeof(p_capacidade) is distinct from 'object'
     or jsonb_typeof(p_capacidade->'origens') is distinct from 'array'
     or coalesce(p_capacidade->>'capacidade_canais_dia','') !~ '^[1-9][0-9]{0,7}$'
     or coalesce(length(btrim(p_capacidade->>'fonte_capacidade')),0)=0
     or coalesce(p_capacidade->>'valido_ate','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'DIG-2.4: capacidade comprovada, origens, fonte e validade são obrigatórias';
  end if;
  validade:=(p_capacidade->>'valido_ate')::timestamptz;
  limite_canais:=(p_capacidade->>'capacidade_canais_dia')::integer;
  if validade<=agora or validade>agora+interval '24 hours' then
    raise exception 'DIG-2.4: recibo deve vencer em até 24 horas';
  end if;
  quantidade:=jsonb_array_length(p_capacidade->'origens');
  if quantidade=0 or quantidade<>(select count(distinct x->>'origem')
    from jsonb_array_elements(p_capacidade->'origens') x) then
    raise exception 'DIG-2.4: origens ausentes ou duplicadas';
  end if;
  for origem in select value from jsonb_array_elements(p_capacidade->'origens') loop
    if coalesce(origem->>'origem','') !~ '^\+55(11|12|27|28)[0-9]{8,9}$'
       or coalesce(origem->>'limite_dia','') !~ '^[1-9][0-9]{0,2}$'
       or (origem->>'limite_dia')::integer>500
       or coalesce(length(btrim(origem->>'fonte_aquecimento')),0)=0 then
      raise exception 'DIG-2.4: origem, limite aquecido (1 a 500) e fonte são obrigatórios';
    end if;
    limite_origens:=limite_origens+(origem->>'limite_dia')::integer;
  end loop;
  if p_valor>least(limite_canais,limite_origens) then
    raise exception 'DIG-2.4: degrau excede capacidade homologada ou aquecimento';
  end if;
  select jsonb_agg(to_jsonb(v) order by v.origem),count(*)
    into gate_b,origens_validas
    from vw_np_sonar_reputacao v
    join np_sonar_reputacao_origens o using(origem)
    where v.origem in(select x->>'origem' from jsonb_array_elements(p_capacidade->'origens') x)
      and o.responsavel_id is not null and not v.pausada and v.total>0
      and v.percentual is not null and v.percentual<30 and v.sem_duracao=0;
  if origens_validas<>quantidade then
    raise exception 'DIG-2.4: Gate B recusado; origem sem responsável, sem amostra, pausada ou com curtas/duração inválidas';
  end if;
  if coalesce(length(btrim(p_gate_c_aprovado_por)),0)=0 then
    raise exception 'DIG-2.4: Gate C exige aprovador identificado';
  end if;
  -- A aprovação registra custos e saldo do instante. A DIG-2.5 continua
  -- reservando cada tentativa e pode parar antes do teto de chamadas.
  select jsonb_agg(to_jsonb(q)),coalesce(sum(q.chamadas_restantes),0) into gate_c,financeiro_resta
  from (
    select b.id,b.nome,b.fonte_tarifas,b.aprovado_por,b.teto_dia,b.teto_campanha,
      floor(greatest(0,least(b.teto_dia-u.dia,b.teto_campanha-u.total))/c.por_chamada) chamadas_restantes
    from np_digital_orcamentos b
    cross join lateral(select
      coalesce(sum(coalesce(voz_usd,reserva_voz)+coalesce(telefonia_usd,reserva_telefonia)),0) total,
      coalesce(sum(coalesce(voz_usd,reserva_voz)+coalesce(telefonia_usd,reserva_telefonia))
        filter(where dia=dia_local),0) dia
      from np_digital_gastos where orcamento_id=b.id) u
    cross join lateral(select
      ceil(ceil(b.max_segundos::numeric/b.bloco_segundos)*b.bloco_segundos/60*b.voz_reserva_minuto*1000000)/1000000
      +ceil((ceil(b.max_segundos::numeric/b.bloco_segundos)*b.bloco_segundos/60*b.telefonia_reserva_minuto
      +b.telefonia_reserva_conexao)*1000000)/1000000 por_chamada) c
    where b.ativo and b.suspenso_motivo is null and agora>=b.inicio and agora<b.fim
      and c.por_chamada>0 and coalesce(length(btrim(b.fonte_tarifas)),0)>0
      and exists(select 1 from np_digital_orcamento_leads m where m.orcamento_id=b.id)
  ) q;
  select count(*) into usadas from np_digital_gastos where dia=dia_local;
  if gate_c is null or financeiro_resta<greatest(0,p_valor-usadas) then
    raise exception 'DIG-2.4: Gate C recusado; orçamento ativo com tarifas e saldo insuficiente';
  end if;
  insert into np_digital_degraus(valor_dia,inicio_degrau,motivo,definido_por,capacidade,valido_ate,gate_b,gate_c)
  values(p_valor,case when p_valor=anterior.valor_dia then anterior.inicio_degrau else agora end,
    p_motivo,p_definido_por,p_capacidade,validade,gate_b,
    jsonb_build_object('aprovado_por',p_gate_c_aprovado_por,'orcamentos',gate_c,'consultado_em',agora))
  returning * into novo;
  return novo;
end $$;

-- Integração no ponto comum já publicado: o INSERT da reserva financeira
-- ocorre ANTES do POST para a ElevenLabs, na fila e no disparo direto.
create function public.np_fn_digital_degrau_reserva() returns trigger
language plpgsql security definer set search_path=public as $$
declare d np_digital_degraus; n bigint; agora timestamptz; sonar record; limite_origem integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'DIG-2.4 exige READ COMMITTED';
  end if;
  perform pg_advisory_xact_lock(240024,1);
  agora:=clock_timestamp();
  -- Não migrar a reserva financeira calculada para outro dia após espera.
  if new.dia is distinct from (agora at time zone 'America/Sao_Paulo')::date then
    raise exception 'DIG-2.4: dia mudou durante a reserva; nenhuma chamada autorizada';
  end if;
  select * into strict d from np_digital_degraus order by id desc limit 1;
  if d.valor_dia=0 or d.valido_ate is null or d.valido_ate<=agora then
    raise exception 'DIG-2.4: degrau zero ou aprovação vencida';
  end if;
  new.origem:=nullif(current_setting('nexi.digital_origem',true),'');
  select (x->>'limite_dia')::integer into limite_origem
    from jsonb_array_elements(d.capacidade->'origens') x where x->>'origem'=new.origem;
  if limite_origem is null then
    raise exception 'DIG-2.4: origem real ausente ou fora da capacidade aprovada';
  end if;
  if not exists(select 1 from vw_np_sonar_reputacao v join np_sonar_reputacao_origens o using(origem)
    where v.origem=new.origem and o.responsavel_id is not null and not v.pausada
      and v.total>0 and v.percentual<30 and v.sem_duracao=0) then
    raise exception 'DIG-2.4: Gate B da origem deixou de passar';
  end if;
  select * into strict sonar from np_fn_sonar_degrau_atual();
  if sonar.valor_dia is null or sonar.resta is null or sonar.valor_dia<=0 or sonar.resta<=0 then
    raise exception 'DIG-2.4: degrau global bloqueado';
  end if;
  select count(*) into n from np_digital_gastos where dia=new.dia;
  if n>=least(d.valor_dia,sonar.valor_dia) then
    raise exception 'DIG-2.4: teto diário Digital atingido';
  end if;
  select count(*) into n from np_digital_gastos where dia=new.dia and origem=new.origem;
  if n>=limite_origem then
    raise exception 'DIG-2.4: limite diário aquecido da origem atingido';
  end if;
  new.degrau_id:=d.id;
  return new;
end $$;
create trigger np_digital_degrau_reserva before insert on public.np_digital_gastos
for each row execute function public.np_fn_digital_degrau_reserva();

-- Conciliação só altera custos/estado, nunca devolve capacidade já consumida.
create function public.np_fn_digital_degrau_preservar() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' or (new.id,new.dia,new.degrau_id,new.orcamento_id,new.lead_id,new.engine,new.origem)
    is distinct from (old.id,old.dia,old.degrau_id,old.orcamento_id,old.lead_id,old.engine,old.origem) then
    raise exception 'DIG-2.4: reserva de vazão é imutável';
  end if;
  return new;
end $$;
create trigger np_digital_degrau_preservar before update or delete on public.np_digital_gastos
for each row execute function public.np_fn_digital_degrau_preservar();

revoke all on function public.np_fn_digital_degrau_atual(),
  public.np_fn_digital_degrau_definir(integer,text,text,text,jsonb),
  public.np_fn_digital_degrau_reserva(),public.np_fn_digital_degrau_preservar()
  from public,anon,authenticated;
grant execute on function public.np_fn_digital_degrau_atual(),
  public.np_fn_digital_degrau_definir(integer,text,text,text,jsonb) to service_role;
comment on table public.np_digital_degraus is
  'DIG-2.4: subteto Digital compartilhado entre LDR/SDR e orçamentos. Não reserva canais nem eleva Sonar. Histórico de capacidade e gates por decisão.';
commit;
