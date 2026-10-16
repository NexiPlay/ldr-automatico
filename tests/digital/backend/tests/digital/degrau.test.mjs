import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup,capacity,uuid,phone,origins} from './degrau-fixture.mjs';
import {dispararComOrcamento} from '../../edge-functions/_shared/digital-gasto.ts';

async function fixture(t) {const db=new PGlite();t.after(()=>db.close());return {...await setup(db),db};}

test('DIG-2.4: instalação zero bloqueia reserva e POST; outros lotes preservados',async t=>{
  const f=await fixture(t);let sent=0;
  await assert.rejects(()=>f.reserve(1),/degrau zero/);
  await assert.rejects(()=>dispararComOrcamento(f.sb,{leadId:uuid(1),e164:phone(1),engine:'ldr',
    maxSegundos:120,origem:origins[0]}, {},async()=>{sent++;return new Response('{}');}));
  assert.equal(sent,0);assert.equal(+(await f.current()).usado_hoje,0);
  assert.deepEqual(await f.reserve(41),{digital:false,permitido:true});
  assert.deepEqual(await f.query('select * from sonar_fixture'),[{valor_dia:1000,resta:1000}]);
});

test('DIG-2.4: subida exige capacidade, Gate B, Gate C e teto Sonar',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>f.define(51),/salto/);
  await assert.rejects(()=>f.define(5,null),/capacidade comprovada/);
  await assert.rejects(()=>f.define(5,capacity(),''),/Gate C exige/);
  await assert.rejects(()=>f.define(5,{...capacity(),capacidade_canais_dia:4}),/excede capacidade/);
  await assert.rejects(()=>f.define(5,capacity([2,2])),/excede capacidade/);
  await assert.rejects(()=>f.define(5,{...capacity(),valido_ate:'2000-01-01T00:00:00Z'}),/24 horas/);
  await assert.rejects(()=>f.define(5,{...capacity(),valido_ate:'2099-01-01T00:00:00Z'}),/24 horas/);
  const duplicate=capacity();duplicate.origens[1]=duplicate.origens[0];
  await assert.rejects(()=>f.define(5,duplicate),/duplicadas/);
  const unknown=capacity();unknown.origens[0].origem='+551188880099';
  await assert.rejects(()=>f.define(5,unknown),/Gate B/);
  for(const sql of ['pausada=true','total=0','percentual=30','sem_duracao=1']) {
    await f.query('update reputacao_fixture set '+sql);
    await assert.rejects(()=>f.define(5),/Gate B/);
    await f.query('update reputacao_fixture set pausada=false,total=100,percentual=4,sem_duracao=0');
  }
  await f.query('update np_sonar_reputacao_origens set responsavel_id=null');
  await assert.rejects(()=>f.define(5),/Gate B/);
  await f.query('update np_sonar_reputacao_origens set responsavel_id=$1',[uuid(900)]);
  await f.query('update np_digital_orcamentos set ativo=false');
  await assert.rejects(()=>f.define(5),/Gate C recusado/);
  await f.query('update np_digital_orcamentos set ativo=true,teto_dia=1');
  await assert.rejects(()=>f.define(5),/Gate C recusado/);
  await f.query('update np_digital_orcamentos set teto_dia=100');
  await f.query('update sonar_fixture set valor_dia=0');
  await assert.rejects(()=>f.define(5),/degrau global/);
  assert.equal(+(await f.query('select count(*) n from np_digital_degraus'))[0].n,1);
});

test('DIG-2.4: fila/direto, LDR/SDR e dois orçamentos dividem o mesmo teto',async t=>{
  const f=await fixture(t);await f.define(3,capacity([2,2]));let sent=0;
  const send=n=>dispararComOrcamento(f.sb,{leadId:uuid(n),e164:phone(n),engine:n%2?'ldr':'sdr',
    maxSegundos:120,origem:origins[n%2]}, {},async()=>{sent++;return new Response(JSON.stringify({success:true,conversation_id:'conv-'+n}));});
  await send(1);await send(3);
  await assert.rejects(()=>send(5)); // mesma origem já atingiu duas
  await send(2);
  await assert.rejects(()=>send(4)); // outra origem tem folga, mas agregado atingiu três
  assert.equal(sent,3);assert.equal(+(await f.current()).usado_hoje,3);
  const rows=await f.query('select origem,degrau_id,engine,orcamento_id from np_digital_gastos');
  assert.equal(new Set(rows.map(r=>r.orcamento_id)).size,2);
  assert.equal(new Set(rows.map(r=>r.engine)).size,2);
  assert.ok(rows.every(r=>r.degrau_id));
  const receipt=(await f.query('select * from np_digital_degraus order by id desc limit 1'))[0];
  assert.equal(receipt.gate_b.length,2);assert.equal(receipt.gate_c.aprovado_por,'QA fixture');
});

test('DIG-2.4: origem ausente/fora do recibo e chamada antiga não contornam',async t=>{
  const f=await fixture(t);await f.define(3);
  await assert.rejects(()=>f.reserve(1,null),/origem real/);
  await assert.rejects(()=>f.reserve(1,'+551188880099'),/origem real/);
  await assert.rejects(()=>f.query('select np_fn_digital_gasto_reservar($1,$2,$3,$4,120,false)',
    [uuid(1001),uuid(1),phone(1),'ldr']),/origem real/);
  assert.equal(+(await f.current()).usado_hoje,0);
});

test('DIG-2.4: timeout e conciliação nunca devolvem capacidade',async t=>{
  const f=await fixture(t);await f.define(1);
  await assert.rejects(()=>dispararComOrcamento(f.sb,{leadId:uuid(1),e164:phone(1),engine:'ldr',maxSegundos:120,
    origem:origins[0]}, {},async()=>{throw Error('timeout');}),/timeout/);
  const attempt=(await f.query('select id from np_digital_gastos'))[0].id;
  await f.query("select np_fn_digital_gasto_registrar($1,'timeout-conv',true,0,0,'CDR fixture')",[attempt]);
  await assert.rejects(()=>f.reserve(2),/teto diário/);
  await assert.rejects(()=>f.query('delete from np_digital_gastos'),/imutável/);
  await assert.rejects(()=>f.query('update np_digital_gastos set dia=dia-1'),/imutável/);
  await assert.rejects(()=>f.query('update np_digital_gastos set origem=$1',[origins[1]]),/imutável/);
  assert.equal(+(await f.current()).usado_hoje,1);
});

test('DIG-2.4: redução, expiração e perda do Gate B bloqueiam novas chamadas',async t=>{
  const f=await fixture(t);await f.define(5);
  await f.query('update sonar_fixture set resta=0');
  await assert.rejects(()=>f.reserve(1),/global bloqueado/);
  await f.query('update sonar_fixture set resta=1000');
  await f.query('update reputacao_fixture set pausada=true');
  await assert.rejects(()=>f.reserve(1),/Gate B/);
  await f.query('update reputacao_fixture set pausada=false');
  await f.query("update np_digital_degraus set valido_ate=clock_timestamp()-interval '1 second' where valor_dia>0");
  await assert.rejects(()=>f.reserve(1),/aprovação vencida/);
  assert.equal(+(await f.current()).resta,0);
  await f.define(0,null,null);assert.equal((await f.current()).valor_dia,0);
});

test('DIG-2.4: renovação não reinicia permanência; salto/calendário não aprovam gates',async t=>{
  const f=await fixture(t);await f.define(5);
  await assert.rejects(()=>f.define(6),/3 dias/);
  await f.query("update np_digital_degraus set inicio_degrau=clock_timestamp()-interval '3 days' where valor_dia=5");
  const before=(await f.current()).desde;
  await f.define(5);assert.deepEqual((await f.current()).desde,before);
  await assert.rejects(()=>f.define(11),/salto/);
  await assert.rejects(()=>f.define(10,capacity(),''),/Gate C exige/);
  await f.define(10);assert.equal((await f.current()).valor_dia,10);
  await f.define(2,null,null);assert.equal((await f.current()).valor_dia,2);
});

test('DIG-2.4: acesso restrito e transação com snapshot antigo recusada',async t=>{
  const f=await fixture(t);
  for(const role of ['anon','authenticated']) {
    await f.query('set role '+role);
    await assert.rejects(()=>f.current(),/permission denied/);
    await assert.rejects(()=>f.define(0),/permission denied/);
    await f.query('reset role');
  }
  await f.query('set role service_role');
  await assert.rejects(()=>f.query("update np_digital_degraus set valor_dia=50"),/permission denied/);
  await f.define(0);await f.query('reset role');
  await f.query('begin isolation level repeatable read');
  await assert.rejects(()=>f.define(0),/READ COMMITTED/);await f.query('rollback');
});
