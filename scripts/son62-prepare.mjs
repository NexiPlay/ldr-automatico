// Offline only. Produces reviewable artifacts; never sends a PATCH or changes approval.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertApprovedAgent, assertR5, promptDigest} from '../backend/edge-functions/_shared/ldr-policy.mjs';

const candidate = new URL('../prompts/bruno/candidates/son-6.2/', import.meta.url);
const json = async url => JSON.parse(await readFile(url,'utf8'));
export async function prepareSon62(agent, newReferences = null) {
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
  fields.resultado_validacao = {...fields.resultado_validacao, description:
    (fields.resultado_validacao.description || '') +
    ' SON-6.2: empresa confirmada com intermediario ou decisor ausente continua CONFIRMADO. NAO_CONFIRMADO exige divergencia explicita da empresa, nunca apenas ausencia, recusa ou pessoa errada.'};
  const promptPatch = {
    conversation_config:{...structuredClone(agent.conversation_config),agent:{
      ...structuredClone(agent.conversation_config.agent),
      prompt:{...structuredClone(agent.conversation_config.agent.prompt),prompt}}},
    version_description:'SON-6.2: pedido unico de nome OU horario ao intermediario, sem insistencia',
  };
  const existingRefs = agent.platform_settings.analysis_items;
  let platformSettings = null;
  if (existingRefs == null) {
    platformSettings = {data_collection:{...fields,...additions}};
  } else if (newReferences != null) {
    if (!Array.isArray(existingRefs.data_collection) || !Array.isArray(existingRefs.evaluation_criteria))
      throw new Error('Referencias existentes incompletas');
    if (Object.keys(newReferences).sort().join() !== Object.keys(additions).sort().join())
      throw new Error('Forneca as dez referencias SON-6.2, sem campos extras');
    const ids = new Set(existingRefs.data_collection.map(r=>r.analysis_item_id));
    const refs = Object.keys(additions).map(name=>{
      const ref=newReferences[name];
      if (ref?.source !== 'user' || !/^aitem_[a-z0-9]+$/i.test(ref.analysis_item_id || '') ||
          typeof ref.version_id !== 'string' || !ref.version_id.trim() || ids.has(ref.analysis_item_id))
        throw new Error('Referencia nova invalida, sem versao fixa ou reutilizada: '+name);
      ids.add(ref.analysis_item_id);
      return {source:'user',analysis_item_id:ref.analysis_item_id,version_id:ref.version_id,scope:'conversation'};
    });
    platformSettings = {analysis_items:{...structuredClone(existingRefs),data_collection:[...structuredClone(existingRefs.data_collection),...refs]}};
  }
  // A migrated agent needs real item references. Never emit a silently ineffective legacy PATCH.
  const patch = platformSettings ? {...promptPatch,platform_settings:platformSettings} : null;
  const proposedApproval = {...approval,version:'bruno-son-6.2-v1',
    prompt_sha256:await promptDigest(prompt,agent.conversation_config.agent.first_message)};
  return {patch,promptPatch,dataCollectionProposal:{mode:existingRefs == null ? 'legacy' : 'references',
    definitions:additions,existing_references:existingRefs ?? null,requires_item_creation:!!existingRefs && !newReferences},
    proposedApproval,base:{agent_id:agent.agent_id,version_id:agent.version_id ?? null,
    prompt_sha256:approval.prompt_sha256}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [snapshot,output,references] = process.argv.slice(2);
  if (!snapshot || !output) throw new Error('Uso: node scripts/son62-prepare.mjs snapshot-agente.json diretorio-privado [novas-referencias.json]');
  const prepared = await prepareSon62(await json(resolve(snapshot)),references ? await json(resolve(references)) : null);
  await mkdir(output,{recursive:true});
  for (const [name,value] of Object.entries(prepared)) {
    await writeFile(resolve(output,`${name}.json`),JSON.stringify(value,null,2)+'\n');
  }
  console.log('Artefatos locais preparados. Nenhuma configuracao remota ou aprovacao ativa foi alterada.');
  if (!prepared.patch) console.log('PATCH de ativacao indisponivel: criar os itens de analise e fornecer as referencias versionadas apos autorizacao.');
}
