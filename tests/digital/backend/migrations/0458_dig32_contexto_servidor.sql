-- DIG-3.2: fatos validados pelo importador/operador, nunca pelo body da ligação.
-- O importador DIG-1.1/1.2 deve fornecer grupo, município IBGE e evidência.
-- Não deduz B3/optante por consumo, nome, CNAE, distribuidora ou tag de piloto.
create table public.np_digital_contextos (
  lead_id uuid primary key references public.np_leads(id),
  lote_id uuid not null references public.np_lotes(id),
  codigo_ibge text not null references public.np_municipio_regiao(codigo_ibge),
  grupo text not null check (grupo in ('B3', 'optante')),
  fonte text not null check (length(btrim(fonte)) between 1 and 1000),
  validado_por text not null check (length(btrim(validado_por)) between 1 and 200),
  validado_em timestamptz not null default now(),
  valido_ate timestamptz not null,
  check (valido_ate > validado_em and valido_ate <= validado_em + interval '48 hours')
);
alter table public.np_digital_contextos enable row level security;
revoke all on public.np_digital_contextos from public, anon, authenticated;
grant select, insert, update, delete on public.np_digital_contextos to service_role;

create function public.np_fn_digital_contexto(p_lead uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c record; e record;
  v_agora timestamptz := now();
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_certificado boolean := false;
  v_evento uuid := null;
begin
  -- Vínculo rechecado a cada ligação. Mover o lead de lote invalida o contexto.
  select x.*, r.cod_regiao, r.regiao into c
    from np_digital_contextos x
    join np_leads l on l.id=x.lead_id and l.lote_id=x.lote_id
    join np_lotes b on b.id=x.lote_id
    join np_municipio_regiao r on r.codigo_ibge=x.codigo_ibge
    where x.lead_id=p_lead and x.validado_em<=v_agora and x.valido_ate>v_agora
      and lower(b.origem)='digital' and l.uf=r.uf and b.uf=r.uf
      and l.dist_codigo=r.dist and b.dist_codigo=r.dist;
  if not found then
    return jsonb_build_object('ok',false,'motivo','contexto_ausente_vencido_ou_lote_divergente');
  end if;

  -- ADR 0011, seção 3: agregado_rede / certificados (passaram na Certificação).
  -- `ativos`, `rcas` da tabela territorial ou matrícula não provam certificação.
  -- Sem evento recente, a reunião continua bloqueada. O último zero revoga.
  select a.*, ev.corpo_sha256, ev.carimbo_assinatura into e
    from vw_np_capilaridade_agregados_vigentes a
    join np_capilaridade_eventos ev on ev.evento_id=a.evento_id
    where a.tipo='agregado_rede' and a.regiao=c.cod_regiao and a.etapa='certificados'
      and a.data_ref<=v_dia
    order by a.data_ref desc, a.recebido_em desc limit 1;
  if found then
    v_certificado := coalesce(e.quantidade>0 and e.data_ref>=v_dia-1
      and e.recebido_em between v_agora-interval '48 hours' and v_agora
      and e.carimbo_assinatura is not null and e.corpo_sha256 ~ '^[a-f0-9]{64}$',false);
    if v_certificado then v_evento := e.evento_id; end if;
  end if;
  return jsonb_build_object('ok',true,'lead_id',c.lead_id,'lote_id',c.lote_id,
    'codigo_ibge',c.codigo_ibge,'grupo',c.grupo,'regiao',c.cod_regiao,
    'fonte',c.fonte,'valido_ate',c.valido_ate,
    'rca_certificado',v_certificado,'certificacao_evento_id',v_evento,
    'reuniao_liberada',v_certificado and v_dia>=date '2026-12-07',
    'agenda_disponivel',false);
end;
$$;
revoke execute on function public.np_fn_digital_contexto(uuid) from public, anon, authenticated;
grant execute on function public.np_fn_digital_contexto(uuid) to service_role;
comment on table public.np_digital_contextos is
  'DIG-3.2: contexto validado com fonte, lote e município IBGE. Expira em até 48h; não autoriza gasto ou discagem.';
