# Abertura Alô e trava R5 — 01/10/2026

## Incidente e escopo

O usuário definiu `Alô?` como abertura permanente de Bruno e Karla. A leitura
da ElevenLabs confirmou esse texto nos dois agentes. O Bruno ficou incompatível
com o orquestrador: o gate antigo exigia os quatro elementos R5 também dentro
de `first_message`. O prompt ainda pressupunha que a identificação já tinha
sido falada na abertura. Atualizar somente o hash ou remover a checagem da
abertura deixaria essa contradição ativa.

Fonte sincronizada com `origin/main` em `18d5a60`. O orquestrador publicado e
os módulos de política/aprovação foram baixados e comparados com essa base;
eram equivalentes após normalização de quebras de linha. A janela de discagem
consultada no banco (SON-2.2) foi preservada.

Karla já prevê identificação na primeira resposta após o cumprimento e seu
dialer não importa `ldr-approval.json`. Nenhuma alteração na Karla integra esta
correção. SON-6.3 segue separada, com publicação ainda pendente.

## Alteração proposta

- `greeting_then_disclosure` permite somente o cumprimento Alô, com R5 exigido
  no prompt e a identificação na primeira resposta substantiva. O modo legado
  continua exigindo R5 completo na abertura; política desconhecida bloqueia.
- O SHA-256 exato de prompt + abertura continua obrigatório. Uma edição no
  painel não vira aprovação automática, inclusive mudanças de acento.
- O roteiro exige identificação mesmo quando todos os dados vêm logo após
  Alô, colocando-a na despedida de `end_call`. Recusa imediata, opt-out ou
  rejeição de gravação encerram sem prolongar a chamada.
- A configuração de `end_call` descreve esse comportamento e desativa a fala
  automática anterior à ferramenta. O candidato usa GPT-4.1, também usado pela
  Karla, após falhas de seguimento do roteiro com Qwen. Voz, coletores e
  processamento de opt-out não mudam.
- Os cenários acompanham a abertura em duas etapas, incluindo dados completos
  espontâneos, interrupção, recusa e preservação do pedido único SON-6.2.
- O workflow ganha `scope=orchestrator`, conservando os gates e a publicação
  manual na main; o escopo padrão `all` mantém o comportamento anterior.

## Validação e estado

61 testes Node e 46 testes Deno sem rede aprovados; `deno check` do orquestrador
aprovado. O handler permite o POST simulado com Alô e versão exata e bloqueia
prompt incompleto, mensagem diferente e mudanças não aprovadas. Mantém os
portões de janela, opt-out, reputação e limite de tentativas.

A simulação não basta sozinha: a primeira rodada recebeu 24 aprovações do
provedor, mas a leitura das transcrições encontrou repetição de pedido e
encerramento tardio. A segunda rodada foi reprovada em quatro cenários após
fortalecer os critérios. A terceira melhorou a repetição, mas ainda apresentou
encerramentos tardios e erro no cenário sem referência. Essas versões NÃO
estão aprovadas para publicação.

A revisão atual é `bruno-alo-r5-v7`, em `prompts/bruno/system.md` e
`opening-config.json`, com hash proposto em `ldr-approval.json`. A rodada final
`suite_7201m3w3587weqwbdrs0v5dfgncj` teve **17/24 aprovados e sete interrompidos
por `Insufficient credits to run this simulation`**. Os 17 completos também
passaram pela checagem determinística e revisão textual. Os sete incompletos
não são aprovação, nem falha comportamental comprovada.

O usuário autorizou explicitamente publicação (“PODE PUBLICAR”) após as
autorizações de simulação; **não falta nova aprovação do usuário**. O bloqueio
atual é externo: créditos para concluir a validação obrigatória. A API key
não permite consultar assinatura/saldo (`GET /v1/user/subscription`: 401),
portanto não se afirma saldo nem data de renovação. Não houve compra ou
alteração de plano. Ver [evidência](evidence/2026-10-01-alo-r5.json).

Nenhum agente ativo, function ou migration foi alterado. Nenhuma ligação,
e-mail ou WhatsApp real foi disparado. A produção ainda tem o gate antigo e
continua incompatível com o Alô até a publicação da correção. Não contornar o
workflow nem ativar versão cuja validação ficou incompleta.

O release agora também verifica transcrições por código: ausência de R5 na
primeira resposta substantiva, pergunta em end_call, nova fala do cliente após
despedida, repetição de pedido e pergunta sem referência impedem publicação,
mesmo que o avaliador do provedor retorne sucesso.

## Reprodução e publicação

O script abaixo só cria uma branch sem tráfego e executa testes com todas as
ferramentas em mock. A API key fica no ambiente; o snapshot contém a leitura
privada previamente auditada. Os artefatos completos ficam em `artifacts/`,
ignorado pelo Git. Ele verifica deriva do agente ativo e da branch candidata.

```text
node scripts/alo-r5-simulate.mjs stage artifacts/alo-r5/candidato snapshot-base.json
node scripts/alo-r5-simulate.mjs run artifacts/alo-r5/candidato snapshot-base.json
node scripts/alo-r5-simulate.mjs status artifacts/alo-r5/candidato snapshot-base.json
```

Após restabelecer os créditos, `retry-infrastructure` reapresenta somente os
sete testes interrompidos na mesma execução, preservando os aprovados e o
relatório anterior. Falha comportamental não é elegível a esse retry.

Depois de restabelecidos os créditos e concluída a validação final, a publicação
já está autorizada: incorporar a PR,
ativar a configuração revisada do Bruno preservando Alô e executar o workflow
`ldr-release.yml` na main com `scope=orchestrator`. O workflow revalida o agente
ativo, repete a suíte positiva, executa controle negativo e revalida a evidência
antes de publicar no projeto `wbagoinuxgvntvbbnmab`. Confirmar por releitura o
prompt e os fontes publicados. Não disparar lote para comprovar deploy.

Se a validação do agente falhar após ativação, a trava antiga continua fechada;
não liberar o orquestrador. O snapshot anterior permite rollback. Nenhum outro
agente, webhook, função de conversa, migration ou trabalho da SON-6.3 está no
escopo dessa publicação.
