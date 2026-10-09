import { handleCadastralContext } from '../_shared/ldr-context.mjs';

// Chave dedicada compartilhada com um secret do workspace ElevenLabs.
// Não aceita service_role/anon; a função não consulta banco nem outros serviços.
Deno.serve(req => handleCadastralContext(req, Deno.env.get('LDR_CONTEXT_TOKEN')));
