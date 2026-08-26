# LDR Automático — Tasks (Igor)

Cronograma de execução, só o lado do Igor — o Pedro cuida das próprias tasks (ElevenLabs, roteiro do
agente, tronco SIP) separadamente. Detalhe técnico completo de cada item está em
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

- [ ] Migração no banco: adicionar `validado_por_ia`, `validado_em`, `conversation_id` em `np_lead_telefones`
- [ ] Abrir validação jurídica (Anatel + LGPD) — ver research; **bloqueia o piloto do D5** se não estiver resolvido até lá

## D2 — sexta 28/08

- [ ] Endpoint do webhook: receber resultado da chamada, validar assinatura, gravar veredito no telefone certo

## D3 — segunda 31/08

- [ ] Orquestrador: puxar lead da fila, disparar uma chamada por número, controlar simultaneidade, marcar lead como liberado quando a lista esgotar

## D4 — terça 01/09

- [ ] Repescagem dos "sem resposta": volta pra fila em outro horário, com limite de tentativas
- [ ] Checar se a validação jurídica do D1 foi concluída — condição para o piloto de amanhã

## D5 — quarta 02/09

- [ ] Piloto real (com o Pedro): 4 leads, ~20 números, ponta a ponta, acompanhado ao vivo

## D6 — quinta 03/09

- [ ] Conferir os ~20 números no áudio (`conversation_id`) contra o veredito gravado — sai a taxa de acerto

## D7 — sexta 04/09

- [ ] Tela do SDR: esconder números descartados, destacar o confirmado
- [ ] Fechar custo real vs. projeção da seção 11
- [ ] Gate de go/no-go: ≥9/10 de acerto no veredito + custo dentro da projeção

## Backlog — depois do go/no-go (sem dia fixo ainda)

- [ ] **Dashboard comparativo LDR Automático vs. LDR manual (humano)**: métricas lado a lado dos dois
  fluxos de validação de telefone — ex. taxa de acerto do veredito, custo por lead/número testado,
  tempo até liberar pro SDR, volume processado. Depende de dados reais dos dois lados: o piloto do
  LDR Automático (D5-D6) e a implementação da "Sala do LDR" (LDR humano, projeto do outro dev, ainda
  não implementado). Escopo (quais métricas exatas, onde vive o dashboard) ainda por definir.
