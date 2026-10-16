-- Read-only preflight. Does not create budgets, enable campaigns or change stops.
do $$
begin
  if to_regprocedure('public.np_fn_digital_gasto_reservar(uuid,uuid,text,text,integer,boolean,text)') is null
     or to_regclass('public.np_digital_degraus') is null
     or not exists(select 1 from pg_trigger where tgrelid='public.np_digital_gastos'::regclass
       and tgname='np_digital_degrau_reserva' and tgenabled='O') then
    raise exception 'DIG-2.4 migration is missing; dialers require the real origin and volume gate';
  end if;
  if to_regprocedure('public.np_fn_digital_gasto_reservar(uuid,uuid,text,text,integer,boolean)') is null
     or to_regprocedure('public.np_fn_digital_gasto_registrar(uuid,text,boolean,numeric,numeric,text)') is null
     or to_regclass('public.np_digital_orcamentos') is null then
    raise exception 'DIG-2.5 migration 0450 is missing; deploying dialers would block existing calls';
  end if;
  if to_regclass('public.np_digital_contextos') is null
     or to_regprocedure('public.np_fn_digital_contexto(uuid)') is null then
    raise exception 'DIG-3.2 migration 0458 is missing';
  end if;
  if not has_function_privilege('service_role','public.np_fn_digital_contexto(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.np_fn_digital_contexto(uuid)','EXECUTE')
     or has_function_privilege('anon','public.np_fn_digital_contexto(uuid)','EXECUTE') then
    raise exception 'DIG-3.2 server context privileges differ from the approved migration';
  end if;
end $$;
