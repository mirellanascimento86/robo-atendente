import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// CONFIGURACAO
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

console.log('[INIT] Webhook iniciando...');
console.log('[INIT] SUPABASE_URL:', SUPABASE_URL ? 'OK' : 'FALTA');
console.log('[INIT] SUPABASE_KEY:', SUPABASE_KEY ? 'OK' : 'FALTA');

let supabase = null;
try {
  if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[INIT] Supabase OK');
  }
} catch (err) {
  console.error('[INIT] FALHA:', err.message);
}

// ═══════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════
export default async function handler(req, res) {
  const rid = Math.random().toString(36).substring(2, 8);

  try {
    console.log(`[${rid}] ${req.method} ${req.url}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase nao inicializado' });
    }

    // GET ?action=status
    if (req.method === 'GET' && req.query?.action === 'status') {
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
    if (req.method === 'GET' && req.query?.action === 'list') {
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
    if (req.method === 'GET' && req.query?.action === 'messages') {
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

    // POST — Salvar treinamento
    if (req.method === 'POST' && (!req.query?.action || req.query?.action === 'saveconfig')) {
      try {
        const body = req.body;
        console.log(`[${rid}] Salvando...`);

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

    // POST ?action=intervene/release/send
    if (req.method === 'POST' && req.query?.action) {
      const action = req.query.action;
      const body = req.body;
      const phone = body?.phone;

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

    // POST — WEBHOOK WHATSAPP
    if (req.method === 'POST') {
      res.status(200).send('OK');
      console.log(`[${rid}] WhatsApp webhook`);

      try {
        const body = req.body;
        console.log(`[${rid}] Body:`, JSON.stringify(body).substring(0, 300));

        if (body.object === 'whatsapp_business_account' && !body.entry) {
          console.log(`[${rid}] Ping Meta`);
          return;
        }

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (!message || message.type !== 'text') {
          console.log(`[${rid}] Sem mensagem texto`);
          return;
        }

        const from = message.from;
        const text = message.text?.body || '';
        const contactName = value?.contacts?.[0]?.profile?.name || from;

        console.log(`[${rid}] >>> ${from}: "${text}"`);

        // Buscar treinamento
        const { data: training, error: trainingError } = await supabase
          .from('bot_training')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (trainingError || !training) {
          console.error(`[${rid}] Sem treinamento:`, trainingError);
          await saveMessage(from, text, 'inbound', 'human', contactName);
          return;
        }

        if (!training.active) {
          console.log(`[${rid}] Bot desativado`);
          await saveMessage(from, text, 'inbound', 'human', contactName);
          return;
        }

        await saveMessage(from, text, 'inbound', 'bot', contactName);

        // Verificar modo humano
        const { data: conversation } = await supabase
          .from('conversations')
          .select('status')
          .eq('phone_number', from)
          .maybeSingle();

        if (conversation?.status === 'human') {
          console.log(`[${rid}] Modo humano`);
          return;
        }

        // Gerar resposta
        const responseData = await generateResponse(text, training, from, contactName);
        const botResponse = responseData.text;

        console.log(`[${rid}] Resposta: "${botResponse.substring(0, 80)}..."`);

        // Enviar WhatsApp
        if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
          try {
            await sendWhatsAppMessage(from, botResponse);
            console.log(`[${rid}] WhatsApp OK`);
          } catch (err) {
            console.error(`[${rid}] Erro WhatsApp:`, err.message);
          }
        }

        // Salvar resposta
        await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

        // Notificar Telegram
        if (responseData.notify && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
          try {
            await sendTelegram(responseData.notifyMessage);
            console.log(`[${rid}] Telegram OK:`, responseData.notifyType);
          } catch (err) {
            console.error(`[${rid}] Erro Telegram:`, err.message);
          }
        }

      } catch (error) {
        console.error(`[${rid}] Erro:`, error);
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
  if (greetings.some(g => msg === g || msg.startsWith(g + ' '))) {
    return { text: training.greeting_message || 'Ola! Como posso ajudar?', notify: false, notifyType: '', notifyMessage: '' };
  }

  // FAQ
  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const q = item.question.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const matches = words.filter(w => msg.includes(w)).length;
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
    const notifyMsg = `📅 *VISITA AGENDADA*\n\nCliente: ${name}\nTelefone: ${phoneNumber}\nMensagem: "${userMessage}"\n\n➡️ Entre em contato para confirmar horario!`;
    return {
      text: '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema?\n3️⃣ Qual dia e horario?\n\nOu digite "atendente" para humano!',
      notify: true,
      notifyType: 'visita',
      notifyMessage: notifyMsg
    };
  }

  // ESCALONAMENTO → NOTIFICAR TELEGRAM
  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor', 'dono'];
  if (escalationWords.some(word => msg.includes(word))) {
    try {
      await supabase.from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
    } catch (err) {
      console.error('Erro transferir:', err);
    }

    const notifyMsg = `🚨 *ATENDIMENTO HUMANO*\n\nCliente: ${name}\nTelefone: ${phoneNumber}\nMensagem: "${userMessage}"\n\n➡️ Transferido para fila humana!`;
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
  if (!response.ok) throw new Error(data.error?.message || 'Erro WhatsApp');
  return data;
}

// ═══════════════════════════════════════════════════════
// ENVIAR TELEGRAM
// ═══════════════════════════════════════════════════════
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

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
  if (!response.ok || !data.ok) throw new Error(data.description || 'Erro Telegram');
  return data;
}
