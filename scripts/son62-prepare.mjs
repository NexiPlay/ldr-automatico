// Offline only. Produces reviewable artifacts; never sends a PATCH or changes approval.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertApprovedAgent, assertR5, promptDigest} from '../backend/edge-functions/_shared/ldr-policy.mjs';

const candidate = new URL('../prompts/bruno/candidates/son-6.2/', import.meta.url);
const json = async url => JSON.parse(await readFile(url,'utf8'));
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))
  : value);

export async function assertSon62Published(agent, prepared) {
  await assertApprovedAgent(agent,prepared.proposedApproval);
  if (canonical(agent.conversation_config) !== canonical(prepared.patch.conversation_config))
    throw new Error('Configuracao de conversa publicada difere da proposta');
  const actual=agent.platform_settings?.data_collection || {};
  for (const [name,definition] of Object.entries(prepared.patch.platform_settings.data_collection)) {
    if (!actual[name] || Object.keys(definition).some(k=>canonical(actual[name][k]) !== canonical(definition[k])))
      throw new Error('Campo de coleta nao persistido conforme proposto: '+name);
  }
  return true;
}

export async function prepareSon62(agent) {
  const approval = await json(new URL('../backend/edge-functions/_shared/ldr-approval.json',import.meta.url));
  await assertApprovedAgent(agent,approval);
  const current = agent.platform_settings?.data_collection;
  if (!current?.resultado_validacao || !current?.redflag) throw new Error('Contrato de coleta atual incompleto');
  if (Object.keys(current).some(k=>k.startsWith('son62_'))) throw new Error('SON-6.2 ja configurada; revisar diferencas manualmente');
  const prompt = await readFile(new URL('system.md',candidate),'utf8');
  assertR5(prompt);
  const additions = Object.fromEntries(Object.entries(await json(new URL('data-collection.json',candidate)))
    .map(([name,definition])=>[name,{...definition,name}]));
  // GET carries llm_billed, a response-only field. Preserve every writable field.
  const fields = Object.fromEntries(Object.entries(current).map(([k,v])=>{
    const {llm_billed, ...writable} = v; return [k,writable];
  }));
  const promptPatch = {
    conversation_config:{...structuredClone(agent.conversation_config),agent:{
      ...structuredClone(agent.conversation_config.agent),
      prompt:{...structuredClone(agent.conversation_config.agent.prompt),prompt}}},
    version_description:'SON-6.2: pedido unico de nome OU horario ao intermediario, sem insistencia',
  };
  // Verified in the provider: definition writes create/update item references.
  // A reference-only PATCH did not persist these fields; readback is mandatory.
  const existingRefs = agent.platform_settings.analysis_items;
  const patch = {...promptPatch,platform_settings:{data_collection:{...fields,...additions}}};
  const proposedApproval = {...approval,version:'bruno-son-6.2-v1',
    prompt_sha256:await promptDigest(prompt,agent.conversation_config.agent.first_message)};
  return {patch,promptPatch,dataCollectionProposal:{mode:'definitions',
    definitions:additions,existing_references:existingRefs ?? null,requires_readback:true},
    proposedApproval,base:{agent_id:agent.agent_id,version_id:agent.version_id ?? null,
    prompt_sha256:approval.prompt_sha256}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [snapshot,output] = process.argv.slice(2);
  if (!snapshot || !output) throw new Error('Uso: node scripts/son62-prepare.mjs snapshot-agente.json diretorio-privado');
  const prepared = await prepareSon62(await json(resolve(snapshot)));
  await mkdir(output,{recursive:true});
  for (const [name,value] of Object.entries(prepared)) {
    await writeFile(resolve(output,`${name}.json`),JSON.stringify(value,null,2)+'\n');
  }
  console.log('Artefatos locais preparados. Nenhuma configuracao remota ou aprovacao ativa foi alterada.');
}
