// Somente GET. Exporta os campos necessários à revisão; nunca chaves/ferramentas.
import { mkdir, writeFile } from "node:fs/promises";
import { elevenlabsBase, promptDigest } from "../backend/edge-functions/_shared/ldr-policy.mjs";
import approval from "../backend/edge-functions/_shared/ldr-approval.json" with {type:"json"};
const agentId=process.env.ELEVENLABS_AGENT_ID;
if(agentId!==approval.agent_id || !process.env.ELEVENLABS_API_KEY) throw new Error("Agente/credencial ausente ou divergente");
const response=await fetch(`${elevenlabsBase(process.env.ELEVENLABS_BASE_URL)}/v1/convai/agents/${encodeURIComponent(agentId)}`,{
  headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY},signal:AbortSignal.timeout(30000),
});
if(!response.ok) throw new Error(`Consulta do agente: HTTP ${response.status}`);
const agent=await response.json();
if(agent.agent_id!==agentId) throw new Error("Identidade divergente");
const config=agent.conversation_config?.agent;
const redflag=agent.platform_settings?.data_collection?.redflag;
const report={checked_at:new Date().toISOString(),agent_id:agentId,version_id:agent.version_id??null,
  prompt:config?.prompt?.prompt,first_message:config?.first_message,
  redflag:redflag?{type:redflag.type,description:redflag.description}:null,
  prompt_sha256:await promptDigest(config?.prompt?.prompt,config?.first_message),
};
await mkdir("artifacts",{recursive:true});
await writeFile("artifacts/son15-agent.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({agent_id:agentId,redflag_configurado:!!redflag,prompt_sha256:report.prompt_sha256}));
