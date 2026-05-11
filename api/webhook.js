// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// Atendimento humanizado 24/7 - Português correto e educado
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
           new Date().toISOString(),
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
           new Date().toISOString(),
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
           new Date().toISOString(),
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
     new Date().toISOString(),
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
         new Date().toISOString(),
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
// REENGAGEMENT - 2 MINUTOS (mensagens educadas)
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

  const nome = conv.nome;
  let msgReengajamento = '';

  switch (conv.etapa) {
    case 'equipamento':
      msgReengajamento = `Olá novamente, ${nome}! Poderia informar qual equipamento está com problema e qual é a marca?`;
      break;
    case 'perguntar_visita':
      msgReengajamento = `Olá, ${nome}! Gostaria de agendar uma visita para hoje?`;
      break;
    case 'perguntar_quando':
      msgReengajamento = `Quando seria mais conveniente para receber a visita, ${nome}?`;
      break;
    case 'perguntar_horario':
      msgReengajamento = `Qual horário seria mais adequado para você, ${nome}?`;
      break;
    case 'perguntar_bairro':
      msgReengajamento = `Poderia informar o bairro, por favor, ${nome}?`;
      break;
    case 'confirmar_taxa':
      msgReengajamento = `Podemos prosseguir com o agendamento, ${nome}?`;
      break;
    case 'perguntar_endereco':
      msgReengajamento = `Preciso do endereço completo para finalizar, ${nome}.`;
      break;
    default:
      msgReengajamento = `Olá, ${nome}! Gostaria de agendar uma visita técnica?`;
  }

  await enviarWhatsApp(telefone, msgReengajamento);
  
  conv.mensagens.push({
    tipo: 'bot',
    mensagem: msgReengajamento,
     new Date().toISOString(),
    nome: 'Robo'
  });
  
  conv.ultima = msgReengajamento;
  conv.ultimaAtividade = new Date().toISOString();
  
  console.log(`[REENGAGE] ${telefone} - ${msgReengajamento}`);
}

// ============================================
// GERAR RESPOSTA INTELIGENTE - PORTUGUÊS CORRETO E EDUCADO
// ============================================

function gerarRespostaInteligente(texto, nome, conv) {
  const txt = texto.toLowerCase().trim();
  const etapa = conv.etapa;

  // CORREÇÃO AUTOMÁTICA DE ACENTOS
  const corrigirTexto = (msg) => {
    return msg
      .replace(/\b(nao)\b/gi, 'não')
      .replace(/\b(tao?|ta)\b/gi, 'está')
      .replace(/\b(hoj[ae])\b/gi, 'hoje')
      .replace(/\b(eh|eh)\b/gi, 'é')
      .replace(/\b(pra|pro)\b/gi, 'para')
      .replace(/maquina/gi, 'máquina')
      .replace(/equipamentoo?/gi, 'equipamento')
      .trim();
  };

  // PEDIDO DE HUMANO
  if (txt.match(/(humano|pessoa|atendente|funcionario|falar com alguem|quero falar|atendente humano|real|vivo)/)) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome);
    return corrigirTexto(`Obrigada, ${nome}! Um momento, por favor. Vou chamar um atendente para ajudá-la(o) imediatamente.`);
  }

  // OBJEÇÕES TAXA
  if (txt.match(/(nao quero pagar|caro|muito caro|taxa alta|por que tem taxa)/)) {
    return corrigirTexto(`Entendo perfeitamente sua preocupação, ${nome}. A taxa de visita cobre apenas o deslocamento do técnico e é integralmente descontada do conserto, caso aprove o orçamento. Poderia me informar seu bairro para eu informar o valor exato?`);
  }

  // O QUE FAZEMOS
  if (txt.match(/(o que voces fazem|quais servicos|conserta o que)/)) {
    return corrigirTexto(`Olá, ${nome}! Trabalhamos com conserto de máquinas de lavar, lava e seca, frigobares, geladeiras e aparelhos de ar-condicionado de todas as marcas. Qual equipamento está com problema e qual é a marca?`);
  }

  // PREÇO CONSERTO
  if (txt.match(/(quanto custa|preco conserto|orcamento)/)) {
    return corrigirTexto(`O valor do conserto só é possível definir após a visita técnica, pois depende do defeito encontrado, ${nome}. A taxa de visita varia entre R$100 e R$190 conforme a região e é descontada do conserto se aprovado. Qual é o equipamento?`);
  }

  // FLUXO PRINCIPAL
  if (etapa === 'saudacao') {
    conv.etapa = 'equipamento';
    return corrigirTexto(`Olá, ${nome}! Tudo bem? Poderia me informar qual equipamento está com problema e qual é a marca?`);
  }

  if (etapa === 'equipamento') {
    const info = extrairEquipamentoMarca(texto);
    if (info.equipamento) {
      conv.equipamento = info.equipamento;
      conv.marca = info.marca || 'Não informada';
      conv.etapa = 'perguntar_visita';
      return corrigirTexto(`Obrigada pela informação, ${nome}! Gostaria de agendar uma visita técnica para hoje?`);
    }
    
    conv.tentativas++;
    if (conv.tentativas === 1) {
      return corrigirTexto(`Peço desculpas, ${nome}, não compreendi bem. É uma máquina de lavar, geladeira ou ar-condicionado? Poderia informar também a marca?`);
    }
    return corrigirTexto(`Para eu entender melhor, ${nome}: trata-se de geladeira, máquina de lavar, ar-condicionado ou outro aparelho? Qual a marca?`);
  }

  if (etapa === 'perguntar_visita') {
    if (txt.match(/(sim|quero|ok|pode|claro|beleza)/)) {
      conv.etapa = 'perguntar_bairro';
      return corrigirTexto(`Perfeito, ${nome}! Poderia me informar qual é o seu bairro, por favor?`);
    }
    
    if (txt.match(/(nao|depois|amanha|outro dia)/)) {
      conv.etapa = 'perguntar_quando';
      return corrigirTexto(`Sem problema algum, ${nome}. Quando seria mais conveniente para receber a visita técnica?`);
    }
    
    return corrigirTexto(`Obrigada, ${nome}. Prefere agendar para hoje ou para outro dia mais conveniente?`);
  }

  if (etapa === 'perguntar_quando') {
    conv.dataVisita = texto;
    conv.etapa = 'perguntar_horario';
    return corrigirTexto(`Obrigada, ${nome}. Qual horário seria mais adequado para você?`);
  }

  if (etapa === 'perguntar_horario') {
    const horarioExtraido = extrairHorario(texto);
    
    if (horarioExtraido) {
      conv.horarioInicio = horarioExtraido.inicio;
      conv.horarioFim = horarioExtraido.fim;
    } else {
      // CALCULA 2 HORAS APÓS HORÁRIO ATUAL
      const agora = new Date();
      agora.setHours(agora.getHours() + 2);
      const h1 = agora.getHours();
      const h2 = h1 + 2;
      conv.horarioInicio = `${h1.toString().padStart(2,'0')}:00`;
      conv.horarioFim = `${h2.toString().padStart(2,'0')}:00`;
    }
    
    conv.etapa = 'perguntar_endereco';
    return corrigirTexto(`Muito obrigada, ${nome}! Poderia informar o endereço completo, por favor?`);
  }

  if (etapa === 'perguntar_bairro') {
    conv.bairro = texto;
    const bairroLower = txt;
    
    if (bairroLower.includes('botafogo')) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 100;
      return corrigirTexto(`Em Botafogo a taxa de visita é R$100, ${nome}, e este valor é integralmente descontado do conserto se o orçamento for aprovado. Posso prosseguir com o agendamento?`);
    }
    
    if (ehZonaSul(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 120;
      return corrigirTexto(`Na Zona Sul a taxa é R$120, ${nome}, com desconto total no conserto aprovado. Podemos continuar?`);
    }
    
    if (ehZonaNorte(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 190;
      return corrigirTexto(`Na Zona Norte o valor é R$190, ${nome}, mas desconta 100% do conserto. Está de acordo para prosseguirmos?`);
    }
    
    if (bairroLower.includes('barra') || bairroLower.includes('baixada') || bairroLower.includes('jacarepagua')) {
      conv.etapa = 'nao_atende';
      return corrigirTexto(`Lamento informar que ainda não atendemos nessa região, ${nome}. Cobrimos Botafogo, Zona Sul e Zona Norte do Rio. Caso queira falar com um atendente, é só avisar.`);
    }
    
    return corrigirTexto(`${nome}, poderia confirmar se é Zona Sul, Zona Norte, Botafogo ou outra região?`);
  }

  if (etapa === 'confirmar_taxa') {
    if (txt.match(/(sim|quero|ok|pode)/)) {
      if (!conv.horarioInicio) {
        const agora = new Date();
        agora.setHours(agora.getHours() + 2);
        const h1 = agora.getHours();
        const h2 = h1 + 2;
        conv.horarioInicio = `${h1.toString().padStart(2,'0')}:00`;
        conv.horarioFim = `${h2.toString().padStart(2,'0')}:00`;
      }
      conv.etapa = 'perguntar_endereco';
      return corrigirTexto(`Excelente, ${nome}! Agora preciso do endereço completo para finalizar o agendamento.`);
    }
    
    if (txt.match(/(nao|cancelar)/)) {
      conv.etapa = 'perguntar_quando';
      return corrigirTexto(`Entendi perfeitamente, ${nome}. Quando seria um melhor momento para a visita?`);
    }
    
    return corrigirTexto(`Podemos prosseguir com o agendamento da visita, ${nome}?`);
  }

  if (etapa === 'perguntar_endereco') {
    conv.endereco = texto;
    conv.etapa = 'visita_marcada';
    
    // Envia para o Telegram
    enviarTelegramVisita(conv);
    
    return corrigirTexto(`✅ *VISITA TÉCNICA AGENDADA COM SUCESSO, ${nome}!*

📅 *Hoje das ${conv.horarioInicio} às ${conv.horarioFim}*
💰 *Taxa: R$${conv.valorVisita}* (descontada do conserto)
📍 *${conv.endereco}*
🛠️ *${conv.equipamento} - ${conv.marca || 'Não informada'}*

Muito obrigada pela confiança, ${nome}! Qualquer dúvida, estou à disposição.`);
  }

  if (etapa === 'visita_marcada') {
    return null;
  }

  if (etapa === 'nao_atende') {
    return corrigirTexto(`Lamento não podermos atendê-lo(a) nessa região no momento, ${nome}. Caso queira falar com um atendente, é só avisar.`);
  }

  return corrigirTexto(`Olá, ${nome}! Gostaria de agendar uma visita técnica para o conserto? Estou aqui para ajudar!`);
}

// ============================================
// FUNCOES AUXILIARES (mantidas iguais)
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
// TELEGRAM - NOTIFICACOES COMPLETAS
// ============================================

async function enviarTelegramVisita(conv) {
  console.log('[TELEGRAM] Enviando visita...');

  const mensagem = `🔧 *NOVA VISITA AGENDADA - CONSERTA RIO*

👤 *Nome:* ${conv.nome}
📱 *WhatsApp:* ${conv.telefone}
📍 *Endereço:* ${conv.endereco}
🏘️ *Bairro:* ${conv.bairro}
🛠️ *Equipamento:* ${conv.equipamento}
🏷️ *Marca:* ${conv.marca || 'Não informada'}
📅 *Data:* Hoje
⏰ *Horário:* ${conv.horarioInicio} às ${conv.horarioFim}
💰 *Taxa:* R$${conv.valorVisita}

*Preparar técnico imediatamente!*`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      console.error('[TELEGRAM] Erro:', data);
      // Fallback sem Markdown
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_GROUP_ID,
          text: mensagem.replace(/\*/g, '')
        })
      });
    } else {
      console.log('[TELEGRAM] Visita enviada com sucesso');
    }
  } catch (e) {
    console.error('[TELEGRAM] Erro:', e.message);
  }
}

async function enviarTelegramIntervencao(telefone, nome) {
  const mensagem = `🆘 *INTERVENÇÃO HUMANA SOLICITADA*

👤 *Cliente:* ${nome}
📱 *WhatsApp:* ${telefone}

O cliente solicitou atendimento humano.`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    
    const data = await response.json();
    if (!data.ok) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_GROUP_ID,
          text: mensagem.replace(/\*/g, '')
        })
      });
    }
  } catch (e) {
    console.error('[TELEGRAM] Erro intervencao:', e.message);
  }
}
