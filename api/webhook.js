import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// CACHE DESABILITADO - sempre busca do banco para garantir dados frescos
let trainingCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 0; // 0 = sem cache

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

// ===== TELEGRAM =====
async function sendTelegramAlert(message, parseMode = 'HTML') {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    console.log('Telegram nao configurado');
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
    return { ok: true, message_id: data.result?.message_id };
  } catch (e) {
    console.error('Erro Telegram:', e.message);
    return { error: e.message };
  }
}

async function alertHumanIntervention(phone, contactName, userMessage) {
  const message = `🚨 <b>INTERVENÇÃO HUMANA SOLICITADA</b>\n\n📱 <b>Cliente:</b> ${contactName || 'Desconhecido'}\n🔢 <b>Telefone:</b> ${phone}\n💬 <b>Mensagem:</b> "${userMessage}"\n\n⚡ O cliente pediu para falar com um atendente humano.\n🔗 <a href="https://wa.me/${phone.replace(/\D/g, '')}">Clique para atender no WhatsApp</a>`;
  return await sendTelegramAlert(message);
}

async function alertVisitScheduled(phone, contactName, details) {
  const message = `📅 <b>VISITA AGENDADA / ORÇAMENTO</b>\n\n📱 <b>Cliente:</b> ${contactName || 'Desconhecido'}\n🔢 <b>Telefone:</b> ${phone}\n📝 <b>Detalhes:</b> ${details || 'Cliente demonstrou interesse em agendamento'}\n\n✅ Entrar em contato para confirmar horário.\n🔗 <a href="https://wa.me/${phone.replace(/\D/g, '')}">Abrir WhatsApp</a>`;
  return await sendTelegramAlert(message);
}

export default async function handler(req, res) {
  // CORS - CRÍTICO: deve ser o primeiro
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log('\n========== WEBHOOK ==========');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Content-Type:', req.headers['content-type'] || 'none');
  console.log('Origin:', req.headers.origin || 'none');

  try {
    // ========== GET ==========
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const challenge = req.query['hub.challenge'];

      // Verificação Meta/WhatsApp Business
      if (mode === 'subscribe' && challenge) {
        console.log('Meta verification - challenge:', challenge);
        return res.status(200).send(challenge);
      }

      const action = req.query.action;

      // --- GET: UPDATE CONFIG (fallback do painel) ---
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
          console.log('Erro parse arrays GET:', e.message);
        }

        // UNIFICAR NOMES: GET usa 'greeting', POST usa 'greeting_message'
        const config = {
          bot_name: req.query.bot_name || defaultTraining.bot_name,
          company_name: req.query.company_name || defaultTraining.company_name,
          greeting_message: req.query.greeting || req.query.greeting_message || defaultTraining.greeting_message,
          personality: req.query.personality || '',
          services: req.query.services || '',
          business_hours: req.query.hours || req.query.business_hours || '',
          pricing_info: req.query.pricing || req.query.pricing_info || '',
          fallback_message: req.query.fallback || req.query.fallback_message || '',
          faq_data: faqData,
          escalation_keywords: escalationKeywords,
          active: req.query.active !== 'false',
          updated_at: new Date().toISOString()
        };

        console.log('Config GET recebida:', JSON.stringify(config, null, 2));

        const result = await saveTrainingToSupabase(config);
        
        return res.status(200).json({
          success: true,
          message: 'Config atualizada via GET',
          greeting: config.greeting_message,
          saved: result
        });
      }

      // --- GET: LISTAR CONVERSAS ---
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

      // --- GET: MENSAGENS DE UM TELEFONE ---
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

      // --- GET: LIMPAR CACHE ---
      if (action === 'clearcache') {
        trainingCache = null;
        cacheTimestamp = 0;
        console.log('Cache limpo');
        return res.status(200).json({ ok: true, message: 'Cache limpo' });
      }

      // --- GET: STATUS PADRÃO ---
      const training = await getTraining();
      return res.status(200).json({
        status: 'online',
        greeting: training?.greeting_message || 'not loaded',
        bot_active: training?.active !== false,
        timestamp: new Date().toISOString()
      });
    }

    // ========== POST ==========
    if (req.method === 'POST') {
      console.log('POST body type:', typeof req.body);
      console.log('POST body keys:', Object.keys(req.body || {}));
      
      let body = req.body || {};
      
      // Se body vier como string (bodyParser falhou), tentar parsear
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
          console.log('Body parseado de string');
        } catch (e) {
          console.log('Falha ao parsear body string');
        }
      }

      // DETECÇÃO ROBUSTA DO TIPO DE POST
      const isWhatsApp = body.object === 'whatsapp_business_account';
      const hasWhatsAppStructure = !!(body.entry?.[0]?.changes?.[0]?.value?.messages);
      const hasPanelFields = body.bot_name !== undefined || body.greeting_message !== undefined || body.company_name !== undefined;
      
      // POST do painel: tem campos do painel E NÃO tem estrutura do WhatsApp
      const isPanelUpdate = hasPanelFields && !isWhatsApp && !hasWhatsAppStructure;
      
      const hasAction = !!req.query.action;

      console.log('Detectado:', { 
        isWhatsApp, 
        hasWhatsAppStructure,
        hasPanelFields,
        isPanelUpdate, 
        hasAction,
        keys: Object.keys(body)
      });

      // --- POST DO PAINEL (TREINAMENTO) ---
      if (isPanelUpdate && !hasAction) {
        console.log('=== SALVANDO CONFIG DO PAINEL VIA POST ===');

        const trainingData = {
          bot_name: body.bot_name || 'Assistente',
          company_name: body.company_name || 'Minha Empresa',
          greeting_message: body.greeting_message || body.greeting || 'Ola! Como posso ajudar?',
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

        console.log('Greeting recebida:', trainingData.greeting_message);
        console.log('Dados completos:', JSON.stringify(trainingData, null, 2));

        const saved = await saveTrainingToSupabase(trainingData);

        // Forçar recarregamento imediato para confirmar
        const refreshed = await getTraining();
        console.log('Config recarregada do banco:', refreshed?.greeting_message);

        return res.status(200).json({
          success: true,
          message: 'Configuracao salva com sucesso',
          greeting: trainingData.greeting_message,
          id: saved?.id,
          refreshed_greeting: refreshed?.greeting_message,
          timestamp: new Date().toISOString()
        });
      }

      // --- POST COM ACTION (intervenção, release, send) ---
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
      if (isWhatsApp || hasWhatsAppStructure) {
        console.log('=== MENSAGEM WHATSAPP ===');

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          console.log('Nenhuma mensagem no payload WhatsApp');
          return res.status(200).send('OK');
        }

        const message = messages[0];

        if (message.type !== 'text') {
          console.log('Tipo de mensagem nao suportado:', message.type);
          return res.status(200).send('OK');
        }

        const from = message.from;
        const text = message.text?.body || '';
        const contactName = value?.contacts?.[0]?.profile?.name || from;

        console.log(`Msg de ${from} (${contactName}): ${text}`);

        // Buscar treinamento ATUAL (sempre do banco - cache desabilitado)
        const training = await getTraining();
        console.log('Training usado:', JSON.stringify({
          greeting: training?.greeting_message?.substring(0, 50),
          active: training?.active,
          company: training?.company_name
        }));

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

        // Gerar resposta inteligente
        const responseData = generateResponse(text, training, from, contactName);
        const response = responseData.text;
        const shouldEscalate = responseData.escalate;
        const isVisit = responseData.isVisit;

        console.log('Resposta gerada:', response.substring(0, 100));
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

        // Alertas Telegram
        if (shouldEscalate) {
          await alertHumanIntervention(from, contactName, text);
          await supabase.from('conversations').upsert({ 
            phone_number: from, status: 'human', updated_at: new Date().toISOString() 
          }, { onConflict: 'phone_number' });
        }

        if (isVisit) {
          await alertVisitScheduled(from, contactName, text);
        }

        return res.status(200).json({ success: true, response });
      }

      console.log('POST nao reconhecido, retornando 200');
      return res.status(200).json({ message: 'Received', body_keys: Object.keys(body) });
    }

    return res.status(405).send('Method not allowed');

  } catch (error) {
    console.error('ERRO GLOBAL:', error);
    return res.status(200).json({ 
      error: true, 
      message: error.message,
      stack: error.stack,
      handled: true 
    });
  }
}

// ========== FUNÇÕES AUXILIARES ==========

async function saveTrainingToSupabase(data) {
  try {
    console.log('=== saveTrainingToSupabase ===');
    
    const { data: existing, error: findError } = await supabase
      .from('bot_training')
      .select('id')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.log('Erro ao buscar existente:', findError.message);
    }

    let result;
    
    if (existing?.id) {
      console.log('Atualizando registro ID:', existing.id);
      const { data: updatedData, error: updateError } = await supabase
        .from('bot_training')
        .update(data)
        .eq('id', existing.id)
        .select();

      if (updateError) {
        console.error('Erro no update:', updateError);
        throw updateError;
      }
      
      result = updatedData?.[0];
      console.log('Update retornou:', result);
    } else {
      console.log('Inserindo novo registro');
      const { data: insertedData, error: insertError } = await supabase
        .from('bot_training')
        .insert(data)
        .select();

      if (insertError) {
        console.error('Erro no insert:', insertError);
        throw insertError;
      }
      
      result = insertedData?.[0];
      console.log('Insert retornou:', result);
    }

    return result;
  } catch (e) {
    console.error('Erro saveTraining:', e.message);
    throw e;
  }
}

async function getTraining() {
  // CACHE DESABILITADO - sempre busca do banco para dados 100% atualizados
  try {
    console.log('=== Buscando training do Supabase (sem cache) ===');
    const { data, error } = await supabase
      .from('bot_training')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.log('Erro buscar training:', error.message);
      return defaultTraining;
    }

    if (data) {
      console.log('Training carregado do banco:', data.greeting_message?.substring(0, 50));
      return data;
    }

    console.log('Nenhum training encontrado, usando default');
    return defaultTraining;
  } catch (e) {
    console.error('Excecao getTraining:', e.message);
    return defaultTraining;
  }
}

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

  // Detectar intenção de agendamento/visita
  const visitKeywords = ['agendar', 'visita', 'marcar', 'horario', 'quando', 'dia', 'data', 'chegar', 'ir ai', 'ir até', 'passar ai', 'ir na loja', 'vir buscar', 'entregar', 'levar'];
  const isVisitIntent = visitKeywords.some(kw => msg.includes(kw));

  // Verificar FAQ
  const faq = training.faq_data || [];
  for (const item of faq) {
    if (!item.question || !item.answer) continue;
    const words = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matches = words.filter(w => msg.includes(w)).length;
    if (matches >= 2 || msg.includes(item.question.toLowerCase())) {
      return { text: item.answer, escalate: false, isVisit: isVisitIntent };
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

  // Detectar palavras de escalonamento
  const esc = training.escalation_keywords || defaultTraining.escalation_keywords;
  const shouldEscalate = esc.some(w => msg.includes(w.toLowerCase()));

  if (shouldEscalate) {
    return { 
      text: '👨‍💼 Entendido! Estou transferindo voce para um atendente humano. Aguarde um momento...',
      escalate: true,
      isVisit: false
    };
  }

  // Intenção de visita
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
