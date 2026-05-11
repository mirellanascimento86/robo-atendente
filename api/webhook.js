import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// CONFIGURACAO — Fallback hardcoded se env nao existir
// REMOVA OS VALORES HARDCODED DEPOIS DE CONFIGURAR NA VERCEL!
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwcljognwdutsagppxcq.supabase.co';

// ⚠️ COLE AQUI SUA SERVICE_ROLE KEY COMPLETA (temporario ate configurar na Vercel)
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg5NjgyMywiZXhwIjoyMDkwNDcyODIzfQ.lMntp1GpMQ-MeOeVDYK13Ayq9GNlFA0qkrMbhylgsRE';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';

console.log('[INIT] Webhook iniciando...');
console.log('[INIT] SUPABASE_URL definido:', !!SUPABASE_URL);
console.log('[INIT] SUPABASE_KEY vem de env?', !!process.env.SUPABASE_KEY);
console.log('[INIT] WHATSAPP_TOKEN definido:', !!WHATSAPP_TOKEN);
console.log('[INIT] WHATSAPP_PHONE_ID definido:', !!WHATSAPP_PHONE_ID);

let supabase;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[INIT] Supabase client criado com sucesso');
} catch (err) {
  console.error('[INIT] FALHA ao criar Supabase client:', err.message);
}

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(2, 10);
  console.log(`[${requestId}] ====== NOVA REQUISICAO ======`);
  console.log(`[${requestId}] Metodo: ${req.method}, URL: ${req.url}`);

  // CORS
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!supabase) {
    console.error(`[${requestId}] ERRO CRITICO: Supabase nao inicializado`);
    return res.status(500).json({ error: 'Supabase nao inicializado. Verifique SUPABASE_URL e SUPABASE_KEY.' });
  }

  // GET ?action=status
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
      console.error(`[${requestId}] Erro status:`, error);
      return res.status(500).json({ error: error.message, details: error });
    }
  }

  // GET ?action=list
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
      console.error(`[${requestId}] Erro listar:`, error);
      return res.status(500).json({ error: error.message, conversas: [] });
    }
  }

  // GET ?action=messages&phone=...
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
      console.error(`[${requestId}] Erro mensagens:`, error);
      return res.status(500).json({ error: error.message, mensagens: [] });
    }
  }

  // POST salvar treinamento
  if (req.method === 'POST' && (!req.query.action || req.query.action === 'saveconfig')) {
    try {
      const body = req.body;
      console.log(`[${requestId}] Salvando treinamento...`);

      if (!body || typeof body !== 'object') {
        throw new Error('Body invalido ou vazio');
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

      const { data: existing, error: existingError } = await supabase
        .from('bot_training')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      let result, error;

      if (existing?.id) {
        console.log(`[${requestId}] Atualizando registro ID:`, existing.id);
        ({ data: result, error } = await supabase
          .from('bot_training')
          .update(trainingData)
          .eq('id', existing.id)
          .select()
          .single());
      } else {
        console.log(`[${requestId}] Criando novo registro...`);
        trainingData.created_at = new Date().toISOString();
        ({ data: result, error } = await supabase
          .from('bot_training')
          .insert(trainingData)
          .select()
          .single());
      }

      if (error) throw error;

      console.log(`[${requestId}] Treinamento salvo, ID:`, result?.id);

      return res.status(200).json({
        success: true,
        message: 'Configuracao salva com sucesso',
        id: result?.id,
        greeting: trainingData.greeting_message
      });

    } catch (error) {
      console.error(`[${requestId}] Erro salvar treinamento:`, error);
      return res.status(500).json({ 
        error: error.message,
        hint: 'Verifique se a tabela bot_training existe e se a chave tem permissoes de escrita'
      });
    }
  }

  // Acoes do painel
  if (req.method === 'POST' && req.query.action) {
    const action = req.query.action;
    const body = req.body;
    const phone = body?.phone;

    if (action === 'intervene') {
      try {
        await supabase
          .from('conversations')
          .update({ status: 'human', updated_at: new Date().toISOString() })
          .eq('phone_number', phone);
        await saveMessage(phone, 'Atendente humano assumiu o controle.', 'outbound', 'system');
        return res.status(200).json({ ok: true, message: 'Intervencao ativada' });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (action === 'release') {
      try {
        await supabase
          .from('conversations')
          .update({ status: 'bot', updated_at: new Date().toISOString() })
          .eq('phone_number', phone);
        await saveMessage(phone, 'Robo reassumiu o atendimento.', 'outbound', 'system');
        return res.status(200).json({ ok: true, message: 'Robo liberado' });
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
        return res.status(200).json({ ok: true, message: 'Mensagem enviada' });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  }

  // Webhook WhatsApp
  if (req.method === 'POST') {
    res.status(200).send('OK');
    console.log(`[${requestId}] Webhook WhatsApp recebido`);

    try {
      const body = req.body;
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message || message.type !== 'text') {
        console.log(`[${requestId}] Ignorado: sem mensagem de texto`);
        return;
      }

      const from = message.from;
      const text = message.text?.body || '';
      const contactName = value?.contacts?.[0]?.profile?.name || from;

      console.log(`[${requestId}] Msg de ${from}: ${text.substring(0, 100)}`);

      // Buscar configuracao
      const { data: training, error: trainingError } = await supabase
        .from('bot_training')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (trainingError || !training) {
        console.error(`[${requestId}] Sem treinamento:`, trainingError);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      if (!training.active) {
        console.log(`[${requestId}] Bot desativado`);
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
        console.log(`[${requestId}] Modo humano ativo`);
        return;
      }

      // Gerar resposta
      const botResponse = await generateResponse(text, training, from);
      console.log(`[${requestId}] Resposta: ${botResponse.substring(0, 100)}`);

      if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
        await sendWhatsAppMessage(from, botResponse);
      }

      await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

    } catch (error) {
      console.error(`[${requestId}] Erro webhook:`, error);
    }
    return;
  }

  return res.status(405).send('Method not allowed');
}

async function generateResponse(userMessage, training, phoneNumber) {
  const msg = userMessage.toLowerCase().trim();

  const greetings = ['oi', 'ola', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae'];
  if (greetings.some(g => msg.includes(g))) {
    return training.greeting_message || 'Ola! Como posso ajudar?';
  }

  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const questionWords = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matchCount = questionWords.filter(word => msg.includes(word)).length;
    if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
      return item.answer;
    }
  }

  if (msg.includes('preco') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto') || msg.includes('cobrar') || msg.includes('orcamento')) {
    return (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito para voce!';
  }

  if (msg.includes('horario') || msg.includes('hora') || msg.includes('aberto') || msg.includes('funciona') || msg.includes('atende') || msg.includes('abre')) {
    return '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos para te atender!';
  }

  if (msg.includes('servico') || msg.includes('faz') || msg.includes('conserta') || msg.includes('concerta') || msg.includes('arruma') || msg.includes('troca') || msg.includes('reparo')) {
    return '🔧 ' + (training.services || 'Oferecemos diversos servicos.') + '\n\nQual desses servicos voce precisa?';
  }

  if (msg.includes('local') || msg.includes('endereco') || msg.includes('onde') || msg.includes('fica') || msg.includes('chegar')) {
    return '📍 Nossa assistencia fica em local de facil acesso! Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".';
  }

  if (msg.includes('garantia') || msg.includes('garante') || msg.includes('garantir')) {
    return '✅ Todos os nossos servicos possuem garantia! O prazo varia conforme o tipo de reparo (geralmente 30 a 90 dias).\n\nA garantia cobre o mesmo defeito reparado.';
  }

  if (msg.includes('prazo') || msg.includes('tempo') || msg.includes('demora') || msg.includes('rapido') || msg.includes('demorar')) {
    return '⏱️ O prazo depende do defeito e da disponibilidade de pecas.\n\nFazemos orcamento em ate 24h! Qual equipamento voce tem?';
  }

  if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('quando') || msg.includes('posso ir') || msg.includes('visita')) {
    return '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema/defeito?\n3️⃣ Qual dia e horario prefere?\n\nOu digite "atendente" para falar com uma pessoa!';
  }

  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor'];
  if (escalationWords.some(word => msg.includes(word))) {
    try {
      await supabase
        .from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
    } catch (err) {
      console.error('Erro ao transferir:', err);
    }
    return '👨‍💼 Entendido! Vou transferir voce para um atendente humano agora mesmo. Por favor, aguarde um momento...';
  }

  return (training.fallback_message || 'Nao entendi bem. Posso te ajudar com orcamentos, horarios, servicos e agendamentos.') + '\n\nOu digite "atendente" para falar com uma pessoa!';
}

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
      await supabase
        .from('conversations')
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

    if (msgError) {
      console.error('Erro salvar mensagem:', msgError);
    }
  } catch (error) {
    console.error('Erro ao salvar mensagem:', error);
  }
}

async function sendWhatsAppMessage(to, text) {
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
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
      console.error('Erro WhatsApp API:', data);
      throw new Error(data.error?.message || 'Erro ao enviar mensagem');
    }

    console.log('Mensagem enviada:', data.messages?.[0]?.id);
    return data;
  } catch (error) {
    console.error('Erro ao enviar WhatsApp:', error);
    throw error;
  }
}
