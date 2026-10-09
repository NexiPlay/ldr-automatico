// Offline only: prepare a reviewable candidate. No network, deployment or approval write.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertApprovedAgent, assertOpening, promptDigest, sha256} from '../backend/edge-functions/_shared/ldr-policy.mjs';
const candidate=new URL('../prompts/bruno/candidates/son-2.9/',import.meta.url);
const readJson=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const stable=value=>JSON.stringify(value && typeof value==='object' ? Array.isArray(value) ? value.map(v=>JSON.parse(stable(v))) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])) : value);
const writable=fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>{const {llm_billed,...rest}=v;return [k,rest];}));
export const normalizeSnapshot=snapshot=>snapshot?.conversation_config ? snapshot : {
  agent_id:snapshot?.agent_id,version_id:snapshot?.version_id,
  conversation_config:{agent:{first_message:snapshot?.first_message,prompt:{prompt:snapshot?.prompt}}},
  platform_settings:{data_collection:snapshot?.data_collection},
};
export async function prepareSon29(snapshot) {
  const agent=normalizeSnapshot(snapshot);
  const approval=await readJson(new URL('baseline-approval.json',candidate));
  await assertApprovedAgent(agent,approval);
  const current=agent.platform_settings?.data_collection;
  if(!current || current.resultado_validacao?.type!=='string' || current.redflag?.type!=='boolean') throw new Error('Contrato de analise incompleto');
  const expected=['CONFIRMADO','NAO_CONFIRMADO','INCONCLUSIVO','SEM_ATENDIMENTO'];
  if(stable(current.resultado_validacao.enum)!==stable(expected)) throw new Error('Enum de resultado divergente');
  if(Object.keys(current).some(k=>k.startsWith('son29_'))) throw new Error('SON-2.9 ja configurada; revisar antes de substituir');
  const prompt=await readFile(new URL('system.md',candidate),'utf8');
  const policy=await readFile(new URL('identity-policy.md',candidate),'utf8');
  const overrides=await readJson(new URL('data-collection.json',candidate));
  const firstMessage=agent.conversation_config.agent.first_message;
  assertOpening(prompt,firstMessage,approval.opening_policy);
  const lf = value => value.replace(/\r\n?/g, '\n');
  if(!lf(prompt).includes(lf(policy).trim()) || !lf(overrides.resultado_validacao.description).includes(lf(policy).trim())) throw new Error('Politica de identidade diverge entre agente e analise');
  const fields=writable(current);
  for(const [key,definition] of Object.entries(overrides)) fields[key]={...fields[key],...definition,...(!fields[key]?{name:key}:{})};
  const humanOnly='Considere somente falas HUMANAS para informacoes de pessoa, responsabilidade, ausencia, disponibilidade e recusa. URA/gravacao/assistente virtual nao identifica interlocutor humano nem decisor; nao copie nome da assistente virtual, setores do menu ou horario de funcionamento como dados do responsavel. Sem fala humana, use NAO_IDENTIFICADO para interlocutor, texto vazio para nomes/horarios/evidencias e false para booleanos. ';
  for(const key of Object.keys(fields).filter(k=>k.startsWith('son62_') && k!=='son62_pedidos')) fields[key]={...fields[key],description:humanOnly+fields[key].description};
  return {
    patch:{conversation_config:{agent:{prompt:{prompt}}},platform_settings:{data_collection:fields},version_description:'SON-2.9 candidato: identidade por humano ou URA, briefing opcional e evidencia separada'},
    base:{agent_id:agent.agent_id,version_id:agent.version_id??null,prompt_sha256:approval.prompt_sha256,analysis_sha256:await sha256(stable(writable(current)))},
    candidate:{status:'LOCAL_NAO_PUBLICADO',prompt_sha256:await promptDigest(prompt,firstMessage),analysis_sha256:await sha256(stable(fields)),requires_model_validation:true,requires_new_human_audit:true},
  };
}
export async function assertSon29Base(snapshot,prepared) {
  const agent=normalizeSnapshot(snapshot);
  if(agent.agent_id!==prepared.base.agent_id || agent.version_id!==prepared.base.version_id ||
     await promptDigest(agent.conversation_config.agent.prompt.prompt,agent.conversation_config.agent.first_message)!==prepared.base.prompt_sha256 ||
     await sha256(stable(writable(agent.platform_settings.data_collection)))!==prepared.base.analysis_sha256) throw new Error('Base mudou; releia e prepare novamente');
  return true;
}
export async function assertSon29Published(snapshot,prepared) {
  const agent=normalizeSnapshot(snapshot);
  if(agent.agent_id!==prepared.base.agent_id || await promptDigest(agent.conversation_config.agent.prompt.prompt,agent.conversation_config.agent.first_message)!==prepared.candidate.prompt_sha256) throw new Error('Prompt/agente publicado divergente');
  for(const [key,expected] of Object.entries(prepared.patch.platform_settings.data_collection)) {
    const actual=agent.platform_settings?.data_collection?.[key];
    if(!actual || Object.keys(expected).some(field=>stable(actual[field])!==stable(expected[field]))) throw new Error('Analise publicada divergente: '+key);
  }
  return true;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [snapshot,output]=process.argv.slice(2);
  if(!snapshot || !output) throw new Error('Uso: node scripts/son29-identity-prepare.mjs snapshot.json pasta-privada');
  const prepared=await prepareSon29(await readJson(resolve(snapshot)));
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'proposal.json'),JSON.stringify(prepared,null,2)+'\n');
  console.log('Candidato local preparado. Nenhum PATCH, discagem, resultado historico ou aprovacao foi alterado.');
}
