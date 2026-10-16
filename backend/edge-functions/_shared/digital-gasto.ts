// DIG-2.5. Fonte compartilhada com ldr-automatico; manter cópia byte a byte.
// Banco decide o recorte, nunca a flag enviada pelo navegador.
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Objeto : {};

export class GastoDigitalBloqueado extends Error {}

export function maxSegundosAgente(config: unknown): number | null {
  const n = objeto(objeto(config).conversation).max_duration_seconds;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

export async function dispararComOrcamento(
  sb: Rpc,
  contexto: { leadId: string | null; e164: string; engine: 'ldr' | 'sdr'; maxSegundos: number | null; exigirDigital?: boolean; origem?: string },
  payload: Objeto,
  enviar: (payload: Objeto) => Promise<Response>,
): Promise<Response> {
  const tentativa = crypto.randomUUID();
  let reserva: Objeto;
  try {
    const { data, error } = await sb.rpc('np_fn_digital_gasto_reservar', {
      p_tentativa: tentativa, p_lead: contexto.leadId, p_e164: contexto.e164,
      p_engine: contexto.engine, p_max_segundos: contexto.maxSegundos,
      p_exigir_digital: contexto.exigirDigital === true,
      ...(contexto.origem !== undefined ? { p_origem: contexto.origem } : {}),
    });
    reserva = objeto(data);
    if (error || typeof reserva.digital !== 'boolean' || typeof reserva.permitido !== 'boolean') {
      throw new Error('orcamento_indisponivel');
    }
    if (reserva.permitido !== true) throw new Error(String(reserva.motivo || 'orcamento_bloqueado'));
    if (reserva.digital && reserva.tentativa_id !== tentativa) throw new Error('reserva_invalida');
    if (contexto.exigirDigital && !reserva.digital) throw new Error('recorte_digital_ausente');
  } catch (e) {
    throw new GastoDigitalBloqueado(e instanceof Error ? e.message : 'orcamento_indisponivel');
  }
  let envio = payload;
  if (reserva.digital) {
    const client = objeto(payload.conversation_initiation_client_data);
    envio = { ...payload, conversation_initiation_client_data: {
      ...client, dynamic_variables: { ...objeto(client.dynamic_variables), digital_tentativa_id: tentativa },
    } };
  }
  // Timeout, 5xx, corpo inválido ou falha de persistência: NUNCA devolver a reserva.
  // A ligação pode ter saído. Não há retry automático nem liberação por idade.
  const response = await enviar(envio);
  if (reserva.digital) {
    const body = objeto(await response.clone().json().catch(() => null));
    if (response.ok && body.success === true && typeof body.conversation_id === 'string' && body.conversation_id.trim()) {
      const { error, data } = await sb.rpc('np_fn_digital_gasto_registrar', {
        p_tentativa: tentativa, p_conversation: body.conversation_id,
      });
      if (error || objeto(data).tentativa_id !== tentativa) {
        throw new GastoDigitalBloqueado('Chamada pode ter saído; reserva mantida, conciliação pendente. Não repetir.');
      }
    }
  }
  return response;
}

// Invocar SOMENTE após verificar a assinatura do webhook. Nenhum envio de mensagens.
export async function registrarCustoDigital(sb: Rpc, data: unknown): Promise<void> {
  const call = objeto(data);
  if (typeof call.conversation_id !== 'string' || !call.conversation_id.trim()) throw new Error('conversation_id_ausente');
  const variables = objeto(objeto(call.conversation_initiation_client_data).dynamic_variables);
  const tentativa = variables.digital_tentativa_id;
  if (tentativa !== undefined && (typeof tentativa !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tentativa))) {
    throw new Error('digital_tentativa_id_invalida');
  }
  const metadata = objeto(call.metadata);
  const cost = metadata.cost_fiat;
  const voz = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
  const { data: result, error } = await sb.rpc('np_fn_digital_gasto_registrar', {
    p_tentativa: tentativa ?? null, p_conversation: call.conversation_id,
    p_finalizada: true, p_voz_usd: voz,
    // Telefonia aguarda CDR/fatura: conserva a reserva integral, não presume zero.
  });
  if (error || typeof objeto(result).digital !== 'boolean' || (tentativa && objeto(result).tentativa_id !== tentativa)) {
    throw new Error('Falha ao conciliar custo Digital; reentrega necessária');
  }
}
