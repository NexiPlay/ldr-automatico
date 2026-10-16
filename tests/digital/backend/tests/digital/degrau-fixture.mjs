import {readFile} from 'node:fs/promises';

export const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const phone=n=>`+55119999${String(n).padStart(5,'0')}`;
export const origins=['+551188880001','+552788880001'];
export function capacity(limits=[50,50]) {
  return {capacidade_canais_dia:100,fonte_capacidade:'FIXTURE: capacidade homologada fictícia',
    valido_ate:new Date(Date.now()+3600000).toISOString(),
    origens:origins.map((origem,i)=>({origem,limite_dia:limits[i],fonte_aquecimento:'FIXTURE: medição fictícia'}))};
}
export async function setup(db) {
  await db.exec(`do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
    create table np_leads(id uuid primary key,telefone text,origem text);
    create table np_lead_telefones(id uuid primary key,lead_id uuid,e164 text);
    create table np_tags(id uuid primary key,slug text);
    create table np_lead_tags(lead_id uuid,tag_id uuid);
    create table np_sonar_reputacao_origens(origem text primary key,responsavel_id uuid);
    -- Só as medições e o degrau global são fixtures; migrations/RPC/adapter Digital são reais.
    create table reputacao_fixture(origem text primary key,pausada boolean,total integer,
      percentual numeric,sem_duracao integer);
    create view vw_np_sonar_reputacao as select * from reputacao_fixture;
    create table sonar_fixture(valor_dia integer,resta integer);
    insert into sonar_fixture values(1000,1000);
    create function np_fn_sonar_degrau_atual() returns table(valor_dia integer,resta integer)
      language sql as $$ select * from sonar_fixture $$;`);
  for(const name of ['0450_dig25_teto_financeiro.sql','0452_dig25_instante_apos_lock.sql',
    '20261016180000_dig25_fonte_cdr.sql','20261016200000_dig24_degraus.sql']) {
    await db.exec(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
  }
  for(let i=0;i<2;i++) {
    await db.query('insert into np_sonar_reputacao_origens values($1,$2)',[origins[i],uuid(900)]);
    await db.query('insert into reputacao_fixture values($1,false,100,4,0)',[origins[i]]);
    await db.query(`insert into np_digital_orcamentos(id,nome,inicio,fim,teto_dia,teto_campanha,
      voz_reserva_minuto,telefonia_reserva_minuto,telefonia_reserva_conexao,fonte_tarifas,aprovado_por,ativo)
      values($1,'fixture',now()-interval '1 day',now()+interval '1 day',100,100,.1,.15,0,'fixture','fixture',true)`,[uuid(100+i)]);
  }
  for(let n=1;n<=41;n++) {
    await db.query("insert into np_leads values($1,$2,'test')",[uuid(n),phone(n)]);
    if(n<=40) await db.query("insert into np_digital_orcamento_leads values($1,$2,'fixture',now())",[uuid(n),uuid(100+n%2)]);
  }
  const query=async(s,a=[])=>(await db.query(s,a)).rows;
  const define=async(value,cap=capacity(),approver='QA fixture')=>(await query(
    "select to_jsonb(np_fn_digital_degrau_definir($1,'fixture','fixture',$2,$3::jsonb)) r",
    [value,approver,cap===null?null:JSON.stringify(cap)]))[0].r;
  const reserve=async(n,origin=origins[n%2],engine=n%2?'ldr':'sdr')=>(await query(
    'select np_fn_digital_gasto_reservar($1,$2,$3,$4,120,false,$5) r',
    [uuid(1000+n),uuid(n),phone(n),engine,origin]))[0].r;
  const current=async()=>(await query('select * from np_fn_digital_degrau_atual()'))[0];
  const sb={async rpc(name,a) {
    try {
      if(name==='np_fn_digital_gasto_reservar') return {data:(await query(
        'select np_fn_digital_gasto_reservar($1,$2,$3,$4,$5,$6,$7) r',
        [a.p_tentativa,a.p_lead,a.p_e164,a.p_engine,a.p_max_segundos,a.p_exigir_digital,a.p_origem??null]))[0].r,error:null};
      if(name==='np_fn_digital_gasto_registrar') return {data:(await query(
        'select np_fn_digital_gasto_registrar($1,$2) r',[a.p_tentativa,a.p_conversation]))[0].r,error:null};
      throw Error('RPC inesperada: '+name);
    } catch(error) {return {data:null,error};}
  }};
  return {query,define,reserve,current,sb};
}
