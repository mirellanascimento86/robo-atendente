// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// Atendimento humanizado 24/7
// ============================================

// CONFIGURACAO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';
const TELEGRAM_BOT_TOKEN = '8517608136:AAFJmE04CPd7DecwKVh_MzGA6bnGGmbT3zI';
const TELEGRAM_GROUP_ID = '-5246111585';

// ============================================
// MEMORIA DO SISTEMA
// ============================================
const conversas = new Map();
const timers = new Map();
const reengajamentoTimers = new Map();

// ============================================
// CONTADORES PARA RELATORIO DIARIO
// ============================================
let relatorioDiario = {
  data: new Date().toISOString().split('T')[0],
  totalAtendimentos: 0,
  totalVisitasMarcadas: 0,
  totalNaoConverteram: 0,
  visitasMarcadas: [],
  naoConverteram: [],
  madrugada: []
};

// ============================================
// HORARIO COMERCIAL
// ============================================
function estaEmHorarioComercial() {
  const agora = new Date();
  const hora = agora.getHours();
  return hora >= 9 && hora < 19;
}

function ehMadrugada() {
  const agora = new Date();
  const hora = agora.getHours();
  return hora >= 0 && hora < 9;
}

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;
    console.log(`[WEBHOOK] ${req.method} action=${action} query=`, req.query);

    // ===== 1. VERIFICACAO DO WEBHOOK (Meta) =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL =====
    if (action === 'list') {
      const lista = Array.from(conversas.values())
        .sort((a, b) => new Date(b.ultimaAtividade || 0) - new Date(a.ultimaAtividade || 0));
      return res.status(200).json({ conversas: lista });
    }

    if (action === 'messages') {
      const phone = req.query.phone;
      const conv = conversas.get(phone);
      if (!conv) {
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }
      return res.status(200).json({ 
        mensagens: conv.mensagens || [],
        emIntervencao: conv.emIntervencao,
        telefone: conv.telefone,
        nome: conv.nome
      });
    }

    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      const conv = conversas.get(phone);
      if (!conv) {
        conversas.set(phone, {
          telefone: phone,
          nome: 'Cliente',
          mensagens: [],
          emIntervencao: true,
          etapa: 'intervencao',
          ultimaAtividade: new Date().toISOString(),
          ultima: 'Intervencao iniciada'
        });
      } else {
        conv.emIntervencao = true;
        conv.ultimaAtividade = new Date().toISOString();
        conv.mensagens.push({
          tipo: 'system',
          mensagem: 'Humano assumiu o controle',
          data: new Date().toISOString(),
          nome: 'Sistema'
        });
      }
      const convAtual = conversas.get(phone);
      return res.status(200).json({ 
        ok: true, 
        emIntervencao: true,
        telefone: phone,
        confirmado: convAtual.emIntervencao
      });
    }

    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;
      const conv = conversas.get(phone);
      if (conv) {
        conv.emIntervencao = false;
        conv.ultimaAtividade = new Date().toISOString();
        conv.mensagens.push({
          tipo: 'system',
          mensagem: 'Robo retomou o atendimento',
          data: new Date().toISOString(),
          nome: 'Sistema'
        });
      }
      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;
      const conv = conversas.get(phone);
      if (!conv || !conv.emIntervencao) {
        return res.status(403).json({ 
          ok: false, 
          erro: 'Nao esta em intervencao',
          emIntervencao: conv?.emIntervencao || false
        });
      }
      const enviado = await enviarWhatsApp(phone, message);
      if (enviado) {
        conv.mensagens.push({
          tipo: 'humano',
          mensagem: message,
          data: new Date().toISOString(),
          nome: 'Atendente'
        });
        conv.ultima = message;
        conv.ultimaAtividade = new Date().toISOString();
      }
      return res.status(200).json({ ok: enviado });
    }

    // ===== 3. RECEBER MENSAGEM DO WHATSAPP =====
    if (req.method === 'POST' && !action) {
      res.status(200).send('OK');
      processarMensagem(req.body).catch(err => {
        console.error('Erro ao processar:', err);
      });
      return;
    }

    res.status(200).send('Webhook Conserta Rio - OK');

  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAR MENSAGEM RECEBIDA
// ============================================

async function processarMensagem(body) {
  if (!body || body.object !== 'whatsapp_business_account') return;

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  if (!changes) return;

  if (changes.statuses) return;

  const msg = changes.messages?.[0];
  if (!msg) return;

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';

  // Verificar tipo de mensagem
  if (msg.type === 'image') {
    await enviarWhatsApp(telefone, 'Gostaria de marcar uma visita para hoje?');
    return;
  }

  if (msg.type === 'audio' || msg.type === 'voice') {
    await enviarWhatsApp(telefone, 'No momento nao consigo ouvir audios, poderia me descrever o que precisa?');
    return;
  }

  if (msg.type !== 'text') return;

  const texto = msg.text.body;

  // CRIAR/ATUALIZAR CONVERSA
  if (!conversas.has(telefone)) {
    conversas.set(telefone, {
      telefone: telefone,
      nome: nome,
      mensagens: [],
      emIntervencao: false,
      etapa: 'saudacao',
      ultimaAtividade: new Date().toISOString(),
      ultima: '',
      equipamento: '',
      marca: '',
      bairro: '',
      endereco: '',
      dataVisita: '',
      horarioInicio: '',
      horarioFim: '',
      valorVisita: 0,
      ultimaMsgBot: null,
      aguardandoResposta: false,
      tentativas: 0,
      contexto: {},
      jaAtendidoAntes: false,
      primeiraVez: true
    });

    // Incrementar contador de atendimentos do dia
    const hoje = new Date().toISOString().split('T')[0];
    if (relatorioDiario.data !== hoje) {
      relatorioDiario = {
        data: hoje,
        totalAtendimentos: 0,
        totalVisitasMarcadas: 0,
        totalNaoConverteram: 0,
        visitasMarcadas: [],
        naoConverteram: [],
        madrugada: []
      };
    }
    relatorioDiario.totalAtendimentos++;
  } else {
    conversas.get(telefone).jaAtendidoAntes = true;
    conversas.get(telefone).primeiraVez = false;
  }

  const conv = conversas.get(telefone);

  // ADICIONAR MENSAGEM DO CLIENTE
  conv.mensagens.push({
    tipo: 'cliente',
    mensagem: texto,
    data: new Date().toISOString(),
    nome: nome
  });

  conv.ultima = texto;
  conv.ultimaAtividade = new Date().toISOString();
  conv.aguardandoResposta = false;
  conv.tentativas = 0;

  // Limpa timers anteriores
  if (timers.has(telefone)) {
    clearTimeout(timers.get(telefone));
    timers.delete(telefone);
  }
  if (reengajamentoTimers.has(telefone)) {
    clearTimeout(reengajamentoTimers.get(telefone));
    reengajamentoTimers.delete(telefone);
  }

  console.log(`[RECEBIDO] ${telefone} (${nome}): ${texto.substring(0,50)}`);
  console.log(`[ESTADO] emIntervencao=${conv.emIntervencao}, etapa=${conv.etapa}`);

  // SE NAO ESTIVER EM INTERVENCAO, RESPONDE AUTOMATICAMENTE
  if (!conv.emIntervencao) {
    if (conv.etapa === 'visita_marcada') {
      console.log(`[BOT] VISITA JA MARCADA - processando follow-up`);
      const respostaFollowUp = handlePosVisitaMarcada(texto, conv);
      if (respostaFollowUp) {
        await enviarWhatsApp(telefone, respostaFollowUp);
        conv.mensagens.push({
          tipo: 'bot',
          mensagem: respostaFollowUp,
          data: new Date().toISOString(),
          nome: 'Robo'
        });
        conv.ultima = respostaFollowUp;
        conv.ultimaAtividade = new Date().toISOString();
      }
      return;
    }

    const resposta = gerarRespostaInteligente(texto, nome, conv);

    if (resposta) {
      await enviarWhatsApp(telefone, resposta);

      conv.mensagens.push({
        tipo: 'bot',
        mensagem: resposta,
        data: new Date().toISOString(),
        nome: 'Robo'
      });

      conv.ultima = resposta;
      conv.ultimaAtividade = new Date().toISOString();
      conv.ultimaMsgBot = resposta;
      conv.aguardandoResposta = true;

      // Timer de reengajamento de 30 minutos (para "vou pensar")
      if (conv.etapa === 'vou_pensar') {
        const timer = setTimeout(() => {
          reengajarPensando(telefone);
        }, 30 * 60 * 1000);
        reengajamentoTimers.set(telefone, timer);
      }

      // Timer de reengajamento de 2 minutos para outras etapas
      if (conv.etapa !== 'visita_marcada' && conv.etapa !== 'nao_atende' && conv.etapa !== 'vou_pensar') {
        const timer = setTimeout(() => {
          reengajarCliente(telefone);
        }, 2 * 60 * 1000);
        timers.set(telefone, timer);
      }

      console.log(`[BOT] Resposta enviada`);
    }
  } else {
    console.log(`[BOT] BLOQUEADO - intervencao humana`);
  }
}

// ============================================
// REENGAGEMENT - 2 MINUTOS
// ============================================

async function reengajarCliente(telefone) {
  const conv = conversas.get(telefone);
  if (!conv) return;

  if (!conv.aguardandoResposta || conv.etapa === 'visita_marcada' || conv.etapa === 'nao_atende' || conv.etapa === 'vou_pensar') {
    return;
  }

  const ultimaAtividade = new Date(conv.ultimaAtividade);
  const agora = new Date();
  const diffMin = (agora - ultimaAtividade) / 1000 / 60;

  if (diffMin < 1.8) return;

  let msgReengajamento = '';

  switch (conv.etapa) {
    case 'equipamento':
      msgReengajamento = 'Ola! Qual equipamento esta com problema e qual a marca?';
      break;
    case 'perguntar_visita':
      msgReengajamento = 'Gostaria de marcar uma visita para hoje?';
      break;
    case 'perguntar_quando':
      msgReengajamento = 'Quando poderia receber a visita?';
      break;
    case 'perguntar_horario':
      msgReengajamento = 'Qual horario seria melhor para voce?';
      break;
    case 'perguntar_bairro':
      msgReengajamento = 'Qual o bairro?';
      break;
    case 'confirmar_taxa':
      msgReengajamento = 'Gostaria de prosseguir com a visita?';
      break;
    case 'perguntar_endereco':
      msgReengajamento = 'Qual o endereco completo?';
      break;
    default:
      msgReengajamento = 'Gostaria de marcar uma visita para hoje?';
  }

  await enviarWhatsApp(telefone, msgReengajamento);

  conv.mensagens.push({
    tipo: 'bot',
    mensagem: msgReengajamento,
    data: new Date().toISOString(),
    nome: 'Robo'
  });

  conv.ultima = msgReengajamento;
  conv.ultimaAtividade = new Date().toISOString();

  console.log(`[REENGAGE] ${telefone} - ${msgReengajamento}`);
}

// ============================================
// REENGAGEMENT - 30 MINUTOS (VOU PENSAR)
// ============================================

async function reengajarPensando(telefone) {
  const conv = conversas.get(telefone);
  if (!conv || conv.etapa !== 'vou_pensar') return;

  const msg = 'Ola! Conseguiu decidir? Gostaria de marcar a visita para hoje?';

  await enviarWhatsApp(telefone, msg);

  conv.mensagens.push({
    tipo: 'bot',
    mensagem: msg,
    data: new Date().toISOString(),
    nome: 'Robo'
  });

  conv.ultima = msg;
  conv.ultimaAtividade = new Date().toISOString();
  conv.etapa = 'perguntar_visita';

  console.log(`[REENGAGE-PENSAR] ${telefone}`);
}

// ============================================
// APOS VISITA MARCADA - FOLLOW UP
// ============================================

function handlePosVisitaMarcada(texto, conv) {
  const txt = texto.toLowerCase().trim();

  // Cancelar
  if (txt.match(/(cancelar|desmarcar|nao quero mais|desistir)/)) {
    conv.etapa = 'perguntar_visita';
    return 'Entendo. Gostaria de remarcar para outro dia?';
  }

  // Mudar horario
  if (txt.match(/(mudar horario|outro horario|alterar horario|trocar horario)/)) {
    conv.etapa = 'perguntar_horario';
    return 'Sem problema. Qual o novo horario que seria melhor para voce?';
  }

  // Tecnico nao chegou
  if (txt.match(/(nao chegou|atrasado|demora|onde esta|cade|cade)/)) {
    enviarTelegramAtraso(conv);
    return 'Vou verificar com a equipe e ja retorno com uma posicao.';
  }

  // Obrigado resolvido
  if (txt.match(/(obrigado|obrigada|resolvido|ja foi|concertaram|consertaram|arrumaram)/)) {
    return 'Que bom! Fico feliz que deu tudo certo.';
  }

  // Novo problema
  if (txt.match(/(outro problema|mais um|tambem tem|outro defeito)/)) {
    conv.etapa = 'equipamento';
    return 'Entendo. Qual o outro equipamento com problema e qual a marca?';
  }

  return null;
}

// ============================================
// GERAR RESPOSTA INTELIGENTE - HUMANIZADA
// ============================================

function gerarRespostaInteligente(texto, nome, conv) {
  const txt = texto.toLowerCase().trim();
  const etapa = conv.etapa;

  // ===== DETECTAR CLIENTE IRRITADO =====
  if (detectarClienteIrritado(txt, texto)) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome, 'Cliente irritado - mensagens agressivas ou em CAPS');
    return 'Me desculpe, estou fazendo o melhor que posso. Um momento que irei encaminhar o seu atendimento.';
  }

  // ===== SOLICITACAO DE HUMANO =====
  if (txt.match(/(humano|pessoa|atendente|funcionario|falar com alguem|atendente humano|real|vivo|pessoa de verdade|quero falar com|falar com atendente|justica|reclamacao|reclamar|protesto|indignado|revoltado|briga|brigar)/)) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome);
    return 'Um momento.';
  }

  // ===== NAO ENTENDEU APOS 3 TENTATIVAS =====
  if (conv.tentativas >= 3) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome, 'Nao entendeu apos 3 tentativas');
    return 'Um momento.';
  }

  // ===== SAUDACOES SIMPLES =====
  if (txt.match(/^(oi|ola|ola|bom dia|boa tarde|boa noite|hey|hi|hello)$/)) {
    if (conv.jaAtendidoAntes && !conv.primeiraVez) {
      return 'Ola novamente! Qual equipamento esta com problema e qual a marca?';
    }
    conv.etapa = 'equipamento';
    return 'Ola! Qual equipamento esta com problema e qual a marca?';
  }

  // ===== CLIENTE JA DESCREVEU PROBLEMA (mensagem longa) =====
  if (texto.length > 30 && etapa === 'saudacao') {
    conv.etapa = 'equipamento';
    // Tenta extrair equipamento e marca da mensagem longa
    const info = extrairEquipamentoMarca(texto);
    if (info.equipamento) {
      conv.equipamento = info.equipamento;
      conv.marca = info.marca || 'Nao informada';
      conv.etapa = 'perguntar_visita';
      return 'Gostaria de marcar uma visita para hoje?';
    }
    return 'Ola! Qual equipamento esta com problema e qual a marca?';
  }

  // ===== EQUIPAMENTO NAO ATENDIDO =====
  if (txt.match(/(micro-ondas|microondas|fogao|fogao|televisao|tv|notebook|computador|celular|tablet|impressora|aspirador)/)) {
    return 'Nossos tecnicos nao realizam esse servico, mas no Infomix Botafogo ha outras lojas e talvez voce encontre o que procura. Mande uma mensagem para eles: 21 96478-1947';
  }

  // ===== CLIENTE PERGUNTA O QUE FAZEMOS =====
  if (txt.match(/(o que voces fazem|o que fazem|quais servicos|o que conserta|trabalham com o que|atende o que|faz o que|conserta o que)/)) {
    return 'Trabalhamos com conserto de maquina de lavar, lava e seca, secadora, geladeira de todos os modelos e marcas, frigobar, ar condicionado e todos os modelos e marcas. Qual equipamento esta com problema e qual a marca?';
  }

  // ===== CLIENTE PERGUNTA PRECO DO CONSERTO =====
  if (txt.match(/(quanto custa o conserto|preco do conserto|valor do conserto|quanto fica|quanto sai|orcamento|orcamento)/)) {
    return 'O valor do conserto so e possivel definir apos a visita tecnica, pois depende do defeito apresentado. A visita tem uma taxa que varia conforme a regiao, e esse valor e abatido do conserto caso voce aprove o orcamento. Qual equipamento esta com problema?';
  }

  // ===== CLIENTE PERGUNTA SOBRE TAXA EM GERAL =====
  if (txt.match(/(taxa|visita tem custo|custo da visita|paga visita|visita paga|valor da visita)/) && etapa !== 'confirmar_taxa') {
    return 'Sim, a visita tecnica tem uma taxa que varia conforme a regiao. Em Botafogo e R$100, na Zona Sul e R$120 e na Zona Norte e R$190. Esse valor e descontado do conserto se voce aprovar o orcamento. Qual equipamento esta com problema e qual a marca?';
  }

  // ===== CLIENTE PERGUNTA SE TECNICO E CONFIAVEL =====
  if (txt.match(/(tecnico e bom|tecnico confiavel|posso confiar|sao bons|qualificado)/)) {
    return 'Sao profissionais da area que poderao diagnosticar o problema com precisao. Gostaria de marcar uma visita para hoje?';
  }

  // ===== CLIENTE PERGUNTA GARANTIA =====
  if (txt.match(/(garantia|tem garantia|da garantia)/)) {
    return 'A garantia depende do servico realizado e somente sera possivel identificar apos a visita. Gostaria de marcar uma visita para hoje?';
  }

  // ===== CLIENTE PERGUNTA SE TECNICO LEVA PECAS =====
  if (txt.match(/(leva pecas|tem pecas|peca|traz peca)/)) {
    return 'Sera realizada uma visita em que o tecnico ira diagnosticar o problema e lhe passaremos o orcamento. Gostaria de marcar uma visita para hoje?';
  }

  // ===== CLIENTE PERGUNTA FORMAS DE PAGAMENTO =====
  if (txt.match(/(forma de pagamento|como paga|paga como|aceita cartao|aceita pix|aceita dinheiro)/)) {
    return 'Aceitamos pix ou dinheiro. Qual equipamento esta com problema e qual a marca?';
  }

  // ===== FORA DO RIO (Niteroi, etc) =====
  if (txt.match(/(niteroi|duque de caxias|sao goncalo|sao goncalo|baixada fluminense|nova iguacu|nova iguacu|mesquita|nilopolis|sao joao de meriti)/)) {
    return 'Infelizmente no momento nao atendemos a sua area. Atendemos Botafogo, Zona Sul e Zona Norte do Rio de Janeiro.';
  }

  // ===== PARCEIRO/LOJA =====
  if (txt.match(/(parceria|revendedor|loja|sou loja|trabalho com)/) && !txt.match(/(tecnico|conserto|consertar)/)) {
    return 'Qual seu ramo e tempo de experiencia?';
  }

  // ===== QUER TRABALHAR COMO TECNICO =====
  if (txt.match(/(quero trabalhar|sou tecnico|vaga|emprego|trabalhar com voces)/)) {
    enviarTelegramParceria(conv.telefone, nome, texto, 'Tecnico quer trabalhar');
    return 'Qual a sua especialidade e tempo de experiencia?';
  }

  // ===== MADRUGADA =====
  if (ehMadrugada()) {
    const agora = new Date();
    const horaVisita = 9 + 2; // 11h do dia seguinte
    conv.horarioInicio = '11:00';
    conv.horarioFim = '13:00';
    conv.etapa = 'perguntar_bairro';

    // Adicionar a lista de madrugada
    relatorioDiario.madrugada.push({
      telefone: conv.telefone,
      nome: conv.nome,
      horario: agora.toISOString(),
      mensagem: texto
    });

    return 'Ola! Nosso horario de atendimento e das 9h as 19h. Sua visita sera agendada para o primeiro horario disponivel do dia, por volta das 11h. Qual o bairro?';
  }

  // ===== DETECTAR OBJECOES E RESISTENCIAS =====

  // Cliente diz que nao quer pagar, acha caro, etc.
  if (txt.match(/(nao quero pagar|nao vou pagar|caro|muito caro|absurdo|taxa alta|por que tem taxa|porque tem taxa|taxa injusta|nao gostei|nao aceito|recuso|reclama|reclamar|protesto|indignado|revoltado)/)) {
    return handleObjecaoTaxa(conv, txt);
  }

  // ===== FLUXO PRINCIPAL =====

  // ETAPA: SAUDACAO
  if (etapa === 'saudacao') {
    conv.etapa = 'equipamento';
    return 'Ola! Qual equipamento esta com problema e qual a marca?';
  }

  // ETAPA: EQUIPAMENTO
  if (etapa === 'equipamento') {
    const info = extrairEquipamentoMarca(texto);

    if (info.equipamento) {
      conv.equipamento = info.equipamento;
      conv.marca = info.marca || 'Nao informada';
      conv.etapa = 'perguntar_visita';
      return 'Gostaria de marcar uma visita para hoje?';
    }

    // Se nao entendeu, pergunta de forma diferente
    conv.tentativas++;
    if (conv.tentativas === 1) {
      return 'Desculpe, nao entendi direito. Poderia me dizer qual equipamento esta com problema? Por exemplo: geladeira, maquina de lavar, ar condicionado... E qual a marca?';
    }
    return 'So para eu entender melhor: e uma geladeira, maquina de lavar, ar condicionado ou outro aparelho? E qual a marca?';
  }

  // ETAPA: PERGUNTAR VISITA
  if (etapa === 'perguntar_visita') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|vamos|vamo|bora|beleza|show|demais|perfeito|combina|fechado|ta bom|ta bom|ta certo|ta certo)/)) {
      conv.etapa = 'perguntar_bairro';
      return 'Qual o bairro?';
    }

    if (txt.match(/(nao|nao|nop|negativo|depois|outro dia|amanha|outro|mais tarde|nao quero|nao posso|hoje nao|outro horario|outra data|nao sei|talvez depois)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Sem problema. Quando poderia receber a visita?';
    }

    // Resposta evasiva ou nao clara
    if (txt.match(/(nao sei|talvez|depende|vou ver|perguntar|pensar)/)) {
      conv.etapa = 'vou_pensar';
      return 'Tudo bem.';
    }

    // Pesquisando precos
    if (txt.match(/(pesquisando|so pesquisando|so pesquisando|so olhando|so olhando|so vendo|so vendo)/)) {
      return 'Entendo que esta pesquisando. Posso te ajudar com informacoes rapidas: trabalhamos com conserto de maquina de lavar, lava e seca, secadora, geladeira, frigobar e ar condicionado. A visita tecnica tem taxa que varia de R$100 a R$190 conforme a regiao, e esse valor e descontado do conserto. Posso marcar uma visita para hoje para voce ter o orcamento exato?';
    }

    return 'Gostaria de marcar uma visita para hoje?';
  }

  // ETAPA: VOU PENSAR
  if (etapa === 'vou_pensar') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|vamos|vamo|bora|beleza|show|demais|perfeito|combina|fechado|ta bom|ta bom|ta certo|ta certo)/)) {
      conv.etapa = 'perguntar_bairro';
      return 'Otimo! Qual o bairro?';
    }
    return 'Tudo bem. Fico por aqui caso precise de algo.';
  }

  // ETAPA: PERGUNTAR QUANDO
  if (etapa === 'perguntar_quando') {
    conv.dataVisita = texto;
    conv.etapa = 'perguntar_horario';
    return 'Qual horario seria melhor para voce?';
  }

  // ETAPA: PERGUNTAR HORARIO
  if (etapa === 'perguntar_horario') {
    const horarioExtraido = extrairHorario(texto);

    if (horarioExtraido) {
      conv.horarioInicio = horarioExtraido.inicio;
      conv.horarioFim = horarioExtraido.fim;
    } else {
      // Robo define horario: agora + 2h
      const agora = new Date();
      const h1 = agora.getHours() + 2;
      const h2 = h1 + 2;
      conv.horarioInicio = `${h1.toString().padStart(2,'0')}:00`;
      conv.horarioFim = `${h2.toString().padStart(2,'0')}:00`;
    }

    conv.etapa = 'perguntar_bairro';
    return 'Qual o bairro?';
  }

  // ETAPA: PERGUNTAR BAIRRO
  if (etapa === 'perguntar_bairro') {
    conv.bairro = texto;
    const bairroLower = txt;

    // Botafogo
    if (bairroLower.includes('botafogo')) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 100;
      return 'Em Botafogo a taxa da visita e R$100. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }

    // Zona Sul
    if (ehZonaSul(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 120;
      return 'Na Zona Sul a taxa da visita e R$120. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }

    // Zona Norte (limitada)
    if (ehZonaNorteAtendida(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 190;
      return 'Na Zona Norte a taxa da visita e R$190. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }

    // Zona Norte (nao atendida - fora do raio)
    if (ehZonaNorteForaRaio(bairroLower)) {
      conv.etapa = 'nao_atende';
      return 'Infelizmente no momento so atendemos a Zona Norte ate o raio da Tijuca, Maracana e Vila Isabel. Atendemos tambem toda a Zona Sul e Botafogo. Caso mude de ideia ou queira falar com um atendente, e so avisar.';
    }

    // Barra, Baixada, regioes nao atendidas
    if (bairroLower.includes('barra') || bairroLower.includes('baixada') || bairroLower.includes('jacarepagua') || bairroLower.includes('recreio') || bairroLower.includes('curicica') || bairroLower.includes('tanque') || bairroLower.includes('campo grande') || bairroLower.includes('santa cruz') || bairroLower.includes('sepetiba') || bairroLower.includes('guaratiba')) {
      conv.etapa = 'nao_atende';
      return 'Infelizmente no momento nao atendemos na sua regiao. Atendemos Botafogo, Zona Sul e Zona Norte ate o raio da Tijuca, Maracana e Vila Isabel. Caso mude de ideia ou queira falar com um atendente, e so avisar.';
    }

    // Bairro nao reconhecido
    return 'De qual regiao e esse bairro? E Zona Sul, Zona Norte, Centro ou outra regiao?';
  }

  // ETAPA: CONFIRMAR TAXA
  if (etapa === 'confirmar_taxa') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|prossiga|vamos|vamo|bora|beleza|show|demais|perfeito|combina|fechado|ta bom|ta bom|ta certo|ta certo|vai|manda|partiu)/)) {
      // Define horario automaticamente se ainda nao tiver
      if (!conv.horarioInicio) {
        const agora = new Date();
        const h1 = agora.getHours() + 2;
        const h2 = h1 + 2;
        conv.horarioInicio = `${h1.toString().padStart(2,'0')}:00`;
        conv.horarioFim = `${h2.toString().padStart(2,'0')}:00`;
      }
      conv.etapa = 'perguntar_endereco';
      return 'Perfeito. Qual o endereco completo?';
    }

    if (txt.match(/(nao|nao|nop|negativo|cancelar|desistir|outro dia|outro horario|nao quero|recuso|rejeito)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Entendo perfeitamente. Quando seria melhor para voce? A visita pode ser em outro dia sem problema.';
    }

    // Objecao sobre taxa ja e tratada no inicio, mas se chegou aqui e ainda nao respondeu claramente
    if (txt.match(/(por que|porque|qual o motivo|explique|nao entendi|duvida)/)) {
      return 'A taxa da visita tecnica cobre o deslocamento do tecnico ate o seu endereco. Se voce aprovar o orcamento do conserto, esse valor e descontado. E uma forma de garantir que o tecnico va ate la com seriedade. Gostaria de prosseguir?';
    }

    return 'Gostaria de prosseguir com a visita?';
  }

  // ETAPA: PERGUNTAR ENDERECO
  if (etapa === 'perguntar_endereco') {
    conv.endereco = texto;
    conv.etapa = 'visita_marcada';

    // Envia para o Telegram
    enviarTelegramVisita(conv);

    // Adicionar ao relatorio
    relatorioDiario.totalVisitasMarcadas++;
    relatorioDiario.visitasMarcadas.push({
      nome: conv.nome,
      telefone: conv.telefone,
      equipamento: conv.equipamento,
      marca: conv.marca,
      bairro: conv.bairro,
      endereco: conv.endereco,
      horario: `${conv.horarioInicio} as ${conv.horarioFim}`,
      valor: conv.valorVisita,
      data: new Date().toISOString()
    });

    return `Visita marcada para hoje entre ${conv.horarioInicio} e ${conv.horarioFim}.

A taxa de R$${conv.valorVisita} deve ser paga no ato da visita em dinheiro ou pix.

Obrigada!`;
  }

  // ETAPA: NAO ATENDE
  if (etapa === 'nao_atende') {
    return 'Infelizmente no momento nao atendemos na sua regiao. Caso queira falar com um atendente, e so digitar "humano".';
  }

  // Fallback
  conv.etapa = 'perguntar_visita';
  return 'Gostaria de marcar uma visita para hoje?';
}

// ============================================
// DETECTAR CLIENTE IRRITADO
// ============================================

function detectarClienteIrritado(txt, textoOriginal) {
  // Xingamentos
  const xingamentos = /(idiota|burro|inutil|merda|porra|caralho|bosta|filho da puta|fdp|vsf|vai se foder|otario|otario|babaca|escroto|desgracado|desgracado)/;

  // CAPS LOCK excessivo (mais de 70% maiusculas)
  const maiusculas = textoOriginal.replace(/[^a-zA-Z]/g, '').length > 0 
    ? (textoOriginal.replace(/[^A-Z]/g, '').length / textoOriginal.replace(/[^a-zA-Z]/g, '').length) > 0.7 
    : false;

  // Muitos pontos de exclamacao
  const muitasExclamacoes = (textoOriginal.match(/!/g) || []).length >= 3;

  // Frases de irritacao
  const irritacao = /(ja liguei|ninguem atende|atendimento horrivel|pessimo atendimento|pessimo atendimento|nao aguento mais|nao aguento mais|quero falar com o gerente|vou processar|vou reclamar|procon|reclame aqui)/;

  return xingamentos.test(txt) || (maiusculas && textoOriginal.length > 10) || (muitasExclamacoes && textoOriginal.length > 15) || irritacao.test(txt);
}

// ============================================
// LIDAR COM OBJECOES - HUMANIZADO
// ============================================

function handleObjecaoTaxa(conv, txt) {
  // Cliente diz que nao quer pagar taxa
  if (txt.match(/(nao quero pagar|nao vou pagar|recuso|rejeito|nao aceito|absurdo|roubo)/)) {
    return 'Entendo sua preocupacao. A taxa e apenas para cobrir o deslocamento do tecnico ate o seu endereco e a avaliacao profissional do aparelho. O bom e que se voce aprovar o conserto, esse valor sai totalmente do orcamento. Fica como um adiantamento, sabe? Qual bairro voce esta? Posso verificar o valor exato para sua regiao.';
  }

  // Cliente acha caro
  if (txt.match(/(caro|muito caro|alto|injusto)/)) {
    return 'Sei que parece um valor a mais, mas garanto que e justo pelo deslocamento do tecnico e pelo diagnostico profissional. E como falei, vira desconto no conserto. Qual bairro voce esta? Posso verificar o valor exato para sua regiao.';
  }

  // Cliente pergunta por que tem taxa
  if (txt.match(/(por que tem taxa|porque tem|por que paga|por que cobra|motivo da taxa)/)) {
    return 'A taxa cobre o deslocamento do tecnico ate o seu endereco e o tempo de diagnostico profissional. Se voce aprovar o orcamento, esse valor e abatido. E uma pratica comum para garantir o compromisso de ambas as partes. Qual bairro voce esta? Assim eu te passo o valor certinho.';
  }

  // Outra empresa nao cobra
  if (txt.match(/(outra empresa|outro lugar|nao cobra|nao paga|de graca|gratis)/)) {
    return 'Entendo. Algumas empresas fazem isso, mas acabam compensando no valor do conserto. Aqui a taxa e transparente e vira desconto no orcamento. Voce so paga o conserto realmente necessario, com diagnostico profissional. Qual bairro voce esta? Posso te passar o valor exato.';
  }

  // Cliente diz que ja sabe o defeito
  if (txt.match(/(ja sei|ja sei o defeito|sei qual e|sei qual e|nao precisa diagnosticar)/)) {
    return 'Entendo, mas e necessaria uma avaliacao profissional para nao correr o risco de ter outros problemas no aparelho e o tecnico conseguir oferecer uma solucao efetiva. O diagnostico completo garante que o conserto seja feito corretamente.';
  }

  // Cliente diz que so paga se consertar
  if (txt.match(/(so pago se consertar|so pago se|pago depois|pago so se|vou pagar so se)/)) {
    return 'A taxa da visita deve ser paga no ato da visita. Caso o orcamento for aprovado, esse valor sera deduzido do valor final do conserto. E uma forma de garantir o compromisso de ambas as partes.';
  }

  // R$190 muito caro
  if (txt.match(/(190|cento e noventa)/)) {
    return 'Entendo que R$190 parece um valor significativo, mas isso cobre o deslocamento do tecnico ate a Zona Norte e a avaliacao completa do aparelho. Se voce aprovar o conserto, esses R$190 saem inteirinhos do orcamento. E um investimento na solucao do problema, nao um custo extra.';
  }

  // Nao tem dinheiro
  if (txt.match(/(nao tenho dinheiro|nao tenho grana|nao tenho como pagar|sem dinheiro)/)) {
    return 'Entendo. Infelizmente a taxa da visita precisa ser paga no ato da visita em dinheiro ou pix. Quando voce tiver condicoes, e so entrar em contato que marcamos a visita. Fico por aqui caso precise.';
  }

  // Precisa consultar
  if (txt.match(/(consultar|perguntar|minha mae|minha mae|meu marido|minha mulher|meu irmao|meu pai|quem paga)/)) {
    return 'Tudo bem, aguardarei o seu retorno.';
  }

  // Cliente reclama em geral
  return 'Entendo perfeitamente. Posso te explicar melhor: a taxa e para o deslocamento do tecnico e vira desconto no conserto. Qual bairro voce esta? Assim eu te passo o valor certinho.';
}

// ============================================
// FUNCOES AUXILIARES
// ============================================

function extrairEquipamentoMarca(texto) {
  const txt = texto.toLowerCase();

  const equipamentos = [
    'maquina de lavar', 'lava e seca', 'lava-seca', 'lavaeseca',
    'frigobar', 'geladeira', 'ar condicionado', 'ar-condicionado', 'arcondicionado', 'arcond',
    'secadora', 'lava e seca', 'lava-seca'
  ];

  let equipamento = '';
  let marca = '';

  for (const eq of equipamentos) {
    if (txt.includes(eq)) {
      equipamento = eq;
      break;
    }
  }

  if (!equipamento) {
    // Tenta identificar por palavras-chave
    if (txt.includes('lavar') || txt.includes('lava')) equipamento = 'maquina de lavar';
    else if (txt.includes('geladeira') || txt.includes('frigo') || txt.includes('side') || txt.includes('frost')) equipamento = 'geladeira';
    else if (txt.includes('ar') || txt.includes('condicionado') || txt.includes('split')) equipamento = 'ar condicionado';
    else if (txt.includes('secadora') || txt.includes('seca')) equipamento = 'secadora';
    else if (txt.includes('frigobar')) equipamento = 'frigobar';
    else equipamento = texto;
  }

  const marcas = ['brastemp', 'consul', 'electrolux', 'eletrolux', 'lg', 'samsung', 'panasonic', 'midea', 'springer', 'carrier', 'fujitsu', 'gree', 'philco', 'continental', 'bosch', 'ge', 'general electric', 'electrolux'];
  for (const m of marcas) {
    if (txt.includes(m)) {
      marca = m === 'eletrolux' ? 'electrolux' : m;
      break;
    }
  }

  return { equipamento, marca };
}

function extrairHorario(texto) {
  const txt = texto.toLowerCase();

  // Padroes: 14h, 14:00, 14 hs, 14 horas, 2 da tarde
  const padroes = [
    /(\d{1,2})[h:](\d{2})/,
    /(\d{1,2})\s*h(?:s|oras?)?/,
    /(\d{1,2})\s*:\s*(\d{2})/,
    /(\d{1,2})\s*da\s*(manha|tarde|noite)/,
  ];

  let hora = null;
  let minuto = 0;

  for (const padrao of padroes) {
    const match = txt.match(padrao);
    if (match) {
      hora = parseInt(match[1]);
      if (match[2] && !isNaN(parseInt(match[2]))) {
        minuto = parseInt(match[2]);
      }
      if (match[2] === 'tarde' && hora < 12) hora += 12;
      if (match[2] === 'noite' && hora < 12) hora += 12;
      break;
    }
  }

  if (hora === null) return null;

  const horaFim = hora + 2;

  const formatar = (h, m) => {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  return {
    inicio: formatar(hora, minuto),
    fim: formatar(horaFim, minuto)
  };
}

function ehZonaSul(bairro) {
  const bairrosZonaSul = [
    'copacabana', 'ipanema', 'leblon', 'laranjeiras', 'flamengo', 'botafogo',
    'humaita', 'humaita', 'jardim botanico', 'jardim botanico', 'gavea', 'gavea', 'sao conrado', 'sao conrado', 'vidigal', 'rocinha',
    'catete', 'gloria', 'gloria', 'cosme velho', 'santa teresa', 'urca', 'leme',
    'lagoa', 'jardim oceanico', 'itaim bibi', 'vila nova', 'leme', 'copacabana',
    'ipanema', 'leblon', 'gavea', 'jardim botanico'
  ];
  return bairrosZonaSul.some(b => bairro.includes(b));
}

function ehZonaNorteAtendida(bairro) {
  const bairrosAtendidos = [
    'tijuca', 'vila isabel', 'vila isabel', 'grajau', 'grajau', 'andaraí', 'andaraí', 'maracana', 'maracana', 'engenho novo',
    'engenho de dentro', 'meier', 'meier', 'alto da boa vista', 'praca da bandeira',
    'riachuelo', 'sao cristovao', 'sao cristovao', 'benfica', 'caju', 'centro', 'lapa', 'cidade nova',
    'estacio', 'estacio', 'saude', 'saude', 'gamboa', 'santo cristo', 'catumbi', 'rio comprido',
    'sao francisco xavier', 'sao francisco xavier'
  ];
  return bairrosAtendidos.some(b => bairro.includes(b));
}

function ehZonaNorteForaRaio(bairro) {
  const bairrosFora = [
    'jacarezinho', 'manguinhos', 'complexo', 'rocha',
    'rocha miranda', 'honorio gurgel', 'honorio gurgel', 'marechal hermes', 'deodoro', 'bento ribeiro',
    'oswaldo cruz', 'madureira', 'campinho', 'cascadura', 'quintino', 'pilares',
    'del castilho', 'inhauma', 'inhuma', 'engenheiro leal', 'encantado', 'manguiera', 'tomas coelho'
  ];
  return bairrosFora.some(b => bairro.includes(b));
}

// ============================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('Token ou Phone ID nao configurado');
    return false;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: numero,
          type: 'text',
          text: { body: texto }
        })
      }
    );

    if (!response.ok) {
      const erro = await response.json();
      console.error('Erro API WhatsApp:', erro);
      return false;
    }

    console.log('Mensagem enviada para', numero);
    return true;

  } catch (e) {
    console.error('Erro ao enviar WhatsApp:', e.message);
    return false;
  }
}

// ============================================
// TELEGRAM - NOTIFICACOES
// ============================================

async function enviarTelegramVisita(conv) {
  console.log('[TELEGRAM] Tentando enviar visita...');

  const mensagem = `NOVA VISITA CONFIRMADA - CONSERTA RIO

Numero: ${conv.telefone}
Nome: ${conv.nome}
Endereco: ${conv.endereco}
Bairro: ${conv.bairro}
Equipamento: ${conv.equipamento}
Marca: ${conv.marca || 'Nao informada'}
Horario da visita: ${conv.horarioInicio} as ${conv.horarioFim}
Taxa Visita: R$${conv.valorVisita || '---'}
Forma de pagamento: Dinheiro ou Pix`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();
    console.log('[TELEGRAM] Resposta:', JSON.stringify(data));

    if (!data.ok) {
      console.error('[TELEGRAM] Erro na resposta:', data);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_GROUP_ID,
          text: mensagem
        })
      });
    } else {
      console.log('[TELEGRAM] Visita enviada com sucesso');
    }
  } catch (e) {
    console.error('[TELEGRAM] Erro fetch:', e.message);
  }
}

async function enviarTelegramIntervencao(telefone, nome, motivo = '') {
  console.log('[TELEGRAM] Tentando enviar intervencao...');

  const mensagem = `INTERVENCAO HUMANA SOLICITADA - CONSERTA RIO

Numero: ${telefone}
Nome: ${nome}
Motivo: ${motivo || 'Cliente solicitou falar com atendente humano.'}

O cliente solicitou falar com um atendente humano.`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();
    console.log('[TELEGRAM] Resposta intervencao:', JSON.stringify(data));

    if (!data.ok) {
      console.error('[TELEGRAM] Erro intervencao:', data);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_GROUP_ID,
          text: mensagem
        })
      });
    } else {
      console.log('[TELEGRAM] Intervencao enviada com sucesso');
    }
  } catch (e) {
    console.error('[TELEGRAM] Erro fetch intervencao:', e.message);
  }
}

async function enviarTelegramAtraso(conv) {
  console.log('[TELEGRAM] Tentando enviar aviso de atraso...');

  const mensagem = `ATENCAO: CLIENTE AGUARDANDO TECNICO - CONSERTA RIO

Numero: ${conv.telefone}
Nome: ${conv.nome}
Endereco: ${conv.endereco}
Bairro: ${conv.bairro}
Horario marcado: ${conv.horarioInicio} as ${conv.horarioFim}
Equipamento: ${conv.equipamento}

O cliente esta aguardando o tecnico e questionou o atraso.`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem
      })
    });
  } catch (e) {
    console.error('[TELEGRAM] Erro aviso atraso:', e.message);
  }
}

async function enviarTelegramParceria(telefone, nome, mensagem, tipo) {
  console.log('[TELEGRAM] Tentando enviar parceria...');

  const msg = `NOVO CONTATO: ${tipo} - CONSERTA RIO

Numero: ${telefone}
Nome: ${nome}
Mensagem: ${mensagem}

Verificar interesse em parceria/contratacao.`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: msg
      })
    });
  } catch (e) {
    console.error('[TELEGRAM] Erro parceria:', e.message);
  }
}

// ============================================
// RELATORIO DIARIO - ENVIAR AS 19H
// ============================================

async function enviarRelatorioDiario() {
  const agora = new Date();
  const hoje = agora.toISOString().split('T')[0];

  if (relatorioDiario.data !== hoje) {
    relatorioDiario = {
      data: hoje,
      totalAtendimentos: 0,
      totalVisitasMarcadas: 0,
      totalNaoConverteram: 0,
      visitasMarcadas: [],
      naoConverteram: [],
      madrugada: []
    };
    return;
  }

  let mensagem = `RELATORIO DO DIA - ${hoje.split('-').reverse().join('/')}

Total de atendimentos: ${relatorioDiario.totalAtendimentos}
Visitas marcadas: ${relatorioDiario.totalVisitasMarcadas}
Nao converteram: ${relatorioDiario.totalNaoConverteram}

Detalhes das visitas marcadas:`;

  relatorioDiario.visitasMarcadas.forEach((v, i) => {
    mensagem += `
${i + 1}. ${v.nome} - ${v.telefone} - ${v.equipamento} ${v.marca} - ${v.bairro} - ${v.horario}`;
  });

  if (relatorioDiario.madrugada.length > 0) {
    mensagem += `

Clientes de madrugada:`;
    relatorioDiario.madrugada.forEach((m, i) => {
      mensagem += `
${i + 1}. ${m.nome} - ${m.telefone} - ${m.mensagem}`;
    });
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem
      })
    });
    console.log('[TELEGRAM] Relatorio diario enviado');
  } catch (e) {
    console.error('[TELEGRAM] Erro relatorio:', e.message);
  }
}

// Agendar relatorio para 19h
function agendarRelatorio() {
  const agora = new Date();
  const hora19 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 19, 0, 0);

  if (hora19 < agora) {
    hora19.setDate(hora19.getDate() + 1);
  }

  const msAte19 = hora19 - agora;

  setTimeout(() => {
    enviarRelatorioDiario();
    // Agendar proximo dia
    setInterval(enviarRelatorioDiario, 24 * 60 * 60 * 1000);
  }, msAte19);
}

// Iniciar agendamento do relatorio
agendarRelatorio();

// ============================================
// RELATORIO MADRUGADA - ENVIAR AS 9H
// ============================================

async function enviarRelatorioMadrugada() {
  if (relatorioDiario.madrugada.length === 0) return;

  let mensagem = `CLIENTES DA MADRUGADA - ${relatorioDiario.data.split('-').reverse().join('/')}

Clientes que entraram em contato fora do horario comercial:`;

  relatorioDiario.madrugada.forEach((m, i) => {
    mensagem += `
${i + 1}. ${m.nome} - ${m.telefone} - ${m.mensagem}`;
  });

  mensagem += `

Aguardando agendamento para o primeiro horario do dia.`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem
      })
    });
    console.log('[TELEGRAM] Relatorio madrugada enviado');
  } catch (e) {
    console.error('[TELEGRAM] Erro relatorio madrugada:', e.message);
  }
}

// Agendar relatorio madrugada para 9h
function agendarRelatorioMadrugada() {
  const agora = new Date();
  const hora9 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 9, 0, 0);

  if (hora9 < agora) {
    hora9.setDate(hora9.getDate() + 1);
  }

  const msAte9 = hora9 - agora;

  setTimeout(() => {
    enviarRelatorioMadrugada();
    // Agendar proximo dia
    setInterval(enviarRelatorioMadrugada, 24 * 60 * 60 * 1000);
  }, msAte9);
}

// Iniciar agendamento do relatorio madrugada
agendarRelatorioMadrugada();
