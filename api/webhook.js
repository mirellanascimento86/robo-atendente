import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

// ═══════════════════════════════════════════════════════
// CONFIGURACAO
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5NjgyMywiZXhwIjoyMDkwNDcyODIzfQ.lMntp1GpMQ-MeOeVDYK13Ayq9GNlFA0qkrMbhylgsRE';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'EAFmfvvzzQO4BRETZCcUIqfW7eBoXRJRlrf8ROZBaVnODG0T5aKfyCxzeKqeupaXI9r6q1c0Vh6yrJrLgoO43g6asjAZB1sKajLOFWPpLzLODbDv97LuLjGbyZCuJADT6FYeT0pDX9o9pTHfZCz1jFatnecBs6w8WjI9KPV8b0aaaKCxePmwozA5ZAXUZCGvIcQ9RAZDZD';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '738758095978120';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8517608136:AAFJmE04CPd7DecwKVh_MzGA6bnGGmbT3zI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-5246111585';

console.log('[INIT] ========== WEBHOOK V2 INICIANDO ==========');

let supabase = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[INIT] Supabase OK');
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

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!supabase) return res.status(500).json({ error: 'Supabase nao inicializado' });

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

        return res.status(200).json({ mensagens, emIntervencao: conversation?.status === 'human' });
      } catch (error) {
        return res.status(500).json({ error: error.message, mensagens: [] });
      }
    }

    // POST — Salvar treinamento
    if (req.method === 'POST' && (!req.query.action || req.query.action === 'saveconfig')) {
      try {
        const body = req.body;
        console.log(`[${rid}] Salvando treinamento...`);

        if (!body || typeof body !== 'object') throw new Error('Body invalido');

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
          lead_questions: Array.isArray(body.lead_questions) ? body.lead_questions : [],
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
        return res.status(200).json({ success: true, message: 'Configuracao salva', id: result?.id });

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
      console.log(`[${rid}] WHATSAPP WEBHOOK RECEBIDO`);
      res.status(200).send('OK');
      console.log(`[${rid}] 200 OK enviado ao Meta`);

      waitUntil(
        processWebhookBody(req.body, rid)
          .then(() => console.log(`[${rid}] Processamento background concluido`))
          .catch(err => console.error(`[${rid}] ERRO background:`, err))
      );

      return;
    }

    return res.status(405).send('Method not allowed');

  } catch (fatalError) {
    console.error(`[${rid}] FATAL:`, fatalError);
    return res.status(500).json({ error: fatalError.message });
  }
}

// ═══════════════════════════════════════════════════════
// PROCESSAR WEBHOOK EM BACKGROUND
// ═══════════════════════════════════════════════════════
async function processWebhookBody(body, rid) {
  try {
    console.log(`[${rid}] Body:`, JSON.stringify(body).substring(0, 500));

    if (body.object === 'whatsapp_business_account' && !body.entry) {
      console.log(`[${rid}] Ping Meta - ignorando`);
      return;
    }

    const entry = body.entry?.[0];
    if (!entry) { console.log(`[${rid}] Sem entry`); return; }

    const changes = entry.changes?.[0];
    if (!changes) { console.log(`[${rid}] Sem changes`); return; }

    const value = changes.value;
    if (!value) { console.log(`[${rid}] Sem value`); return; }

    const message = value.messages?.[0];
    if (!message) { console.log(`[${rid}] Sem mensagem`); return; }

    console.log(`[${rid}] Message type:`, message.type);

    if (message.type !== 'text') {
      console.log(`[${rid}] Ignorado: tipo ${message.type}`);
      return;
    }

    const from = message.from;
    const text = message.text?.body || '';
    const contactName = value.contacts?.[0]?.profile?.name || from;

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
      console.error(`[${rid}] [1] Erro Supabase:`, trainingError);
      await saveMessage(from, text, 'inbound', 'human', contactName);
      return;
    }

    if (!training) {
      console.log(`[${rid}] [1] NENHUM TREINAMENTO! Crie no painel.`);
      await saveMessage(from, text, 'inbound', 'human', contactName);
      return;
    }

    console.log(`[${rid}] [1] Treinamento OK. Ativo:`, training.active);

    // 2. VERIFICAR SE BOT ESTA ATIVO
    if (!training.active) {
      console.log(`[${rid}] [2] Bot DESATIVADO.`);
      await saveMessage(from, text, 'inbound', 'human', contactName);
      return;
    }

    // 3. SALVAR MENSAGEM DO CLIENTE
    await saveMessage(from, text, 'inbound', 'bot', contactName);
    console.log(`[${rid}] [3] Mensagem do cliente salva`);

    // 4. VERIFICAR MODO HUMANO
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', from)
      .maybeSingle();

    if (conversation?.status === 'human') {
      console.log(`[${rid}] [4] Modo HUMANO ativo`);
      return;
    }

    // ═══════════════════════════════════════════════════════
    // 5. SISTEMA DE FLUXO CONVERSACIONAL (CAPTURA DE LEADS)
    // ═══════════════════════════════════════════════════════
    const leadQuestions = training.lead_questions || [];
    const currentStep = conversation?.lead_step || 0;
    const leadData = conversation?.lead_data || {};

    // Se há perguntas de lead configuradas e o cliente ainda nao completou
    if (leadQuestions.length > 0 && currentStep < leadQuestions.length) {
      console.log(`[${rid}] [5] Fluxo de lead - Etapa ${currentStep}/${leadQuestions.length}`);

      // Se for a primeira mensagem (etapa 0), envia saudacao + primeira pergunta
      if (currentStep === 0 && !leadData[leadQuestions[0].field]) {
        const firstQuestion = leadQuestions[0];
        const greeting = training.greeting_message || `Ola! Sou ${training.bot_name || 'o assistente'}.`;
        const botResponse = `${greeting}\n\n${firstQuestion.question}`;

        await sendWhatsAppMessageSafe(from, botResponse, rid);
        await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

        // Atualizar etapa
        await supabase.from('conversations')
          .update({ lead_step: 1, lead_data: leadData, updated_at: new Date().toISOString() })
          .eq('phone_number', from);

        console.log(`[${rid}] [5] Primeira pergunta enviada`);
        return;
      }

      // Se o cliente respondeu uma pergunta, salvar resposta e ir para proxima
      if (currentStep > 0 && currentStep <= leadQuestions.length) {
        const prevQuestion = leadQuestions[currentStep - 1];
        leadData[prevQuestion.field] = text;

        // Se ainda ha mais perguntas
        if (currentStep < leadQuestions.length) {
          const nextQuestion = leadQuestions[currentStep];
          const botResponse = nextQuestion.question;

          await sendWhatsAppMessageSafe(from, botResponse, rid);
          await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

          await supabase.from('conversations')
            .update({ lead_step: currentStep + 1, lead_data: leadData, updated_at: new Date().toISOString() })
            .eq('phone_number', from);

          console.log(`[${rid}] [5] Pergunta ${currentStep + 1} enviada`);
          return;
        }

        // Se completou todas as perguntas
        if (currentStep >= leadQuestions.length) {
          // Salvar ultima resosta
          const lastQuestion = leadQuestions[leadQuestions.length - 1];
          leadData[lastQuestion.field] = text;

          const completionMsg = training.completion_message ||
            `✅ Obrigado! Recebemos suas informacoes:\n\n` +
            Object.entries(leadData).map(([k, v]) => `• ${k}: ${v}`).join('\n') +
            `\n\nNosso tecnico entrara em contato em breve para confirmar a visita!`;

          await sendWhatsAppMessageSafe(from, completionMsg, rid);
          await saveMessage(from, completionMsg, 'outbound', 'bot', contactName);

          // Notificar Telegram
          const notifyMsg = `🆕 *NOVO LEAD CAPTURADO*\n\n` +
            `Cliente: ${leadData.nome || contactName}\n` +
            `Telefone: ${from}\n` +
            Object.entries(leadData).map(([k, v]) => `• ${k}: ${v}`).join('\n') +
            `\n\n➡️ Entre em contato para agendar a visita!`;

          if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
            try { await sendTelegram(notifyMsg); } catch (e) { console.error('Telegram erro:', e); }
          }

          // Resetar fluxo
          await supabase.from('conversations')
            .update({ lead_step: 0, lead_data: {}, updated_at: new Date().toISOString() })
            .eq('phone_number', from);

          console.log(`[${rid}] [5] Lead completo! Notificacao enviada`);
          return;
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // 6. RESPOSTA INTELIGENTE (FAQ + Keywords) se nao estiver em fluxo de lead
    // ═══════════════════════════════════════════════════════
    console.log(`[${rid}] [6] Gerando resposta inteligente...`);
    const responseData = await generateResponse(text, training, from, contactName);
    const botResponse = responseData.text;

    console.log(`[${rid}] [6] Resposta: "${botResponse.substring(0, 100)}..."`);

    await sendWhatsAppMessageSafe(from, botResponse, rid);
    await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

    if (responseData.notify && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      try { await sendTelegram(responseData.notifyMessage); } catch (e) { console.error('Telegram erro:', e); }
    }

    console.log(`[${rid}] ====== FIM ======`);

  } catch (error) {
    console.error(`[${rid}] ERRO GERAL:`, error);
  }
}

// ═══════════════════════════════════════════════════════
// GERAR RESPOSTA INTELIGENTE
// ═══════════════════════════════════════════════════════
async function generateResponse(userMessage, training, phoneNumber, contactName) {
  const msg = userMessage.toLowerCase().trim();
  const name = contactName || phoneNumber;

  // SAUDACOES
  const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae', 'opa', 'fala'];
  if (greetings.some(g => msg === g || msg.startsWith(g + ' '))) {
    return {
      text: training.greeting_message || `Ola! Sou ${training.bot_name || 'o assistente'} da ${training.company_name || 'empresa'}. Como posso ajudar?`,
      notify: false, notifyType: '', notifyMessage: ''
    };
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
  if (msg.includes('preco') || msg.includes('preço') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto') || msg.includes('cobrar') || msg.includes('orcamento') || msg.includes('orçamento')) {
    return { text: (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito!', notify: false, notifyType: '', notifyMessage: '' };
  }

  // HORARIO
  if (msg.includes('horario') || msg.includes('horário') || msg.includes('hora') || msg.includes('aberto') || msg.includes('funciona') || msg.includes('atende') || msg.includes('abre')) {
    return { text: '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos para atender!', notify: false, notifyType: '', notifyMessage: '' };
  }

  // SERVICOS
  if (msg.includes('servico') || msg.includes('serviço') || msg.includes('faz') || msg.includes('conserta') || msg.includes('arruma') || msg.includes('troca') || msg.includes('reparo') || msg.includes('trabalho')) {
    return { text: '🔧 ' + (training.services || 'Diversos servicos.') + '\n\nQual voce precisa?', notify: false, notifyType: '', notifyMessage: '' };
  }

  // LOCAL
  if (msg.includes('local') || msg.includes('endereco') || msg.includes('endereço') || msg.includes('onde') || msg.includes('fica') || msg.includes('chegar') || msg.includes('mapa')) {
    return { text: '📍 Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".', notify: false, notifyType: '', notifyMessage: '' };
  }

  // GARANTIA
  if (msg.includes('garantia') || msg.includes('garante')) {
    return { text: '✅ Todos os nossos servicos possuem garantia! (geralmente 30 a 90 dias)', notify: false, notifyType: '', notifyMessage: '' };
  }

  // PRAZO
  if (msg.includes('prazo') || msg.includes('tempo') || msg.includes('demora') || msg.includes('rapido') || msg.includes('rápido') || msg.includes('urgente')) {
    return { text: '⏱️ O prazo depende do defeito. Fazemos orcamento em ate 24h!', notify: false, notifyType: '', notifyMessage: '' };
  }

  // AGENDAR → NOTIFICA TELEGRAM
  if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('visita') || msg.includes('posso ir') || msg.includes('levar') || msg.includes('vir')) {
    const notifyMsg = `📅 *VISITA AGENDADA*\n\nCliente: ${name}\nTelefone: ${phoneNumber}\nMensagem: "${userMessage}"\n\n➡️ Entre em contato para confirmar horario!`;
    return {
      text: '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema?\n3️⃣ Qual dia e horario?\n\nOu digite "atendente" para falar com um humano!',
      notify: true,
      notifyType: 'visita',
      notifyMessage: notifyMsg
    };
  }

  // ESCALONAMENTO
  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor', 'dono'];
  const shouldEscalate = escalationWords.some(word => msg.includes(word));

  if (shouldEscalate) {
    try {
      await supabase.from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
    } catch (err) { console.error('Erro transferir:', err); }

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
    text: (training.fallback_message || 'Nao entendi muito bem. Posso te ajudar com precos, horarios, servicos e agendamentos.') + '\n\nDigite "atendente" se precisar de um humano!',
    notify: false,
    notifyType: '',
    notifyMessage: ''
  };
}

// ═══════════════════════════════════════════════════════
// ENVIAR WHATSAPP COM TRATAMENTO DE ERRO
// ═══════════════════════════════════════════════════════
async function sendWhatsAppMessageSafe(to, text, rid) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.log(`[${rid}] SEM WHATSAPP_TOKEN`);
    return;
  }
  try {
    await sendWhatsAppMessage(to, text);
    console.log(`[${rid}] WhatsApp ENVIADO`);
  } catch (err) {
    console.error(`[${rid}] ERRO WhatsApp:`, err.message);
  }
}

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
    throw new Error(data.error?.message || 'Erro WhatsApp API');
  }

  console.log('WhatsApp enviado ID:', data.messages?.[0]?.id);
  return data;
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
// ENVIAR TELEGRAM
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
