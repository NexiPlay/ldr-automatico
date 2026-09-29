# SON-6.2 — candidato, ainda não ativo

O roteiro permite um único pedido de nome **ou** horário ao intermediário. R5, R6, opt-out, abertura, voz e `end_call` permanecem no contrato anterior. Horário é texto informado, sem agendamento. A aprovação ativa e `prompts/bruno/system.md` não foram alterados.

`data-collection.json` define os dez campos. `cases.json` contém dez cenários de comportamento para executar após a autorização de ativação; não são resultados medidos. Usar a empresa fictícia Oficina Horizonte Ltda e briefing sintético. Ao promover, incorporar estes cenários à suíte adversarial existente, preservando os casos de R5/R6 e os controles negativos.

Preparação offline:

```sh
node scripts/son62-prepare.mjs snapshot-agente.json diretorio-privado
```

O snapshot deve vir do GET atual do agente. O script confere o agente e hash aprovado, preserva a configuração de voz/ferramentas e gera a proposta de aprovação. Não faz chamadas de rede nem altera arquivos ativos.

O agente Bruno consultado em 29/09/2026 já usa `platform_settings.analysis_items`. Os itens existentes de veredito e opt-out devem permanecer. Neste modo, a preparação devolve `patch: null` até receber os IDs e versões reais dos dez novos itens de coleta. Não aplicar `promptPatch` sozinho. Criar os itens com os nomes exatos `son62_*`, tipos e descrições da proposta; conferir a definição salva de cada um. Essa criação é uma alteração remota, parte da ativação autorizada.

Depois, passar um JSON `novas-referencias.json`: mapa das dez chaves para `{ "source":"user", "analysis_item_id":"aitem_...", "version_id":"versão real publicada" }`. O terceiro argumento gera o PATCH com as referências antigas preservadas e as novas fixadas por versão. IDs repetidos ou versões ausentes são recusados. O script não prova que os IDs fornecidos correspondem às definições: isso precisa ser conferido no provedor antes do PATCH.

O parser aceita resultados pelo nome da chave ou pelo campo `name` do item, quando a chave é um ID. Evidências devem ser trechos literais da fala do cliente; correspondência textual não prova interpretação semântica. A revisão humana continua necessária.

A promoção deve coordenar prompt remoto, artefato local aprovado e gate de release durante uma janela sem novos disparos. Revalidar todos os campos após o PATCH. Mudar somente o prompt remoto fará o portão de aprovação bloquear chamadas por divergência. A medição real fica para depois das tasks, conforme decisão do solicitante.

Referência de contrato: [Update agent](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/update) e OpenAPI oficial consultado em 29/09/2026.
