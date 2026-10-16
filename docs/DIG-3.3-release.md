# DIG-3.3: release conjunto Bruno e Karla

O discador Bruno deve usar a candidata DIG-3.1 aprovada, com a branch enviada ao provedor e a versão conferida antes da chamada. A Karla Digital deve usar o contexto validado no servidor e a mesma candidata examinada pela suíte conjunta. Antes desta mudança, a release LDR examinava somente a suíte histórica do Bruno e não vinculava ambos os agentes ao mesmo pacote.

O workflow `ldr-release.yml` exige os testes locais, 45 simulações do Bruno, 20 da Karla e um controle negativo comportamental em cada agente. As ferramentas externas das simulações são mocks. O controle negativo usa override exclusivo do endpoint de testes; não modifica agentes. Falha, resultado inconclusivo, versão divergente, draft, transcrição ausente ou alteração de definição/fonte bloqueiam a publicação. A evidência é reconsultada no provedor imediatamente antes do deploy.

`tests/digital/upstream.json` registra o commit NexiLead e os hashes das fontes incorporadas. `python scripts/digital-suite.py` confere o pacote e os vínculos dos dois discadores. Para atualizar, usar `--source <checkout-NexiLead-com-fontes-commitadas>` e revisar o diff. A configuração ativa é `tests/digital/prompts/digital/suite.json`, com 65 casos; `release.json` preserva somente o registro histórico inicial.

Os três casos PBT-2.3 foram reconstruídos a partir dos bugs descritos no card. A suíte original e seus IDs não foram encontrados. O solicitante autorizou seguir e documentar essa ausência. Esses testes não são apresentados como execução da suíte histórica. As duas perguntas diretas sobre IA e gravação cobrem a lacuna apontada por Warley na DIG-3.1. O parecer humano anterior mantém seu escopo; a revisão posterior da DIG-3.3 não é atribuída automaticamente a Warley ou Marcus.

## Publicação

Após merge e Checks aprovados, executar `workflow_dispatch` na `main`, com `scope=digital`. Esse escopo publica `ldr-automatico-webhook`, `ldr-automatico-orquestrador` e `karla-dialer`, preservando os valores de `verify_jwt`. O webhook Karla v28 já contém a integração de custos e foi comparado com a fonte versionada. O preflight exige as migrações 0450 e 0458, incluindo acesso exclusivo do servidor à RPC de contexto. Não ativa campanha, orçamento, janela, degrau nem a flag Digital; também não altera o 3CX. Os outros escopos preservam suas funções, sujeitos à mesma trava conjunta.

O artefato `ldr-adversarial-<commit>` guarda os resultados brutos e os controles negativos por 30 dias. Contém dados técnicos da conta e deve permanecer restrito. A documentação NexiLead guarda um recibo reduzido, sem chaves, configuração privada de ferramentas ou telefone pessoal. A existência do environment `production` não implica aprovação humana: na consulta de 16/10 ele não tinha regras de proteção.

Depois do deploy, baixar as funções publicadas e comparar seus arquivos com o pacote, conferindo versões, autenticação e branches. A publicação das funções não substitui o ensaio real.

## Ensaio autorizado e pendências

Pedro autorizou somente seu destino interno, guardado em evidência privada, para **19/10/2026 às 11h de Brasília**, com **teto total de R$ 20**. Nenhuma ligação é autorizada antes dessa data. Não há automação agendada por este documento. O operador precisa estar presente; controlar o total de telefonia e voz, sem interpretar o teto como valor por ligação.

O ensaio deve conferir áudio, interrupção, duração, captura da empresa/responsável, perguntas diretas de IA/gravação, recusa/opt-out persistido, bloqueio de repetição e carimbo SON-2.10 na conversa real. A taxa de confirmação em produção não é derivada das simulações. O acesso ao 3CX segue indisponível; sua configuração existente é preservada e qualquer falha de tronco exige diagnóstico antes de repetir chamadas.

Se a trava conjunta falhar, não publicar nem reutilizar uma rodada antiga aprovada. Corrigir o motivo, preservar a evidência anterior e executar nova rodada. Em falha operacional após publicação, parar os disparos e reconciliar eventuais reservas de custo antes de tentar novamente.
