# LDR Automático — Tasks

Cronograma de execução, Igor e Pedro juntos. Detalhe técnico completo de cada item está em
`02 - LDR Automatico (IA + 3CX).html` (seção 10) e nos achados do research em
`.specify/assessments/ldr-automatico/research.md`.

## Atualização — segunda 31/08 (pivô de arquitetura: Twilio → 3CX)

Mudança de arquitetura passada pelo Pedro: **saiu a integração nativa ElevenLabs + Twilio, entrou
3CX (Tendência) como tronco de saída + integração ElevenLabs**. Motivo: custo — o número brasileiro
da Twilio (Regulatory Bundle + aluguel + tarifa por minuto) saía mais caro que reaproveitar o 3CX que
a empresa já opera. **Nota**: o upgrade de plano do 3CX que tinha sido mencionado antes **não tem
relação com este projeto** — foi feito por outro motivo, coincidência de timing.

Isso derruba o bloqueio de calendário que existia (Twilio Regulatory Bundle, "até 3 dias úteis,
podendo levar semanas") — não existe mais essa dependência externa de aprovação regulatória. Em
troca, o Pedro já configurou o lado do 3CX sozinho (tronco, script de chamada, regra de saída) e
validou com conta pessoal do ElevenLabs; falta fechar a conta/plano oficial da Nexi e integrar de
verdade com o "3CX Tendência".

**As datas fixas do plano D1-D7 abaixo (27/08-04/09) ficaram inválidas** — o pivô interrompeu o
cronograma no meio (hoje seria "D3" pela contagem antiga). Mantive a ORDEM das tasks do Igor (ainda
fazem sentido, são backend/webhook/orquestrador, não mudam com o provedor de telefonia), só tirei as
datas — recombinar quando o Pedro estiver mais perto do fim da lista dele.

**Datas do Pedro combinadas em 31/08**: passo 5 (definir conta/plano) fecha **hoje**; passos 6 a 11
(config ElevenLabs Nexi + 3CX, agente, testes internos, teste de API, integração com o dashboard e
produção) ficam pra **amanhã, terça 01/09**. É um dia bem cheio pra 6 passos incluindo produção — vale
confirmar com o Pedro se "amanhã" é a meta otimista ou se dá pra escalonar, antes de tratar como
compromisso fechado.

## Tasks do Pedro — passadas por ele em 31/08 (substitui a lista antiga)

Datas combinadas em 31/08: passo 5 fecha **hoje**, passos 6-11 ficam pra **amanhã, terça 01/09**.

1. [x] Configurar tronco no 3CX
2. [x] Configurar Script de Chamadas 3CX
3. [x] Configurar Regra de saída 3CX
4. [x] Integrar com o ElevenLabs pessoal para primeiros testes
5. [ ] **Hoje, segunda 31/08** — Definir conta da Nexi do ElevenLabs e escolher o plano
6. [ ] **Amanhã, terça 01/09** — Configurar ElevenLabs Nexi com 3CX Tendência
7. [ ] **Amanhã, terça 01/09** — Desenvolver agente no ElevenLabs Nexi
8. [ ] **Amanhã, terça 01/09** — Teste para números internos
9. [ ] **Amanhã, terça 01/09** — Testar API
10. [ ] **Amanhã, terça 01/09** — **Integrar API com dashboard do Igor** (ver seção do dashboard mais
    abaixo — é o ponto de encontro com o trabalho que já foi adiantado no `nexi-lead-360`)
11. [ ] **Amanhã, terça 01/09** — Produção

Passos 6-9 (config ElevenLabs Nexi + 3CX Tendência, agente, testes internos, teste de API)
**bloqueiam** o D1/D2 do Igor abaixo — não dá pra escrever webhook/orquestrador contra uma API que
ainda não está batendo em nada real.

## Setup — quarta 26/08 (concluído)

- [x] Levantar o material de planejamento existente (proposta "Sala do LDR" + revisão 2 do "LDR Automático") e confirmar o que já está fechado
- [x] Separar o material da "Sala do LDR" para fora deste repo (projeto de outro dev, `Nexiplay/Sala do LDR/`)
- [x] Criar repositório GitHub privado `NexiPlay/ldr-automatico`
- [x] Instalar GitHub CLI (`gh`) e `uv`
- [x] Corrigir autenticação/permissão do GitHub (conta certa: `igorvisla`, com write access)
- [x] Commit + push do material de planejamento (HTML da revisão 2 + resumo de decisões)
- [x] Instalar o spec-kit (`specify-cli`) neste repo, integração Claude Code + extensão `assess`
- [x] Rodar `/speckit-assess-intake` (slug=`ldr-automatico`)
- [x] Rodar `/speckit-assess-research` (slug=`ldr-automatico`) — achados: risco LGPD (voz é dado biométrico, gravação/transcrição exige consentimento) não previsto no plano original; zona cinzenta sobre chamada de verificação vs. telemarketing na regra da Anatel; tentativa anterior não documentada de IA de voz (Nexi SDR/Infobip)
- [x] Atualizar seção 10 do HTML (datas reais D1-D7 + task nova de validação jurídica)
- [x] Mudança de arquitetura (26/08): tronco SIP próprio avulso → integração nativa ElevenLabs + Twilio, com número brasileiro alugado na conta Twilio — **revertida em 31/08, ver acima**
- [x] Reunir as tasks do Pedro de volta neste arquivo (estavam separadas, voltaram a pedido do Igor)
- [x] Dashboard (1ª parte, adiantada do backlog): nova seção "LDR Automático" dentro de `frontend/telas/ldr-coordenador.html` (projeto `nexi-lead-360`, painel já existente do LDR humano) — KPIs + gráfico de tendência com **dados mockados** (`frontend/js/ldr-automatico-painel.js`, novo arquivo). Não commitado no repo do nexi-lead-360 ainda (tem outras mudanças locais em progresso lá, não mexidas)
- [x] Commit + push deste `TASKS.md` e do HTML atualizado (revisão 3, Twilio)

## Igor — passo 1 (sem data fixa, depende do Pedro fechar os passos 6-9)

- [x] Migração no banco: **desenhada e aplicada no banco real** (01/09, via `supabase db query -f`,
  Management API — não precisou de senha de Postgres). Conferido ANTES de rodar que nenhum dos 4
  objetos novos já existia (zero conflito) e que os objetos do Guilherme (`np_ldr_participantes`,
  `np_fn_pool_reposicao`) seguem intactos; conferido DEPOIS que as 4 migrations realmente criaram
  tudo. Tudo separado da infra do LDR Trilha Humana (Guilherme) — colunas próprias em
  `np_lead_telefones` (`ia_conversation_id`, `ia_testado_em`, `ia_resultado`), tag própria
  (`qualificacao:validado-ldr-ia`), roster próprio (`np_ldr_ia_participantes`), RPC própria pro
  coordenador puxar leads (`np_fn_ldr_ia_obter_leads` — não mexe em `np_fn_pool_reposicao`).
  Confirmado por teste de fumaça (payload assinado real contra o webhook) que a cadeia toda
  funciona agora — antes dava 500 (coluna não existia), agora responde 200. **Falta**: (a)
  botão/tela pro coordenador chamar essa RPC — ela é separada do "Obter novos leads" de sempre,
  não aparece em lugar nenhum ainda; (b) povoar `np_ldr_ia_participantes` com quem vai receber
  lead do robô no piloto (nasce vazio de propósito) — **decisão marcada pro Igor tomar em 01/09,
  ainda não fechada**.
- [x] Abrir validação jurídica (Anatel + LGPD) — **validada pelo Igor em 01/09: tudo certo, a v1
  não chega perto de zona de bloqueio.** Deixa de bloquear o piloto.

## Igor — passo 2

- [x] Endpoint do webhook: **escrito e deployado** (01/09) —
  `backend/edge-functions/ldr-automatico-webhook/index.ts` deste repo, deploy feito via
  `supabase functions deploy` (`--use-api`, sem depender de Docker local), URL ativa:
  `https://wbagoinuxgvntvbbnmab.supabase.co/functions/v1/ldr-automatico-webhook`. Recebe
  `post_call_transcription` do ElevenLabs, verifica a assinatura HMAC (header
  `ElevenLabs-Signature`), acha o telefone pelo `conversation_id` (coluna `ia_conversation_id`,
  migration 0320), grava `ia_resultado`/`ia_testado_em` e aplica a tag `qualificacao:validado-ldr-ia`
  quando o veredito é `confirmado`. Secrets `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` já existiam no
  projeto (compartilhados com as outras functions); `ELEVENLABS_WEBHOOK_SECRET` cadastrado em 01/09
  (o Pedro já configurou a URL no painel do ElevenLabs). **Webhook 100% ativo e testado ponta a
  ponta** (01/09): o Pedro fez uma ligação de teste de verdade, o ElevenLabs mandou o webhook, a
  assinatura bateu — só faltava a migration 0320 (coluna não existia ainda, deu 500). Migrations
  aplicadas no mesmo dia (ver passo 1) e confirmado por um segundo teste (payload assinado
  sintético) que a cadeia completa responde 200. **Falta**: sem o orquestrador (passo 3) o webhook
  ainda não acha telefone pra nenhum `conversation_id` real — comportamento esperado até aquela
  peça existir, é o próximo bloqueio real do pipeline. Detalhe completo em
  `backend/edge-functions/README.md`.

## Igor — passo 3

- [x] Orquestrador: **escrito, deployado e testado** (01/09) —
  `backend/edge-functions/ldr-automatico-orquestrador/index.ts` deste repo. Decisão do Igor:
  **não** puxa lead de um pool automático — recebe `{ telefone_ids: [...] }` explícito (botão manual no
  dashboard, escopo do piloto é 4 leads/~20 números escolhidos a dedo, não disparo em massa). Pra
  cada telefone: busca o lead (nome pro `dynamic_variables.empresa`), dispara
  `POST /v1/convai/sip-trunk/outbound-call` (shape exato passado pelo Pedro em 01/09 — `agent_id`/
  `agent_phone_number_id` fixos, `to_number` sempre com `+55` como já vem em `np_lead_telefones.e164`),
  espera 4s entre ligações (trunco não aguenta rajada), grava `conversation_id` em
  `ia_conversation_id`. Pula telefone que já tem `ia_conversation_id` (nunca liga 2x pro mesmo
  número por clique duplicado). Trava de segurança: máximo 50 telefones por lote. Function com
  **JWT exigido** (diferente do webhook) — só usuário logado no dashboard dispara. Secrets
  cadastrados: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID`.
  Testado com id falso autenticado — confirma auth + lógica sem discar de verdade. **V1 do popup
  construída (01/09)**: `nexi-lead-360/frontend/js/ldr-automatico-disparo.js` (arquivo novo,
  isolado — não toca em `ldr-coordenador.html`/`.js` além de 1 linha de `<script>`). Injeta botão +
  popup no Painel do LDR (nome da empresa + telefone); ao disparar, cria um `np_leads` de teste
  (prefixo `[TESTE LDR-IA]`, `origem='ldr-automatico-teste'`) + `np_lead_telefones`, e só então
  chama o orquestrador — assim a chamada vira dado real rastreável (resolve o
  "telefone_nao_encontrado" do teste de ontem, que foi feito fora desse fluxo). Inserts validados
  por dry-run direto no banco (transação com rollback, sem erro de coluna/constraint). **Falta**:
  teste de verdade no navegador (não testável nesta sessão) — Igor/Pedro precisam clicar de fato;
  depois evolui pra fila/lote de até ~20 números de uma vez (o endpoint já aceita array, só falta a
  UI de multi-seleção).

## Igor — passo 4

- [ ] Repescagem dos "sem resposta": volta pra fila em outro horário, com limite de tentativas
- [x] Checar se a validação jurídica foi concluída — condição para o piloto. **Validada pelo Igor
  em 01/09: Anatel/LGPD ok, a v1 não chega perto de zona de risco.** Deixa de ser bloqueio.
- [x] Checar se os passos 6-9 do Pedro (3CX Tendência + ElevenLabs Nexi + agente + testes) estão
  prontos — condição para o piloto. **Confirmado pelo Igor em 01/09: integração ElevenLabs+3CX via
  API está tudo certa** (bate com o teste real do Pedro no mesmo dia, ver passo 2/3 acima).

## Igor + Pedro — piloto

- [ ] Piloto real: 4 leads, ~20 números, ponta a ponta, acompanhado ao vivo

## Igor + Pedro — conferência

- [ ] Conferir os ~20 números no áudio/transcrição (`conversation_id`) contra o veredito gravado — sai a taxa de acerto

## Igor + Pedro — fechamento

- [ ] Tela do SDR: esconder números descartados, destacar o confirmado
- [x] Fechar custo real vs. projeção da seção 11 — **confirmado pelo Igor em 01/09: US$ 11 no
  primeiro mês, US$ 22/mês a partir do segundo** (plano ElevenLabs da conta Nexi). Falta só refletir
  isso no HTML (seção 11), que ainda tem a projeção antiga.
- [ ] Gate de go/no-go: ≥9/10 de acerto no veredito + custo dentro da projeção

## Backlog — dashboard (parte 2, sem dia fixo ainda)

- [x] ~~Parte 1: seção "LDR Automático" na tela do painel do LDR, com dados mockados~~ — feita em 26/08, ver Setup
- [x] **Trocar mock por dado real** — feito 02/09. Nova SQL function
  `np_fn_ldr_ia_painel_serie(p_dias)` (migration 0324, aplicada no banco real) conta todo telefone
  testado (`ia_testado_em not null`) por dia, mesmo shape de campos que o mock já usava. `nexi-
  lead-360/frontend/js/ldr-automatico-painel.js` reescrito pra buscar via RPC em background e
  cachear — `.serie()`/`.resumo()` continuam **síncronos** (mesma interface, `ldr-coordenador.js`
  do Guilherme não precisou mudar), com o gerador mock antigo como fallback só até o cache
  carregar. `taxa_acerto_pct` virou sinal real (`validos/testados`) em vez da simulação de
  conferência de áudio antiga; `custo_usd_periodo` segue estimativa (não há billing real por
  minuto ainda, só o plano mensal US$11/US$22). Testado com os números reais do popup de disparo
  (14 testados, 3 confirmados, 11 sem resposta no dia). **Falta**: remover o badge "dados de
  exemplo" do HTML (`ldr-coordenador.html`, arquivo entrelaçado — fora de escopo por ora).
- [ ] Decidir se cabe alguma métrica só do LDR Automático que não tem equivalente no painel humano
  (ex. custo em US$, breakdown por status 3CX/ElevenLabs) além do que já foi colocado (leads
  processados, números testados, válidos, taxa de acerto)
- [x] Commit + push parcial (01/09) — `frontend/js/shell.js` e `frontend/js/ldr-automatico-painel.js`
  commitados e pushados pra `origin/refactor/sala-comando` no repo `nexi-lead-360` (branch já
  existente, 6 commits à frente de `origin/main`, main intocada). **Ficaram de fora de propósito**:
  `frontend/telas/ldr-coordenador.html`, `frontend/js/ldr-coordenador.js`, `frontend/js/sala-comando.js`
  e `frontend/css/sala-comando.css` — conferi o diff de cada um e estão com trabalho **não commitado
  de outras pessoas** misturado (feature "Aprovações" do Fernando; cruzamento "ESTOQUE × LDR" do
  Guilherme, literalmente datado de 01/09; e o próprio Painel do LDR do Guilherme em
  `ldr-coordenador.html`/`.js`). Commitar esses arquivos publicaria o trabalho deles sem review —
  precisa alinhar antes de soltar.
