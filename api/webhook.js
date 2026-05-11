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
      contexto: {}
    });
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

  // Limpa timer anterior
  if (timers.has(telefone)) {
    clearTimeout(timers.get(telefone));
    timers.delete(telefone);
  }

  console.log(`[RECEBIDO] ${telefone} (${nome}): ${texto.substring(0,50)}`);
  console.log(`[ESTADO] emIntervencao=${conv.emIntervencao}, etapa=${conv.etapa}`);

  // SE NAO ESTIVER EM INTERVENCAO, RESPONDE AUTOMATICAMENTE
  if (!conv.emIntervencao) {
    if (conv.etapa === 'visita_marcada') {
      console.log(`[BOT] VISITA JA MARCADA - silencio total`);
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

      // Timer de reengajamento de 2 minutos
      if (conv.etapa !== 'visita_marcada' && conv.etapa !== 'nao_atende') {
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
  
  if (!conv.aguardandoResposta || conv.etapa === 'visita_marcada' || conv.etapa === 'nao_atende') {
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
// GERAR RESPOSTA INTELIGENTE - HUMANIZADA
// ============================================

function gerarRespostaInteligente(texto, nome, conv) {
  const txt = texto.toLowerCase().trim();
  const etapa = conv.etapa;

  // ===== SOLICITACAO DE HUMANO =====
  if (txt.match(/(humano|pessoa|atendente|funcionario|falar com alguem|atendente humano|real|vivo|pessoa de verdade|quero falar com|falar com atendente)/)) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome);
    return 'Um momento.';
  }

  // ===== DETECTAR OBJECOES E RESISTENCIAS (em qualquer etapa) =====
  
  // Cliente diz que nao quer pagar, acha caro, etc.
  if (txt.match(/(nao quero pagar|nao vou pagar|caro|muito caro|absurdo|taxa alta|por que tem taxa|porque tem taxa|taxa injusta|nao gostei|nao aceito|recuso|reclama|reclamar|protesto|indignado|revoltado)/)) {
    return handleObjecaoTaxa(conv, txt);
  }

  // Cliente pergunta sobre o que fazemos, servicos
  if (txt.match(/(o que voces fazem|o que fazem|quais servicos|o que conserta|trabalham com o que|atende o que|faz o que|conserta o que)/)) {
    return 'Trabalhamos com conserto de maquina de lavar, lava e seca, frigobar, geladeira e ar condicionado de todas as marcas e modelos. Qual equipamento esta com problema e qual a marca?';
  }

  // Cliente pergunta preco do conserto
  if (txt.match(/(quanto custa o conserto|preco do conserto|valor do conserto|quanto fica|quanto sai|orçamento|orcamento)/)) {
    return 'O valor do conserto so e possivel definir apos a visita tecnica, pois depende do defeito apresentado. A visita tem uma taxa que varia conforme a regiao, e esse valor e abatido do conserto caso voce aprove o orcamento. Qual equipamento esta com problema?';
  }

  // Cliente pergunta sobre a taxa em geral
  if (txt.match(/(taxa|visita tem custo|custo da visita|paga visita|visita paga|valor da visita)/) && etapa !== 'confirmar_taxa') {
    return 'Sim, a visita tecnica tem uma taxa que varia de R$100 a R$190 conforme a regiao. Esse valor e descontado do conserto se voce aprovar o orcamento. Qual equipamento esta com problema e qual a marca?';
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
    return 'Só para eu entender melhor: e uma geladeira, maquina de lavar, ar condicionado ou outro aparelho? E qual a marca?';
  }

  // ETAPA: PERGUNTAR VISITA
  if (etapa === 'perguntar_visita') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|vamos|vamo|bora|beleza|show|demais|perfeito|combina|fechado|ta bom|tá bom|ta certo|tá certo)/)) {
      conv.etapa = 'perguntar_bairro';
      return 'Qual o bairro?';
    }
    
    if (txt.match(/(nao|não|nop|negativo|depois|outro dia|amanha|outro|mais tarde|nao quero|nao posso|hoje nao|outro horario|outra data|nao sei|talvez depois)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Sem problema. Quando poderia receber a visita?';
    }
    
    // Resposta evasiva ou nao clara
    if (txt.match(/(nao sei|talvez|depende|vou ver|perguntar|pensar)/)) {
      return 'Tudo bem, fica a vontade. So para eu organizar: voce prefere hoje ou outro dia?';
    }
    
    return 'Gostaria de marcar uma visita para hoje?';
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
    
    conv.etapa = 'perguntar_endereco';
    return 'Qual o endereco completo?';
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
    
    // Zona Norte
    if (ehZonaNorte(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 190;
      return 'Na Zona Norte a taxa da visita e R$190. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Barra, Baixada, regioes nao atendidas
    if (bairroLower.includes('barra') || bairroLower.includes('baixada') || bairroLower.includes('jacarepagua') || bairroLower.includes('recreio') || bairroLower.includes('curicica') || bairroLower.includes('tanque') || bairroLower.includes('campo grande') || bairroLower.includes('santa cruz') || bairroLower.includes('sepetiba') || bairroLower.includes('guaratiba')) {
      conv.etapa = 'nao_atende';
      return 'Infelizmente nao atendemos na sua regiao no momento. Atendemos Botafogo, Zona Sul e Zona Norte do Rio. Caso mude de ideia ou queira falar com um atendente, e so avisar.';
    }
    
    // Bairro nao reconhecido
    return 'De qual regiao e esse bairro? E Zona Sul, Zona Norte, Centro ou outra regiao?';
  }

  // ETAPA: CONFIRMAR TAXA
  if (etapa === 'confirmar_taxa') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|prossiga|vamos|vamo|bora|beleza|show|demais|perfeito|combina|fechado|ta bom|tá bom|ta certo|tá certo|vai|manda|partiu)/)) {
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
    
    if (txt.match(/(nao|não|nop|negativo|cancelar|desistir|outro dia|outro horario|nao quero|recuso|rejeito)/)) {
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
    
    return `Visita marcada para hoje entre ${conv.horarioInicio} e ${conv.horarioFim}.

A taxa de R$${conv.valorVisita} deve ser paga no ato da visita

Obrigada!`;
  }

  // ETAPA: VISITA MARCADA - silencio absoluto
  if (etapa === 'visita_marcada') {
    return null;
  }

  // ETAPA: NAO ATENDE
  if (etapa === 'nao_atende') {
    return 'Infelizmente nao atendemos na sua regiao no momento. Caso queira falar com um atendente, e so digitar "humano".';
  }

  // Fallback
  conv.etapa = 'perguntar_visita';
  return 'Gostaria de marcar uma visita para hoje?';
}

// ============================================
// LIDAR COM OBJECOES - HUMANIZADO
// ============================================

function handleObjecaoTaxa(conv, txt) {
  // Cliente diz que nao quer pagar taxa
  if (txt.match(/(nao quero pagar|nao vou pagar|recuso|rejeito|nao aceito|absurdo)/)) {
    return 'Entendo sua preocupacao. A taxa e apenas para cobrir o deslocamento do tecnico. O bom e que se voce aprovar o conserto, esse valor sai totalmente do orcamento. Fica como um adiantamento, sabe? Posso verificar o bairro para te passar o valor exato?';
  }
  
  // Cliente acha caro
  if (txt.match(/(caro|muito caro|alto|absurdo|injusto|roubo)/)) {
    return 'Sei que parece um valor a mais, mas garanto que e justo pelo deslocamento e diagnostico. E como falei, vira desconto no conserto. Qual bairro voce esta? Posso verificar o valor exato para sua regiao.';
  }
  
  // Cliente pergunta por que tem taxa
  if (txt.match(/(por que tem taxa|porque tem|por que paga|por que cobra|motivo da taxa)/)) {
    return 'A taxa cobre o deslocamento do tecnico ate o seu endereco e o tempo de diagnostico. Se voce aprovar o orcamento, esse valor e abatido. E uma pratica comum para garantir o compromisso de ambas as partes. Posso verificar o valor para seu bairro?';
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
    'frigobar', 'geladeira', 'ar condicionado', 'ar-condicionado', 'arcondicionado', 'arcond'
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
    'humaita', 'jardim botanico', 'gavea', 'sao conrado', 'vidigal', 'rocinha',
    'catete', 'gloria', 'cosme velho', 'santa teresa', 'urca', 'leme', 'gavea',
    'lagoa', 'jardim oceanico', 'itaim bibi', 'vila nova', 'leme', 'copacabana'
  ];
  return bairrosZonaSul.some(b => bairro.includes(b));
}

function ehZonaNorte(bairro) {
  const bairrosZonaNorte = [
    'tijuca', 'vila isabel', 'grajau', 'andaraí', 'maracana', 'engenho novo',
    'engenho de dentro', 'meier', 'alto da boa vista', 'praça da bandeira',
    'riachuelo', 'sao cristovao', 'benfica', 'caju', 'centro', 'lapa', 'cidade nova',
    'estacio', 'saude', 'gamboa', 'santo cristo', 'catumbi', 'rio comprido',
    'sao francisco xavier', 'jacarezinho', 'manguinhos', 'complexo', 'rocha',
    'rocha miranda', 'honorio gurgel', 'marechal hermes', 'deodoro', 'bento ribeiro',
    'oswaldo cruz', 'madureira', 'campinho', 'cascadura', 'quintino', 'pilares',
    'del castilho', 'inhauma', 'engenheiro leal', 'encantado', 'manguiera', 'tomas coelho'
  ];
  return bairrosZonaNorte.some(b => bairro.includes(b));
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
  console.log('[TELEGRAM] TOKEN presente:', !!TELEGRAM_BOT_TOKEN);
  console.log('[TELEGRAM] GROUP ID:', TELEGRAM_GROUP_ID);

  const mensagem = `NOVA VISITA CONFIRMADA - CONSERTA RIO

Numero: ${conv.telefone}
Nome: ${conv.nome}
Endereco: ${conv.endereco}
Bairro: ${conv.bairro}
Equipamento: ${conv.equipamento}
Marca: ${conv.marca || 'Nao informada'}
Horario da visita: ${conv.horarioInicio} as ${conv.horarioFim}
Taxa Visita: R$${conv.valorVisita || '---'}`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    console.log('[TELEGRAM] URL:', url);
    
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
      // Tenta sem parse_mode se deu erro
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

async function enviarTelegramIntervencao(telefone, nome) {
  console.log('[TELEGRAM] Tentando enviar intervencao...');

  const mensagem = `INTERVENCAO HUMANA SOLICITADA - CONSERTA RIO

Numero: ${telefone}
Nome: ${nome}

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
