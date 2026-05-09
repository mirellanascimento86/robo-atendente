import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

// ===== TELEGRAM CONFIG =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID; // ID do grupo (negativo para grupos)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

let trainingCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2000;

const defaultTraining = {
  bot_name: 'Assistente',
  company_name: 'Minha Empresa',
  greeting_message: 'Ola! Seja bem-vindo(a). Como posso ajuda-lo(a) hoje?',
  personality: 'Seja cordial, elegante e objetivo.',
  services: 'Conserto de celulares, notebooks, tablets e acessorios.',
  business_hours: 'Seg-Sex: 9h as 18h | Sab: 9h as 13h',
  pricing_info: 'Realizamos orcamento gratuito e sem compromisso.',
  fallback_message: 'Nao compreendi bem. Posso te ajudar com orcamentos, horarios, servicos e agendamentos.',
  faq_data: [],
  escalation_keywords: ['atendente', 'humano', 'pessoa', 'reclamacao', 'cancelar', 'chefe', 'gerente', 'supervisor'],
  active: true
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

// ===== FUNÇÃO TELEGRAM =====
async function sendTelegramAlert(message, parseMode = 'HTML') {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    console.log('Telegram não configurado:', { token: !!TELEGRAM_BOT_TOKEN, group: !!TELEGRAM_GROUP_ID });
    return { skipped: true };
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      console.error('Erro Telegram:', data);
      return { error: data.description || 'Unknown error' };
    }

    console.log('✅ Alerta Telegram enviado');
    return { ok: true, message_id: data.result?.message_id };
  } catch (e) {
    console.error('Erro ao enviar Telegram:', e.message);
    return { error: e.message };
  }
}

// ===== FUNÇÃO: FORMATAR ALERTA DE INTERVENÇÃO =====
async function alertHumanIntervention(phone, contactName, userMessage) {
  const message = `🚨 <b>INTERVENÇÃO HUMANA SOLICITADA</b>

📱 <b>Cliente:</b> ${contactName || 'Desconhecido'}
🔢 <b>Telefone:</b> ${phone}
💬 <b>Mensagem:</b> "${userMessage}"

⚡ O cliente pediu para falar com um atendente humano.
🔗 <a href="https://wa.me/${phone.replace(/\D/g, '')}">Clique para atender no WhatsApp</a>`;

  return await sendTelegramAlert(message);
}

// ===== FUNÇÃO: FORMATAR ALERTA DE VISITA =====
async function alertVisitScheduled(phone, contactName, details) {
  const message = `📅 <b>VISITA AGENDADA / ORÇAMENTO</b>

📱 <b>Cliente:</b> ${contactName || 'Desconhecido'}
🔢 <b>Telefone:</b> ${phone}
📝 <b>Detalhes:</b> ${details || 'Cliente demonstrou interesse em agendamento'}

✅ Entrar em contato para confirmar horário.
🔗 <a href="https://wa.me/${phone.replace(/\D/g, '')}">Abrir WhatsApp</a>`;

  return await sendTelegramAlert(message);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log('\n========== WEBHOOK ==========');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Content-Type:', req.headers['content-type'] || 'none');

  try {
    // ========== GET ==========
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe') {
        console.log('Meta verification');
        return res.status(200).send(challenge);
      }

      const action = req.query.action;

      if (action === 'updateconfig') {
        console.log('=== UPDATE CONFIG VIA GET ===');
        
        let faqData = [];
        let escalationKeywords = [];
        
        try {
          if (req.query.faq_data) {
            faqData = JSON.parse(req.query.faq_data);
          }
          if (req.query.escalation_keywords) {
            escalationKeywords = JSON.parse(req.query.escalation_keywords);
          }
        } catch (e) {
          console.log('Erro parse arrays:', e.message);
        }

        const config = {
          bot_name: req.query.bot_name || defaultTraining.bot_name,
          company_name: req.query.company_name || defaultTraining.company_name,
          greeting_message: req.query.greeting || defaultTraining.greeting_message,
          personality: req.query.personality || '',
          services: req.query.services || '',
          business_hours: req.query.hours || '',
          pricing_info: req.query.pricing || '',
          fallback_message: req.query.fallback || '',
          faq_data: faqData,
          escalation_keywords: escalationKeywords,
          active: req.query.active !== 'false',
          updated_at: new Date().toISOString()
        };

        const result = await saveTrainingToSupabase(config);
        trainingCache = null;
        cacheTimestamp = 0;
        
        return res.status(200).json({
          success: true,
          message: 'Config atualizada via GET',
          greeting: config.greeting_message,
          saved: result
        });
      }

      if (action === 'list') {
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
      }

      if (action === 'messages') {
        const phone = req.query.phone;
        if (!phone) return res.status(400).json({ error: 'Phone required' });
        const { data: conversation } = await supabase
          .from('conversations').select('*').eq('phone_number', phone).single();
        const { data: messages, error } = await supabase
          .from('messages').select('*').eq('phone_number', phone).order('created_at', { ascending: true });
        if (error) throw error;
        const mensagens = (messages || []).map(msg => ({
          data: msg.created_at, timestamp: msg.created_at,
          tipo: msg.direction === 'outbound' ? (msg.sender_type === 'human' ? 'humano' : 'bot') : 'cliente',
          from: msg.direction === 'outbound' ? (msg.sender_type === 'human' ? 'humano' : 'bot') : 'cliente',
          mensagem: msg.content, texto: msg.content, content: msg.content, message: msg.content,
          nome: msg.sender_type === 'human' ? 'Voce' : (msg.sender_type === 'bot' ? 'Bot' : 'Cliente')
        }));
        return res.status(200).json({ mensagens, emIntervencao: conversation?.status === 'human' });
      }

      if (action === 'clearcache') {
        trainingCache = null;
        cacheTimestamp = 0;
        console.log('Cache limpo');
        return res.status(200).json({ ok: true, message: 'Cache limpo' });
      }

      const training = await getTraining();
      return res.status(200).json({
        status: 'online',
        greeting: training?.greeting_message || 'not loaded',
        bot_active: training?.active !== false
      });
    }

    // ========== POST ==========
    if (req.method === 'POST') {
      console.log('POST body type:', typeof req.body);
      console.log('POST body:', JSON.stringify(req.body).substring(0, 800));

      const body = req.body || {};
      
      // DETECÇÃO ROBUSTA DO TIPO DE POST
      const isWhatsApp = body.object === 'whatsapp_business_account';
      const isPanelUpdate = body.bot_name !== undefined && !isWhatsApp;
      const hasAction = !!req.query.action;

      console.log('Detectado:', { isWhatsApp, isPanelUpdate, hasAction, keys: Object.keys(body) });

      // --- POST DO PAINEL ---
      if (isPanelUpdate && !hasAction) {
        console.log('=== SALVANDO CONFIG DO PAINEL ===');

        const trainingData = {
          bot_name: body.bot_name || 'Assistente',
          company_name: body.company_name || 'Minha Empresa',
          greeting_message: body.greeting_message || 'Ola! Como posso ajudar?',
          personality: body.personality || '',
          services: body.services || '',
          business_hours: body.business_hours || '',
          pricing_info: body.pricing_info || '',
          fallback_message: body.fallback_message || '',
          faq_data: Array.isArray(body.faq_data) ? body.faq_data : [],
          escalation_keywords: Array.isArray(body.escalation_keywords) ? body.escalation_keywords : [],
          active: body.active !== false,
          updated_at: new Date().toISOString()
        };

        console.log('Greeting recebida:', trainingData.greeting_message);

        const saved = await saveTrainingToSupabase(trainingData);
        trainingCache = null;
        cacheTimestamp = 0;

        console.log('✓ Config salva! ID:', saved?.id);

        return res.status(200).json({
          success: true,
          message: 'Configuracao salva',
          greeting: trainingData.greeting_message,
          id: saved?.id
        });
      }

      // --- POST COM ACTION ---
      if (hasAction) {
        const action = req.query.action;
        const phone = body.phone;

        if (action === 'intervene') {
          await supabase.from('conversations').upsert({ 
            phone_number: phone, status: 'human', updated_at: new Date().toISOString() 
          }, { onConflict: 'phone_number' });
          await saveMessage(phone, 'Atendente humano assumiu o controle.', 'outbound', 'system');
          return res.status(200).json({ ok: true });
        }

        if (action === 'release') {
          await supabase.from('conversations').upsert({ 
            phone_number: phone, status: 'bot', updated_at: new Date().toISOString() 
          }, { onConflict: 'phone_number' });
          await saveMessage(phone, 'Robo reassumiu o atendimento.', 'outbound', 'system');
          return res.status(200).json({ ok: true });
        }

        if (action === 'send') {
          const message = body.message;
          if (!message) return res.status(400).json({ error: 'Message required' });
          await saveMessage(phone, message, 'outbound', 'human');
          if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) await sendWhatsAppMessage(phone, message);
          return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
      }

      // --- POST DO WHATSAPP ---
      if (isWhatsApp || (!isPanelUpdate && !hasAction)) {
        console.log('=== MENSAGEM WHATSAPP ===');

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        // VERIFICAÇÃO CRÍTICA: WhatsApp envia array de mensagens
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          console.log('Nenhuma mensagem no payload WhatsApp');
          return res.status(200).send('OK');
        }

        const message = messages[0];

        if (message.type !== 'text') {
          console.log('Tipo de mensagem não suportado:', message.type);
          return res.status(200).send('OK');
        }

        const from = message.from;
        const text = message.text?.body || '';
        const contactName = value?.contacts?.[0]?.profile?.name || from;

        console.log(`Msg de ${from} (${contactName}): ${text}`);

        // Buscar treinamento ATUAL
        const training = await getTraining();

        // Bot desativado?
        if (training.active === false) {
          await saveMessage(from, text, 'inbound', 'human', contactName);
          return res.status(200).send('Bot off');
        }

        await saveMessage(from, text, 'inbound', 'bot', contactName);

        // Modo humano?
        let convStatus = 'bot';
        try {
          const { data: conv } = await supabase
            .from('conversations').select('status').eq('phone_number', from).single();
          if (conv) convStatus = conv.status;
        } catch (e) {}

        if (convStatus === 'human') {
          return res.status(200).send('Human mode');
        }

        // ===== GERAR RESPOSTA INTELIGENTE =====
        const responseData = generateResponse(text, training, from, contactName);
        const response = responseData.text;
        const shouldEscalate = responseData.escalate;
        const isVisit = responseData.isVisit;

        console.log('Resposta:', response);
        console.log('Escalar?:', shouldEscalate, 'Visita?:', isVisit);

        // Enviar WhatsApp
        if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
          try {
            await sendWhatsAppMessage(from, response);
          } catch (e) {
            console.error('Erro enviar WA:', e.message);
          }
        }

        await saveMessage(from, response, 'outbound', 'bot', contactName);

        // ===== ALERTA TELEGRAM: INTERVENÇÃO =====
        if (shouldEscalate) {
          console.log('🚨 Enviando alerta de intervenção para Telegram...');
          await alertHumanIntervention(from, contactName, text);
          
          // Mudar status para humano automaticamente
          await supabase.from('conversations').upsert({ 
            phone_number: from, status: 'human', updated_at: new Date().toISOString() 
          }, { onConflict: 'phone_number' });
        }

        // ===== ALERTA TELEGRAM: VISITA AGENDADA =====
        if (isVisit) {
          console.log('📅 Enviando alerta de visita para Telegram...');
          await alertVisitScheduled(from, contactName, text);
        }

        return res.status(200).json({ success: true, response });
      }

      return res.status(200).json({ message: 'Received' });
    }

    return res.status(405).send('Method not allowed');

  } catch (error) {
    console.error('ERRO GLOBAL:', error);
    return res.status(200).json({ 
      error: true, 
      message: error.message,
      handled: true 
    });
  }
}

// ========== FUNCOES AUXILIARES ==========

async function saveTrainingToSupabase(data) {
  try {
    const { data: existing, error: findError } = await supabase
      .from('bot_training')
      .select('id')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.log('Erro ao buscar:', findError.message);
    }

    let result;
    
    if (existing?.id) {
      console.log('Atualizando ID:', existing.id);
      result = await supabase
        .from('bot_training')
        .update(data)
        .eq('id', existing.id)
        .select();
    } else {
      console.log('Inserindo novo');
      result = await supabase
        .from('bot_training')
        .insert(data)
        .select();
    }

    if (result.error) {
      console.error('Erro Supabase:', result.error);
      throw result.error;
    }

    return result.data?.[0] || result.data;
  } catch (e) {
    console.error('Erro saveTraining:', e.message);
    throw e;
  }
}

async function getTraining() {
  const now = Date.now();

  if (trainingCache && (now - cacheTimestamp) < CACHE_TTL) {
    return trainingCache;
  }

  try {
    const { data, error } = await supabase
      .from('bot_training')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.log('Erro buscar training:', error.message);
      if (trainingCache) return trainingCache;
      return defaultTraining;
    }

    if (data) {
      trainingCache = data;
      cacheTimestamp = now;
      console.log('Training carregado:', data.greeting_message?.substring(0, 50));
      return data;
    }

    return defaultTraining;
  } catch (e) {
    console.error('Excecao getTraining:', e.message);
    return trainingCache || defaultTraining;
  }
}

// ===== GERAR RESPOSTA INTELIGENTE (com detecção de escalonamento e visita) =====
function generateResponse(userMessage, training, phone, contactName) {
  const msg = (userMessage || '').toLowerCase().trim();

  if (!msg) {
    return { 
      text: training.greeting_message || defaultTraining.greeting_message,
      escalate: false,
      isVisit: false
    };
  }

  // Detectar saudações
  const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae', 'fala'];
  if (greetings.some(g => msg === g || msg.startsWith(g + ' '))) {
    return { 
      text: training.greeting_message || defaultTraining.greeting_message,
      escalate: false,
      isVisit: false
    };
  }

  // Detectar intenção de agendamento/visita ANTES de verificar FAQ
  const visitKeywords = ['agendar', 'visita', 'marcar', 'horario', 'quando', 'dia', 'data', 'chegar', 'ir ai', 'ir até', 'passar ai', 'ir na loja', 'vir buscar', 'entregar', 'levar'];
  const isVisitIntent = visitKeywords.some(kw => msg.includes(kw));

  // Verificar FAQ primeiro
  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const words = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matches = words.filter(w => msg.includes(w)).length;
    if (matches >= 2 || msg.includes(item.question.toLowerCase())) {
      return { 
        text: item.answer,
        escalate: false,
        isVisit: isVisitIntent // Se a FAQ for sobre agendamento, marca como visita
      };
    }
  }

  // Detectar preços
  if (/preco|valor|custa|quanto|orcamento/i.test(msg)) {
    return { 
      text: (training.pricing_info || defaultTraining.pricing_info) + '\n\nPosso agendar um orcamento gratuito!',
      escalate: false,
      isVisit: isVisitIntent
    };
  }

  // Detectar horários
  if (/horario|hora|aberto|funciona/i.test(msg)) {
    return { 
      text: '⏰ ' + (training.business_hours || defaultTraining.business_hours) + '\n\nEstamos prontos!',
      escalate: false,
      isVisit: isVisitIntent
    };
  }

  // Detectar serviços
  if (/servico|conserta|reparo|arruma|troca/i.test(msg)) {
    return { 
      text: '🔧 ' + (training.services || defaultTraining.services) + '\n\nQual voce precisa?',
      escalate: false,
      isVisit: isVisitIntent
    };
  }

  // Detectar palavras de escalonamento (ATENDENTE HUMANO)
  const esc = training.escalation_keywords || defaultTraining.escalation_keywords;
  const shouldEscalate = esc.some(w => msg.includes(w.toLowerCase()));

  if (shouldEscalate) {
    return { 
      text: '👨‍💼 Entendido! Estou transferindo voce para um atendente humano. Aguarde um momento...',
      escalate: true,
      isVisit: false
    };
  }

  // Se detectou intenção de visita mas não caiu em nenhum caso acima
  if (isVisitIntent) {
    return {
      text: 'Perfeito! Vou registrar seu interesse em agendamento. Um atendente entrará em contato para confirmar o melhor horário.\n\n' + 
            (training.business_hours || defaultTraining.business_hours),
      escalate: false,
      isVisit: true
    };
  }

  // Fallback
  return { 
    text: (training.fallback_message || defaultTraining.fallback_message) + '\n\nOu digite "atendente"!',
    escalate: false,
    isVisit: false
  };
}

async function saveMessage(phone, content, direction, senderType, contactName = null) {
  try {
    let convId = null;
    const { data: existing } = await supabase
      .from('conversations').select('id').eq('phone_number', phone).maybeSingle();

    if (existing) {
      convId = existing.id;
      await supabase.from('conversations').update({
        contact_name: contactName || undefined,
        last_message: content,
        last_message_time: new Date().toISOString(),
        unread: direction === 'inbound',
        updated_at: new Date().toISOString()
      }).eq('id', convId);
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        phone_number: phone, contact_name: contactName, status: 'bot',
        last_message: content, last_message_time: new Date().toISOString(),
        unread: direction === 'inbound',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).select().single();
      convId = newConv?.id;
    }

    await supabase.from('messages').insert({
      conversation_id: convId, phone_number: phone,
      direction, content, sender_type: senderType,
      created_at: new Date().toISOString()
    });
  } catch (error) { 
    console.error('Erro saveMessage:', error.message); 
  }
}

async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    return { simulated: true };
  }
  const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      messaging_product: 'whatsapp', 
      recipient_type: 'individual', 
      to, 
      type: 'text', 
      text: { body: text } 
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Erro ${response.status}`);
  return data;
}
