# SON-2.9 — amostra e revisão humana do Gate A

Em 02/10/2026, Pedro pediu preparar 50 chamadas já executadas recentemente para
revisão humana. GitHub conferido antes da execução: base `origin/main` em
`4f1b981`, sem PR/issue da SON-2.9. Trabalho separado na branch
`feat/son-2.9-gate-a`.

## Amostra preparada

- Lote real: `guarulhos_piloto_398`.
- População congelada em 02/10/2026, 17:07:25 BRT: 218 chamadas do Bruno,
  realizadas depois da publicação de 01/10/2026, 13:15 BRT.
- Todas com o mesmo hash de prompt registrado por chamada:
  `a643c708dcf37e4d7e6265d4bc762ed389254775d48e804b7c1d45f36ae6e535`.
- 50 sorteadas sem reposição, sem filtro por veredito, duração, transcrição ou
  disponibilidade de áudio. Semente aleatória criptográfica e população
  congeladas antes de buscar o conteúdo das chamadas.
- Identificador da amostra: `ae48af2f734489df40146d0c`.
- 32 chamadas de 01/10 e 18 de 02/10; 50 transcrições; duração somada de 17min33s.
- Distribuição do robô: 43 `sem_atendimento`, 5 `inconclusivo`, 1 `confirmado`,
  1 `nao_confirmado`. Isso descreve a amostra, não mede acerto.

A associação ao lote é a do lead no instante da captura. O hash é o carimbo
SON-2.10 por conversa, que inclui voz; não é o hash de aprovação de prompt e
abertura da R5. A preparação não afirma que versões anteriores passaram.

## Entrega e estado

O pacote privado fica em `artifacts/son-2.9/pacote/`, ignorado pelo Git:

- `revisar.html`: revisão chamada a chamada, transcrição, campo para referência
  humana, confirmação de escuta, evidência, exportação e retomada das revisões.
- `comparacao.csv`: comparação em planilha; inclui os campos humanos quando o
  build recebe um checkpoint de revisões.
- `amostra.json`: contexto e identidade de cada chamada sorteada.
- `audio/`: destino das gravações após download autorizado com a credencial existente.

O formulário esconde inicialmente o resultado do robô para a pessoa registrar
primeiro o próprio veredito. Salva no navegador, exporta JSON/CSV e permite
retomar o JSON apenas na mesma amostra. As revisões não são enviadas ao banco.

### Checkpoint de 03/10/2026

Pedro pediu salvar o progresso no GitHub para continuar em outro computador.
Foram recuperados dois registros humanos do navegador, sem modificar seus
vereditos, confirmação de escuta, comentários ou datas. Ambos ainda não têm o
nome do revisor: são dois registros preservados e zero revisões completas pelo
critério do Gate A. A identificação deve ser preenchida pela pessoa ao retomar.

O HTML agora pode incorporar um checkpoint. Em um navegador novo, carrega os
registros automaticamente; se houver dados locais, conserva a edição mais
recente de cada conversa. O JSON original também é guardado separadamente.
As novas alterações continuam locais e precisam ser exportadas para transporte.

O GitHub confirmou em 03/10 que `NexiPlay/ldr-automatico` é público. Por isso,
o código fica nesta branch e o pacote com dados das chamadas e revisões fica
no repositório **privado** `NexiPlay/nexilead`, branch
`feat/son-2.9-checkpoint`, pasta `documentacao/sonar/son-2.9-checkpoint/`.

**Pendente:** localizar a configuração da ElevenLabs para baixar os áudios.
Não há `ELEVENLABS_API_KEY` no ambiente nem arquivo `.env` nos repositórios
locais consultados; não foi encontrada integração ElevenLabs no catálogo de
plugins. Nenhum áudio está arquivado em `np_ldr_conversas`. O caminho do arquivo
de ambiente foi solicitado ao Pedro, sem pedir a chave no chat. As transcrições
estão no pacote, mas não substituem a escuta exigida pelo card.

O Gate A permanece pendente. Só depois de 50 referências humanas completas,
com identificação do revisor, escuta e evidência, o cálculo aceita ≥45 acertos.
44 reprova; 49 revisões, mesmo perfeitas, não aprovam. Áudio indisponível não é
excluído do denominador nem trocado por outra chamada. Um veredito ausente do
robô não conta como acerto. A ferramenta não conclui a task nem libera o SDR.

## Reprodução

O SQL de captura seleciona o agente Bruno, o lote e o período acima. A seleção
usa `SHA-256(semente + "\n" + conversation_id)`, ordena os hashes e pega os 50
primeiros. O manifesto registra população, semente, hash da população, IDs
sorteados, hash do prompt e instante de captura. O comando recusa sobrescrever
um manifesto existente.

```sh
node scripts/son29-prepare.mjs select candidates.json artifacts/son-2.9/manifest.json
# Executar o SQL de leitura gerado em manifest.json.sql e salvar a resposta em details.json.
node scripts/son29-prepare.mjs build artifacts/son-2.9/manifest.json artifacts/son-2.9/details.json artifacts/son-2.9/pacote
# Para incorporar e preservar revisões existentes, acrescente o JSON como último argumento:
node scripts/son29-prepare.mjs build artifacts/son-2.9/manifest.json artifacts/son-2.9/details.json artifacts/son-2.9/pacote artifacts/son-2.9/revisoes-recuperadas.json
```

Para incluir os áudios, usando apenas GET na API oficial da ElevenLabs:

```sh
node --env-file=CAMINHO_DO_ENV scripts/son29-audio.mjs artifacts/son-2.9/manifest.json artifacts/son-2.9/pacote
# Repetir o build para ligar o player aos MP3s baixados.
```

O downloader valida ID da conversa e agente, registra tamanho e SHA-256 dos
arquivos, respeita 429/5xx com retentativas e para em erro de autenticação.
Ele mantém as mesmas 50 chamadas. Não disca, não roda simulações e não muda
prompt ou agente. Referência: [GET do áudio da conversa](https://elevenlabs.io/docs/api-reference/conversations/get-audio).

## Validação

72 testes Node passaram, incluindo onze casos de sorteio, Gate A e checkpoints.
Teste no Chrome com perfil temporário: 50 itens, salvamento após recarregar,
exportação/importação, 49 referências mantendo pendência, 45/50 aprovando,
44/50 reprovando e layout móvel sem rolagem horizontal. Todas as avaliações
usadas no teste foram fictícias e ficaram fora do pacote de entrega.
O checkpoint também foi aberto em um perfil temporário vazio: as duas revisões
recuperadas apareceram integralmente, a exportação preservou seus campos e
uma edição local mais recente sobreviveu ao recarregamento do pacote.

```sh
node --test tests/*.test.mjs
```
