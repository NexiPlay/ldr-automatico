# Idea Intake: LDR Automático — validação de telefone de leads por IA de voz

- **Slug**: ldr-automatico
- **Created**: 2026-08-26
- **Source**: repo path — `02 - LDR Automatico (IA + 3CX).html` e `03 - Resumo e decisoes.md` (material de planejamento já existente neste repositório, revisão 2, 18-19/08/2026)
- **Type**: new-capability

## Idea (as captured)

> LDR Automático: um robô de voz (ElevenLabs Agents) liga para todos os telefones de cada lead do
> Nexi Lead 360, faz uma pergunta fechada sim/não para confirmar se é o telefone da empresa certa, e
> só libera para o SDR os números confirmados. Diferente da proposta irmã "Sala do LDR" (validador
> humano, que parava no primeiro número confirmado), o robô testa a lista inteira sempre, e cada
> telefone recebe seu próprio veredito.
>
> Decisão técnica já fechada: o robô disca por um tronco SIP próprio contratado só para isso — não
> pelo 3CX existente (Call Control API do 3CX não dá acesso a áudio; usar o 3CX como tronco do agente
> de voz é frágil). O 3CX continua existindo só para o SDR discar manualmente, como hoje.
>
> Resultado de cada chamada (`e_a_empresa=true/false`, ou sem resposta) é gravado por telefone em
> `np_lead_telefones` (colunas novas: `validado_por_ia`, `validado_em`, `conversation_id`) via webhook
> de pós-chamada do ElevenLabs.
>
> Plano de execução já desenhado: 7 dias úteis (Igor cuida de banco/webhook/orquestrador; Pedro cuida
> da conta ElevenLabs/roteiro do agente/tronco SIP), piloto real no dia 5 (4 leads, ~20 números),
> conferência de áudio no dia 6, gate de go/no-go no dia 7 exigindo acerto em pelo menos 9 de cada 10
> vereditos conferidos.
>
> Custo projetado: US$22/mês (plano ElevenLabs Creator, 275 min inclusos) cobre o piloto e ~229
> leads/mês; em produção (500-1.000 leads/mês) sobe para ~US$48-96/mês, usando a média real medida de
> 1,8 telefone por lead — mais o tronco SIP, cobrado à parte por minuto e ainda não orçado.
>
> Risco mais alto identificado: conformidade com a Lei do Não Me Perturbe e regras da Anatel sobre
> discagem automatizada, ainda sem validação jurídica. Riscos médios: recepcionista desligar antes da
> IA terminar a pergunta, e reputação do número que disca virar spam nas operadoras com volume alto.

## Restated

Substituir a validação humana de telefone de leads (proposta "Sala do LDR") por um agente de voz de
IA que liga para todos os números de cada lead, confirma por sim/não se é a empresa certa, e só
repassa ao SDR os números confirmados — eliminando a dependência de contratar e escalar pessoas para
essa etapa.

## Origin & Context

- **Raised by**: Igor (Nexi Lead 360) — ideia dele de automatizar a etapa de validação já desenhada na proposta "Sala do LDR"
- **Trigger**: evolução direta da "Sala do LDR" (LDR humano); necessidade de uma solução que escale com volume de chamadas via orçamento, em vez de contratação de pessoas

## First-Glance Unknowns

- [NEEDS CLARIFICATION: validação jurídica sobre a Lei do Não Me Perturbe e regras da Anatel para discagem automatizada em massa — apontada como risco alto, ainda não realizada]
- [NEEDS CLARIFICATION: custo exato do número brasileiro na Twilio (aluguel + por minuto) — conta já teve upgrade, mas número ainda não aprovado]
- [NEEDS CLARIFICATION: taxa real de "recepcionista desliga antes de responder" — só será medida no piloto (dia 5) e na conferência de áudio (dia 6)]
- [NEEDS CLARIFICATION: se/quando este repositório standalone (`ldr-automatico`) será integrado de volta ao repositório `nexi-lead-360`, onde a arquitetura original da revisão 2 previa que o webhook e o orquestrador fossem código escrito dentro daquele projeto]

## Atualização — 26/08/2026 (mesmo dia, pós-intake)

Mudança de arquitetura decidida pelo Igor/Pedro: em vez de um **tronco SIP próprio avulso** (o que
esta intake original registrava), o projeto passa a usar a **integração nativa ElevenLabs + Twilio**.
A conta Twilio já recebeu o upgrade necessário; falta alugar um número brasileiro, que exige um
"Regulatory Bundle" da Twilio — validação de identidade em **etapas sequenciais**, cada uma só
liberando a próxima depois de aprovada. Isso substitui o item "custo e SLA do tronco SIP" acima pelo
mesmo tipo de incerteza, agora do lado da Twilio — ver `research.md` para o achado sobre prazo
(pode levar de poucos dias úteis a algumas semanas, segundo a documentação da própria Twilio).

## Atualização — 31/08/2026 (pivô de volta: Twilio → 3CX)

Twilio **descartado por custo** (número BR alugado + tarifa por minuto, além do Regulatory Bundle) —
o Pedro passou a nova arquitetura: o robô disca pelo **tronco de saída do 3CX que a empresa já opera
("3CX Tendência")**, integrado ao ElevenLabs via SIP trunk (não mais integração nativa Twilio). Isso
é, na prática, uma volta parcial à decisão original desta intake (3CX como tronco), só que usando o
3CX **existente** da empresa em vez de um tronco SIP avulso contratado à parte — e essa variante já
tinha sido avaliada como "frágil" na revisão 2 (autenticação/roteamento tronco-a-tronco), mas o Pedro
validou funcionando de ponta a ponta com conta pessoal do ElevenLabs antes de reportar isso.

Nota à parte: um upgrade de plano do 3CX que tinha sido mencionado antes **não tem relação com este
projeto** — foi feito por outro motivo.

Isso elimina o item "custo exato do número Twilio" da lista de incertezas abaixo — não existe mais
número alugado à parte. Em troca, entra uma nova incerteza: **conta/plano oficial do ElevenLabs em
nome da Nexi** (o Pedro está definindo isso agora — os US$22/mês de Creator eram suposição da fase
Twilio, não confirmados para este cenário). Ver checklist de progresso do Pedro (1-11) no `TASKS.md`
do repo.
