# Edge Functions — LDR Automático

Convenção herdada do `nexi-lead-360` (mesmo projeto Supabase,
`wbagoinuxgvntvbbnmab`): uma pasta por function, `index.ts` dentro, deploy via
Supabase CLI. Nada aqui foi deployado ainda.

## `ldr-automatico-webhook`

Recebe o evento `post_call_transcription` do ElevenLabs quando uma ligação
termina, e grava o veredito (`ia_resultado`) no telefone testado —
correlação por `conversation_id` (coluna `ia_conversation_id`, migration
`0320`). Quando o veredito é `confirmado`, aplica a tag
`qualificacao:validado-ldr-ia` (migration `0321`) no lead.

### Deploy

```
supabase functions deploy ldr-automatico-webhook --project-ref wbagoinuxgvntvbbnmab
```

### Secrets necessários (Supabase → Project Settings → Edge Functions)

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — já existem no projeto (usados por outras functions).
- `ELEVENLABS_WEBHOOK_SECRET` — **novo**, gerado pelo ElevenLabs quando o webhook é cadastrado no
  painel do agente (Webhooks → Add). **Não é a API key** usada pra disparar chamadas — são segredos
  diferentes, cadastrados em telas diferentes do ElevenLabs. Só entra como secret do Supabase, nunca
  em arquivo/commit.

### URL a passar pro Pedro

Depois do deploy, a URL a cadastrar no ElevenLabs (evento "Post-call transcription", ou o nome
equivalente na versão do painel dele) é:

```
https://wbagoinuxgvntvbbnmab.supabase.co/functions/v1/ldr-automatico-webhook
```

### O que falta pra isso funcionar de ponta a ponta

1. Aplicar as migrations `0320`-`0323` no banco de verdade (ver `../migrations/README.md`).
2. Fazer o deploy acima e configurar os secrets.
3. Pedro cadastrar a URL + copiar o `ELEVENLABS_WEBHOOK_SECRET` gerado pro secret do Supabase.
4. Construir o orquestrador (Igor — passo 3 do `TASKS.md`): é ele quem dispara
   `POST /v1/convai/sip-trunk/outbound-call` e grava o `conversation_id` da resposta em
   `np_lead_telefones.ia_conversation_id` **antes** da ligação acontecer — sem isso, este webhook
   recebe o resultado mas não acha o telefone pra gravar (fica registrado como
   `telefone_nao_encontrado`, não é erro, só fica sem match).
