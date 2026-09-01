-- 0321_seed_tag_validado_ldr_ia.sql
-- LDR Automático — tag própria pra lead com >=1 telefone confirmado pelo robô.
-- Separada de propósito da 'qualificacao:validado-ldr' do LDR Trilha Humana (migration
-- 0287 do repo ldr-trilha-humana) — mesma categoria, slug diferente. Se fossem a mesma
-- tag, todo coordenador ativo em np_ldr_participantes (humano) passaria a receber lead
-- validado pelo robô também, sem controle — não é o que o Igor quer agora (nem todo
-- mundo deve receber, ver np_ldr_ia_participantes na migration 0322).

insert into public.np_tags (slug, label, categoria, tipo, cor, ativo)
values ('qualificacao:validado-ldr-ia', 'Validado (LDR Automático)', 'qualificacao', 'sistema', '#22d3ee', true)
on conflict (slug) do nothing;
