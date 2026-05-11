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
console.log('[INIT] SUPABASE_KEY:', SUPABASE_KEY ? 'OK' : 'FALTA');
console.log('[INIT] WHATSAPP_TOKEN:', WHATSAPP_TOKEN ? 'OK' : 'FALTA');
console.log('[INIT] WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID ? 'OK' : 'FALTA');
console.log('[INIT] TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? 'OK' : 'FALTA');
console.log('[INIT] TELEGRAM_CHAT_ID:', TELEGRAM_CHAT_ID ? 'OK' : 'FALTA');

let supabase = null;
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

  try {
    console.log(`\n[${rid}] ${req.method} ${req.url}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase nao inicializado' });
    }

    // ═══════════════════════════════════════════════════════
    // GET ?action=status
    // ═══════════════════════════════════════════════════════
    if (req.method === 'GET' && req.query && req.query.action === 'status') {
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
        console.error(`[${rid}] status erro:`, error.message);
        return res.status(500).json({ error: error.message });
      }
    }

    // GET ?action=list
    if (req.method === 'GET' && req.query && req.query.action === 'list') {
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

    // GET ?action=messages&phone=...
    if (req.method === 'GET' && req.query && req.query.action === 'messages') {
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
    // POST — Salvar treinamento
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

        if (existing && existing.id) {
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

        console.log(`[${rid}] Salvo ID:`, result?.id);

        return res.status(200).json({
          success: true,
          message: 'Configuracao salva',
          id: result?.id
        });

      } catch (error) {
        console.error(`[${rid}] Erro salvar:`, error.message);
        return res.status(500).json({ error: error.message });
      }
    }

    // ═══════════════════════════════════════════════════════
    // POST ?action=intervene/release/send
    // ═══════════════════════════════════════════════════════
    if (req.method === 'POST' && req.query && req.query.action) {
      const action = req.query.action;
      const body = req.body;
      const phone = body && body.phone;

      if (action === 'intervene') {
        try {
          await supabase.from('conversations')
            .update({ status: 'human', updated_at: new Date().toISOString() })
            .eq('phone_number', phone);
          await saveMessage(phone, 'Atendente humano assumiu.', 'outbound', 'system');
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
          const message = body && body.message;
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
    // POST — WEBHOOK WHATSAPP
    // ═══════════════════════════════════════════════════════
    if (req.method === 'POST') {
      console.log(`[${rid}] WHATSAPP WEBHOOK`);

      // Responder 200 IMEDIATAMENTE para o Meta
      res.status(200).send('OK');
      console.log(`[${rid}] 200 OK enviado`);

      try {
        const body = req.body;
        console.log(`[${rid}] Body:`, JSON.stringify(body).substring(0, 500));

        // Verificar se e ping de verificacao
        if (body.object === 'whatsapp_business_account' && !body.entry) {
          console.log(`[${rid}] Ping Meta - ignorando`);
          return;
        }

        const entry = body.entry && body.entry[0];
        if (!entry) {
          console.log(`[${rid}] Sem entry`);
          return;
        }

        const changes = entry.changes && entry.changes[0];
        if (!changes) {
          console.log(`[${rid}] Sem changes`);
          return;
        }

        const value = changes.value;
        if (!value) {
          console.log(`[${rid}] Sem value`);
          return;
        }

        const message = value.messages && value.messages[0];
        if (!message) {
          console.log(`[${rid}] Sem mensagem`);
          return;
        }

        console.log(`[${rid}] Message type:`, message.type);

        if (message.type !== 'text') {
          console.log(`[${rid}] Ignorado: tipo ${message.type}`);
          return;
        }

        const from = message.from;
        const text = message.text && message.text.body ? message.text.body : '';
        const contactName = value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name ? value.contacts[0].profile.name : from;

        console.log(`[${rid}] >>> ${from} (${contactName}): "${text}"`);

        // 1. BUSCAR TREINAMENTO
        console.log(`[${rid}] [1] Buscando treinamento...`);
        const { data: training, error: trainingError } = await supabase
          .from('bot_training')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (trainingError) {
          console.error(`[${rid}] [1] Erro:`, trainingError);
          await saveMessage(from, text, 'inbound', 'human', contactName);
          return;
        }

        if (!training) {
          console.log(`[${rid}] [1] Nenhum treinamento`);
          await saveMessage(from, text, 'inbound', 'human', contactName);
          return;
        }

        console.log(`[${rid}] [1] Treinamento OK. Ativo:`, training.active);

        // 2. VERIFICAR SE BOT ATIVO
        if (!training.active) {
          console.log(`[${rid}] [2] Bot desativado`);
          await saveMessage(from, text, 'inbound', 'human', contactName);
          return;
        }

        // 3. SALVAR MENSAGEM DO CLIENTE
        await saveMessage(from, text, 'inbound', 'bot', contactName);

        // 4. VERIFICAR MODO HUMANO
        const { data: conversation } = await supabase
          .from('conversations')
          .select('status')
          .eq('phone_number', from)
          .maybeSingle();

        if (conversation && conversation.status === 'human') {
          console.log(`[${rid}] [4] Modo humano`);
          return;
        }

        // 5. GERAR RESPOSTA
        console.log(`[${rid}] [5] Gerando resposta...`);
        const responseData = await generateResponse(text, training, from, contactName);
        const botResponse = responseData.text;

        console.log(`[${rid}] [5] Resposta: "${botResponse.substring(0, 80)}..."`);

        // 6. ENVIAR WHATSAPP
        console.log(`[${rid}] [6] Enviando WhatsApp...`);
        if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
          try {
            await sendWhatsAppMessage(from, botResponse);
            console.log(`[${rid}] [6] WhatsApp OK`);
          } catch (err) {
            console.error(`[${rid}] [6] Erro WhatsApp:`, err.message);
          }
        } else {
          console.log(`[${rid}] [6] SEM WHATSAPP_TOKEN`);
        }

        // 7. SALVAR RESPOSTA
        await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

        // 8. NOTIFICAR TELEGRAM
        if (responseData.notify) {
          console.log(`[${rid}] [8] Notificando Telegram...`);
          if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
            try {
              await sendTelegram(responseData.notifyMessage);
              console.log(`[${rid}] [8] Telegram OK`);
            } catch (err) {
              console.error(`[${rid}] [8] Erro Telegram:`, err.message);
            }
          }
        }

        console.log(`[${rid}] ====== FIM ======`);

      } catch (error) {
        console.error(`[${rid}] ERRO GERAL:`, error);
      }
      return;
    }

    return res.status(405).send('Method not allowed');

  } catch (fatalError) {
    console.error(`[${rid}] FATAL:`, fatalError);
    return res.status(500).json({ error: fatalError.message });
  }
}

// ═══════════════════════════════════════════════════════
// GERAR RESPOSTA
// ═══════════════════════════════════════════════════════
async function generateResponse(userMessage, training, phoneNumber, contactName) {
  const msg = userMessage.toLowerCase().trim();
  const name = contactName || phoneNumber;

  // SAUDACOES
  const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae', 'opa', 'fala'];
  if (greetings.some(function(g) { return msg === g || msg.startsWith(g + ' '); })) {
    return { text: training.greeting_message || 'Ola! Como posso ajudar?', notify: false, notifyType: '', notifyMessage: '' };
  }

  // FAQ
  const faq = training.faq_data || [];
  for (let i = 0; i < faq.length; i++) {
    const item = faq[i];
    if (!item.question || !item.answer) continue;
    const q = item.question.toLowerCase();
    const words = q.split(/\s+/).filter(function(w) { return w.length > 2; });
    const matches = words.filter(function(w) { return msg.includes(w); }).length;
    if (matches >= 2 || msg.includes(q)) {
      return { text: item.answer, notify: false, notifyType: '', notifyMessage: '' };
    }
  }

  // PRECO
  if (msg.includes('preco') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto') || msg.includes('cobrar') || msg.includes('orcamento')) {
    return { text: (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito!', notify: false, notifyType: '', notifyMessage: '' };
  }

  // HORARIO
  if (msg.includes('horario') || msg.includes('hora') || msg.includes('aberto') || msg.includes('funciona') || msg.includes('atende') || msg.includes('abre')) {
    return { text: '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos!', notify: false, notifyType: '', notifyMessage: '' };
  }

  // SERVICOS
  if (msg.includes('servico') || msg.includes('faz') || msg.includes('conserta') || msg.includes('arruma') || msg.includes('troca') || msg.includes('reparo')) {
    return { text: '🔧 ' + (training.services || 'Diversos servicos.') + '\n\nQual voce precisa?', notify: false, notifyType: '', notifyMessage: '' };
  }

  // LOCAL
  if (msg.includes('local') || msg.includes('endereco') || msg.includes('onde') || msg.includes('fica') || msg.includes('chegar')) {
    return { text: '📍 Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".', notify: false, notifyType: '', notifyMessage: '' };
  }

  // GARANTIA
  if (msg.includes('garantia') || msg.includes('garante')) {
    return { text: '✅ Todos os nossos servicos possuem garantia! (geralmente 30 a 90 dias)', notify: false, notifyType: '', notifyMessage: '' };
  }

  // PRAZO
  if (msg.includes('prazo') || msg.includes('tempo') || msg.includes('demora') || msg.includes('rapido')) {
    return { text: '⏱️ O prazo depende do defeito. Fazemos orcamento em ate 24h!', notify: false, notifyType: '', notifyMessage: '' };
  }

  // AGENDAR → NOTIFICAR TELEGRAM
  if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('visita') || msg.includes('posso ir') || msg.includes('levar')) {
    const notifyMsg = '📅 *VISITA AGENDADA*\n\nCliente: ' + name + '\nTelefone: ' + phoneNumber + '\nMensagem: "' + userMessage + '"\n\n➡️ Entre em contato para confirmar horario!';
    return {
      text: '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema?\n3️⃣ Qual dia e horario?\n\nOu digite "atendente" para humano!',
      notify: true,
      notifyType: 'visita',
      notifyMessage: notifyMsg
    };
  }

  // ESCALONAMENTO → NOTIFICAR TELEGRAM
  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor', 'dono'];
  let shouldEscalate = false;
  for (let i = 0; i < escalationWords.length; i++) {
    if (msg.includes(escalationWords[i])) {
      shouldEscalate = true;
      break;
    }
  }

  if (shouldEscalate) {
    try {
      await supabase.from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
    } catch (err) {
      console.error('Erro transferir:', err);
    }

    const notifyMsg = '🚨 *ATENDIMENTO HUMANO*\n\nCliente: ' + name + '\nTelefone: ' + phoneNumber + '\nMensagem: "' + userMessage + '"\n\n➡️ Transferido para fila humana!';
    return {
      text: '👨‍💼 Entendido! Vou transferir voce para um atendente humano. Aguarde um momento...',
      notify: true,
      notifyType: 'humano',
      notifyMessage: notifyMsg
    };
  }

  // FALLBACK
  return {
    text: (training.fallback_message || 'Nao entendi. Posso te ajudar com precos, horarios e agendamentos.') + '\n\nDigite "atendente"!',
    notify: false,
    notifyType: '',
    notifyMessage: ''
  };
}

// ═══════════════════════════════════════════════════════
// SALVAR MENSAGEM
// ═══════════════════════════════════════════════════════
async function saveMessage(phone, content, direction, senderType, contactName) {
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

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      phone_number: phone,
      direction: direction,
      content: content,
      sender_type: senderType
    });

  } catch (error) {
    console.error('Erro saveMessage:', error);
  }
}

// ═══════════════════════════════════════════════════════
// ENVIAR WHATSAPP
// ═══════════════════════════════════════════════════════
async function sendWhatsAppMessage(to, text) {
  const url = 'https://graph.facebook.com/v18.0/' + WHATSAPP_PHONE_ID + '/messages';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + WHATSAPP_TOKEN,
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
    throw new Error(data.error && data.error.message ? data.error.message : 'Erro WhatsApp');
  }

  console.log('WhatsApp enviado:', data.messages && data.messages[0] ? data.messages[0].id : 'sem ID');
  return data;
}

// ═══════════════════════════════════════════════════════
// ENVIAR TELEGRAM
// ═══════════════════════════════════════════════════════
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram nao configurado');
    return;
  }

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';

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
    throw new Error(data.description ? data.description : 'Erro Telegram');
  }

  console.log('Telegram enviado');
  return data;
}
