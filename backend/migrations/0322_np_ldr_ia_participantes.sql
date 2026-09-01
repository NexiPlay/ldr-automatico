-- 0322_np_ldr_ia_participantes.sql
-- LDR Automático — quem recebe lead validado pelo robô (coordenador).
-- Tabela própria, separada de np_ldr_participantes (LDR Trilha Humana, migration 0288
-- daquele repo) de propósito — não mexe no `check (papel in ('sdr','coordenador'))` dele,
-- e evita que ligar o robô exponha leads pra todo coordenador já ativo no LDR humano.
-- Só existe o papel "coordenador" aqui (o robô faz o papel do SDR sozinho — não precisa
-- de linha própria pra isso).
--
-- "Regional não duplica aqui" — mesmo princípio da 0288: vem de np_agentes/
-- np_areas_atuacao_membros (já existentes), não é coluna nesta tabela.

create table if not exists public.np_ldr_ia_participantes (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references public.np_agentes(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (agente_id)
);

comment on table public.np_ldr_ia_participantes is
  'Quem recebe leads validados pelo LDR Automático (robô ElevenLabs) — coordenador que recebe o pool qualificado pelo robô. Separada de np_ldr_participantes (LDR Trilha Humana) de propósito. Regional vem de np_agentes/np_areas_atuacao_membros.';

alter table public.np_ldr_ia_participantes enable row level security;

create policy np_ldr_ia_participantes_select_authenticated
  on public.np_ldr_ia_participantes for select
  to authenticated
  using (true);

grant select on public.np_ldr_ia_participantes to authenticated;
grant all on public.np_ldr_ia_participantes to service_role;

-- Sem seed inicial de propósito (diferente da 0288, que já nasceu com Rafael/Nathan) —
-- ninguém deve receber lead do robô automaticamente até o Igor decidir quem entra no
-- piloto. Popular manualmente (painel próprio, a construir, ou insert direto) quando
-- houver alguém definido.
