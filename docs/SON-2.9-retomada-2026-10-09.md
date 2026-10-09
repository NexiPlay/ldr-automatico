# Bruno: retomada em 09/10/2026

Trabalho pausado a pedido de Pedro. Continue na branch fix/son-2.9-interpretacao. O pacote de áudios, revisões, experimentos e instruções de instalação fica no repositório privado NexiPlay/nexilead, em documentacao/RETOMADA-SONAR-2026-10-09.md. Este repositório público contém apenas código, configurações sem credenciais e casos sintéticos.

## Estado publicado

Agente: agtvrsn_8801m4gjnayremqrnhsxcwd4m03h. Conversa: GPT-4.1; análise pós-chamada: gemini-3.1-pro-preview. Os arquivos prompts/bruno/data-collection.json e analysis-config.json refletem a análise publicada. Aprovação do roteiro: bruno-son-2.9-esclarecer-identidade-v4, hash 6cc2c9c74c2ef662f3e602b03e08393586d2caa1183d5f3986a5edf4e779cfd6. A aprovação do roteiro não cobre, sozinha, a configuração completa da análise; conferir o snapshot e recibo no pacote privado.

Orquestrador v45, com o mesmo código conferido em v44: nome curto a partir do mesmo cadastro e fiscalização do degrau antes de cada POST de discagem. O degrau ficou em zero; filas vazias. A exceção de 50 chamadas adicionais em 09/10 já foi consumida e restaurada; não repetir scripts de disparo ou SQL histórico.

## Validação e limitações

Roteiro v4: 91 testes Node, 48 de runtime, 31 cenários focados e nove diálogos completos passaram antes da publicação. Análise atual: replay das 50 transcrições, zero falas adicionais, 12 confirmações (24%), 41 concordâncias (82%) com as marcações humanas e nenhum falso confirmado nessa amostra; 24/24 controles e 12 testes locais passaram. As 20 confirmações humanas não foram alcançadas. O replay é avaliação na amostra usada no ajuste, sem garantia de desempenho em novas chamadas. Houve uma regressão de confirmação por falta de referência independente; detalhes completos no pacote privado.

## Trabalho interrompido

Pedro autorizou alterar as configurações para melhorar assertividade, mas depois pediu pausa e envio ao GitHub. A etapa seguinte fez apenas leitura do agente e do esquema oficial. Nenhuma nova configuração foi publicada nessa etapa, nenhum novo teste de modelo ou telefonema foi iniciado.

Próximos pontos: resolver a chegada da referência e do briefing ao analisador mesmo quando a chamada acaba sem end_call; alinhar a política da conversa, ainda mais conservadora para nomes fonéticos, à análise; avaliar palavras-chave por empresa no ASR e parâmetros de turno para reduzir nomes trocados e interrupções. Keywords de ASR estão vazias e o override está desabilitado; retranscribe_on_turn_timeout está false. A documentação consultada informa que Code Tools exige Enterprise, portanto não presumir disponibilidade. Não trocar incerteza por confirmação sem evidência nem sobrescrever rótulos históricos.

Ao retomar, baixar novamente as funções e ler o agente vivo antes de editar: produção e main podem avançar em paralelo. Não aplicar configurações antigas de main sobre esta versão. Não executar scripts históricos de publicação como inicialização do ambiente.
