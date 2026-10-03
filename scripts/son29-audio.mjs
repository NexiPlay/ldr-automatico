// Somente GET de gravações já realizadas. Nenhuma discagem, simulação ou mudança de agente.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateAudioManifest(manifest) {
  if (manifest?.task !== 'SON-2.9' || manifest.calls?.length !== 50 ||
      new Set(manifest.calls.map(c => c.conversation_id)).size !== 50 ||
      manifest.calls.some(c => !/^conv_[a-zA-Z0-9_]+$/.test(c.conversation_id) || c.agent_id !== manifest.agent_id))
    throw new Error('Manifesto inválido: esperadas 50 chamadas do mesmo agente.');
}

async function main() {
  const [manifestPath, directory] = process.argv.slice(2);
  if (!manifestPath || !directory) throw new Error('Uso: node --env-file=CAMINHO scripts/son29-audio.mjs manifest.json pasta-do-pacote');
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY ausente. Informe um arquivo de ambiente local; não cole a chave em logs.');
  const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
  validateAudioManifest(manifest);
  const target = resolve(directory), audioDir = resolve(target, 'audio');
  await mkdir(audioDir, { recursive: true });
  const report = { sample_id: manifest.sample_id, checked_at: new Date().toISOString(), calls: [] };
  const fetchProvider = async suffix => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch('https://api.elevenlabs.io/v1/convai/conversations/' + suffix, {
        headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(45000), redirect: 'error' });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await response.body?.cancel();
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue;
      }
      if ([401,403].includes(response.status)) throw new Error('A credencial não permitiu ler a gravação: HTTP ' + response.status);
      return response;
    }
  };
  for (const call of manifest.calls) {
    const id = call.conversation_id, path = resolve(audioDir, id + '.mp3');
    let row;
    try {
      const details = await fetchProvider(id);
      if (!details.ok) row = { conversation_id: id, status: 'indisponivel', http_status: details.status };
      else {
        const data = await details.json();
        if (data.conversation_id !== id || data.agent_id !== manifest.agent_id) throw new Error('Identidade da conversa divergiu do manifesto.');
        let bytes;
        try { if ((await stat(path)).size > 0) bytes = await readFile(path); } catch {}
        if (!bytes) {
          const audio = await fetchProvider(id + '/audio');
          if (!audio.ok) row = { conversation_id: id, status: 'indisponivel', http_status: audio.status };
          else {
            if (!/audio\/|application\/octet-stream/.test(audio.headers.get('content-type') || ''))
              throw new Error('Tipo de conteúdo inesperado ao buscar áudio.');
            bytes = Buffer.from(await audio.arrayBuffer());
            if (bytes.length < 100) throw new Error('Áudio vazio ou incompleto.');
            await writeFile(path, bytes, { flag: 'wx' });
          }
        }
        if (bytes) row = { conversation_id: id, status: 'baixado', bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'), provider_version_id: data.version_id ?? null };
      }
    } catch (error) {
      report.calls.push({ conversation_id: id, status: 'erro', motivo: error.message });
      await writeFile(resolve(target, 'audios.json'), JSON.stringify(report, null, 2) + '\n');
      throw error;
    }
    report.calls.push(row);
    await writeFile(resolve(target, 'audios.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.calls.length}/50: ${row.status}`);
  }
  console.log(JSON.stringify({ baixados: report.calls.filter(c => c.status === 'baixado').length,
    indisponiveis: report.calls.filter(c => c.status !== 'baixado').length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
