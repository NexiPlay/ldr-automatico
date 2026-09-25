-- Somente verificacao. A migration 0389 vem do repositorio nexilead.
do $$
begin
  if to_regclass('public.vw_np_sonar_reputacao') is null
    or to_regprocedure('public.np_fn_sonar_reputacao_portao(text)') is null
    or to_regprocedure('public.np_fn_sonar_reputacao_registrar(text,text,text,timestamptz,numeric,text)') is null then
    raise exception 'SON-2.8: aplicar migration 0389 do nexilead antes de publicar as functions';
  end if;
end;
$$;
