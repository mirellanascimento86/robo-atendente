import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// CONFIGURAÇÃO — Fallback para variáveis hardcoded se env não existir
// (remova os valores hardcoded após configurar na Vercel!)
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';

// Log de inicialização (aparece nos logs da Vercel)
console.log('[INIT] Webhook iniciando...');
console.log('[INIT] SUPABASE_URL definido:', !!SUPABASE_URL);
console.log('[INIT] SUPABASE_KEY definido:', !!SUPABASE_KEY);
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
  console.log(`[${requestId}] ====== NOVA REQUISIÇÃO ======`);
  console.log(`[${requestId}] Método: ${req.method}, URL: ${req.url}`);
  console.log(`[${requestId}] Query:`, req.query);
  console.log(`[${requestId}] Headers:`, JSON.stringify(req.headers).substring(0, 300));

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
    console.log(`[${requestId}] OPTIONS - retornando 200`);
    return res.status(200).end();
  }

  // Verificar se supabase está funcionando
  if (!supabase) {
    console.error(`[${requestId}] ERRO CRÍTICO: Supabase não inicializado`);
    return res.status(500).json({ error: 'Supabase não inicializado. Verifique SUPABASE_URL e SUPABASE_KEY.' });
  }

  // ═══════════════════════════════════════════════════════
  // API DO PAINEL — STATUS (GET ?action=status)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET' && req.query.action === 'status') {
    console.log(`[${requestId}] Action: status`);
    try {
      const { data: training, error } = await supabase
        .from('bot_training')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(`[${requestId}] Erro Supabase (status):`, error);
        throw error;
      }

      console.log(`[${requestId}] Status OK, training ID:`, training?.id);
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

  // ═══════════════════════════════════════════════════════
  // API DO PAINEL — LISTAR CONVERSAS (GET ?action=list)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET' && req.query.action === 'list') {
    console.log(`[${requestId}] Action: list`);
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

  // ═══════════════════════════════════════════════════════
  // API DO PAINEL — BUSCAR MENSAGENS (GET ?action=messages&phone=...)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET' && req.query.action === 'messages') {
    const phone = req.query.phone;
    console.log(`[${requestId}] Action: messages, phone:`, phone);
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

  // ═══════════════════════════════════════════════════════
  // SALVAR TREINAMENTO (POST sem action ou action=saveconfig)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && (!req.query.action || req.query.action === 'saveconfig')) {
    console.log(`[${requestId}] Action: saveconfig/salvar treinamento`);
    try {
      const body = req.body;
      console.log(`[${requestId}] Body recebido:`, JSON.stringify(body).substring(0, 500));

      // Validação básica
      if (!body || typeof body !== 'object') {
        throw new Error('Body inválido ou vazio');
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

      console.log(`[${requestId}] Dados processados:`, JSON.stringify(trainingData).substring(0, 300));

      // Buscar registro existente
      console.log(`[${requestId}] Buscando registro existente...`);
      const { data: existing, error: existingError } = await supabase
        .from('bot_training')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        console.error(`[${requestId}] Erro ao buscar existente:`, existingError);
        throw existingError;
      }

      console.log(`[${requestId}] Registro existente:`, existing?.id || 'NENHUM');

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

      if (error) {
        console.error(`[${requestId}] Erro Supabase (save):`, error);
        throw error;
      }

      console.log(`[${requestId}] ✅ Treinamento salvo com sucesso, ID:`, result?.id);

      return res.status(200).json({
        success: true,
        message: 'Configuracao salva com sucesso',
        id: result?.id,
        greeting: trainingData.greeting_message
      });

    } catch (error) {
      console.error(`[${requestId}] ❌ Erro salvar treinamento:`, error);
      return res.status(500).json({ 
        error: error.message,
        stack: error.stack,
        hint: 'Verifique se a tabela bot_training existe no Supabase e se a chave tem permissões de escrita'
      });
    }
  }

  // ═══════════════════════════════════════════════════════
  // AÇÕES DO PAINEL — INTERVIR / LIBERAR / ENVIAR
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && req.query.action) {
    const action = req.query.action;
    const body = req.body;
    const phone = body?.phone;
    console.log(`[${requestId}] Action:`, action, 'Phone:', phone);

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
    console.log(`[${requestId}] 📩 WEBHOOK WHATSAPP RECEBIDO`);

    // ⚡ CRÍTICO: Responder 200 IMEDIATAMENTE para o Meta
    // e processar em background
    res.status(200).send('OK');
    console.log(`[${requestId}] ✅ 200 OK enviado para Meta`);

    try {
      const body = req.body;
      console.log(`[${requestId}] Body completo:`, JSON.stringify(body).substring(0, 800));

      // Verificar se é um evento de verificação do webhook (Meta)
      if (body.object === 'whatsapp_business_account' && !body.entry) {
        console.log(`[${requestId}] ℹ️ Verificação de webhook do Meta`);
        return;
      }

      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      console.log(`[${requestId}] Entry:`, !!entry, 'Changes:', !!changes, 'Message:', !!message);

      if (!message) {
        console.log(`[${requestId}] ℹ️ Sem mensagem no payload (pode ser status update)`);
        return;
      }

      if (message.type !== 'text') {
        console.log(`[${requestId}] ℹ️ Ignorado: tipo de mensagem é`, message.type);
        return;
      }

      const from = message.from;
      const text = message.text?.body || '';
      const contactName = value?.contacts?.[0]?.profile?.name || from;

      console.log(`[${requestId}] 📱 De: ${from}, Nome: ${contactName}, Texto: ${text.substring(0, 100)}`);

      // 1. BUSCAR CONFIGURACAO ATUAL DO BOT
      console.log(`[${requestId}] 🔍 Buscando configuração do bot no Supabase...`);
      const { data: training, error: trainingError } = await supabase
        .from('bot_training')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (trainingError) {
        console.error(`[${requestId}] ❌ Erro ao buscar treinamento:`, trainingError);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      if (!training) {
        console.error(`[${requestId}] ⚠️ Nenhum treinamento encontrado no banco`);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      console.log(`[${requestId}] ✅ Treinamento carregado, bot ativo:`, training.active);

      // 2. VERIFICAR SE BOT ESTA ATIVO
      if (!training.active) {
        console.log(`[${requestId}] 🤖 Bot desativado. Apenas salvando mensagem.`);
        await saveMessage(from, text, 'inbound', 'human', contactName);
        return;
      }

      // 3. SALVAR MENSAGEM DO CLIENTE
      console.log(`[${requestId}] 💾 Salvando mensagem do cliente...`);
      await saveMessage(from, text, 'inbound', 'bot', contactName);

      // 4. VERIFICAR SE CONVERSA ESTA EM MODO HUMANO
      console.log(`[${requestId}] 🔍 Verificando status da conversa...`);
      const { data: conversation } = await supabase
        .from('conversations')
        .select('status')
        .eq('phone_number', from)
        .maybeSingle();

      if (conversation?.status === 'human') {
        console.log(`[${requestId}] 👤 Modo humano ativo para:`, from);
        return;
      }

      // 5. GERAR RESPOSTA DO BOT
      console.log(`[${requestId}] 🤖 Gerando resposta...`);
      const botResponse = await generateResponse(text, training, from);
      console.log(`[${requestId}] 💬 Resposta gerada:`, botResponse.substring(0, 100));

      // 6. ENVIAR RESPOSTA PELO WHATSAPP
      if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
        console.log(`[${requestId}] 📤 Enviando resposta pelo WhatsApp...`);
        await sendWhatsAppMessage(from, botResponse);
      } else {
        console.log(`[${requestId}] ⚠️ WHATSAPP_TOKEN ou PHONE_ID não configurados`);
        console.log(`[${requestId}] 💬 Resposta simulada:`, botResponse.substring(0, 100));
      }

      // 7. SALVAR RESPOSTA DO BOT
      await saveMessage(from, botResponse, 'outbound', 'bot', contactName);
      console.log(`[${requestId}] ✅ Ciclo completo finalizado`);

    } catch (error) {
      console.error(`[${requestId}] ❌ Erro no processamento do webhook:`, error);
      console.error(`[${requestId}] Stack:`, error.stack);
    }
    return;
  }

  console.log(`[${requestId}] ⚠️ Método não permitido:`, req.method);
  return res.status(405).send('Method not allowed');
}

// ═══════════════════════════════════════════════════════
// GERAR RESPOSTA DO BOT
// ═══════════════════════════════════════════════════════
async function generateResponse(userMessage, training, phoneNumber) {
  const msg = userMessage.toLowerCase().trim();

  // 1. SAUDACOES
  const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae'];
  if (greetings.some(g => msg.includes(g))) {
    return training.greeting_message || 'Ola! Como posso ajudar?';
  }

  // 2. FAQ INTELIGENTE
  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const questionWords = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matchCount = questionWords.filter(word => msg.includes(word)).length;
    if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
      return item.answer;
    }
  }

  // 3. PALAVRAS-CHAVE
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

  // 4. ESCALONAMENTO
  const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor'];
  if (escalationWords.some(word => msg.includes(word))) {
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

  // 5. FALLBACK
  return (training.fallback_message || 'Nao entendi bem. Posso te ajudar com orcamentos, horarios, servicos e agendamentos.') + '\n\nOu digite "atendente" para falar com uma pessoa!';
}

// ═══════════════════════════════════════════════════════
// SALVAR MENSAGEM NO BANCO
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

// ═══════════════════════════════════════════════════════
// ENVIAR MENSAGEM PELO WHATSAPP
// ═══════════════════════════════════════════════════════
async function sendWhatsAppMessage(to, text) {
  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    console.log('📤 Enviando WhatsApp para:', to);

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
      console.error('❌ Erro WhatsApp API:', JSON.stringify(data));
      throw new Error(data.error?.message || 'Erro ao enviar mensagem');
    }

    console.log('✅ Mensagem enviada, ID:', data.messages?.[0]?.id);
    return data;

  } catch (error) {
    console.error('❌ Erro ao enviar WhatsApp:', error.message);
    throw error;
  }
}
