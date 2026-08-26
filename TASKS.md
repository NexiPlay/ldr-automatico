# LDR Automático — Tasks

Cronograma de execução. Detalhe técnico completo de cada item está em
`02 - LDR Automatico (IA + 3CX).html` (seção 10) e nos achados do research em
`.specify/assessments/ldr-automatico/research.md`.

## Setup — hoje, quarta 26/08 (concluído)

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
- [ ] Commit + push deste `TASKS.md` e do HTML atualizado

## D1 — quinta 27/08

- [ ] **Pedro** — Abrir a conta e a linha: plano Creator do ElevenLabs, contratar o tronco SIP e importar o número no painel
- [ ] **Igor** — Migração no banco: adicionar `validado_por_ia`, `validado_em`, `conversation_id` em `np_lead_telefones`
- [ ] **Igor** — Abrir validação jurídica (Anatel + LGPD) — ver research; **bloqueia o piloto do D5** se não estiver resolvido até lá

## D2 — sexta 28/08

- [ ] **Pedro** — Montar o agente: roteiro, voz em português, frase de abertura com `{{nome_lead}}`, encerramento automático, campo `e_a_empresa` na extração
- [ ] **Igor** — Endpoint do webhook: receber resultado da chamada, validar assinatura, gravar veredito no telefone certo

## D3 — segunda 31/08

- [ ] **Igor** — Orquestrador: puxar lead da fila, disparar uma chamada por número, controlar simultaneidade, marcar lead como liberado quando a lista esgotar
- [ ] **Pedro** — Teste de voz em números internos (velocidade, sotaque, tempo de espera) antes de tocar em lead real

## D4 — terça 01/09

- [ ] **Pedro** — Afinar o roteiro com o que os testes internos mostraram
- [ ] **Igor** — Repescagem dos "sem resposta": volta pra fila em outro horário, com limite de tentativas
- [ ] **Igor** — Checar se a validação jurídica do D1 foi concluída — condição para o piloto de amanhã

## D5 — quarta 02/09

- [ ] **Igor + Pedro** — Piloto real: 4 leads, ~20 números, ponta a ponta, acompanhado ao vivo

## D6 — quinta 03/09

- [ ] **Igor + Pedro** — Conferir os ~20 números no áudio (`conversation_id`) contra o veredito gravado — sai a taxa de acerto

## D7 — sexta 04/09

- [ ] **Igor** — Tela do SDR: esconder números descartados, destacar o confirmado
- [ ] **Igor + Pedro** — Fechar custo real vs. projeção da seção 11
- [ ] **Igor + Pedro** — Gate de go/no-go: ≥9/10 de acerto no veredito + custo dentro da projeção
