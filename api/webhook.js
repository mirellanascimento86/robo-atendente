// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// Versao com PAINEL DE INTERVENCAO
// ============================================

// CONFIGURACAO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

// ============================================
// MEMORIA DO SISTEMA
// ============================================
const conversas = new Map();
const timers = new Map(); // Timers para delay de 2 minutos

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  // CORS
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

    // LISTAR CONVERSAS
    if (action === 'list') {
      const lista = Array.from(conversas.values())
        .sort((a, b) => new Date(b.ultimaAtividade || 0) - new Date(a.ultimaAtividade || 0));

      console.log(`[LIST] Retornando ${lista.length} conversas`);
      return res.status(200).json({ conversas: lista });
    }

    // BUSCAR MENSAGENS
    if (action === 'messages') {
      const phone = req.query.phone;
      const conv = conversas.get(phone);

      if (!conv) {
        console.log(`[MESSAGES] Conversa nao encontrada: ${phone}`);
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }

      console.log(`[MESSAGES] ${phone} - ${conv.mensagens?.length || 0} msgs, intervencao=${conv.emIntervencao}`);
      return res.status(200).json({ 
        mensagens: conv.mensagens || [],
        emIntervencao: conv.emIntervencao,
        telefone: conv.telefone,
        nome: conv.nome
      });
    }

    // ASSUMIR CONTROLE
    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      console.log(`[INTERVENE] Recebido phone=${phone}`);

      const conv = conversas.get(phone);

      if (!conv) {
        console.log(`[INTERVENE] Conversa nao existe, criando...`);
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
        console.log(`[INTERVENE] Conversa ${phone} agora emIntervencao=true`);
      }

      const convAtual = conversas.get(phone);
      return res.status(200).json({ 
        ok: true, 
        emIntervencao: true,
        telefone: phone,
        confirmado: convAtual.emIntervencao
      });
    }

    // LIBERAR ROBO
    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;
      console.log(`[RELEASE] phone=${phone}`);

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
        console.log(`[RELEASE] Conversa ${phone} emIntervencao=false`);
      }

      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    // ENVIAR MENSAGEM MANUAL
    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;
      console.log(`[SEND] phone=${phone} message="${message?.substring(0,30)}..."`);

      const conv = conversas.get(phone);

      // VERIFICACAO CRITICA: so envia se estiver em intervencao
      if (!conv || !conv.emIntervencao) {
        console.log(`[SEND] BLOQUEADO - emIntervencao=${conv?.emIntervencao}`);
        return res.status(403).json({ 
          ok: false, 
          erro: 'Nao esta em intervencao',
          emIntervencao: conv?.emIntervencao || false
        });
      }

      // Envia pelo WhatsApp API
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
        console.log(`[SEND] Mensagem enviada e salva`);
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
      horarioVisita: '',
      horarioInicio: '',
      horarioFim: '',
      valorVisita: 0,
      ultimaMsgBot: null,
      aguardandoResposta: false
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

  // Limpa timer anterior se existir
  if (timers.has(telefone)) {
    clearTimeout(timers.get(telefone));
    timers.delete(telefone);
  }

  console.log(`[RECEBIDO] ${telefone} (${nome}): ${texto.substring(0,50)}`);
  console.log(`[ESTADO] emIntervencao=${conv.emIntervencao}, etapa=${conv.etapa}`);

  // SE NAO ESTIVER EM INTERVENCAO, RESPONDE AUTOMATICAMENTE
  if (!conv.emIntervencao) {
    // Se ja marcou visita, nao responde mais nada
    if (conv.etapa === 'visita_marcada') {
      console.log(`[BOT] VISITA JA MARCADA - silencio total`);
      return;
    }

    const resposta = gerarResposta(texto, nome, conv);
    
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

      // Agenda timer de 2 minutos para reengajamento
      if (conv.etapa !== 'visita_marcada' && conv.etapa !== 'nao_atende') {
        const timer = setTimeout(() => {
          reengajarCliente(telefone);
        }, 2 * 60 * 1000); // 2 minutos
        
        timers.set(telefone, timer);
      }

      console.log(`[BOT] Resposta automatica enviada`);
    }
  } else {
    console.log(`[BOT] BLOQUEADO - conversa em intervencao humana`);
  }
}

// ============================================
// REENGAGEMENT - 2 MINUTOS SEM RESPOSTA
// ============================================

async function reengajarCliente(telefone) {
  const conv = conversas.get(telefone);
  if (!conv) return;
  
  // So reengaja se estiver aguardando resposta e nao for visita marcada
  if (!conv.aguardandoResposta || conv.etapa === 'visita_marcada' || conv.etapa === 'nao_atende') {
    return;
  }

  // Verifica se passou mais de 2 minutos desde ultima mensagem do cliente
  const ultimaAtividade = new Date(conv.ultimaAtividade);
  const agora = new Date();
  const diffMin = (agora - ultimaAtividade) / 1000 / 60;
  
  if (diffMin < 1.8) return; // Ainda nao passou tempo suficiente

  let msgReengajamento = '';

  // Mensagem de reengajamento baseada na etapa
  if (conv.etapa === 'equipamento') {
    msgReengajamento = 'Ola! Qual equipamento esta com problema e qual a marca?';
  } else if (conv.etapa === 'perguntar_visita') {
    msgReengajamento = 'Gostaria de marcar uma visita para hoje?';
  } else if (conv.etapa === 'perguntar_quando') {
    msgReengajamento = 'Quando poderia receber a visita?';
  } else if (conv.etapa === 'perguntar_horario') {
    msgReengajamento = 'Qual horario seria melhor para voce?';
  } else if (conv.etapa === 'perguntar_bairro') {
    msgReengajamento = 'Qual o bairro?';
  } else if (conv.etapa === 'confirmar_taxa') {
    msgReengajamento = 'Gostaria de prosseguir com a visita?';
  } else if (conv.etapa === 'perguntar_endereco') {
    msgReengajamento = 'Qual o endereco completo?';
  } else {
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
// GERAR RESPOSTA - FLUXO CONSERTA RIO
// ============================================

function gerarResposta(texto, nome, conv) {
  const txt = texto.toLowerCase().trim();
  const etapa = conv.etapa;

  // ===== SOLICITACAO DE HUMANO =====
  if (txt.match(/(humano|pessoa|atendente|funcionario|falar com|falar com alguem|atendente humano|real|vivo|pessoa de verdade)/)) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome);
    return 'Um momento.';
  }

  // ===== FLUXO PRINCIPAL =====

  // ETAPA: SAUDACAO (primeira mensagem ou sem contexto)
  if (etapa === 'saudacao') {
    conv.etapa = 'equipamento';
    return 'Ola! Qual equipamento esta com problema e qual a marca?';
  }

  // ETAPA: EQUIPAMENTO (recebeu info do equipamento e marca)
  if (etapa === 'equipamento') {
    // Tenta extrair equipamento e marca da mensagem
    const info = extrairEquipamentoMarca(texto);
    if (info.equipamento) conv.equipamento = info.equipamento;
    if (info.marca) conv.marca = info.marca;
    
    // Se nao conseguiu extrair, pergunta novamente com educacao
    if (!info.equipamento) {
      return 'Desculpe, nao entendi bem. Poderia me dizer qual equipamento esta com problema e qual a marca?';
    }
    
    conv.etapa = 'perguntar_visita';
    return 'Gostaria de marcar uma visita para hoje?';
  }

  // ETAPA: PERGUNTAR VISITA (resposta sim/nao para visita hoje)
  if (etapa === 'perguntar_visita') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|vamos|vamo|bora|beleza|show|demais|perfeito)/)) {
      conv.etapa = 'perguntar_bairro';
      return 'Qual o bairro?';
    } else if (txt.match(/(nao|não|nop|negativo|depois|outro dia|amanha|outro|mais tarde|nao quero|nao posso|hoje nao|outro horario|outra data)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Quando poderia?';
    } else {
      // Se resposta nao clara, repete a pergunta com gentileza
      return 'Gostaria de marcar uma visita para hoje?';
    }
  }

  // ETAPA: PERGUNTAR QUANDO (cliente disse nao para hoje)
  if (etapa === 'perguntar_quando') {
    conv.dataVisita = texto;
    conv.etapa = 'perguntar_horario';
    return 'Qual horario?';
  }

  // ETAPA: PERGUNTAR HORARIO
  if (etapa === 'perguntar_horario') {
    conv.horarioVisita = texto;
    
    // Tenta extrair horario para calcular janela de 2h
    const horarioExtraido = extrairHorario(texto);
    if (horarioExtraido) {
      conv.horarioInicio = horarioExtraido.inicio;
      conv.horarioFim = horarioExtraido.fim;
    } else {
      // Se nao conseguiu extrair, assume horario atual + 2h
      const agora = new Date();
      const h1 = agora.getHours() + 2;
      const h2 = h1 + 2;
      conv.horarioInicio = `${h1}:00`;
      conv.horarioFim = `${h2}:00`;
    }
    
    conv.etapa = 'perguntar_endereco';
    return 'Qual o endereco?';
  }

  // ETAPA: PERGUNTAR BAIRRO (cliente disse sim para visita hoje)
  if (etapa === 'perguntar_bairro') {
    conv.bairro = texto;
    
    const bairroLower = txt;
    
    // Verifica se e Botafogo
    if (bairroLower.includes('botafogo')) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 100;
      return 'Em Botafogo a taxa da visita e R$100. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Verifica Zona Sul
    if (ehZonaSul(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 120;
      return 'Na Zona Sul a taxa da visita e R$120. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Verifica Zona Norte
    if (ehZonaNorte(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 190;
      return 'Na Zona Norte a taxa da visita e R$190. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Barra da Tijuca, Baixada ou outras regioes nao atendidas
    if (bairroLower.includes('barra') || bairroLower.includes('baixada') || bairroLower.includes('jacarepagua') || bairroLower.includes('recreio') || bairroLower.includes('curicica') || bairroLower.includes('tanque')) {
      conv.etapa = 'nao_atende';
      return 'Infelizmente nao atendemos na sua regiao no momento.';
    }
    
    // Se nao reconhecer o bairro, pergunta de qual regiao
    return 'De qual regiao e esse bairro? (Zona Sul, Zona Norte, Centro, etc.)';
  }

  // ETAPA: CONFIRMAR TAXA
  if (etapa === 'confirmar_taxa') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|prossiga|vamos|vamo|bora|beleza|show|demais|perfeito)/)) {
      conv.etapa = 'perguntar_horario';
      return 'Qual horario?';
    } else if (txt.match(/(nao|não|nop|negativo|cancelar|desistir|outro dia|outro horario)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Quando poderia?';
    } else {
      return 'Gostaria de prosseguir?';
    }
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
    return null; // Nao responde nada
  }

  // ETAPA: NAO ATENDE - resposta generica
  if (etapa === 'nao_atende') {
    return 'Infelizmente nao atendemos na sua regiao no momento. Caso queira falar com um atendente, digite "humano".';
  }

  // Fallback: se etapa nao reconhecida, volta para pergunta de visita
  conv.etapa = 'perguntar_visita';
  return 'Gostaria de marcar uma visita para hoje?';
}

// ============================================
// FUNCOES AUXILIARES
// ============================================

function extrairEquipamentoMarca(texto) {
  const txt = texto.toLowerCase();
  
  const equipamentos = [
    'maquina de lavar', 'lava e seca', 'lava-seca', 'lavaeseca', 'lavaeseca',
    'frigobar', 'geladeira', 'ar condicionado', 'ar-condicionado', 'arcondicionado', 'ar condicionado', 'arcond'
  ];
  
  let equipamento = '';
  let marca = '';
  
  for (const eq of equipamentos) {
    if (txt.includes(eq)) {
      equipamento = eq;
      break;
    }
  }
  
  // Se nao encontrou equipamento especifico, usa o texto todo como equipamento
  if (!equipamento) {
    equipamento = texto;
  }
  
  // Tenta extrair marca (palavras comuns de marca)
  const marcas = ['brastemp', 'consul', 'electrolux', 'eletrolux', 'lg', 'samsung', 'panasonic', 'midea', 'springer', 'carrier', 'fujitsu', 'gree', 'philco', 'continental', 'bosch', 'ge', 'general electric'];
  for (const m of marcas) {
    if (txt.includes(m)) {
      marca = m;
      break;
    }
  }
  
  return { equipamento, marca };
}

function extrairHorario(texto) {
  const txt = texto.toLowerCase();
  
  // Padroes de horario: 14h, 14:00, 14 hs, 14 horas, 2 da tarde, etc.
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
      
      // Se tem minutos no match
      if (match[2] && !isNaN(parseInt(match[2]))) {
        minuto = parseInt(match[2]);
      }
      
      // Ajusta para tarde/noite
      if (match[2] === 'tarde' && hora < 12) hora += 12;
      if (match[2] === 'noite' && hora < 12) hora += 12;
      
      break;
    }
  }
  
  if (hora === null) return null;
  
  // Calcula janela de 2 horas
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
    'jardim botanico', 'lagoa', 'jardim oceanico', 'itaim bibi', 'vila nova'
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
      console.error('Erro API:', erro);
      return false;
    }

    console.log('Mensagem enviada para', numero);
    return true;

  } catch (e) {
    console.error('Erro ao enviar:', e.message);
    return false;
  }
}

// ============================================
// TELEGRAM - ENVIO DE NOTIFICACOES
// ============================================

async function enviarTelegramVisita(conv) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    console.error('Telegram nao configurado - TOKEN:', !!TELEGRAM_BOT_TOKEN, 'GROUP:', !!TELEGRAM_GROUP_ID);
    return;
  }

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
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });
    
    const data = await response.json();
    if (!data.ok) {
      console.error('[TELEGRAM] Erro na resposta:', data);
    } else {
      console.log('[TELEGRAM] Visita enviada ao grupo com sucesso');
    }
  } catch (e) {
    console.error('[TELEGRAM] Erro:', e.message);
  }
}

async function enviarTelegramIntervencao(telefone, nome) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    console.error('Telegram nao configurado');
    return;
  }

  const mensagem = `INTERVENCAO HUMANA SOLICITADA - CONSERTA RIO

Numero: ${telefone}
Nome: ${nome}

O cliente solicitou falar com um atendente humano.`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });
    
    const data = await response.json();
    if (!data.ok) {
      console.error('[TELEGRAM] Erro na resposta:', data);
    } else {
      console.log('[TELEGRAM] Intervencao enviada ao grupo com sucesso');
    }
  } catch (e) {
    console.error('[TELEGRAM] Erro:', e.message);
  }
}
