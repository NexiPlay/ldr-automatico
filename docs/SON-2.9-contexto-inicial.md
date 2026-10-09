# Bruno: contexto independente do encerramento

**Publicado e verificado em 09/10/2026**, após autorização explícita de Pedro. Agente `agtvrsn_9901m4gxycc5fg5r70gggzcmsbp8`, orquestrador v47 e função de contexto v1. O classificador perdia a empresa procurada quando Bruno não copiava a referência em `end_call.reason` ou quando o destino desligava primeiro. Uma saudação institucional clara podia ficar inconclusiva por falta de referência independente.

## Mudança publicada

O orquestrador guarda `empresa` e `briefing_lead`, exatamente como enviados, no `ia_config_snapshot.analysis_context` de cada chamada. Isso preserva a referência original mesmo se o cadastro mudar depois; não reclassifica registros históricos.

O workflow executa `contexto_cadastral` uma vez após a abertura e antes de começar as perguntas. A ferramenta recebe as variáveis pelo transporte, sem depender de o modelo copiá-las. Seu retorno preserva apenas campos empresariais públicos. O contexto aparece no histórico interno, sem ser falado ao interlocutor, e pode ser lido pelo analisador mesmo sem `end_call`.

`scripts/son29-start-context.mjs` constrói a ferramenta e o patch de workflow, sem chamadas de API. Recusa sobrescrever um workflow já personalizado. O nó Bruno herda a configuração atual e espera a fala do interlocutor: preserva `Alô?`, a regra de empresa primeiro e as respostas já dadas. Erro/timeout da ferramenta segue para o Bruno com suas regras atuais, sem derrubar a ligação ou inventar confirmação.

`ldr-contexto-analise` é uma função de transporte: não consulta banco, não chama modelos, não disca e não escreve dados. Exige segredo dedicado `LDR_CONTEXT_TOKEN` (mínimo 32 caracteres), enviado pelo secret store do ElevenLabs em `X-LDR-Context-Token`. Rejeita referência inválida, limita a leitura a 16 KB e não registra conteúdo ou credencial. Não usar `service_role` como segredo dessa ferramenta.

O prompt principal, os modelos, o ASR e os limites de contato foram preservados. O nó Bruno acrescenta regras de conversa para separar uma pergunta do destino de uma afirmação, não tratar um sim após Alô como confirmação, responder sua própria identidade com verdade e aproveitar nome, responsabilidade, ausência ou horário já informados. Quem fala? não é convite para perguntar sobre energia. A referência cadastral serve para comparação; a confirmação ainda precisa de evidência do destino. O hash antigo do prompt principal não cobre essas regras adicionais: a verificação da versão publicada inclui o workflow completo. Normalizamos CRLF/LF na comparação local das políticas, necessária no Windows.

## Evidência e limites

Na mesma amostra revisada de 50 chamadas, o replay do classificador anterior tinha 41/50 concordâncias (82%), 12 confirmações e nenhum falso confirmado. A avaliação com referência original e a estrutura final `progress_workflow/nested_tools`, sem alterar nenhuma fala histórica, obteve **45/50 concordâncias (90%), 16 das 20 confirmações humanas e nenhum falso confirmado**. Os 28 controles passaram e o opt-out foi preservado.

Esse resultado é contrafactual na amostra de ajuste, não desempenho medido em novas ligações. O experimento preliminar, com ferramenta diretamente no histórico, tinha 46/50 (92%) e 17 confirmações; a representação final recuperou 16. Uma interpretação fonética permanece variável entre execuções. Não apresentar 90% ou 92% como taxa de produção nem como resultado de um conjunto independente de avaliação.

No formato encapsulado real, 29 cenários **fictícios** passaram, incluindo nome e responsabilidade informados juntos, sem encerramento pelo agente. Três controles adicionais passaram com os argumentos do modelo vazios e a referência disponível no corpo/retorno da ferramenta. O analisador preservou `Marta` e `DECISOR` da resposta espontânea. A suíte inicial validou retorno normal e erro simulado, sem interromper o atendimento. Após corrigir os problemas de identidade observados, 30 cenários de conversa passaram no agente isolado.

Na versão exata publicada, foram verificados os mesmos 30 cenários: 29 passaram de imediato; um teste de pedido de dados internos foi reavaliado após corrigir um falso negativo do avaliador, sem mudar o agente. O resultado inicial permanece arquivado. A auditoria local revalidou as 30 transcrições, a execução única da ferramenta e a igualdade do corpo enviado com as variáveis de cada caso. Os validadores reconhecem perguntas coloquiais de identidade, sem confundir pedidos para recitar cadastro com perguntas sobre quem é o Bruno.

O endpoint antigo `simulate-conversation` ignorou o workflow e não serve para provar sua execução. Os testes de execução usam `run-tests` e ferramentas simuladas; os primeiros usaram URL `.invalid`. O HTTP da função publicada foi testado separadamente: 401 sem segredo, 200 com segredo e 400 para referência inválida; a resposta autenticada demorou cerca de 600 ms nessa verificação. O timeout é de 5 segundos e pode introduzir atraso. Na publicação inicial ainda não havia novas ligações; a rodada posterior está registrada abaixo. Não houve correção retroativa dos resultados históricos. [Documentação de workflows do fornecedor](https://elevenlabs.io/docs/eleven-agents/customization/agent-workflows).

Validação local final: 99 testes Node e 48 testes de runtime Deno passaram, além das verificações de tipos das funções alteradas e hash/política local. O gate público de release passou a fornecer mocks para a ferramenta de contexto; assim a CI não precisa acessar a função real durante simulações.

## Publicação, pendências e reversão

A autorização para processar as 50 transcrições e publicar foi recebida e executada. A retranscrição dos oito áudios foi recusada pelo ElevenLabs porque a chave não tem `speech_to_text`; Pedro então pediu expressamente para seguir com o contexto e deixar os áudios pendentes. Não alterar ASR por suposição nem forçar as confirmações restantes.

O estado vivo foi relido e comparado antes de cada alteração. A configuração de segredo incrementou a versão das funções; a fonte do orquestrador permaneceu idêntica e foi novamente comparada antes da publicação. A fonte publicada foi baixada e conferida. O patch do agente alterou somente `workflow`; modelos, voz, prompt principal e análise permaneceram iguais. O orquestrador preserva JWT; a função de contexto usa seu header autenticado dedicado. Credenciais permanecem fora do Git.

Após a publicação, Pedro autorizou a rodada 6 com 30 chamadas adicionais para números quentes. A métrica acordada é aprovações divididas pelas chamadas atendidas, incluindo humanos e URAs institucionais. Houve 10 atendidas (4 humanas e 6 URAs), 7 aprovações automáticas (70%) e 20 não atendidas. A revisão conservadora das transcrições sustentou 5/10 (50%); duas confirmações fonéticas dependem de escuta. O contexto foi preservado e a ferramenta executou uma única vez em cada uma das 30 chamadas. Essa rodada selecionada não substitui a auditoria original de 50 chamadas aleatórias do Gate A.

Estado após a rodada: degrau zero, filas LDR/SDR vazias, teto restaurado para 69 e 130 chamadas contabilizadas. Não reaplicar scripts ou SQL das rodadas anteriores nem iniciar novas chamadas sem autorização.

O release manual pela `main`, no escopo `all`, inclui `ldr-contexto-analise` antes do orquestrador, com JWT de plataforma desativado e autenticação pelo segredo dedicado já configurado. O escopo `orchestrator` continua publicando apenas o orquestrador. O merge por si só executa validações, sem iniciar deploy.

Reversão: restaurar somente o workflow anterior salvo, após conferir que não houve edição concorrente. Se necessário, restaurar a fonte anterior do orquestrador; o campo extra dos snapshots existentes pode permanecer. Retirar a ferramenta do agente antes de desativar a função/segredo. Não restaurar uma configuração antiga inteira sobre mudanças de outra sessão.

Evidências detalhadas, configurações e transcrições ficam exclusivamente no repositório privado, em `outputs/son-2.9-contexto-inicial-2026-10-09/`. Nenhuma credencial ou conversa real pertence a este repositório público.
