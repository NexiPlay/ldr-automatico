import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('contexto Digital: contrato SQL, permissões, lote, território, certificação e validade', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table np_lotes(id uuid primary key,codigo text,nome text,origem text,uf text,dist_codigo int);
      create table np_leads(id uuid primary key,lote_id uuid,cnpj text not null,razao_social text,origem text,uf text,dist_codigo int);
      create table np_municipio_regiao(codigo_ibge text primary key,cod_regiao text,regiao text,uf text,dist int);
      insert into np_municipio_regiao values('3518800','SP-R1','Grande Guarulhos','SP',391);
      create table np_capilaridade_eventos(id bigint generated always as identity primary key,evento_id uuid unique,
        acao text,tipo text,regiao text,data_ref date,etapa text,quantidade int,corpo jsonb,corpo_sha256 text,
        carimbo_assinatura timestamptz not null,recebido_em timestamptz default now());
      create view vw_np_capilaridade_agregados_vigentes as
        select distinct on(tipo,data_ref,regiao,etapa) tipo,data_ref,regiao,etapa,quantidade,evento_id,recebido_em
        from np_capilaridade_eventos where tipo in ('agregado_relacionamento','agregado_rede')
        order by tipo,data_ref,regiao,etapa,recebido_em desc,id desc;`);
    await db.exec(await readFile(new URL('../../migrations/0458_dig32_contexto_servidor.sql',import.meta.url),'utf8'));
    await db.exec('begin');
    await db.exec(await readFile(new URL('../sql/test_0458_digital_contexto.sql',import.meta.url),'utf8'));
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as n from np_leads')).rows[0].n,0);
  } finally { await db.close(); }
});
