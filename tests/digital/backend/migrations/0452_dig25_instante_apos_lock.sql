-- DIG-2.5: validar período e dia no instante efetivo da reserva, após obter o lock.
-- Mantém assinatura e permissões de 0450; não ativa orçamento nem discagem.
begin;

create or replace function public.np_fn_digital_gasto_reservar(
  p_tentativa uuid, p_lead uuid, p_e164 text, p_engine text,
  p_max_segundos integer, p_exigir_digital boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b np_digital_orcamentos%rowtype;
  v_ids uuid[]; v_leads uuid[]; v_id uuid; v_lead uuid;
  v_agora timestamptz; v_dia date;
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
    -- Uma reserva pode esperar o lock atravessando o fim do período ou a meia-noite.
    -- O instante de decisão precisa ser medido DEPOIS dessa espera.
    v_agora := clock_timestamp();
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

commit;
