import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// VARIÁVEIS DE AMBIENTE (configure na Vercel!)
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;        // service_role ou anon com RLS
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Validação de configuração
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_KEY são obrigatórios nas variáveis de ambiente da Vercel');
}
if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
  console.warn('⚠️ WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID não configurados. O bot não enviará mensagens.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  // ═══════════════════════════════════════════════════════
  // CORS
  // ═══════════════════════════════════════════════════════
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ═══════════════════════════════════════════════════════
  // API DO PAINEL — STATUS (GET ?action=status)
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
      console.error('Erro status:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ═══════════════════════════════════════════════════════
  // API DO PAINEL — LISTAR CONVERSAS (GET ?action=list)
  // ═══════════════════════════════════════════════════════
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
      console.error('Erro listar:', error);
      return res.status(500).json({ error: error.message, conversas: [] });
    }
  }

  // ═══════════════════════════════════════════════════════
  // API DO PAINEL — BUSCAR MENSAGENS (GET ?action=messages&phone=...)
  // ═══════════════════════════════════════════════════════
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
      console.error('Erro mensagens:', error);
      return res.status(500).json({ error: error.message, mensagens: [] });
    }
  }

  // ═══════════════════════════════════════════════════════
  // SALVAR TREINAMENTO (POST sem action ou action=saveconfig)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && (!req.query.action || req.query.action === 'saveconfig')) {
    try {
      const body = req.body;
      console.log('💾 Salvando treinamento:', JSON.stringify(body).substring(0, 200));

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

      // Buscar registro existente
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

      console.log('✅ Treinamento salvo:', result?.id);

      return res.status(200).json({
        success: true,
        message: 'Configuracao salva com sucesso',
        id: result?.id,
        greeting: trainingData.greeting_message
      });

    } catch (error) {
      console.error('❌ Erro salvar treinamento:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ═══════════════════════════════════════════════════════
  // AÇÕES DO PAINEL — INTERVIR / LIBERAR / ENVIAR
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && req.query.action) {
    const action = req.query.action;
    const body = req.body;
    const phone = body?.phone;

    // ASSUMIR CONTROLE (Intervenção Humana)
    if (action === 'intervene') {
      try {
        await supabase
          .from('conversations')
          .update({ status: 'human', updated_at: new Date().toISOString() })
          .eq('phone_number', phone);

        await saveMessage(phone, 'Atendente humano assumiu o controle da conversa.', 'outbound', 'system');

        return res.status(200).json({ ok: true, message: 'Intervencao ativada' });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // LIBERAR ROBÔ
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

    // ENVIAR MENSAGEM PELO PAINEL
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

  // ═══════════════════════════════════════════════════════
  // RECEBIMENTO DE MENSAGENS DO WHATSAPP (POST)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST') {
    // ⚡ IMPORTANTE: Responder 200 IMEDIATAMENTE para o WhatsApp/Meta
    // e processar em background. Isso evita duplicatas de mensagens.
    res.status(200).send('OK');

    try {
      const body = req.body;
      console.log('📩 Webhook recebido:', JSON.stringify(body).substring(0, 500));

      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message || message.type !== 'text') {
        console.log('ℹ️ Ignorado: não é mensagem de texto');
        return;
      }

      const from = message.from;
      const text = message.text?.body || '';
      const contactName = value?.contacts?.[0]?.profile?.name || from;

      // 1. BUSCAR CONFIGURACAO ATUAL DO BOT (SEMPRE DO SUPABASE - TEMPO REAL)
      const { data: training, error: trainingError } = await supabase
        .from('bot_training')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (trainingError || !training) {
        console.error('❌ Erro ao buscar treinamento:', trainingError);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      // 2. VERIFICAR SE BOT ESTA ATIVO
      if (!training.active) {
        console.log('🤖 Bot desativado. Mensagem salva apenas.');
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      // 3. SALVAR MENSAGEM DO CLIENTE
      await saveMessage(from, text, 'inbound', 'bot', contactName);

      // 4. VERIFICAR SE CONVERSA ESTA EM MODO HUMANO
      const { data: conversation } = await supabase
        .from('conversations')
        .select('status')
        .eq('phone_number', from)
        .maybeSingle();

      if (conversation?.status === 'human') {
        console.log('👤 Modo humano ativo para:', from);
        return;
      }

      // 5. GERAR RESPOSTA DO BOT (USA O TREINAMENTO DO SUPABASE EM TEMPO REAL)
      const botResponse = await generateResponse(text, training, from);

      // 6. ENVIAR RESPOSTA PELO WHATSAPP
      if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
        await sendWhatsAppMessage(from, botResponse);
      } else {
        console.log('⚠️ Token nao configurado. Resposta simulada:', botResponse.substring(0, 100));
      }

      // 7. SALVAR RESPOSTA DO BOT
      await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

      console.log('✅ Resposta enviada para', from, ':', botResponse.substring(0, 80));

    } catch (error) {
      console.error('❌ Erro no webhook:', error);
    }
    return;
  }

  return res.status(405).send('Method not allowed');
}

// ═══════════════════════════════════════════════════════
// GERAR RESPOSTA DO BOT (USA DIRETO O TREINAMENTO DO SUPABASE)
// ═══════════════════════════════════════════════════════
async function generateResponse(userMessage, training, phoneNumber) {
  const msg = userMessage.toLowerCase().trim();

  // 1. SAUDACOES (usa greeting_message do painel)
  const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae'];
  if (greetings.some(g => msg.includes(g))) {
    return training.greeting_message || 'Ola! Como posso ajudar?';
  }

  // 2. FAQ INTELIGENTE (usa faq_data do painel)
  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const questionWords = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matchCount = questionWords.filter(word => msg.includes(word)).length;
    if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
      return item.answer;
    }
  }

  // 3. PALAVRAS-CHAVE POR CATEGORIA (usa campos do painel)
  if (msg.includes('preco') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto') || msg.includes('cobrar') || msg.includes('orcamento')) {
    return (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito para voce! Qual equipamento precisa de assistencia?';
  }

  if (msg.includes('horario') || msg.includes('hora') || msg.includes('aberto') || msg.includes('funciona') || msg.includes('atende') || msg.includes('abre')) {
    return '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos para te atender! 😊';
  }

  if (msg.includes('servico') || msg.includes('faz') || msg.includes('conserta') || msg.includes('concerta') || msg.includes('arruma') || msg.includes('troca') || msg.includes('reparo')) {
    return '🔧 ' + (training.services || 'Oferecemos diversos servicos.') + '\n\nQual desses servicos voce precisa? Posso te passar mais detalhes!';
  }

  if (msg.includes('local') || msg.includes('endereco') || msg.includes('onde') || msg.includes('fica') || msg.includes('chegar')) {
    return '📍 Nossa assistencia fica em local de facil acesso! Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".';
  }

  if (msg.includes('garantia') || msg.includes('garante') || msg.includes('garantir')) {
    return '✅ Todos os nossos servicos possuem garantia! O prazo varia conforme o tipo de reparo (geralmente 30 a 90 dias).\n\nA garantia cobre o mesmo defeito reparado. Quer saber mais sobre algum servico especifico?';
  }

  if (msg.includes('prazo') || msg.includes('tempo') || msg.includes('demora') || msg.includes('rapido') || msg.includes('demorar')) {
    return '⏱️ O prazo depende do defeito e da disponibilidade de pecas.\n\nFazemos orcamento em ate 24h! Qual equipamento voce tem?';
  }

  if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('quando') || msg.includes('posso ir') || msg.includes('visita')) {
    return '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema/defeito?\n3️⃣ Qual dia e horario prefere?\n\nOu se preferir, posso transferir voce para um atendente humano agora mesmo! 👨‍💼';
  }

  // 4. ESCALONAMENTO PARA HUMANO (usa escalation_keywords do painel)
  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor'];
  if (escalationWords.some(word => msg.includes(word))) {
    // Transferir para humano
    try {
      await supabase
        .from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber);
      console.log('👤 Conversa transferida para humano:', phoneNumber);
    } catch (err) {
      console.error('❌ Erro ao transferir:', err);
    }

    return '👨‍💼 Entendido! Vou transferir voce para um atendente humano agora mesmo. Por favor, aguarde um momento... ⏳\n\n(Seu atendente ja foi notificado e respondera em breve!)';
  }

  // 5. FALLBACK (usa fallback_message do painel)
  return (training.fallback_message || 'Nao entendi bem. Posso te ajudar com orcamentos, horarios, servicos e agendamentos.') + '\n\nOu digite "atendente" para falar com uma pessoa!';
}

// ═══════════════════════════════════════════════════════
// SALVAR MENSAGEM NO BANCO
// ═══════════════════════════════════════════════════════
async function saveMessage(phone, content, direction, senderType, contactName = null) {
  try {
    // Buscar ou criar conversa
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

    // Inserir mensagem
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

// ═══════════════════════════════════════════════════════
// ENVIAR MENSAGEM PELO WHATSAPP (API META)
// ═══════════════════════════════════════════════════════
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
      console.error('❌ Erro WhatsApp API:', data);
      throw new Error(data.error?.message || 'Erro ao enviar mensagem');
    }

    console.log('✅ Mensagem enviada:', data.messages?.[0]?.id);
    return data;

  } catch (error) {
    console.error('❌ Erro ao enviar WhatsApp:', error);
    throw error;
  }
}
