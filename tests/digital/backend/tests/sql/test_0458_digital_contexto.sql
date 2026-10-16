-- Executar depois da migration, dentro de BEGIN ... ROLLBACK.
-- Só fixtures novas, sem alterar leads reais nem realizar chamadas externas.
do $$
declare
  v_lead uuid := gen_random_uuid(); v_lote uuid := gen_random_uuid();
  v_evento uuid := gen_random_uuid(); v_result jsonb; v_municipio record;
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  assert not has_table_privilege('authenticated','np_digital_contextos','INSERT'), 'frontend não pode validar contexto';
  assert not has_function_privilege('anon','np_fn_digital_contexto(uuid)','EXECUTE'), 'anon sem acesso';
  assert not has_function_privilege('authenticated','np_fn_digital_contexto(uuid)','EXECUTE'), 'RPC só servidor';
  assert has_function_privilege('service_role','np_fn_digital_contexto(uuid)','EXECUTE'), 'service_role deve executar';
  assert (np_fn_digital_contexto(v_lead)->>'ok')::boolean=false, 'ausência bloqueia';

  select * into strict v_municipio from np_municipio_regiao where codigo_ibge='3518800';
  insert into np_lotes(id,codigo,nome,origem,uf,dist_codigo)
    values(v_lote,'QA-DIG32-'||v_lote,'Fixture transacional DIG-3.2','digital',v_municipio.uf,v_municipio.dist);
  insert into np_leads(id,lote_id,cnpj,razao_social,origem,uf,dist_codigo)
    values(v_lead,v_lote,'00000000000332','Fixture transacional DIG-3.2','digital',v_municipio.uf,v_municipio.dist);
  insert into np_digital_contextos(lead_id,lote_id,codigo_ibge,grupo,fonte,validado_por,valido_ate)
    values(v_lead,v_lote,v_municipio.codigo_ibge,'B3','fixture sem cliente','teste transacional',now()+interval '1 hour');
  v_result := np_fn_digital_contexto(v_lead);
  assert (v_result->>'ok')::boolean and v_result->>'grupo'='B3' and v_result->>'regiao'='SP-R1', 'contexto canônico';
  assert (v_result->>'rca_certificado')::boolean=false, 'tabela territorial não prova certificação';
  assert (v_result->>'agenda_disponivel')::boolean=false, 'não inventa agenda';

  -- Nenhum destes eventos autoriza reunião na região do lead.
  insert into np_capilaridade_eventos(evento_id,acao,tipo,regiao,data_ref,etapa,quantidade,corpo,corpo_sha256,carimbo_assinatura)
    values(gen_random_uuid(),'status_lead','agregado_rede','SP-R1',v_dia,'ativos',10,'{}',repeat('a',64),now());
  assert (np_fn_digital_contexto(v_lead)->>'rca_certificado')::boolean=false, 'ativo não é certificado';
  insert into np_capilaridade_eventos(evento_id,acao,tipo,regiao,data_ref,etapa,quantidade,corpo,corpo_sha256,carimbo_assinatura)
    values(gen_random_uuid(),'status_lead','agregado_rede','ES-R1',v_dia,'certificados',10,'{}',repeat('a',64),now());
  assert (np_fn_digital_contexto(v_lead)->>'rca_certificado')::boolean=false, 'certificado de outra região não autoriza';
  insert into np_capilaridade_eventos(evento_id,acao,tipo,regiao,data_ref,etapa,quantidade,corpo,corpo_sha256,carimbo_assinatura)
    values(gen_random_uuid(),'status_lead','agregado_rede','SP-R1',v_dia-3,'certificados',10,'{}',repeat('a',64),now());
  assert (np_fn_digital_contexto(v_lead)->>'rca_certificado')::boolean=false, 'data de referência vencida não autoriza';
  begin
    insert into np_capilaridade_eventos(evento_id,acao,tipo,regiao,data_ref,etapa,quantidade,corpo,corpo_sha256,carimbo_assinatura)
      values(gen_random_uuid(),'status_lead','agregado_rede','SP-R1',v_dia,'certificados',10,'{}',repeat('a',64),null);
    raise exception 'Banco aceitou evento sem assinatura';
  exception when not_null_violation then null;
  end;
  assert (np_fn_digital_contexto(v_lead)->>'rca_certificado')::boolean=false, 'evento sem recibo de assinatura não autoriza';

  -- Certificação válida sintética; o contrato é o da ADR 0011.
  insert into np_capilaridade_eventos(evento_id,acao,tipo,regiao,data_ref,etapa,quantidade,corpo,corpo_sha256,carimbo_assinatura)
    values(v_evento,'status_lead','agregado_rede','SP-R1',v_dia,'certificados',1,'{}',repeat('a',64),now());
  v_result := np_fn_digital_contexto(v_lead);
  assert (v_result->>'rca_certificado')::boolean and (v_result->>'certificacao_evento_id')::uuid=v_evento, 'evento vigente vinculado';
  assert (v_result->>'reuniao_liberada')::boolean=(v_dia>=date '2026-12-07'), 'data R10 no servidor';

  -- O último agregado zero revoga a permissão, sem voltar ao positivo anterior.
  insert into np_capilaridade_eventos(evento_id,acao,tipo,regiao,data_ref,etapa,quantidade,corpo,corpo_sha256,carimbo_assinatura,recebido_em)
    values(gen_random_uuid(),'status_lead','agregado_rede','SP-R1',v_dia,'certificados',0,'{}',repeat('b',64),now(),now());
  assert (np_fn_digital_contexto(v_lead)->>'rca_certificado')::boolean=false, 'revogação prevalece';
  update np_digital_contextos set grupo='optante' where lead_id=v_lead;
  assert np_fn_digital_contexto(v_lead)->>'grupo'='optante', 'optante explícito preservado';
  update np_leads set lote_id=null where id=v_lead;
  assert (np_fn_digital_contexto(v_lead)->>'ok')::boolean=false, 'troca de lote invalida';
  update np_leads set lote_id=v_lote,uf='ES' where id=v_lead;
  assert (np_fn_digital_contexto(v_lead)->>'ok')::boolean=false, 'UF divergente invalida';
  update np_leads set uf=v_municipio.uf where id=v_lead;
  update np_digital_contextos set validado_em=now()-interval '2 hours',valido_ate=now()-interval '1 hour' where lead_id=v_lead;
  assert (np_fn_digital_contexto(v_lead)->>'ok')::boolean=false, 'contexto expirado bloqueia';
end;
$$;
select 'DIG-3.2: 19 asserções SQL OK; fixtures serão revertidas' as resultado;
