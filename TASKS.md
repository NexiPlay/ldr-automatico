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

- [x] Migração no banco: **desenhada** (não aplicada ainda — sem credencial de escrita nesta
  sessão) em `backend/migrations/` deste repo, 0320-0323. Tudo separado da infra do LDR
  Trilha Humana (Guilherme) — colunas próprias em `np_lead_telefones` (`ia_conversation_id`,
  `ia_testado_em`, `ia_resultado`), tag própria (`qualificacao:validado-ldr-ia`), roster
  próprio (`np_ldr_ia_participantes`), RPC própria pro coordenador puxar leads
  (`np_fn_ldr_ia_obter_leads` — não mexe em `np_fn_pool_reposicao`, a função compartilhada
  do Guilherme). **Falta**: (a) aplicar de verdade contra o banco — confirmar antes que
  0320+ ainda está livre, os repos `nexi-lead-360`/`ldr-trilha-humana` já colidiram de
  número uma vez (0300-0302); (b) botão/tela pro coordenador chamar essa RPC — ela é
  separada do "Obter novos leads" de sempre, não aparece em lugar nenhum ainda; (c) povoar
  `np_ldr_ia_participantes` com quem vai receber lead do robô no piloto (nasce vazio de
  propósito).
- [ ] Abrir validação jurídica (Anatel + LGPD) — ver research; continua bloqueando o piloto, independente do provedor de telefonia

## Igor — passo 2

- [x] Endpoint do webhook: **escrito** (não deployado ainda) em
  `backend/edge-functions/ldr-automatico-webhook/index.ts` deste repo — recebe
  `post_call_transcription` do ElevenLabs, verifica a assinatura HMAC (header
  `ElevenLabs-Signature`, segredo próprio `ELEVENLABS_WEBHOOK_SECRET`, **não** é a API key), acha o
  telefone pelo `conversation_id` (coluna `ia_conversation_id`, migration 0320), grava
  `ia_resultado`/`ia_testado_em` e aplica a tag `qualificacao:validado-ldr-ia` quando o veredito é
  `confirmado`. **Falta**: (a) deploy (`supabase functions deploy ldr-automatico-webhook`) + cadastrar
  os secrets no Supabase; (b) Pedro cadastrar a URL no painel do ElevenLabs e colar o
  `ELEVENLABS_WEBHOOK_SECRET` gerado; (c) migrations 0320-0323 aplicadas no banco de verdade (pré-requisito,
  ver passo 1); (d) sem o orquestrador (passo 3) este webhook não acha telefone pra nenhum
  `conversation_id` — comportamento esperado até aquela peça existir. Detalhe completo em
  `backend/edge-functions/README.md`.

## Igor — passo 3

- [ ] Orquestrador: puxar lead da fila, disparar uma chamada por número, controlar simultaneidade, marcar lead como liberado quando a lista esgotar

## Igor — passo 4

- [ ] Repescagem dos "sem resposta": volta pra fila em outro horário, com limite de tentativas
- [ ] Checar se a validação jurídica foi concluída — condição para o piloto
- [ ] Checar se os passos 6-9 do Pedro (3CX Tendência + ElevenLabs Nexi + agente + testes) estão prontos — condição para o piloto

## Igor + Pedro — piloto

- [ ] Piloto real: 4 leads, ~20 números, ponta a ponta, acompanhado ao vivo

## Igor + Pedro — conferência

- [ ] Conferir os ~20 números no áudio/transcrição (`conversation_id`) contra o veredito gravado — sai a taxa de acerto

## Igor + Pedro — fechamento

- [ ] Tela do SDR: esconder números descartados, destacar o confirmado
- [ ] Fechar custo real vs. projeção da seção 11 (número da Twilio sai da conta; custo do 3CX em si — a confirmar se é incremental ou já coberto pela infra existente)
- [ ] Gate de go/no-go: ≥9/10 de acerto no veredito + custo dentro da projeção

## Backlog — dashboard (parte 2, sem dia fixo ainda)

- [x] ~~Parte 1: seção "LDR Automático" na tela do painel do LDR, com dados mockados~~ — feita em 26/08, ver Setup
- [ ] **Trocar mock por dado real** assim que o Pedro tiver o banco salvando as chamadas (passo 10 da
  lista dele, "Integrar API com dashboard do Igor"): substituir `mockSerie()`/`mockResumo()` em
  `ldr-automatico-painel.js` por uma chamada real, no mesmo formato que `ldrPainelCoordenador`/
  `ldrPainelSerie` já usam pro LDR humano (ver `api-client.js` no nexi-lead-360), e remover o badge
  "dados de exemplo" do HTML quando isso acontecer.
- [ ] Decidir se cabe alguma métrica só do LDR Automático que não tem equivalente no painel humano
  (ex. custo em US$, breakdown por status 3CX/ElevenLabs) além do que já foi colocado (leads
  processados, números testados, válidos, taxa de acerto)
- [ ] Commit + push das mudanças em `frontend/telas/ldr-coordenador.html`,
  `frontend/js/ldr-automatico-painel.js`, `frontend/js/shell.js` e `frontend/js/sala-comando.js` no
  repo `nexi-lead-360` (por enquanto só editei os arquivos no Drive, não commitei — combinar com o
  Igor antes, esse repo tinha outras mudanças locais em progresso e o `ldr-coordenador.js` é do
  Guilherme)
