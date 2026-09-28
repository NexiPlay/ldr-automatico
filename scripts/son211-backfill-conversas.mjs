// SON-2.11 — backfill: trazer para casa as conversas que já aconteceram.
//
// O card manda importar o passivo ANTES de descobrir o prazo de retenção da
// ElevenLabs, e não o contrário: o que for apagado lá não volta.
//
// É retomável de propósito. A lista de pendentes vem da view
// `vw_np_ldr_conversas_pendentes`, que é a própria query de aceitação da task —
// então rodar de novo depois de uma queda só processa o que faltou, e rodar com
// tudo pronto não faz nada. Não existe "já rodou, não pode rodar de novo".
//
// Não dispara ligação nenhuma: só lê conversa encerrada.
//
//   node scripts/son211-backfill-conversas.mjs [--limite N] [--dry-run]
//
// Variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ELEVENLABS_API_KEY.

import { gravarConversa, montarLinha } from "../backend/edge-functions/_shared/ldr-conversa.ts";

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE = env("SUPABASE_SERVICE_ROLE_KEY");
const ELEVEN_KEY = env("ELEVENLABS_API_KEY");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMITE = numero(args, "--limite");
const PAUSA_MS = 250;

function env(nome) {
  const valor = process.env[nome];
  // Abortar alto. Um backfill que roda "pela metade" por falta de credencial
  // deixa a tabela num estado que parece completo e não é.
  if (!valor) {
    console.error(`Variável de ambiente obrigatória ausente: ${nome}`);
    process.exit(1);
  }
  return valor;
}

function numero(lista, flag) {
  const i = lista.indexOf(flag);
  if (i === -1) return null;
  const n = Number(lista[i + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${flag} precisa de um inteiro positivo`);
    process.exit(1);
  }
  return n;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// PostgREST cru: este repositório não tem node_modules, e todos os scripts aqui
// usam só built-ins. O adaptador abaixo tem a forma mínima que `gravarConversa`
// espera, para que a REGRA de gravação (não sobrescrever transcript bom com
// vazio) continue vindo do módulo compartilhado, e não seja reescrita aqui.
// ---------------------------------------------------------------------------

async function rest(caminho, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

const sb = {
  from(tabela) {
    return {
      async upsert(linha, opts) {
        if (DRY_RUN) return { error: null };
        const resolucao = opts?.ignoreDuplicates ? "ignore-duplicates" : "merge-duplicates";
        const res = await rest(`${tabela}?on_conflict=${encodeURIComponent(opts?.onConflict ?? "")}`, {
          method: "POST",
          body: JSON.stringify(linha),
          headers: { Prefer: `resolution=${resolucao},return=minimal` },
        });
        if (!res.ok) return { error: { message: `HTTP ${res.status}: ${await res.text()}` } };
        return { error: null };
      },
    };
  },
};

async function pendentes() {
  const fora = [];
  // A view devolve no máximo 1000 por página; as 431 cabem, mas paginar é o que
  // impede o script de mentir silenciosamente se a base crescer.
  for (let offset = 0; ; offset += 1000) {
    const res = await rest(
      `vw_np_ldr_conversas_pendentes?select=conversation_id,telefone_id,lead_id&limit=1000&offset=${offset}`,
    );
    if (!res.ok) {
      console.error(`Falha lendo pendentes: HTTP ${res.status} — ${await res.text()}`);
      process.exit(1);
    }
    const pagina = await res.json();
    fora.push(...pagina);
    if (pagina.length < 1000) return fora;
  }
}

/** GET da conversa, com retentativa em 429 e 5xx. 404 é definitivo. */
async function buscarConversa(conversationId, tentativa = 1) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    { headers: { "xi-api-key": ELEVEN_KEY }, signal: AbortSignal.timeout(30_000) },
  );
  if (res.ok) return { ok: true, corpo: await res.json() };

  // 404 quer dizer que a ElevenLabs já não tem essa conversa. É o Risco 1 do
  // card acontecendo — não adianta insistir, mas tem de aparecer no relatório.
  if (res.status === 404) return { ok: false, motivo: "nao_existe_mais_na_elevenlabs", definitivo: true };

  if ((res.status === 429 || res.status >= 500) && tentativa <= 4) {
    const espera = 1000 * 2 ** (tentativa - 1);
    console.log(`   HTTP ${res.status}, tentando de novo em ${espera}ms (${tentativa}/4)`);
    await dormir(espera);
    return buscarConversa(conversationId, tentativa + 1);
  }
  return { ok: false, motivo: `http_${res.status}`, definitivo: false };
}

// ---------------------------------------------------------------------------

const lista = await pendentes();
const alvo = LIMITE ? lista.slice(0, LIMITE) : lista;

console.log(`Pendentes na view: ${lista.length}`);
console.log(`Vou processar:     ${alvo.length}${DRY_RUN ? "  (DRY-RUN: nada é gravado)" : ""}`);
if (!alvo.length) {
  console.log("Nada a fazer. A query de aceitação já está em 0.");
  process.exit(0);
}

let gravadas = 0, comTranscript = 0, semTranscript = 0;
const falhas = [];

for (const [i, p] of alvo.entries()) {
  const posicao = `[${i + 1}/${alvo.length}]`;
  const busca = await buscarConversa(p.conversation_id);

  if (!busca.ok) {
    falhas.push({ conversation_id: p.conversation_id, motivo: busca.motivo });
    console.log(`${posicao} ${p.conversation_id} — FALHA: ${busca.motivo}`);
    await dormir(PAUSA_MS);
    continue;
  }

  const linha = montarLinha(busca.corpo, {
    conversationId: p.conversation_id,
    origem: "backfill",
    telefoneId: p.telefone_id,
    leadId: p.lead_id,
  });

  const r = await gravarConversa(sb, linha);
  if (!r.ok) {
    falhas.push({ conversation_id: p.conversation_id, motivo: r.motivo });
    console.log(`${posicao} ${p.conversation_id} — ERRO GRAVANDO: ${r.motivo}`);
  } else {
    gravadas++;
    if (linha.transcript.length) comTranscript++; else semTranscript++;
    console.log(`${posicao} ${p.conversation_id} — ok (${linha.transcript.length} turnos, ${linha.duracao_seg ?? "?"}s)`);
  }
  await dormir(PAUSA_MS);
}

console.log("\n========================================");
console.log(`Gravadas:            ${gravadas}`);
console.log(`  com transcript:    ${comTranscript}`);
console.log(`  sem transcript:    ${semTranscript}  (sem_atendimento não tem conversa)`);
console.log(`Falhas:              ${falhas.length}`);
for (const f of falhas) console.log(`  ${f.conversation_id}: ${f.motivo}`);

if (!DRY_RUN) {
  const restante = await pendentes();
  console.log(`\nPendentes agora:     ${restante.length}   (aceitação da task: 0)`);
}
console.log("========================================");

// Sai diferente de zero se sobrou falha: quem chamar isto de um wrapper precisa
// saber que o passivo não veio inteiro.
process.exit(falhas.length ? 1 : 0);
