# SON-2.9 — empresa primeiro e fala curta

Publicado em 06/10/2026 às 13:09 BRT, após o feedback de Pedro na segunda rodada de 50 chamadas. A apresentação antiga anunciava gravação e duas finalidades e podia consumir o tempo disponível antes da pergunta de identidade.

Abertura após Alô: **“Sou Bruno, assistente virtual da Tendência Energia. Falo com a {{empresa}}?”** O nome vem da referência recebida; nome fantasia só quando vinculado no briefing. Cargo, setor ou dizer que cuida da energia não confirmam empresa.

Empresa identificada espontaneamente é aproveitada. Um sim simples encerra com agradecimento. Somente após confirmação por humano e convite para continuar cabe uma pergunta: **“Quem cuida da energia aí?”** Nome e horário não são exigidos; resposta, recusa ou falta de tempo encerram sem insistência. Não oferece ajuda adicional.

Retirado o anúncio espontâneo de gravação por pedido expresso do usuário. Mantida a identificação de assistente virtual e resposta verdadeira caso a pessoa pergunte sobre IA/gravação. Essa alteração de roteiro não desativa gravação ou altera retenção.

URA/aviso técnico encerra pela ferramenta sem apresentação. URA institucional pode confirmar a empresa; destino inacessível, sem identidade, continua SEM_ATENDIMENTO e não prova número errado. Os 22 avisos nas transcrições da rodada anterior são um diagnóstico separado de telefonia/disponibilidade; não se atribuiu causa definitiva nem se alterou o tronco.

## Publicação

- Agente: agtvrsn_5801m48znnxafv08ry7y2y4h5q7q; aprovação bruno-son-2.9-empresa-primeiro-v2.
- Prompt/abertura SHA256: fd9cc94ab41fb411fc71c497a1963be200f35da49d487fe27ae05f092d5a5e8a.
- Orquestrador v36; verify_jwt=true. Somente ldr-policy.mjs e ldr-approval.json alterados no pacote baixado de produção; sete arquivos conferidos após publicação.
- end_call com descrição curta e pre_tool_speech=off. Dados de análise, voz, modelos, workflow e duração máxima de 120s já existente preservados.
- Nova política explícita greeting_then_company_check. Políticas R5 históricas continuam exigindo seus próprios elementos; o hash exato continua obrigatório antes de discar.
- Filas vazias e limite diário zero antes/depois. Nenhuma chamada real nesta alteração.

## Evidência e limites

81 testes Node, 46 de runtime e tipagem aprovados. A última versão passou nos 16 cenários controlados: empresa primeiro, financeiro/cargo sem identidade, sim simples, convite explícito, informação espontânea, URA institucional/genérica, destino inacessível, referência ausente, recusa, opt-out e responsável ausente. Abertura medida de 13 palavras nos casos sintéticos e despedida de três após sim.

Houve nove testes iniciais com simulador de conversa, cujos resultados incluíram falhas reais e avaliações inconsistentes; os históricos foram preservados em evidência privada. A primeira rodada controlada ficou em 14/16. Após os dois ajustes, a rodada final ficou em 16/16. Total de 41 execuções de simulação no provedor, sem telefones. Não reutilizar aprovação das tentativas anteriores nem declarar que os 27 cenários de conversa livre passaram nesta versão.

Os cenários controlados testam a próxima ação com histórico fixo; não substituem conversas completas, áudio/ASR ou auditoria humana. Taxa de 50% de confirmação permanece uma meta de negócio sem comprovação nesta mudança. Gate A continua pendente.

[Recibo](son-2.9/empresa-primeiro-release.json) · [Validação](son-2.9/empresa-primeiro-validation.json)
