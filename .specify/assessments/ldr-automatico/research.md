# Idea Research: LDR Automático — validação de telefone de leads por IA de voz

- **Slug**: ldr-automatico
- **Created**: 2026-08-26
- **Evidence confidence (overall)**: medium

## Users & Demand

- SDRs hoje recebem leads com listas de telefone brutas e descartam números errados na mão — a proposta irmã "Sala do LDR" (13-14/08/2026) já documentou essa dor e propôs um validador humano para o mesmo problema, o que indica que a necessidade já foi reconhecida internamente antes de se cogitar IA. — [source: internal — Nexi Lead 360, proposta "Sala do LDR"] (confidence: medium; ASSUMPTION quanto ao volume de tempo perdido — nenhum dado de ticket/tempo médio por SDR foi citado nos materiais disponíveis)
- Volume real medido: em média **1,8 telefone por lead** (mediana 1) entre leads efetivamente distribuídos aos agentes nos últimos 30 dias antes de 20/08/2026 — corrige a estimativa inicial de 6 números/lead que o primeiro rascunho do plano usava. — [source: medição direta em `np_reposicao_execucoes` × `np_lead_telefones`, citada no artefato "LDR Automático" revisão 2] (confidence: high; cited)

## Prior Art

- **"Sala do LDR" (interna, 13-14/08/2026)** — mesma dor, resolvida com um validador **humano** que para no primeiro telefone confirmado. Está em desenvolvimento paralelo, com outro desenvolvedor, em repositório próprio — não foi mesclada nem descartada. — [source: internal — Nexi Lead 360, repo local `Sala do LDR/`]
- **"Nexi SDR" (interna, sistema diferente)** — já existe uma tentativa anterior de ligação por IA na empresa, via **Infobip** (não ElevenLabs, não 3CX). Registrada como não reaproveitável sem adaptação e, na última verificação, sem credenciais configuradas — ou seja, uma iniciativa de IA de voz já foi tentada e não chegou a produção. — [source: internal — resumo "03 - Resumo e decisoes.md" deste repositório] (confidence: medium — não há registro do motivo exato de não ter avançado)
- **ElevenLabs "AI SDR" (externa, material do próprio fornecedor)** — case interno do fornecedor relata 78% das decisões de qualificação sem intervenção humana, com os 22% restantes majoritariamente "falsos positivos" (qualifica lead que deveria ser desqualificado), rodando em 38 países. É prova de que o padrão "agente de voz liga e qualifica" é operacional em produção — mas é material de marketing do próprio vendor, não uma auditoria independente, e mede *qualificação* (mais complexo que a pergunta fechada sim/não do LDR Automático). — [source: elevenlabs.io/blog/how-we-scaled-inbound-sales] (confidence: medium; cited, fonte interessada)

## Market & Context

- Alternativa que já existe no mercado e não foi escolhida: serviços de **validação de número** (ex. Twilio Lookup e similares) confirmam se um número é válido/ativo e o tipo de linha, mas não conseguem confirmar semanticamente "esta é a empresa X" — não substituem a pergunta feita pelo robô, só reduziriam a lista antes de ligar. Não há registro de que essa camada extra foi avaliada nos materiais existentes. — [ASSUMPTION — não citado nos artefatos, é uma lacuna de comparação] (confidence: low)
- Custo de não fazer nada: continua como hoje — SDR ligando manualmente pelo 3CX para toda a lista bruta, incluindo números errados, com o mesmo problema que motivou a "Sala do LDR". — [source: internal, seção 01 do artefato "LDR Automático"]

## Data & Constraints

- **Anatel / "Não Me Perturbe" (RNP)** — regra vigente proíbe telemarketing por voz feito por bots/robôs/software que dispare chamadas em volume acima da capacidade humana de discagem, para **oferta de produto ou serviço**. Cadastro "Não Me Perturbe" tinha 14,2 milhões de números registrados até o fim de 2025. — [source: gov.br/anatel — comunicado "Anatel edita medida cautelar para combate a chamadas de robocall"] (confidence: high; cited)
- **Regras novas 2025-2028** — vigentes de 01/11/2025 a 31/10/2028: autenticação obrigatória (protocolo STIR/SHAKEN), bloqueio automático pelas operadoras e relatórios mensais. Aplicam-se integralmente a "grande chamador" = quem origina **mais de 500 mil chamadas/mês** por serviço/operadora. — [source: Estado de Minas / oficinadanet.com.br, cobertura das novas regras Anatel] (confidence: medium; cited, mas não é o texto oficial da resolução)
- **Volume projetado do LDR Automático está bem abaixo do limiar de "grande chamador"**: ~900 a ~1.800 chamadas/mês projetadas para 500-1.000 leads/mês (1,8 tel/lead), contra o limiar de 500.000/mês. — [cálculo interno a partir do dado de volume acima] (confidence: high; cited/calculado)
- **Zona cinzenta relevante**: a proibição citada é especificamente sobre chamadas para "oferta de produto ou serviço" (telemarketing). O robô do LDR Automático não oferece nada na ligação — só faz uma pergunta de verificação (sim/não) — o que pode ou não enquadrá-lo como "telemarketing" para efeito da lei, já que a ligação é uma etapa preparatória de um funil comercial. Não encontrei uma fonte que resolva essa distinção diretamente. — [NEEDS CLARIFICATION: parecer jurídico específico sobre se uma chamada de verificação (não-venda) automatizada por voz sintética se enquadra nas vedações do RNP/Anatel]
- **Código 0303**: empresas de telemarketing devem se identificar com o prefixo 0303 desde 06/2022, para que o destinatário reconheça a chamada como telemarketing antes de atender. Não está claro se isso se aplica a uma chamada de verificação B2B feita por um tronco SIP próprio (não um "0303" tradicional). — [source: cobertura Anatel/Vono sobre robocall] (confidence: medium; cited) — [NEEDS CLARIFICATION: se o número do tronco SIP contratado precisa desse prefixo]
- **LGPD — voz como dado pessoal/biométrico**: voz é considerada dado pessoal (e biométrico) pela LGPD. Gravar a chamada e gerar transcrição (como o ElevenLabs faz nativamente para extrair `e_a_empresa`) normalmente exige consentimento do interlocutor e finalidade clara, além de abrir direito de acesso/exclusão sobre a gravação e a transcrição. **Esse risco não estava listado na seção de riscos do artefato original** (que só cobria Anatel/Não Me Perturbe) — é um achado novo desta pesquisa. — [source: cobertura jurídica LGPD sobre gravação de chamadas (delgrande.com.br, ddcomsystems.com.br)] (confidence: medium; cited) — [NEEDS CLARIFICATION: se o aviso verbal do robô ("Olá, aqui é da Tendência Energia...") é suficiente como base legal/consentimento para gravar e reter a transcrição]

## Evidence Against the Idea

- **Risco regulatório é real e não totalmente mitigado pelo baixo volume**: mesmo abaixo do limiar de "grande chamador", a vedação geral a chamadas automatizadas por bot para fins de telemarketing não tem piso de volume claro nas fontes encontradas — o baixo volume projetado reduz a exposição prática (menos chance de gerar reclamações em massa), mas não é uma isenção legal confirmada.
- **LGPD é um risco adicional, não coberto no plano original**: gravação + transcrição automática por voz sintética, sem um fluxo explícito de consentimento/aviso de gravação, é uma lacuna de conformidade que o artefato revisão 2 não menciona.
- **Prova de mercado é majoritariamente do próprio fornecedor (ElevenLabs)**: a única evidência externa de "isso funciona em produção" vem do material de marketing do vendor, não de um caso independente ou de um benchmark de terceiros — favorece otimismo sobre a taxa de acerto que só o piloto (dia 5-6) vai confirmar de fato.
- **Já existe uma tentativa anterior de IA de voz na empresa (Nexi SDR/Infobip) que não avançou** e cujo motivo de estagnação não está documentado — vale entender por que antes de repetir o padrão com outro fornecedor, para não tropeçar no mesmo obstáculo (técnico, de custo, ou organizacional).
- **Divergência arquitetural**: a decisão de abrir um repositório novo e independente (`ldr-automatico`) contraria a arquitetura descrita na revisão 2, que previa o webhook e o orquestrador como código dentro do projeto `nexi-lead-360` já existente — isso é uma decisão consciente do Igor, mas introduz custo de integração futura (dois repositórios, dois deploys, até decidir se/como unificar).

## Gaps & Open Questions

- [NEEDS CLARIFICATION: parecer jurídico formal sobre Anatel/Não Me Perturbe para uma chamada de verificação B2B (não-venda) — já era o risco "alto" apontado no plano original, esta pesquisa não o resolve, apenas o detalha]
- [NEEDS CLARIFICATION: obrigação (ou não) de consentimento/aviso de gravação sob a LGPD para a ligação e a transcrição gerada pelo ElevenLabs — achado novo, não coberto no plano original]
- [NEEDS CLARIFICATION: se o número do tronco SIP precisa do prefixo 0303 de identificação de telemarketing]
- [NEEDS CLARIFICATION: por que a iniciativa anterior "Nexi SDR" (Infobip) não avançou — histórico não documentado nos materiais disponíveis]
- [NEEDS CLARIFICATION: nenhuma comparação de custo/qualidade foi feita contra uma camada simples de validação de número (Twilio Lookup ou similar) como filtro antes de ligar — pode reduzir o volume de chamadas e, portanto, a exposição regulatória e o custo]

## Sources

- https://www.gov.br/anatel/pt-br/consumidor/destaques/anatel-edita-medida-cautelar-para-combate-a-chamadas-de-robocall (host: gov.br, policy: allowlisted — domínio governamental oficial)
- https://www.em.com.br/emfoco/2026/05/09/operadoras-como-vivo-claro-e-tim-passam-a-seguir-novas-regras-da-anatel-para-bloqueio-temporario-de-ligacoes-de-telemarketing-abusivo/ (host: em.com.br, policy: confirmed-by-user — resultado de busca web, não um dos hosts pré-aprovados)
- https://www.nvoip.com.br/blog/robocall/ (host: nvoip.com.br, policy: confirmed-by-user)
- https://delgrande.com.br/blog/lgpd-e-gravacao-de-chamadas-em-2026-evite-multas-com-criptografia-ponta-a-ponta/ (host: delgrande.com.br, policy: confirmed-by-user)
- https://www.ddcomsystems.com.br/lgpd-e-a-gravacao-de-voz-do-cliente (host: ddcomsystems.com.br, policy: confirmed-by-user)
- https://elevenlabs.io/blog/how-we-scaled-inbound-sales (host: elevenlabs.io, policy: confirmed-by-user)
- internal — artefato Claude "LDR Automático" (revisão 2), `02 - LDR Automatico (IA + 3CX).html` e `03 - Resumo e decisoes.md`, neste repositório
