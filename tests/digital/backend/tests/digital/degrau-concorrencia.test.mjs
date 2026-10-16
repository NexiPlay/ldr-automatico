import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {setup,capacity,uuid,origins} from './degrau-fixture.mjs';

test('DIG-2.4 PostgreSQL: teto compartilhado e validade após lock',
  {skip:!process.env.DIGITAL_TEST_POSTGRES_URL},async t=>{
    const admin=new pg.Pool({connectionString:process.env.DIGITAL_TEST_POSTGRES_URL,max:1});
    const name='dig24_test_'+crypto.randomUUID().replaceAll('-','');let pool;
    const closed=[],connectionIds=new Set();
    try {
      await admin.query(`create database ${name}`);
      const url=new URL(process.env.DIGITAL_TEST_POSTGRES_URL);url.pathname='/'+name;
      pool=new pg.Pool({connectionString:url.toString(),max:40});
      // Queries recusadas removem clientes do pool antes de terminar o socket.
      // Aguarda também esses clientes antes de remover o banco descartável.
      pool.on('connect',client=>{
        connectionIds.add(client.processID);
        closed.push(new Promise(resolve=>client.once('end',resolve)));
      });
      const f=await setup({exec:s=>pool.query(s),query:(s,a)=>pool.query(s,a)});
      await t.test('40 conexões, dois orçamentos e duas origens: só cinco reservas',async()=>{
        await f.define(5,capacity([3,3]));
        const results=await Promise.all(Array.from({length:40},async(_,i)=>{
          try{return await f.reserve(i+1);}catch(e){return {error:e.message};}
        }));
        assert.equal(connectionIds.size,40);
        assert.equal(results.filter(r=>r.permitido).length,5);
        assert.ok(results.filter(r=>r.error).every(r=>/teto diário|limite diário/.test(r.error)));
        assert.equal(+(await f.current()).usado_hoje,5);
        const perOrigin=await f.query('select origem,count(*) n from np_digital_gastos group by origem');
        assert.ok(perOrigin.every(r=>+r.n<=3));
        console.log(JSON.stringify({independent_connections:connectionIds.size,attempts:40,accepted:5,
          rejected:35,per_origin:perOrigin.map(r=>+r.n)}));
      });
      await t.test('aprovação vencida durante espera bloqueia sem gravar reserva',async()=>{
        // Histórico fictício de três dias permite aumentar o subteto do teste.
        await f.query("update np_digital_degraus set inicio_degrau=clock_timestamp()-interval '3 days' where valor_dia=5");
        await f.define(10,capacity([10,10]));
        const holder=await pool.connect(),waiter=await pool.connect();let pending;
        try {
          await holder.query('begin');await holder.query('select pg_advisory_xact_lock(240024,1)');
          const pid=(await waiter.query('select pg_backend_pid() pid')).rows[0].pid;
          const unused=(await f.query('select id,telefone from np_leads where id not in(select lead_id from np_digital_gastos) and id<$1 limit 1',[uuid(41)]))[0];
          pending=waiter.query('select np_fn_digital_gasto_reservar($1,$2,$3,$4,120,false,$5)',
            [uuid(9900),unused.id,unused.telefone,'ldr',origins[0]]).then(()=>({ok:true}),e=>({error:e.message}));
          let waiting=false;
          for(let i=0;i<100;i++) {
            waiting=(await pool.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting;
            if(waiting)break;
            await new Promise(resolve=>setTimeout(resolve,20));
          }
          assert.equal(waiting,true);
          await holder.query('update np_digital_degraus set valido_ate=clock_timestamp() where id=(select max(id) from np_digital_degraus)');
          await holder.query('commit');
          assert.match((await pending).error,/aprovação vencida/);
          assert.equal(+(await f.current()).usado_hoje,5);
        } finally {
          await holder.query('rollback');if(pending)await pending;holder.release();waiter.release();
        }
      });
    } finally {
      if(pool)await pool.end();
      await Promise.all(closed);
      await admin.query(`drop database if exists ${name}`);await admin.end();
    }
});
