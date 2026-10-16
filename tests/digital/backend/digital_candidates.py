"""Stage only the minimal DIG-3.3 Karla fixes on a new branch; never publish/dial."""
import argparse
import copy
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import digital_release as gate

OLD_END = 'A confirmação do horário depende de um representante da região. Ainda não há reunião marcada.'
NEW_END = 'Não tenho confirmação de horário nem recibo de reserva. Ainda não há reunião marcada.'
REFUSAL = ('Uma recusa de reunião é prioritária mesmo quando o cliente aceita separar a fatura, '
           'mesmo antes de você oferecer reunião e mesmo com R10 liberada. '
           'Exemplos: "reunião eu não vou ter", "só fatura, sem reunião", "não quero visita". '
           'Não ofereça, não reofereça, não tente convencer nem corrija essa escolha. '
           'A próxima ação é encerrar via end_call, agradecendo pelo tempo, sem nova pergunta.')


def corrected_candidate(agent):
    config = copy.deepcopy(agent['conversation_config'])
    workflow = copy.deepcopy(agent['workflow'])
    config['agent']['prompt'].pop('tools', None)  # do not re-submit hydrated private tool definitions
    prompt = config['agent']['prompt']['prompt']
    gate.require(OLD_END in prompt or NEW_END in prompt, 'Expected conclusion changed; reconcile before staging')
    config['agent']['prompt']['prompt'] = prompt.replace(OLD_END, NEW_END)
    if REFUSAL not in prompt:
        config['agent']['prompt']['prompt'] += '\n\n## Recusa parcial prioritária (DIG-3.3)\n' + REFUSAL + '\n'
    # Replace the same ambiguous conclusion in workflow overrides and end_call guidance.
    def replace(value):
        if isinstance(value, str): return value.replace(OLD_END, NEW_END)
        if isinstance(value, list): return [replace(v) for v in value]
        if isinstance(value, dict): return {k: replace(v) for k, v in value.items()}
        return value
    workflow = replace(workflow)
    conversation = workflow['nodes']['digital_conversa']
    conversation['additional_prompt'] = conversation['additional_prompt'].replace(' ' + REFUSAL, '') + ' ' + REFUSAL
    order = workflow['nodes']['digital_conversa']['edge_order']
    order.remove('digital_finish')
    order.insert(0, 'digital_finish')
    workflow['edges']['digital_finish']['forward_condition']['condition'] = (
        'PRIORIDADE: se o cliente recusou reunião ou visita, mesmo aceitando fatura, '
        'transicione imediatamente; não precisa ter havido oferta anterior. '
        'Também transicione por recusa de continuar, empresa errada ou grupo divergente. '
        'Sem recusa: transicione apenas depois de oferta REAL de reunião pela Karla, '
        'aceita com escolha explícita ONLINE. Preferência ou horário espontâneo antes da oferta '
        'não bastam. Pedido presencial, coleta ou correção de endereço usam os demais caminhos.')
    workflow['nodes']['digital_encerrar']['additional_prompt'] += ' ' + REFUSAL
    # The failed final turn inherited the entire conversational prompt. A short
    # terminal node prevents resuming sales explanations or inventing a return.
    terminal = (
        'Você é Karla, assistente virtual da Tendência Energia. A identificação e gravação já foram informadas. '
        'Sua ÚNICA próxima ação é chamar end_call com reason e system__message_to_speak. '
        'Não emita fala textual separada, não faça pergunta e não espere agradecimento. '
        'Escolha o motivo pela fala REAL do cliente, não pelo nome da transição. '
        'O contexto é grupo {{grupo}}. Dizer que já é Grupo A ou está no mercado livre é DIVERGÊNCIA DE GRUPO. '
        'Pedir para corrigir ou atualizar cadastro NÃO é recusa nem opt-out. Nesse caso use obrigatoriamente '
        'a frase de Grupo divergente, mesmo que o cliente diga "preciso resolver" ou "atualize isso". '
        'Recusa/opt-out só se aplica quando ele pede para parar, não ligar ou recusa continuar/reunião. '
        'Monte a mensagem apenas com as frases relevantes desta lista, sem criar outras: '
        'Recusa ou opt-out: Entendi seu pedido. Vou encerrar esta ligação. '
        'Empresa errada: Obrigada por avisar. Vou encerrar. '
        'Grupo divergente: O enquadramento informado é diferente do contexto desta ligação e precisa ser confirmado antes de continuar. '
        'Se a última fala pede reunião no modo preparação: Ainda não posso oferecer uma reunião para a sua região. '
        'Se a última fala pergunta o que acontece após ajustar faturamento do optante: Primeiro é necessário voltar ao faturamento do Grupo A e ajustar a contratação de demanda com a distribuidora; depois avaliar a migração, sem garantia. '
        'Se pergunta onde enviar fatura: Não tenho um canal de recebimento confirmado nesta ligação. '
        'Se pergunta para que serve ou o que fazer com a fatura: A finalidade é verificar possibilidades de contratação a partir da fatura, sem cobrança ou garantia. '
        'Se pergunta horário, link, retorno, novidades ou próximos passos: Não consigo garantir contato ou envio de link nesta ligação. '
        'Reunião online aceita: Modalidade online confirmada. Não tenho confirmação de horário nem recibo de reserva. Ainda não há reunião marcada. '
        'Reunião presencial coletada: Não tenho confirmação de horário nem recibo de reserva. Ainda não há reunião marcada. '
        'Agradecimento final: Obrigada pelo seu tempo. '
        'Nunca diga que novidades serão comunicadas, que alguém vai avisar, encaminhar ou entrar em contato. '
        'Não confirme bloqueio gravado, envio, reserva ou atendimento futuro. Não use consultar_acervo_sdr.')
    for name in ('digital_fim_preparacao', 'digital_encerrar'):
        workflow['nodes'][name]['conversation_config'] = {'agent': {'prompt': {'prompt': terminal, 'tool_ids': []}}}
        workflow['nodes'][name]['additional_prompt'] = 'Somente end_call, com frases da lista e sem pergunta. '
        if name == 'digital_fim_preparacao':
            workflow['nodes'][name]['additional_prompt'] += 'Modo preparação: nenhuma reunião permitida. '
    # The provider exposes this field on live nodes. Enforce the terminal action
    # instead of relying only on an instruction that can produce another turn.
    for name in ('digital_fim_preparacao', 'digital_encerrar', 'digital_limites'):
        workflow['nodes'][name]['forced_tool_name'] = 'end_call'
        workflow['nodes'][name]['entry_behavior'] = 'generate_immediately'
    workflow['edges']['digital_preparacao_finish']['forward_condition']['condition'] = (
        'Transicione imediatamente em recusa de continuar/opt-out, empresa errada ou grupo divergente. '
        'Também transicione se existe uma fala ANTERIOR REAL da Karla pedindo para separar a fatura '
        'e a ÚLTIMA fala do cliente responde a esse pedido: aceita, recusa ou pergunta canal/próximo passo. '
        'Aceite como "posso separar a fatura sim" encerra mesmo se vier seguido de uma pergunta sobre o que muda depois. '
        'O nó final responde essa dúvida ao encerrar. Não espere agradecimento. '
        'Só não transicione se a agente ainda não pediu a fatura ou se o cliente apenas pergunta como funciona a migração, sem responder ao pedido.')
    return {'parent_version_id': agent['version_id'], 'include_draft': False,
            'name': 'DIG-3.3 Karla recusa e agenda ' + gate.digest({'config': config, 'workflow': workflow})[:10],
            'description': 'Correções das rodadas conjuntas DIG-3.3. Candidata de testes; QA posterior à revisão DIG-3.2 ainda pendente.',
            'conversation_config': config, 'workflow': workflow}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--key-file', type=Path, required=True)
    args = parser.parse_args()
    gate.require(not args.output_dir.exists(), 'Use a new evidence directory')
    spec = gate.read(gate.SPEC)
    target = spec['agents']['karla']
    key = next(l.split('=', 1)[1].strip().strip('"').strip("'") for l in
               args.key_file.read_text(encoding='utf-8-sig').splitlines() if l.startswith('ELEVENLABS_API_KEY='))
    provider = gate.Provider(key, spec)
    main_agent = provider.request('GET', f"agents/{target['agent_id']}")
    gate.check_agent(main_agent, target, main=True)
    source = provider.request('GET', f"agents/{target['agent_id']}?branch_id={target['branch_id']}")
    gate.check_agent(source, target)
    payload = corrected_candidate(source)
    args.output_dir.mkdir(parents=True)
    request = Request(f"https://api.elevenlabs.io/v1/convai/agents/{target['agent_id']}/branches",
                      method='POST', headers={'xi-api-key': key, 'Content-Type': 'application/json'},
                      data=json.dumps(payload).encode())
    try:
        with urlopen(request, timeout=50) as response:
            created = json.load(response)
    except HTTPError as error:
        details = json.loads(error.read())
        # Store diagnostics privately: validation responses may echo input fields.
        gate.save(args.output_dir / 'error-private.json', details)
        raise ValueError(f'Branch creation rejected: HTTP {error.code}; private diagnostics saved') from None
    gate.save(args.output_dir / 'created.json', created)
    candidate = provider.request('GET', f"agents/{target['agent_id']}?branch_id={created['created_branch_id']}")
    gate.require(candidate['version_id'] == created['created_version_id'], 'Unexpected staged version')
    expected_config = copy.deepcopy(source['conversation_config'])
    expected_config['agent']['prompt']['prompt'] = payload['conversation_config']['agent']['prompt']['prompt']
    gate.require(candidate['conversation_config'] == expected_config, 'Unplanned conversation configuration change')
    gate.require(candidate['platform_settings'] == source['platform_settings'], 'Extraction/platform changed')
    gate.require(candidate['workflow'] == payload['workflow'], 'Staged workflow differs')
    gate.save(args.output_dir / 'candidate-private.json', candidate)
    gate.check_agent(provider.request('GET', f"agents/{target['agent_id']}"), target, main=True)
    result = {**target, 'branch_id': created['created_branch_id'], 'version_id': candidate['version_id'],
              'behavior_sha256': gate.digest(gate.behavior(candidate)), 'supersedes_version_id': target['version_id']}
    gate.save(args.output_dir / 'target.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
