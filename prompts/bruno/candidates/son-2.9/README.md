# SON-2.9 — interpretação da identidade

Permite confirmar a empresa pela identificação institucional de pessoa ou gravação, mantendo tipo de atendimento e dados de contato separados. Briefing vazio não invalida referência preenchida. Marca diferente sem vínculo documentado é inconclusiva; número errado exige negativa explícita.

Arquivos: system.md (prompt completo), identity-policy.md (política comum ao prompt/análise), data-collection.json (definições de análise), cases.json (33 cenários sintéticos), baseline-system.md e baseline-approval.json (base imutável anterior). A cópia canônica vigente fica em prompts/bruno/system.md e prompts/bruno/data-collection.json.

Preparação offline da mesma migração:

    node scripts/son29-identity-prepare.mjs CAMINHO_SNAPSHOT_GET.json PASTA_PRIVADA
    node --test tests/*.test.mjs

O snapshot pode ser o GET completo ou projeção com agent_id, version_id, prompt, first_message e data_collection. Não salvar snapshots de produção, chamadas ou revisões humanas neste repositório público. O preparador não faz rede; exige o baseline revisado e preserva voz, modelo, ferramentas, opt-out e demais campos. Antes de publicar, assertSon29Base detecta deriva; assertSon29Published confere prompt E análise no GET posterior.

A análise pós-chamada não recebe automaticamente variáveis só por citar placeholders na descrição. O prompt leva referência e briefing nos argumentos internos de end_call, sem falar esses dados. A análise usa-os apenas para comparar; o veredito do agente não é prova. Sem referência disponível na transcrição/ferramenta, preserva dúvida.

Limites: simulações de texto não validam ASR/áudio e não provam a taxa real de acerto. Em um teste direto com referência vazia, houve pergunta indevida apesar do resultado inconclusivo; é um caso de acompanhamento, não falso confirmado. Chamadas interrompidas antes do fechamento podem não transportar referência ao analisador. O histórico não é reclassificado. Após publicação, auditar OUTRA amostra humana de 50 chamadas; limiar de 90%, com a rodada antiga preservada.

Publicado e relido em produção em 06/10/2026, versão bruno-son-2.9-identidade-v1. Orquestrador v35; única mudança no bundle: ldr-approval.json. Gates obrigatórios: 67 testes Node, 46 runtime, tipagem, 24/24 adversariais com conferência de transcrição e 4/4 controles negativos rejeitados. Benchmark adicional: 32/33 classificações corretas; a URA genérica após pergunta do Bruno ficou INCONCLUSIVO em vez de SEM_ATENDIMENTO. Essa divergência conservadora foi registrada, sem fingir aprovação integral do benchmark. Nenhum falso CONFIRMADO na rodada final. Recibo e resultados sintéticos: docs/son-2.9/.
