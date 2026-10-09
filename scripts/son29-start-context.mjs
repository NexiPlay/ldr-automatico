// Preparação local, sem chamadas de API ou publicação.
export const contextConversationRule = `Antes de cada resposta, confira a evidência de identidade do DESTINO. contexto_cadastral identifica somente a empresa PROCURADA; seu retorno nunca confirma quem atendeu.
Empresa confirmada exige uma afirmação do destino com nome empresarial compatível OU um sim em resposta à SUA pergunta imediatamente anterior sobre essa empresa. Seu Alô? não é uma pergunta de empresa. Um sim logo após Alô?, aqui é da empresa sem nome, cuido da energia, nome de pessoa e ausência do responsável NÃO confirmam identidade.
Uma PERGUNTA do destino como É da empresa...? também não confirma, mesmo acompanhada de responsável ou ausência. Guarde esses dados e confirme apenas a empresa: Falo com a {{empresa}}? Não agradeça pela confirmação nem escreva empresa confirmada no motivo enquanto faltar essa evidência.
Perguntas sobre quem você é ou de onde liga exigem sua identificação verdadeira imediatamente. Quem fala? pede sua identidade, não oferece abertura para perguntar sobre energia. Depois de responder, pergunte somente a empresa se ainda falta confirmá-la. Se a empresa já foi confirmada, não acrescente pergunta sobre responsável sem convite explícito como pode falar, pode perguntar ou em que posso ajudar.
Depois de confirmar a empresa, aproveite nome, responsabilidade, ausência e horário já informados e encerre; não pergunte de novo nem complete cadastro. Recusa, rejeição de gravação e opt-out têm prioridade: encerre imediatamente mesmo sem confirmação, sem inventá-la ou pedir esclarecimento.
Exemplos vinculantes de próxima ação (use a referência real):
- Você só disse Alô?. Destino: É da {{empresa}}? O responsável está ausente. Responda: Sou Bruno, assistente virtual da Tendência Energia. Falo com a {{empresa}}? Espere a resposta SEM end_call; após Sim, encerre agradecendo e preserve a ausência.
- Você só disse Alô?. Destino: Sim, aqui é da empresa, eu cuido da energia. Com quem eu falo? Responda: Sou Bruno, assistente virtual da Tendência Energia. Falo com a {{empresa}}? SEM end_call; após Sim, encerre sem repetir energia.
- Destino: Aqui é da {{empresa}}. Quem fala? Chame end_call com system__message_to_speak: Sou Bruno, assistente virtual da Tendência Energia. Obrigado. NÃO pergunte energia: quem fala não é convite.
- Destino pergunta se você é outra pessoa, por exemplo Você é a Karla? Identifique-se verdadeiramente como Bruno, assistente virtual da Tendência Energia; não silencie sobre sua identidade e não assuma o nome sugerido. Se falta confirmar a empresa e não houve recusa, acrescente apenas Falo com a {{empresa}}?`;
export function contextTool(secretId) {
  if (typeof secretId !== 'string' || !secretId.trim()) throw Error('Secret do workspace não configurado');
  return {tool_config:{
    type:'webhook',name:'contexto_cadastral',description:'Recebe a referência pública original desta chamada. Executada uma vez pelo workflow no início; não pedir dados ao interlocutor e não falar o conteúdo.',
    response_timeout_secs:5,pre_tool_speech:'off',execution_mode:'immediate',interruption_mode:'allow',
    api_schema:{url:'https://wbagoinuxgvntvbbnmab.supabase.co/functions/v1/ldr-contexto-analise',method:'POST',
      request_headers:{'X-LDR-Context-Token':{secret_id:secretId}},
      request_body_schema:{type:'object',required:['REFERENCIA_EMPRESA','BRIEFING_REFERENCIA'],properties:{
        REFERENCIA_EMPRESA:{type:'string',dynamic_variable:'empresa'},
        BRIEFING_REFERENCIA:{type:'string',dynamic_variable:'briefing_lead'},
      }},
    },
  }};
}

export function startContextWorkflow(snapshot, toolId) {
  const workflow=snapshot?.workflow;
  if(!workflow || Object.keys(workflow.nodes||{}).length!==1 || !Object.values(workflow.nodes).every(n=>n.type==='start') || Object.keys(workflow.edges||{}).length) throw Error('Workflow existente mudou; não substituir sem conciliar');
  if(typeof toolId!=='string'||!toolId.trim())throw Error('Ferramenta de contexto ausente');
  return {workflow:{nodes:{
    start_node:{type:'start',position:{x:0,y:0},edge_order:['start_context']},
    context_node:{type:'tool',position:{x:0,y:120},edge_order:['context_continue'],tools:[{tool_id:toolId}]},
    bruno_node:{type:'override_agent',position:{x:0,y:240},edge_order:[],label:'Bruno',entry_behavior:'wait_for_user',conversation_config:{},additional_prompt:contextConversationRule,additional_tool_ids:[],additional_knowledge_base:[]},
  },edges:{
    start_context:{source:'start_node',target:'context_node',forward_condition:{type:'unconditional'}},
    // Indisponibilidade do transporte não deve derrubar uma chamada atendida.
    // O Bruno mantém a política original de exigir evidência independente.
    context_continue:{source:'context_node',target:'bruno_node',forward_condition:{type:'unconditional'}},
  },prevent_subagent_loops:true}};
}
