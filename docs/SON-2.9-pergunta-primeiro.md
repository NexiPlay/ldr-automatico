# SON-2.9 — pergunta pela empresa antes da apresentação

Publicado em 07/10/2026 às 11:44 BRT por solicitação de Pedro após a escuta da terceira rodada. A apresentação espontânea antes da pergunta de identidade foi substituída por esta sequência:

1. Alô e espera da resposta humana.
2. Falo com a empresa de referência? Sem apresentação espontânea nesse turno.
3. Depois de confirmação e convite para continuar, identificar-se como Bruno, assistente virtual da Tendência Energia, e perguntar uma vez quem cuida da energia.

Perguntas diretas sobre quem fala ou se é IA recebem identidade verdadeira imediatamente. Confirmação simples permite agradecer e encerrar; empresa já identificada não é perguntada novamente. Referência vazia, silêncio, aviso automático, recusa e opt-out encerram sem insistência. A análise de identidade não depende de responsável ou contato humano.

## Publicação e validação

- Aprovação: `bruno-son-2.9-pergunta-primeiro-v3`, política `greeting_then_company_question`.
- Hash de aprovação: `b45483fc0990dae8b3c237835a9b5fa54a7db2dde892b07b02b0aa4912b4da37`.
- Versão do agente: `agtvrsn_5501m4bd6qcxf5kbpdg5w9v4pnx4`.
- Orquestrador v37: somente política e aprovação atualizadas sobre pacote fresco da produção. Index e demais controles preservados, JWT ativo, degrau zero e filas vazias antes e depois.
- Validação final: 22 respostas controladas e nove diálogos completos aprovados; 87 testes Node, 46 de runtime e verificação Deno. Os nove diálogos são o recorte dirigido desta mudança, não a suíte adversarial completa.
- Prompt e descrição de end_call atualizados com leitura de retorno. Análise, voz, modelo, duração e workflow preservados. Nenhuma chamada real nesta publicação.

Políticas anteriores continuam válidas apenas com seus próprios hashes aprovados. A política nova exige explicitamente ordem da pergunta e identificação verdadeira quando solicitada. A mudança não dispensa o hash exato nem os demais portões.

O main com PR #18 ainda precisa incorporar a frente SON-2.9 antes do próximo deploy. Este release preservou o pacote vivo; não incorporou o bloqueio de degrau que só estava no main.
