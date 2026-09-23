# SON-2.4: Bruno e trava de release

## Estado e bloqueio de produção

PR em rascunho sobre `NexiPlay/ldr-automatico/main`, commit
`6ba711d4bae5936aa06398a231db34f200b24220`, confirmado por Git e API GitHub.
Não há `AGENTS.md` ou `CLAUDE.md` nessa base. Foram lidos `README.md`, `TASKS.md`,
`backend/edge-functions/README.md` e `.specify/memory/constitution.md` (template não preenchido).

O PO confirmou que o carimbo de versão por chamada e a apuração de custos foram
implantados manualmente a partir de `ldr-automatico-orquestrador.ts` e
`ldr-automatico-webhook.ts`, sem branch/commit conhecido. Esses arquivos não foram
encontrados no workspace, incluindo arquivos ignorados pelo Git. A main remota
ainda tem o código antigo, com `ia_conversation_id`/`ia_disparado_em`.

**Este PR não altera os entrypoints do orquestrador, webhook, proxy de conversa ou
migrations.** A integração inicialmente preparada contra o orquestrador antigo
foi retirada do diff. Os helpers estão disponíveis para integração depois da
conciliação; não são importados pelo entrypoint atual. Não se afirma que carimbo
de versão e custos de produção foram validados sem acesso à fonte implantada.

O job `deploy` tem um bloqueio explícito que termina com erro. Removê-lo somente
na mesma revisão que integrar as fontes implantadas e demonstrar a preservação do
carimbo/custos. Mesmo uma execução manual com R5 e suíte aprovados não publica
o orquestrador antigo enquanto esse bloqueio existir.

## Escopo preparado

- `prompts/bruno/system.md`: persona, três verificações, R5/R6, briefing por confirmação e regras de opt-out.
- `prompts/bruno/first-message.txt`: identificação completa e pergunta final `Aqui é da {{empresa}}?`.
- `backend/edge-functions/_shared/ldr-approval.json`: agente, versão `bruno-son-2.4-v2` e hash dos textos.
- `backend/edge-functions/_shared/ldr-policy.mjs`: validação R5/hash, filtro/consulta de briefing e discagem condicionada à validação, ainda sem integração ao entrypoint.
- `scripts/ldr-release.mjs`: validação local, validação remota e execução de testes nativos.
- `tests/adversarial/cases.json`: 14 cenários incluindo Karla, recitação de cadastro e repetição de perguntas já respondidas.
- `.github/workflows/ldr-release.yml`: CI local em PR; release futuro manual com gates obrigatórios e bloqueio atual de produção.

Agente: `agent_3501m1c2yxmye1q99p9nh7r7ndkg`. O PO informou draft preparado,
não publicado, e voz **Manoel Cota**. O voice_id e o texto completo do draft não
foram consultados remotamente. O prompt aproveita respostas já dadas e não repete
a identificação entregue por `first_message`. Se houver interrupção, completa
somente os elementos R5 que faltaram.

## Pipeline e abertura do PR

O workflow está na raiz do repo LDR. O deploy Railway do `nexilead` é independente.
Eventos: `pull_request` e `workflow_dispatch`; não há gatilho de push.
Em PR, apenas `checks` roda, sem credenciais de produção: testes com transporte
simulado, R5/hash local e Deno. Os jobs `r5-adversarial` e `deploy` exigem
`workflow_dispatch` no `refs/heads/main`.

`deploy.needs: [checks, r5-adversarial]` torna as duas validações obrigatórias.
Não há `continue-on-error`. O job baixa a evidência da mesma execução e executa
`--verify-live` antes do CLI Supabase. `always()` só guarda o relatório; não libera
publicação após falha. O bloqueio adicional pela ausência das fontes implantadas
permanece no início do job de deploy.

A API GitHub informou zero workflows pré-existentes. A autenticação disponível
não tem acesso administrativo à listagem de webhooks (HTTP 404), então não é
possível comprovar a ausência de automações externas não visíveis. O workflow
deste PR não faz testes remotos, deploy ou chamadas ao abrir o PR.

O grupo `elevenlabs-ldr-production` serializa workflows do mesmo repo que o usam.
Não bloqueia painel ou deploy manual via CLI. SON-1.5 precisa compartilhar o grupo
e ter suas ferramentas e instruções específicas preservadas na conciliação.

## Secrets e variáveis

No environment `production` do GitHub:

| Tipo | Nome | Uso |
| --- | --- | --- |
| Secret | `ELEVENLABS_API_KEY` | Leitura do agente e criação/execução/leitura de testes |
| Secret | `SUPABASE_ACCESS_TOKEN` | Deploy CLI, somente após gates e conciliação |
| Variável | `ELEVENLABS_AGENT_ID` | `agent_3501m1c2yxmye1q99p9nh7r7ndkg` |
| Variável opcional | `ELEVENLABS_BASE_URL` | Padrão `https://api.elevenlabs.io` |

No runtime Supabase, preservar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID` e
os secrets já usados pelo carimbo/custeio. O webhook mantém
`ELEVENLABS_WEBHOOK_SECRET`. Não copiar service_role para GitHub ou frontend.

## Verificação

```sh
node --test tests/*.test.mjs
node scripts/ldr-release.mjs --local
deno check backend/edge-functions/ldr-automatico-orquestrador/index.ts
actionlint -shellcheck= -pyflakes= .github/workflows/ldr-release.yml
```

31 testes locais passaram; R5/hash, Deno e actionlint passaram. Isso valida os
helpers e o controle da suíte, não o comportamento do LLM nem a integração com
a fonte implantada ausente. Os testes de discagem usam transporte simulado.

O comando remoto futuro é `node --env-file=.env scripts/ldr-release.mjs --live`.
Não foi executado nesta etapa. Cria testes nativos com ferramentas mockadas e pode
consumir créditos LLM; não disca. Resultados ausentes, falhos, unknown, draft ou de
outro agente/versão bloqueiam. Evidência: `artifacts/ldr-adversarial.json`.
Cada execução cria novos IDs de testes para auditoria.

## Pendências e ordem futura

1. Obter os dois arquivos realmente implantados e o contrato das migrations.
   Integrar briefing/gate preservando carimbo e custos; testar essa integração
   antes de retirar o bloqueio do workflow.
2. Conferir schema real de `np_lead_enriquecimento`, ferramentas SON-1.5 e analisador
   `resultado_validacao`. O helper consulta por `lead_id`, ordena `updated_at DESC`
   e `id DESC`, e não usa `briefing_file`.
3. O helper prepara `dynamic_variables.empresa` (texto) e `briefing_lead` (JSON
   serializado), com dados de identificação da empresa. Sócios, decisores IA e
   dados pessoais/comerciais não são enviados. O entrypoint antigo ainda envia
   somente `empresa`; sua alteração depende da fonte de produção.
4. Depois da revisão, integrar PR e configurar environment. Suspender disparos,
   conferir os textos exatos, voz Manoel Cota e SON-1.5; publicar primeiro o agente,
   executar o workflow com R5/hash e 14 simulações obrigatórias, e só então
   publicar o orquestrador conciliado.
5. Verificar deploy sem discar. Retomar chamadas somente quando autorizado.

Nenhum merge, deploy, publicação de agente ou chamada integra esta preparação.

## Limites

O helper reconsulta o prompt antes de cada discagem, sem fallback. GET e POST não
são atômicos contra uma edição entre eles; chamadas pelo painel não passam pelo
helper. O hash cobre prompt e abertura. A suíte compara também modelo, voz,
ferramentas e workflow antes/depois dos testes e antes do deploy. O texto completo
do painel deve coincidir com a referência, não apenas conter os marcadores R5.

Contratos: [Get agent](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get),
[Create test](https://elevenlabs.io/docs/eleven-agents/api-reference/tests/create),
[Get test invocation](https://elevenlabs.io/docs/eleven-agents/api-reference/tests/test-invocations/get)
e [OpenAPI oficial](https://api.elevenlabs.io/openapi.json).
