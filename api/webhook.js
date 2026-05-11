import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// CONFIGURACAO
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5NjgyMywiZXhwIjoyMDkwNDcyODIzfQ.lMntp1GpMQ-MeOeVDYK13Ayq9GNlFA0qkrMbhylgsRE';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'EAFmfvvzzQO4BRETZCcUIqfW7eBoXRJRlrf8ROZBaVnODG0T5aKfyCxzeKqeupaXI9r6q1c0Vh6yrJrLgoO43g6asjAZB1sKajLOFWPpLzLODbDv97LuLjGbyZCuJADT6FYeT0pDX9o9pTHfZCz1jFatnecBs6w8WjI9KPV8b0aaaKCxePmwozA5ZAXUZCGvIcQ9RAZDZD';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '738758095978120';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8517608136:AAFJmE04CPd7DecwKVh_MzGA6bnGGmbT3zI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-5246111585';

console.log('[INIT] ========== WEBHOOK INICIANDO ==========');
console.log('[INIT] SUPABASE_URL:', SUPABASE_URL ? 'OK' : 'FALTA');
console.log('[INIT] SUPABASE_KEY:', SUPABASE_KEY ? 'OK (' + SUPABASE_KEY.substring(0, 20) + '...)' : 'FALTA');
console.log('[INIT] WHATSAPP_TOKEN:', WHATSAPP_TOKEN ? 'OK' : 'FALTA');
console.log('[INIT] WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID ? 'OK' : 'FALTA');
console.log('[INIT] TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? 'OK' : 'FALTA');
console.log('[INIT] TELEGRAM_CHAT_ID:', TELEGRAM_CHAT_ID ? 'OK' : 'FALTA');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[INIT] ERRO CRITICO: SUPABASE nao configurado');
}
if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
  console.error('[INIT] ERRO: WhatsApp nao configurado');
}

let supabase;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[INIT] Supabase client criado');
} catch (err) {
  console.error('[INIT] FALHA Supabase:', err.message);
}

// ═══════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════
export default async function handler(req, res) {
  const rid = Math.random().toString(36).substring(2, 8);
  console.log(`\n[${rid}] ====== REQUISICAO ${req.method} ======`);
  console.log(`[${rid}] URL: ${req.url}`);
  console.log(`[${rid}] Query:`, JSON.stringify(req.query));

  // CORS
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase nao inicializado' });
  }

  // ═══════════════════════════════════════════════════════
  // GET ?action=status — Painel de treinamento busca config
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET' && req.query.action === 'status') {
    try {
      const { data: training, error } = await supabase
        .from('bot_training')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        status: 'online',
        ...training,
        greeting: training?.greeting_message,
        bot_active: training?.active
      });
    } catch (error) {
      console.error(`[${rid}] Erro status:`, error);
      return res.status(500).json({ error: error.message });
    }
  }

  // GET ?action=list — Painel de intervenção lista conversas
  if (req.method === 'GET' && req.query.action === 'list') {
    try {
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .order('last_message_time', { ascending: false });

      if (error) throw error;

      const conversas = (conversations || []).map(conv => ({
        telefone: conv.phone_number,
        nome: conv.contact_name || conv.phone_number,
        emIntervencao: conv.status === 'human',
        etapa: conv.status,
        ultimaAtividade: conv.last_message_time,
        ultima: conv.last_message || 'Sem mensagens',
        mensagens: []
      }));

      return res.status(200).json(conversas);
    } catch (error) {
      return res.status(500).json({ error: error.message, conversas: [] });
    }
  }

  // GET ?action=messages&phone=... — Buscar mensagens de uma conversa
  if (req.method === 'GET' && req.query.action === 'messages') {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    try {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('phone_number', phone)
        .maybeSingle();

      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('phone_number', phone)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const mensagens = (messages || []).map(msg => ({
        data: msg.created_at,
        timestamp: msg.created_at,
        tipo: msg.direction === 'outbound' ? (msg.sender_type === 'human' ? 'humano' : 'bot') : 'cliente',
        from: msg.direction === 'outbound' ? (msg.sender_type === 'human' ? 'humano' : 'bot') : 'cliente',
        mensagem: msg.content,
        texto: msg.content,
        content: msg.content,
        message: msg.content,
        nome: msg.sender_type === 'human' ? 'Voce' : (msg.sender_type === 'bot' ? 'Bot' : 'Cliente')
      }));

      return res.status(200).json({
        mensagens: mensagens,
        emIntervencao: conversation?.status === 'human'
      });
    } catch (error) {
      return res.status(500).json({ error: error.message, mensagens: [] });
    }
  }

  // ═══════════════════════════════════════════════════════
  // POST — Salvar treinamento do painel
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && (!req.query.action || req.query.action === 'saveconfig')) {
    try {
      const body = req.body;
      console.log(`[${rid}] Salvando treinamento...`);

      if (!body || typeof body !== 'object') {
        throw new Error('Body invalido');
      }

      const trainingData = {
        bot_name: body.bot_name || '',
        company_name: body.company_name || '',
        greeting_message: body.greeting_message || body.greeting || '',
        personality: body.personality || '',
        services: body.services || '',
        business_hours: body.business_hours || body.hours || '',
        pricing_info: body.pricing_info || body.pricing || '',
        fallback_message: body.fallback_message || body.fallback || '',
        faq_data: Array.isArray(body.faq_data) ? body.faq_data : [],
        escalation_keywords: Array.isArray(body.escalation_keywords) ? body.escalation_keywords : [],
        active: body.active !== false && body.active !== 'false',
        updated_at: new Date().toISOString()
      };

      const { data: existing } = await supabase
        .from('bot_training')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let result, error;

      if (existing?.id) {
        ({ data: result, error } = await supabase
          .from('bot_training')
          .update(trainingData)
          .eq('id', existing.id)
          .select()
          .single());
      } else {
        trainingData.created_at = new Date().toISOString();
        ({ data: result, error } = await supabase
          .from('bot_training')
          .insert(trainingData)
          .select()
          .single());
      }

      if (error) throw error;

      console.log(`[${rid}] Treinamento salvo ID:`, result?.id);

      return res.status(200).json({
        success: true,
        message: 'Configuracao salva',
        id: result?.id
      });

    } catch (error) {
      console.error(`[${rid}] Erro salvar:`, error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ═══════════════════════════════════════════════════════
  // POST ?action=intervene/release/send — Acoes do painel
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && req.query.action) {
    const action = req.query.action;
    const body = req.body;
    const phone = body?.phone;

    if (action === 'intervene') {
      try {
        await supabase.from('conversations')
          .update({ status: 'human', updated_at: new Date().toISOString() })
          .eq('phone_number', phone);
        await saveMessage(phone, 'Atendente humano assumiu o controle.', 'outbound', 'system');
        return res.status(200).json({ ok: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (action === 'release') {
      try {
        await supabase.from('conversations')
          .update({ status: 'bot', updated_at: new Date().toISOString() })
          .eq('phone_number', phone);
        await saveMessage(phone, 'Robo reassumiu.', 'outbound', 'system');
        return res.status(200).json({ ok: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (action === 'send') {
      try {
        const message = body?.message;
        if (!message) return res.status(400).json({ error: 'Message required' });
        await saveMessage(phone, message, 'outbound', 'human');
        if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
          await sendWhatsAppMessage(phone, message);
        }
        return res.status(200).json({ ok: true });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // POST — WEBHOOK WHATSAPP (recebe mensagens do Meta)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST') {
    // Responder 200 IMEDIATAMENTE para o Meta nao reenviar
    res.status(200).send('OK');

    try {
      const body = req.body;
      console.log(`[${rid}] WHATSAPP WEBHOOK RECEBIDO`);
      console.log(`[${rid}] Body:`, JSON.stringify(body).substring(0, 500));

      // Verificar se e ping de verificacao
      if (body.object === 'whatsapp_business_account' && !body.entry) {
        console.log(`[${rid}] Ping de verificacao do Meta`);
        return;
      }

      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message) {
        console.log(`[${rid}] Sem mensagem no payload`);
        return;
      }

      if (message.type !== 'text') {
        console.log(`[${rid}] Ignorado: tipo ${message.type}`);
        return;
      }

      const from = message.from;
      const text = message.text?.body || '';
      const contactName = value?.contacts?.[0]?.profile?.name || from;

      console.log(`[${rid}] >>> MENSAGEM DE ${from} (${contactName}): "${text}"`);

      // 1. BUSCAR TREINAMENTO ATUAL DO SUPABASE
      console.log(`[${rid}] Buscando treinamento...`);
      const { data: training, error: trainingError } = await supabase
        .from('bot_training')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (trainingError) {
        console.error(`[${rid}] Erro buscar treinamento:`, trainingError);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      if (!training) {
        console.log(`[${rid}] Nenhum treinamento encontrado`);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      console.log(`[${rid}] Treinamento carregado. Bot ativo:`, training.active);

      // 2. VERIFICAR SE BOT ESTA ATIVO
      if (!training.active) {
        console.log(`[${rid}] Bot DESATIVADO`);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      // 3. SALVAR MENSAGEM DO CLIENTE
      await saveMessage(from, text, 'inbound', 'bot', contactName);

      // 4. VERIFICAR SE CONVERSA EM MODO HUMANO
      const { data: conversation } = await supabase
        .from('conversations')
        .select('status')
        .eq('phone_number', from)
        .maybeSingle();

      if (conversation?.status === 'human') {
        console.log(`[${rid}] Modo HUMANO ativo - nao responde`);
        return;
      }

      // 5. GERAR RESPOSTA COM BASE NO TREINAMENTO
      const responseData = await generateResponse(text, training, from, contactName);
      const botResponse = responseData.text;
      const shouldNotifyTelegram = responseData.notify;
      const notifyType = responseData.notifyType;
      const notifyMessage = responseData.notifyMessage;

      console.log(`[${rid}] Resposta gerada: "${botResponse.substring(0, 80)}..."`);

      // 6. ENVIAR RESPOSTA NO WHATSAPP
      if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
        try {
          await sendWhatsAppMessage(from, botResponse);
          console.log(`[${rid}] WhatsApp ENVIADO`);
        } catch (err) {
          console.error(`[${rid}] ERRO ao enviar WhatsApp:`, err.message);
        }
      } else {
        console.log(`[${rid}] SEM WHATSAPP_TOKEN - nao enviou`);
      }

      // 7. SALVAR RESPOSTA DO BOT
      await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

      // 8. NOTIFICAR TELEGRAM SE NECESSARIO
      if (shouldNotifyTelegram && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        try {
          await sendTelegram(notifyMessage);
          console.log(`[${rid}] Telegram notificado: ${notifyType}`);
        } catch (err) {
          console.error(`[${rid}] ERRO Telegram:`, err.message);
        }
      }

      console.log(`[${rid}] ====== CICLO COMPLETO ======`);

    } catch (error) {
      console.error(`[${rid}] ERRO GERAL webhook:`, error);
    }
    return;
  }

  return res.status(405).send('Method not allowed');
}

// ═══════════════════════════════════════════════════════
// GERAR RESPOSTA — USA TREINAMENTO DO PAINEL
// Retorna: { text, notify, notifyType, notifyMessage }
// ═══════════════════════════════════════════════════════
async function generateResponse(userMessage, training, phoneNumber, contactName) {
  const msg = userMessage.toLowerCase().trim();
  const name = contactName || phoneNumber;

  // 1. SAUDACOES
  const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae', 'opa', 'fala'];
  if (greetings.some(g => msg === g || msg.startsWith(g + ' '))) {
    return {
      text: training.greeting_message || 'Ola! Como posso ajudar?',
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  // 2. FAQ INTELIGENTE (do painel)
  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const q = item.question.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const matches = words.filter(w => msg.includes(w)).length;

    if (matches >= 2 || msg.includes(q)) {
      return {
        text: item.answer,
        notify: false,
        notifyType: '',
        notifyMessage: ''
      };
    }
  }

  // 3. PALAVRAS-CHAVE POR CATEGORIA
  if (msg.includes('preco') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto') || msg.includes('cobrar') || msg.includes('orcamento') || msg.includes('tabela')) {
    return {
      text: (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito para voce! Qual equipamento precisa de assistencia?',
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  if (msg.includes('horario') || msg.includes('hora') || msg.includes('aberto') || msg.includes('funciona') || msg.includes('atende') || msg.includes('abre') || msg.includes('fecha')) {
    return {
      text: '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos para te atender! 😊',
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  if (msg.includes('servico') || msg.includes('faz') || msg.includes('conserta') || msg.includes('concerta') || msg.includes('arruma') || msg.includes('troca') || msg.includes('reparo') || msg.includes('manutencao')) {
    return {
      text: '🔧 ' + (training.services || 'Oferecemos diversos servicos.') + '\n\nQual desses servicos voce precisa? Posso te passar mais detalhes!',
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  if (msg.includes('local') || msg.includes('endereco') || msg.includes('onde') || msg.includes('fica') || msg.includes('chegar') || msg.includes('rua')) {
    return {
      text: '📍 Nossa assistencia fica em local de facil acesso! Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".'
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  if (msg.includes('garantia') || msg.includes('garante') || msg.includes('garantir')) {
    return {
      text: '✅ Todos os nossos servicos possuem garantia! O prazo varia conforme o tipo de reparo (geralmente 30 a 90 dias).\n\nA garantia cobre o mesmo defeito reparado. Quer saber mais sobre algum servico especifico?',
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  if (msg.includes('prazo') || msg.includes('tempo') || msg.includes('demora') || msg.includes('rapido') || msg.includes('demorar') || msg.includes('urgente')) {
    return {
      text: '⏱️ O prazo depende do defeito e da disponibilidade de pecas.\n\nFazemos orcamento em ate 24h! Qual equipamento voce tem?',
      notify: false,
      notifyType: '',
      notifyMessage: ''
    };
  }

  // 4. AGENDAR VISITA → NOTIFICAR TELEGRAM
  if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('quando') || msg.includes('posso ir') || msg.includes('visita') || msg.includes('vir ai') || msg.includes('levar') || msg.includes('buscar')) {
    const notifyMsg = `📅 *VISITA AGENDADA*\n\nCliente: ${name}\nTelefone: ${phoneNumber}\nMensagem: "${userMessage}"\n\n➡️ Entre em contato para confirmar horario!`;

    return {
      text: '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema/defeito?\n3️⃣ Qual dia e horario prefere?\n\nOu se preferir, posso transferir voce para um atendente humano agora mesmo! 👨‍💼',
      notify: true,
      notifyType: 'visita',
      notifyMessage: notifyMsg
    };
  }

  // 5. ESCALONAMENTO → NOTIFICAR TELEGRAM
  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor', 'dono', 'proprietario'];
  if (escalationWords.some(word => msg.includes(word))) {
    // Transferir para humano no banco
    try {
      await supabase.from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
    } catch (err) {
      console.error('Erro transferir:', err);
    }

    const notifyMsg = `🚨 *ATENDIMENTO HUMANO SOLICITADO*\n\nCliente: ${name}\nTelefone: ${phoneNumber}\nMensagem: "${userMessage}"\n\n➡️ Cliente transferido para fila humana!`;

    return {
      text: '👨‍💼 Entendido! Vou transferir voce para um atendente humano agora mesmo. Por favor, aguarde um momento... ⏳\n\n(Seu atendente ja foi notificado e respondera em breve!)',
      notify: true,
      notifyType: 'humano',
      notifyMessage: notifyMsg
    };
  }

  // 6. FALLBACK
  return {
    text: (training.fallback_message || 'Nao entendi bem. Posso te ajudar com orcamentos, horarios, servicos e agendamentos.') + '\n\nOu digite "atendente" para falar com uma pessoa!',
    notify: false,
    notifyType: '',
    notifyMessage: ''
  };
}

// ═══════════════════════════════════════════════════════
// SALVAR MENSAGEM NO SUPABASE
// ═══════════════════════════════════════════════════════
async function saveMessage(phone, content, direction, senderType, contactName = null) {
  try {
    let { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', phone)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          phone_number: phone,
          contact_name: contactName,
          status: 'bot',
          last_message: content,
          last_message_time: new Date().toISOString(),
          unread: true
        })
        .select()
        .single();

      if (convError) {
        console.error('Erro criar conversa:', convError);
        return;
      }
      conversation = newConv;
    } else {
      await supabase.from('conversations')
        .update({
          contact_name: contactName || undefined,
          last_message: content,
          last_message_time: new Date().toISOString(),
          unread: true
        })
        .eq('id', conversation.id);
    }

    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      phone_number: phone,
      direction: direction,
      content: content,
      sender_type: senderType
    });

    if (msgError) console.error('Erro salvar msg:', msgError);

  } catch (error) {
    console.error('Erro saveMessage:', error);
  }
}

// ═══════════════════════════════════════════════════════
// ENVIAR MENSAGEM WHATSAPP (API META)
// ═══════════════════════════════════════════════════════
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { body: text }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('WhatsApp API erro:', JSON.stringify(data));
    throw new Error(data.error?.message || 'Erro WhatsApp');
  }

  console.log('WhatsApp enviado:', data.messages?.[0]?.id);
  return data;
}

// ═══════════════════════════════════════════════════════
// ENVIAR NOTIFICACAO TELEGRAM
// ═══════════════════════════════════════════════════════
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram nao configurado');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    console.error('Telegram erro:', JSON.stringify(data));
    throw new Error(data.description || 'Erro Telegram');
  }

  console.log('Telegram enviado');
  return data;
}
