# Migrations — LDR Automático

Estas migrations aplicam no MESMO banco Supabase do `nexi-lead-360` (é o banco único do
projeto — `ldr-trilha-humana` também aplica migrations nele, ver `06-tarefas-piloto.md`
daquele repo). **Aplicadas no banco real em 01/09/2026**, via
`supabase db query -f <arquivo> --linked --project-ref wbagoinuxgvntvbbnmab` (Management API,
sem precisar de senha de Postgres). Antes de rodar, conferimos contra o estado real do banco
que nenhum dos 4 objetos novos existia e que os objetos do Guilherme (`np_ldr_participantes`,
`np_fn_pool_reposicao`) seguiam intactos; depois de rodar, confirmamos os 4 criados e um teste
de fumaça (payload assinado real) confirmou o webhook respondendo 200 (antes dava 500 por
`ia_conversation_id` não existir).

## Numeração — cuidado real, não é só formalidade

`nexi-lead-360/backend/migrations/` está em 0315. `ldr-trilha-humana/backend/migrations/`
está em 0302, mas usando uma faixa (0286-0302) que `nexi-lead-360` pulou de propósito — os
dois repos SE DESENCONTRARAM a partir de 0300: `nexi-lead-360` tem um `0300_np_karla_analises_superseded_by.sql`
e `ldr-trilha-humana` tem um `0300_np_ldr_reports.sql` — **mesmo número, arquivos
diferentes**. Ou seja, a convenção de "sequência global única" já quebrou entre esses dois
repos antes deste aqui existir.

Comecei a numerar daqui em **0320** (acima do maior número visto nos dois repos, 0315), com
folga de propósito. **Antes de aplicar qualquer uma destas migrations**, confirme contra o
estado REAL do banco (não só os arquivos dos repos, que já provaram divergir) que 0320+
ainda está livre.

## O que cada uma faz (tudo separado da infra do LDR Trilha Humana — Guilherme)

- `0320_np_lead_telefones_ldr_ia.sql` — colunas do robô em `np_lead_telefones` (tabela
  compartilhada, mas colunas próprias — não toca `ldr_testado_por`/`ldr_testado_em`/
  `ldr_resultado`, que são do Guilherme).
- `0321_seed_tag_validado_ldr_ia.sql` — tag nova `qualificacao:validado-ldr-ia`, separada da
  `qualificacao:validado-ldr` do humano.
- `0322_np_ldr_ia_participantes.sql` — tabela de roster própria (quem recebe lead validado
  pelo robô), separada da `np_ldr_participantes` do Guilherme — não mexe no `check` de papel
  dele.
- `0323_np_fn_ldr_ia_obter_leads.sql` — função de pull própria pro coordenador buscar leads
  validados pelo robô. **Não mexe em `np_fn_pool_reposicao`** (a função compartilhada por
  ~32 agentes que o Guilherme mantém) — é uma RPC nova e isolada. Isso significa que o
  coordenador vai precisar de um botão/ação separado pra puxar esses leads (não cai
  automaticamente no botão "Obter novos leads" de sempre).
