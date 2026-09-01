# Edge Functions — LDR Automático

Convenção herdada do `nexi-lead-360` (mesmo projeto Supabase,
`wbagoinuxgvntvbbnmab`): uma pasta por function, `index.ts` dentro, deploy via
Supabase CLI. As duas abaixo já estão deployadas e testadas (01/09/2026).

## `ldr-automatico-webhook`

Recebe o evento `post_call_transcription` do ElevenLabs quando uma ligação
termina, e grava o veredito (`ia_resultado`) no telefone testado —
correlação por `conversation_id` (coluna `ia_conversation_id`, migration
`0320`). Quando o veredito é `confirmado`, aplica a tag
`qualificacao:validado-ldr-ia` (migration `0321`) no lead. **Sem JWT**
(`--no-verify-jwt`) — quem chama é o ElevenLabs, não um usuário logado; a
segurança é a assinatura HMAC (`ElevenLabs-Signature`).

URL ativa: `https://wbagoinuxgvntvbbnmab.supabase.co/functions/v1/ldr-automatico-webhook`

### Secrets

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — já existiam no projeto.
- `ELEVENLABS_WEBHOOK_SECRET` — cadastrado (gerado pelo ElevenLabs quando o Pedro configurou o
  webhook no painel do agente). **Não é a API key** — segredos diferentes, telas diferentes.

## `ldr-automatico-orquestrador`

Dispara as ligações. Entrada: `POST { telefone_ids: string[] }` — lista escolhida a dedo (botão
manual no dashboard, decisão do Igor em 01/09: nada de pool automático nesta fase, escopo do
piloto é ~20 números). Pra cada telefone: busca o nome do lead (`dynamic_variables.empresa`),
dispara `POST /v1/convai/sip-trunk/outbound-call` e grava o `conversation_id` devolvido em
`ia_conversation_id` — é esse campo que o webhook usa depois pra achar o telefone certo. Espera 4s
entre ligações, pula telefone que já foi discado antes, trava em 50 por lote. **Com JWT**
(default) — só usuário autenticado no dashboard consegue chamar.

URL ativa: `https://wbagoinuxgvntvbbnmab.supabase.co/functions/v1/ldr-automatico-orquestrador`

### Secrets

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — já existiam.
- `ELEVENLABS_API_KEY` — a API key de disparo de chamadas (diferente do `ELEVENLABS_WEBHOOK_SECRET`
  acima). Nunca em arquivo/commit, só secret do Supabase.
- `ELEVENLABS_AGENT_ID` / `ELEVENLABS_AGENT_PHONE_NUMBER_ID` — fixos da conta Nexi no ElevenLabs
  (não são segredo, ficam como env var só pra poder trocar sem redeploy).

## Deploy (referência — sem Docker local, via Management API)

```
supabase functions deploy <nome> --project-ref wbagoinuxgvntvbbnmab --use-api [--no-verify-jwt]
```

`--no-verify-jwt` só no webhook. `supabase secrets set NOME=valor --project-ref wbagoinuxgvntvbbnmab`
pra cadastrar/atualizar secret — precisa de `SUPABASE_ACCESS_TOKEN` (Personal Access Token, gerado em
supabase.com/dashboard/account/tokens), não precisa de senha de Postgres.

## O que falta pra rodar o piloto de ponta a ponta

1. ~~Aplicar as migrations `0320`-`0323` no banco de verdade~~ — feito 01/09 (ver `../migrations/README.md`).
2. ~~Deploy do webhook + orquestrador~~ — feito 01/09.
3. **Tela/botão no dashboard** (`nexi-lead-360/frontend`) pra escolher os leads do piloto e chamar
   `ldr-automatico-orquestrador` com os `telefone_ids` certos — ainda não existe, é o próximo passo.
4. Validação jurídica (Anatel + LGPD) — continua bloqueando qualquer disparo fora do piloto controlado.
