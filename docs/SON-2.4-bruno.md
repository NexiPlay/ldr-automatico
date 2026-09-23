# SON-2.4: Bruno, briefing e trava de release

## Implementação

Bruno confirma somente atendimento, identidade da empresa e responsável por
energia. A abertura termina em `Aqui é da {{empresa}}?`, contém os quatro
elementos R5 e já é entregue por `first_message`. O prompt aproveita respostas
anteriores sem repetir a identificação/perguntas, proíbe pitch, preço, comissão,
promessa de economia e apresentação como Karla.

Agente: `agent_3501m1c2yxmye1q99p9nh7r7ndkg`; versão local
`bruno-son-2.4-v3.1`. Texto final em `prompts/bruno/system.md`, abertura em
`prompts/bruno/first-message.txt` e configuração mínima em `prompts/bruno/end-call.json`.
Publicado pelo PO como `agtvrsn_0601m37cb2v3fq0v2zxgtjedwad0`, com `end_call`.
A v3.1 registra somente a remoção de 27 linhas em branco feita no painel;
texto e abertura idênticos à v3, sem flexibilizar o algoritmo de hash.
Validação: mesmos 14 cenários contra essa versão, sem override. SON-1.5 pendente.

O orquestrador envia `dynamic_variables.empresa` (nome normalizado para fala) e
`briefing_lead` (JSON serializado). Consulta `np_lead_enriquecimento` por `lead_id`,
ordena `updated_at DESC NULLS LAST`, depois `id DESC`, e usa uma linha. Seleciona
somente razão social, nome fantasia, CNAE, situação cadastral, logradouro,
município/UF e nome/endereço Places. Não consulta `briefing_file`; não envia
sócios, decisores IA ou dados comerciais. Erro de consulta bloqueia o disparo;
ausência de linha admite o nome de referência do lead. Sem referência, pula o
telefone. O modelo usa esses dados para perguntas de confirmação, sem recitá-los.

## Conciliação com produção

Base: `main` em `6ba711d4bae5936aa06398a231db34f200b24220`. Lidos `README.md`,
`TASKS.md`, `backend/edge-functions/README.md` e a constituição (template vazio).
Não havia `AGENTS.md` ou `CLAUDE.md` nessa base.

Os dois arquivos fornecidos e confirmados pelo PO como produção foram importados
no commit separado `ce461c2`, antes da integração SON-2.4. SHA256 dos anexos:

| Fonte | SHA256 |
| --- | --- |
| Orquestrador | `440e9f8be1976ad2c582796e76f796322344f9245e8c0c882a2decf47b99dbba` |
| Webhook | `9c3edffac1647d9a5b5877e7c751fe574dc37254c85d787e548843327dc1b65d` |

O webhook mantém o conteúdo do anexo, sem alteração funcional. A apuração usa
`metadata.cost_fiat` em USD; créditos/componentes ficam separados. Zero explícito
é válido, ausência não vira zero, fallback verifica a identidade da conversa,
reentregas preservam a primeira apuração e escrita concorrente mantém a proteção
por `ia_conversation_id` e `ia_custo_valor IS NULL`.

O orquestrador usa a **mesma resposta GET por telefone** para validar R5/versão e
produzir o carimbo original. Preserva `ia_agent_id`, `ia_prompt_hash`,
`ia_voice_id`, `ia_llm_model`, `ia_tts_model`, `ia_config_lida_em` e
`ia_config_snapshot`, além de tentativas, pausa e dados de recuperação se a
discagem ocorrer mas a gravação falhar. Não grava custos no disparo.

`ia_prompt_hash` continua SHA256 do JSON, nesta ordem:
`{schema_version:1,prompt,first_message,voice_id}`, com os textos exatos recebidos.
O hash de aprovação em `ldr-approval.json` é separado: cobre prompt/abertura
normalizados para transporte. Não substitui o hash histórico de cada chamada.
Falha R5/hash interrompe o lote com HTTP 503 e preserva as chamadas já gravadas.

O bloqueio temporário por ausência dos fontes foi removido após a conciliação e
os testes dos entrypoints. Proxy e migrations não foram alterados. A migração
`01-sonar-carimbo.sql`, citada no webhook fornecido, não veio nos anexos; não se
inventa nem aplica DDL neste PR.

## Pipeline real

O workflow está em `.github/workflows/ldr-release.yml` na raiz deste repositório.
Eventos: `pull_request` e `workflow_dispatch`, sem gatilho `push`. Em PR executa
somente `checks`: testes locais com rede bloqueada nos handlers, R5/hash do
artefato e verificação Deno, sem secrets de produção.

`r5-adversarial` e `deploy` exigem **workflow_dispatch em refs/heads/main**.
`deploy.needs: [checks, r5-adversarial]` exige sucesso de ambos. Não há
`continue-on-error`. O release lê o prompt remoto, verifica os quatro elementos
R5 e o hash revisado, executa os 14 cenários nativos SON-2.5 e reconsulta a
configuração. Ausência/falha/unknown/draft/versão divergente bloqueia.

Antes do CLI Supabase, o deploy baixa a evidência da mesma execução e executa
`--verify-live`: relatório com até 30 minutos, todos os casos aprovados e
configuração ainda correspondente. Modelo, voz, ferramentas e workflow também
entram nessa comparação. Só então publica **o orquestrador**, com seus módulos
compartilhados; não publica o webhook nem aplica migrations.

Abrir/atualizar este PR não executa testes remotos, deploy, publicação de agente
ou chamadas. Não havia workflows preexistentes na main. A API de webhooks
administrativos retornou 404 para a credencial disponível; automações externas
não visíveis não puderam ser auditadas.

O grupo `elevenlabs-ldr-production` serializa workflows que o compartilham neste
repo. SON-1.5 deve usar o mesmo grupo; isso não bloqueia alterações no painel ou
deploy avulso pelo CLI. Esses caminhos não passam pelo gate de release.

## Secrets e variáveis

No environment GitHub `production` (a configurar antes do release):

| Tipo | Nome | Uso |
| --- | --- | --- |
| Secret | `ELEVENLABS_API_KEY` | Ler agente e criar/executar/ler simulações |
| Secret | `SUPABASE_ACCESS_TOKEN` | Deploy CLI após aprovação dos gates |
| Variável | `ELEVENLABS_AGENT_ID` | `agent_3501m1c2yxmye1q99p9nh7r7ndkg` |
| Variável opcional | `ELEVENLABS_BASE_URL` | Padrão `https://api.elevenlabs.io` |

No Supabase, preservar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID` e
`ELEVENLABS_WEBHOOK_SECRET`. A API key também atende ao fallback de custo do
webhook. Não copiar service_role para GitHub/frontend. O orquestrador aceita
`ELEVENLABS_BASE_URL`; o webhook fornecido mantém o host global de produção.

## Validação

```sh
node --test tests/*.test.mjs
node scripts/ldr-release.mjs --local
deno test --config tests/runtime/deno.json --allow-read --allow-env --deny-net tests/runtime/
deno check backend/edge-functions/ldr-automatico-orquestrador/index.ts backend/edge-functions/ldr-automatico-webhook/index.ts
actionlint -shellcheck= -pyflakes= .github/workflows/ldr-release.yml
```

Passaram **28 testes Node e 17 testes Deno**, R5/hash local, verificação dos dois
entrypoints e actionlint. Os testes Deno carregam os handlers reais com Supabase,
fetch e relógio de pausa simulados; a rede permanece negada. Cobrem carimbo por
chamada, alterações no painel, briefing, recuperação de gravação, pausas, custo
USD/zero/pendência/fallback, reentrega e assinatura HMAC.

Isso não comprova comportamento do LLM. Os **14 cenários adversariais remotos
continuam pendentes**, incluindo recitação de cadastro, persona Karla e repetição
de perguntas. O futuro `node scripts/ldr-release.mjs --live` cria simulações
com ferramentas mockadas, sem discagem, e pode consumir créditos. Não foi
executado nesta etapa. Evidência: `artifacts/ldr-adversarial.json`.

## Pendências e ordem de publicação futura

1. Conferir o schema implantado: colunas de carimbo/custo e `lead_id`, `updated_at`,
   `id`/campos permitidos do enriquecimento. Registrar a migração SONAR ausente.
   Preservar ferramentas/procedimento SON-1.5 e analisador `resultado_validacao`.
2. Revisar/integrar o PR e configurar environment/secrets quando autorizado.
3. Com disparos suspensos, conferir prompt/abertura exatos do artefato revisado,
   voz Manoel Cota e opt-out; **publicar primeiro o agente**. A suspensão evita
   receber chamadas do orquestrador antigo sem `briefing_lead` nesse intervalo.
4. Executar manualmente o workflow na main: R5/hash remoto + 14 simulações;
   após sucesso e revalidação, **publicar o orquestrador** pelo mesmo workflow.
5. Verificar configuração sem discagem. Retomar chamadas somente com autorização.

Nenhum merge, deploy, publicação de agente ou chamada faz parte deste PR.

## Limites

O runtime valida o texto antes de cada POST, mas GET e POST não são atômicos contra
edições simultâneas no painel. Chamadas fora do orquestrador não passam pela
validação. O carimbo registra voz/modelos lidos; a aprovação textual não fixa
esses valores durante todas as chamadas. A suíte verifica sua estabilidade
durante o release. A validação por marcadores não substitui a suíte comportamental.

Contratos: [Get agent](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get),
[Create test](https://elevenlabs.io/docs/eleven-agents/api-reference/tests/create),
[Get test invocation](https://elevenlabs.io/docs/eleven-agents/api-reference/tests/test-invocations/get)
e [OpenAPI oficial](https://api.elevenlabs.io/openapi.json).
