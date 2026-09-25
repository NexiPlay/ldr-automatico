# SON-2.8 — reputação antes de cada chamada

Implementado e testado localmente em 25/09/2026; **não publicado**.

O orquestrador resolve o telefone de origem pela API oficial de phone-numbers e consulta `np_fn_sonar_reputacao_portao` imediatamente antes de cada POST. Uma pausa durante o lote impede a próxima discagem e mantém os demais telefones pendentes. Erro ou resposta incompleta do monitor não autoriza chamada. Uma chamada já autorizada/em andamento pode continuar.

O webhook assinado registra `conversation_id`, agente, origem, início, duração e estado, inclusive para chamadas sem lead correlacionado. Reentregas são deduplicadas no banco. Origem vem de `metadata.phone_call.agent_number`, nunca do telefone de destino. Dados sem duração não viram zero. Web/widget/inbound não entram.

**Dependência obrigatória:** branch `feat/son-2.8-reputacao` no repo `NexiPlay/nexilead`, migration `0389_np_sonar_reputacao.sql`. Ali ficam as tabelas/RPCs/RLS, janela de 24h, painel, alertas, dono e integração SDR. Limiares: ≥30% alerta e ≥60% bloqueio; pausa manual persistida em um clique. Responsável: Pedro Tibúrcio (SON-2.8). O módulo `_shared/sonar-reputacao.ts` é igual nos dois repos e deve continuar sincronizado.

Validado: 20 testes runtime sem rede, 28 testes de política/release, R5 local e `deno check`. Teste existente de CRLF corrigido para Windows sem alterar prompt/hash. Novos cenários verificam pausa no meio do lote, indisponibilidade e ingestão somente após assinatura válida. Nenhuma chamada real.

Após revisão, autorização e aplicação da migration, executar `ldr-release.yml` **na main**, preservando environment production, R5 remoto e suíte existentes. O workflow verifica a presença do schema e publica primeiro o webhook (assinatura, JWT=false), depois o orquestrador (JWT=true). A publicação SDR e frontend é coordenada pelo repo nexilead. Sem novos secrets. Dados anteriores não são importados; a cobertura é dos eventos entregues aos webhooks. Outros discadores/chamadas diretas ao provedor não passam por esse gate.

Não concluir SON-2.8 enquanto banco, quatro funções e painel não estiverem publicados e conferidos. O bloqueio do piloto SON-4.4 e a avaliação SON-4.5 são independentes deste monitor.
