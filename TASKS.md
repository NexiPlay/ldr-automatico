# LDR Automático — Tasks

Cronograma de execução, Igor e Pedro juntos. Detalhe técnico completo de cada item está em
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
- [x] Mudança de arquitetura (26/08): tronco SIP próprio avulso → **integração nativa ElevenLabs + Twilio**, com número brasileiro alugado na conta Twilio (upgrade já feito). Atualizado no HTML (seções 02, 06, 09, 11), no `research.md` e no `intake.md`
- [x] Reunir as tasks do Pedro de volta neste arquivo (estavam separadas, voltaram a pedido do Igor)
- [x] Dashboard (1ª parte, adiantada do backlog): nova seção "LDR Automático" dentro de `frontend/telas/ldr-coordenador.html` (projeto `nexi-lead-360`, painel já existente do LDR humano) — KPIs + gráfico de tendência com **dados mockados** (`frontend/js/ldr-automatico-painel.js`, novo arquivo). Não commitado no repo do nexi-lead-360 ainda (tem outras mudanças locais em progresso lá, não mexidas)
- [ ] Commit + push deste `TASKS.md` e do HTML atualizado

## Tasks do Pedro (sem data fixa ainda)

- [ ] Finalizar as validações de identidade do número brasileiro na Twilio (Regulatory Bundle — etapas sequenciais, cada uma só libera a próxima depois de aprovada). **Bloqueia o piloto do D5** — vale começar o quanto antes
- [ ] Desenvolver o agente no ElevenLabs (roteiro, voz PT-BR, `{{nome_lead}}`, extração `e_a_empresa`) e analisar se é necessário pagar por assinaturas/planos adicionais
- [ ] Analisar as chamadas de API do ElevenLabs para as ligações e salvar os parâmetros relevantes no banco de dados
- [ ] Implementar a transcrição das chamadas para validação humana — insumo direto pra conferência de áudio do D6

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
- [ ] Checar se as tasks do Pedro (Twilio, agente, transcrição) estão prontas — condição para o piloto de amanhã

## D5 — quarta 02/09

- [ ] Piloto real (Igor + Pedro): 4 leads, ~20 números, ponta a ponta, acompanhado ao vivo

## D6 — quinta 03/09

- [ ] Conferir os ~20 números no áudio/transcrição (`conversation_id`) contra o veredito gravado — sai a taxa de acerto

## D7 — sexta 04/09

- [ ] Tela do SDR: esconder números descartados, destacar o confirmado
- [ ] Fechar custo real vs. projeção da seção 11 (Igor + Pedro)
- [ ] Gate de go/no-go: ≥9/10 de acerto no veredito + custo dentro da projeção

## Backlog — dashboard (parte 2, sem dia fixo ainda)

- [x] ~~Parte 1: seção "LDR Automático" na tela do painel do LDR, com dados mockados~~ — feita hoje, ver Setup
- [ ] **Trocar mock por dado real** assim que o Pedro tiver o banco salvando as chamadas: substituir
  `mockSerie()`/`mockResumo()` em `ldr-automatico-painel.js` por uma chamada real, no mesmo formato
  que `ldrPainelCoordenador`/`ldrPainelSerie` já usam pro LDR humano (ver `api-client.js` no
  nexi-lead-360), e remover o badge "dados de exemplo" do HTML
  quando isso acontecer.
- [ ] Decidir se cabe alguma métrica só do LDR Automático que não tem equivalente no painel humano
  (ex. custo em US$, breakdown por status Twilio/ElevenLabs) além do que já foi colocado (leads
  processados, números testados, válidos, taxa de acerto)
- [ ] Commit + push das mudanças em `frontend/telas/ldr-coordenador.html` e
  `frontend/js/ldr-automatico-painel.js` no repo `nexi-lead-360` (hoje só editei os arquivos no Drive,
  não commitei — esse repo tinha outras mudanças locais em progresso)
