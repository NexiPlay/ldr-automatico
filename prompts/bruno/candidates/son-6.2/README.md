# SON-6.2 — artefato promovido em 29/09/2026

Atualização na troca de PC: webhook agora ACTIVE v26, após a correção de JSDoc; orquestrador permanece v28. A comparação de fontes descrita abaixo foi da v25. Falta baixar/comparar v26 e integrar a PR #12, cujo CI passou. [Retomada](../../../../docs/RETOMADA-SON-6.2-2026-09-29.md).

O roteiro permite um único pedido de nome **ou** horário ao intermediário. R5, R6, opt-out, abertura, voz e `end_call` permanecem no contrato anterior. Horário é texto informado, sem agendamento. `prompts/bruno/system.md` e a aprovação `bruno-son-6.2-v1` foram promovidos após autorização explícita.

`data-collection.json` define os dez campos. Os dez cenários de `cases.json` foram incorporados à suíte adversarial com briefing sintético da Oficina Horizonte Ltda. Os 24 cenários passaram; os quatro controles negativos comprovaram o bloqueio das duas violações efetivamente produzidas. Nenhuma ligação telefônica foi feita. A meta de 7/10 segue para a medição real posterior.

Preparação offline:

```sh
node scripts/son62-prepare.mjs snapshot-agente.json diretorio-privado
```

O snapshot deve vir do GET atual do agente. O script confere o agente e hash aprovado, preserva a configuração de voz/ferramentas e gera a proposta de aprovação. Não faz chamadas de rede nem altera arquivos ativos.

O provedor usa `platform_settings.analysis_items`. Na ativação, conferimos em uma branch isolada que escrever o mapa completo de `data_collection` cria as referências automaticamente e preserva os itens existentes. Um PATCH somente de referências não persistiu os novos campos; a releitura detectou isso, e a gravação foi concluída pelo formato de definições já verificado na branch. A versão final ativa é `agtvrsn_4301m3py000ffvfv7gza5mfmmkgy`, com 12 campos e 12 referências.

O preparador offline agora preserva integralmente os campos atuais e emite as definições completas, removendo apenas `llm_billed` da resposta GET. `assertSon62Published` exige uma releitura com o prompt e todos os campos iguais à proposta. HTTP 200 sozinho não comprova persistência. Não aplicar `promptPatch` isoladamente. Para novas alterações, revalidar a configuração atual e usar uma branch de preparação.

O parser aceita resultados pelo nome da chave ou pelo campo `name` do item, quando a chave é um ID. Evidências devem ser trechos literais da fala do cliente; correspondência textual não prova interpretação semântica. A revisão humana continua necessária.

A promoção coordenou prompt remoto, artefato aprovado e gate de release durante uma janela sem novas chamadas. Webhook v25 e orquestrador v28 foram publicados após aprovação da suíte e tiveram seus fontes baixados e comparados. A primeira mensagem, voz, ferramentas, configurações não relacionadas, veredito/opt-out e portão SON-1.7 foram preservados. O hash aprovado é `29bede9e71b3615a7021dfd972468c308f92626fafe74ab02eabcd6f7fd4632d`.

Referência de contrato: [Update agent](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/update) e OpenAPI oficial consultado em 29/09/2026.
