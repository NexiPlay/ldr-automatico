# LDR Automático — resumo do que foi tratado (atualizado — revisão 2, 18-19/08)

## Ponto de partida

A "Sala do LDR" (arquivo `01 - Sala do LDR (original).html`) é uma proposta de 14/08, baseada na
reunião de 13/08 (Leonardo Toschi + Igor): criar um papel humano (LDR) que valida telefone e
empresa de um lead **antes** do SDR ligar, parando na primeira confirmação. Nada disso está
implementado no banco — é proposta e mockup de tela.

## A ideia do Igor: automatizar essa etapa com IA

Em vez de um LDR humano, um robô liga para todos os números do lead, com voz gerada, roteiro fixo,
pergunta fechada sim/não, e o agente só recebe depois os números que passaram. Isso ficou registrado
no artefato `02 - LDR Automatico (IA + 3CX).html`.

**Este arquivo já foi atualizado uma vez** — a primeira versão (23/08 desta pasta) ainda tratava a
"ferramenta de voz" e o "3CX" como coisas em aberto. Na revisão 2 (18-19/08) essas duas lacunas
foram fechadas com decisões concretas, então o conteúdo abaixo substitui o resumo anterior.

## Decisões fechadas na revisão 2

1. **Ferramenta de voz escolhida: ElevenLabs Agents** (não é TTS genérico — é a linha de "agentes de
   voz" da ElevenLabs, que já escuta, entende e fala, e extrai campos estruturados da transcrição).
2. **O 3CX NÃO faz a discagem da IA.** Foram avaliados 3 caminhos:
   - Call Control API do 3CX → inviável (a API não dá acesso ao áudio da chamada).
   - 3CX como tronco do ElevenLabs → frágil (autenticação incompatível, exigiria proxy SIP).
   - **Tronco SIP próprio, contratado só para isso → escolhido.**
   O 3CX continua existindo, mas só para o SDR discar manualmente, como já é hoje. É a maior mudança
   em relação à primeira versão deste resumo, que ainda tratava "como a IA se conecta ao 3CX" como
   pergunta em aberto — a resposta acabou sendo "não se conecta, usa um tronco separado".
3. **Captura da resposta**: o próprio agente ElevenLabs interpreta sim/não na conversa e extrai um
   campo `e_a_empresa` (booleano) da transcrição, entregue via webhook de pós-chamada. Não precisou
   escolher entre ASR separado e DTMF — o agente de voz já resolve isso nativamente.
4. **Onde grava o resultado**: reaproveita `np_lead_telefones`, com 3 colunas novas —
   `validado_por_ia`, `validado_em`, `conversation_id`.

## O que continua igual à primeira versão

- IA liga para **todos** os números do lead, não para no primeiro que confirma (oposto do LDR humano).
- Pergunta fechada, sim/não, sem tentar achar decisor/e-mail.
- SDR só recebe os números que responderam "sim".
- Cada telefone tem seu próprio veredito — não é um veredito único por lead.

## Plano de execução (novo na revisão 2) — 7 dias úteis, com dono por tarefa

Responsáveis: **Igor** (back-end, banco, webhook, orquestrador) e **Pedro** (conta ElevenLabs,
roteiro do agente, telefonia/tronco SIP). Resumo dia a dia, código do webhook/orquestrador, e o
JSON exato da chamada à API do ElevenLabs estão no artefato `02` (seções 04, 09 e 10).

- D1-D4: setup (conta ElevenLabs + tronco SIP, migration no banco, webhook, orquestrador, roteiro,
  testes de voz internos).
- D5: piloto real conjunto — 4 leads, ~20 números, ao vivo.
- D6: conjunto ouve as 20 chamadas e confere contra o veredito gravado — é aqui que sai a taxa de acerto.
- D7: tela do SDR (esconder descartados/destacar validado) + fechar custo real vs. projeção.

**Gate de go/no-go no dia 7**: só segue pra produção se acertar ≥9 de cada 10 vereditos conferidos
no áudio E o custo por número testado couber na projeção.

## Custo (novo na revisão 2)

- ElevenLabs Creator: US$ 22/mês, 275 min inclusos — cobre o piloto com folga.
- Produção multiplica a conta porque testa todos os números: ~500 leads/mês ≈ US$ 160/mês;
  ~1.000 leads/mês ≈ US$ 320/mês.
- Tronco SIP cobrado à parte, por minuto — único item de custo ainda não fechado.

## Riscos identificados (novo na revisão 2)

- **Alto**: regras de discagem automatizada (Lei do Não Me Perturbe, Anatel) — validar com jurídico
  antes do piloto (dia 5).
- **Médio**: recepcionista desliga antes de responder (voz sintética, pergunta fechada).
- **Médio**: reputação do número que disca (spam pelas operadoras) se o volume subir rápido demais.

## Onde mais isso está registrado

Também salvei um resumo equivalente no `CLAUDE.md` do projeto (seção 16, pasta `nexi-lead-360` no
Drive) — é o arquivo que qualquer sessão futura de IA lê primeiro para entender o projeto, então essa
é a cópia "oficial" de longo prazo. Esta pasta local é a cópia de conveniência pra você mandar pra
alguém.

## Contexto técnico do projeto (levantado antes da revisão 2, ainda válido)

- Redirecionamento estoque → Sala do Agente: geração/estoque (`vw_np_estoque_regiao`,
  `geracao_fila_worker.py`) alimenta o pool sem dono; agentes puxam via "Obter novos leads" →
  função SQL `np_fn_pool_reposicao` (versão vigente: migration `0249`). Essa função já exige pelo
  menos 1 telefone ou 1 decisor, e prioriza telefone de alta confiança — mas não tem nenhum
  conceito de "validado por IA/LDR" ainda.
- A cascata de discagem manual que já existe hoje (Sala do Agente, `backend/sala_agente/core.py` +
  `widget.html`) tem peças reaproveitáveis: ordenação de telefones, kill-switch permanente
  (`morto/morto_motivo/morto_em` em `np_lead_telefones`), e log de tentativas (`np_sessao_ligacoes`).
- Existe um serviço diferente e não relacionado, "Nexi SDR" (liga por IA via Infobip, não 3CX) —
  não é reaproveitável sem adaptação, e não tinha credenciais configuradas na última verificação.

## Arquivos nesta pasta

- `01 - Sala do LDR (original).html` — proposta original (LDR humano).
- `02 - LDR Automatico (IA + 3CX).html` — **revisão 2**: ElevenLabs Agents + tronco SIP próprio,
  plano de 7 dias, custo e riscos.
- `03 - Resumo e decisoes.md` — este arquivo.
