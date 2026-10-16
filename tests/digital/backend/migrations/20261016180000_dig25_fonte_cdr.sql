-- DIG-2.5: custo e comprovante devem continuar correspondendo após reentrega.
-- Não altera tarifas, limites, vínculos ou ativação. Preserva a assinatura e grants.
begin;

create or replace function public.np_fn_digital_gasto_registrar(
  p_tentativa uuid, p_conversation text, p_finalizada boolean default false,
  p_voz_usd numeric default null, p_telefonia_usd numeric default null, p_fonte_telefonia text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare g np_digital_gastos%rowtype; v_id uuid; v_fonte_efetiva text;
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
  -- Só trocar o comprovante quando aceitar o primeiro custo ou um custo maior.
  -- Reentrega antiga/igual e nota sem custo não comprovam o valor já consolidado.
  v_fonte_efetiva := case
    when p_telefonia_usd is not null and (g.telefonia_usd is null or p_telefonia_usd > g.telefonia_usd)
      then p_fonte_telefonia else g.fonte_telefonia end;
  update np_digital_gastos set conversation_id=p_conversation,
    finalizada=finalizada or p_finalizada,
    voz_usd=greatest(voz_usd,p_voz_usd), telefonia_usd=greatest(telefonia_usd,p_telefonia_usd),
    fonte_telefonia=v_fonte_efetiva, atualizado_em=clock_timestamp()
    where id=g.id;
  if p_voz_usd>g.reserva_voz or p_telefonia_usd>g.reserva_telefonia then
    update np_digital_orcamentos set suspenso_motivo='custo_excedeu_reserva' where id=v_id;
  end if;
  insert into np_digital_gasto_eventos(orcamento_id,tentativa_id,tipo,detalhe)
    values(v_id,g.id,'conciliacao',jsonb_build_object('conversation_id',p_conversation,
      'voz_usd',p_voz_usd,'telefonia_usd',p_telefonia_usd,'finalizada',p_finalizada,
      'fonte_telefonia',p_fonte_telefonia,'fonte_telefonia_efetiva',v_fonte_efetiva));
  return jsonb_build_object('digital',true,'tentativa_id',g.id);
end $$;

commit;
