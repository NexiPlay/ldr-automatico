# SON-1.5 — opt-out pelo resultado pós-chamada

Em 25/09/2026, Pedro substituiu explicitamente o requisito de captura durante a ligação pelo processamento normal do output pós-chamada. `redflag` é um data point Boolean do ElevenLabs, com escopo Conversation. A persistência ocorre quando o webhook recebe a análise; a janela entre pedido e processamento permanece. Nenhuma garantia de bloqueio antes do fim da chamada é feita.

## Comportamento implementado

- `ldr-automatico-webhook` verifica a assinatura e correlaciona `conversation_id`/agente ao telefone salvo. `redflag=true` usa `np_fn_opt_out_registrar` da SON-1.4, separadamente por E.164 e por CNPJ raiz, com `fonte=verbal_chamada`, data do evento, lead e conversation ID na observação.
- Cada RPC da SON-1.4 aceita exatamente uma chave. Ambas são aguardadas antes da resposta de sucesso. Erro parcial responde 5xx e exige reentrega; os upserts usam a mesma data do evento e não criam novas linhas para as mesmas chaves.
- `false` não remove bloqueio. Ausência do campo é `null` (compatibilidade com chamadas anteriores), não uma medição falsa de ausência de pedido. Valores inválidos não viram `false` silenciosamente.
- Veredito e custo mantêm o processamento normal. Um lead bloqueado não recebe a tag `qualificacao:validado-ldr-ia`; se já tinha essa tag, ela é retirada apenas desse lead. Os bloqueios por CNPJ/telefone são a fonte do portão para as demais filiais/números.
- `ldr-automatico-orquestrador` consulta `np_fn_pode_contatar` por número e CNPJ no início e imediatamente antes do POST de telefonia. `false` pula o número; erro/resposta desconhecida para o lote preservando os pendentes. O fluxo de teste já identificado como `origem=ldr-automatico-teste`, que usa CNPJ fictício, bloqueia por telefone.
- Não foi criada tabela, coluna, ferramenta síncrona ou função pública nova. Foram alteradas as duas funções LDR existentes. Guardrails Focus e Manipulation não são editados por esta entrega.

## Configuração no ElevenLabs

Data collection → Add data point → Boolean → Identifier **redflag** → Analysis scope **Conversation**:

> Retorne true quando o interlocutor pedir explicitamente que não sejam feitas novas ligações para ele ou para a empresa, incluindo pedidos equivalentes como retirar o número da lista ou parar de ligar. Considere apenas o pedido do interlocutor, não falas do agente, citações ou hipóteses. Retorne false quando esse pedido não existir, inclusive em indisponibilidade momentânea, pedido para ligar depois ou simples desinteresse sem pedido de cessar contatos.

Substituir apenas o bloco antigo de recusa/opt-out no prompt:

> Se a pessoa pedir para não receber mais ligações — por exemplo, “não me ligue mais”, “retire meu número”, “me tire dessa lista” ou “pare de ligar” — interrompa a qualificação, reconheça o pedido brevemente e encerre usando `end_call`. Não insista, não negocie e não ofereça outro canal. Não diga que o bloqueio já foi gravado: ele será registrado pelo processamento de pós-chamada. “Agora não posso”, “ligue depois” ou “não tenho interesse”, sem pedido para cessar contatos, não significam bloqueio permanente.

Publicar a configuração. O hash de prompt da SON-2.4 continua exigindo revisão da versão publicada; editar no painel não atualiza automaticamente `ldr-approval.json`. O workflow `SON-1.5 - conferir agente (somente leitura)` exporta apenas prompt, abertura, hash e configuração do campo para essa conferência, sem alterar o agente ou discar.

## Validação e publicação

32 testes Node e 26 testes Deno de runtime passaram; tipos das duas funções conferidos. Cobertura inclui true/false/ausência, formato booleano da análise, reentrega, bloqueio por ambas as chaves, falha parcial, assinatura inválida, preservação de custo/veredito e recusa antes da API de telefonia. Testes de runtime não fazem requisições externas.

Publicação concluída em 25/09/2026 no projeto `wbagoinuxgvntvbbnmab`: `ldr-automatico-webhook` **v21** (assinatura HMAC, JWT desativado) e `ldr-automatico-orquestrador` **v24** (JWT ativado), ambas ACTIVE. Os dois fontes e quatro dependências foram baixados após o deploy e conferidos byte a byte contra o Git, sem divergências. Requisições sem assinatura/autenticação receberam HTTP 401. Implementação: [PR #6](https://github.com/NexiPlay/ldr-automatico/pull/6), incorporada em `a2652cc`.

As RPCs reais da SON-1.4 também foram verificadas em transação revertida: telefone bloqueado, outro número/filial bloqueado pelo mesmo CNPJ raiz e reentrega com a mesma data sem duplicação ou incremento da contagem. O ensaio confirmou que nenhum registro de teste persistiu. O teste do orquestrador usa telefonia simulada e verifica a recusa antes do POST; não foi feita tentativa telefônica real.

Na leitura do ElevenLabs às **17:39:37 UTC**, o campo `redflag` Boolean já estava publicado. O prompt ainda mantinha o trecho antigo de gravação antes de encerrar, com o mesmo hash aprovado. A substituição pelo texto acima continua pendente; depois de publicada, a nova versão precisa ter o hash revisado e atualizado na aprovação do orquestrador antes de novas discagens. [Conferência somente leitura](https://github.com/NexiPlay/ldr-automatico/actions/runs/36168492263).

Evidência de versões, hashes e verificações: [deployment.json](evidence/son-1.5/deployment.json). Não houve publicação de frontend ou agente, nem liberação das 200 discagens, que continuam em espera.

O teste de uma conversa real com o data point publicado continua distinto dos testes de integração locais. Não marcar essa prova no checklist antes de existir uma conversa identificada com `redflag=true` e opt-out correspondente no banco.

Contrato do provedor: [post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks) chegam após o encerramento e a análise. A descrição síncrona antiga foi substituída por decisão explícita do usuário.
