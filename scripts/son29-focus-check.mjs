import assert from 'node:assert/strict';
const norm=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function checkFocusResponse(testCase,result){
 const generated=(result.simulated_conversation||[]).slice(testCase.history.length).filter(t=>t.role==='agent');
 const tools=generated.flatMap(t=>t.tool_calls||[]);const end=tools.filter(t=>t.tool_name==='end_call');const texts=generated.map(t=>t.message||'').filter(Boolean);
 for(const call of end){const args=JSON.parse(call.params_as_json);const s=args.system__message_to_speak||args.message||'';if(s&&!texts.some(t=>norm(t).includes(norm(s))))texts.push(s);}
 const spoken=texts.join(' ').trim(),n=norm(spoken),expected=testCase.expected,words=spoken.split(/\s+/).filter(Boolean).length;
 assert.ok(generated.length,testCase.id+': nenhuma resposta');assert.ok(tools.every(t=>t.tool_name==='end_call'),testCase.id+': ferramenta indevida');assert.ok(words<=expected.max_words,testCase.id+': fala longa '+words);assert.ok(!/ligacao.*gravada|esta sendo gravad|estamos gravando|posso ajudar|algo mais|posso perguntar/.test(n),testCase.id+': fala extra');
 if(expected.intro)assert.ok(n.includes('assistente virtual')&&n.includes('tendencia energia'),testCase.id+': falta identificação virtual');
 if(expected.intro===false)assert.ok(!/bruno|assistente|virtual|tendencia/.test(n),testCase.id+': apresentação antecipada');
 if(expected.action==='end'){assert.equal(end.length,1,testCase.id+': não encerrou');assert.ok(!spoken.includes('?'),testCase.id+': pergunta ao encerrar');}
 else{assert.equal(end.length,0,testCase.id+': encerrou ao perguntar');assert.equal((spoken.match(/\?/g)||[]).length,1,testCase.id+': pergunta não é única');if(expected.action==='ask_company'){assert.ok(n.includes('horizonte'),testCase.id+': não usou referência');assert.ok(!/quem.*energia|responsavel|horario/.test(n),testCase.id+': responsável antes da empresa');}else assert.ok(/quem.*energia/.test(n),testCase.id+': não perguntou responsável');}
 const identity=result.analysis?.data_collection_results?.resultado_validacao?.value;if(expected.identity)assert.equal(identity,expected.identity,testCase.id+': classificação divergente');return {case:testCase.id,action:expected.action,words,identity:identity??null,passed:true};
}
