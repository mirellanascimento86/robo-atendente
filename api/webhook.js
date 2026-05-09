import { createClient } from ‘@supabase/supabase-js’;

const SUPABASE_URL = ‘https://fwcljognwdutsagppxcq.supabase.co’;
const SUPABASE_KEY = ‘eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE’;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
auth: { autoRefreshToken: false, persistSession: false }
});

// Fallback mínimo — só usado se o banco estiver completamente vazio
const defaultTraining = {
bot_name: ‘Assistente’,
company_name: ‘Minha Empresa’,
greeting_message: ‘Ola! Como posso ajudar?’,
personality: ‘’,
services: ‘’,
business_hours: ‘’,
pricing_info: ‘’,
fallback_message: ‘Nao compreendi. Posso ajudar com orcamentos, horarios e servicos.’,
faq_data: [],
escalation_keywords: [‘atendente’, ‘humano’, ‘pessoa’, ‘reclamacao’, ‘cancelar’, ‘chefe’, ‘gerente’, ‘supervisor’],
active: true
};

export const config = {
api: { bodyParser: { sizeLimit: ‘2mb’ } },
};

// ===== TELEGRAM =====
async function sendTelegramAlert(message, parseMode = ‘HTML’) {
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) return { skipped: true };
try {
const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ chat_id: TELEGRAM_GROUP_ID, text: message, parse_mode: parseMode, disable_web_page_preview: true })
});
const data = await response.json();
return response.ok && data.ok ? { ok: true } : { error: data.description };
} catch (e) {
return { error: e.message };
}
}

async function alertHumanIntervention(phone, contactName, userMessage) {
return await sendTelegramAlert(`🚨 <b>INTERVENÇÃO HUMANA</b>\n\n📱 ${contactName || 'Desconhecido'}\n🔢 ${phone}\n💬 "${userMessage}"\n\n🔗 <a href="https://wa.me/${phone.replace(/\D/g, '')}">Atender no WhatsApp</a>`);
}

async function alertVisitScheduled(phone, contactName, details) {
return await sendTelegramAlert(`📅 <b>VISITA AGENDADA</b>\n\n📱 ${contactName || 'Desconhecido'}\n🔢 ${phone}\n📝 ${details || 'Interesse em agendamento'}\n\n🔗 <a href="https://wa.me/${phone.replace(/\D/g, '')}">Abrir WhatsApp</a>`);
}

export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, POST, OPTIONS, PUT, PATCH’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type, Authorization, X-Requested-With’);
if (req.method === ‘OPTIONS’) return res.status(200).end();

console.log(’\n=== WEBHOOK ===’, req.method, req.query);

try {

```
// ========== GET ==========
if (req.method === 'GET') {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && challenge) return res.status(200).send(challenge);

  const action = req.query.action;

  // ----- GET updateconfig -----
  if (action === 'updateconfig') {
    console.log('=== UPDATE VIA GET ===');
    let faqData = [], escalationKeywords = [];
    try {
      if (req.query.faq_data) faqData = JSON.parse(req.query.faq_data);
      if (req.query.escalation_keywords) escalationKeywords = JSON.parse(req.query.escalation_keywords);
    } catch (e) { console.log('Parse erro:', e.message); }

    const configData = {
      bot_name: req.query.bot_name || '',
      company_name: req.query.company_name || '',
      greeting_message: req.query.greeting_message || req.query.greeting || '',
      personality: req.query.personality || '',
      services: req.query.services || '',
      business_hours: req.query.business_hours || req.query.hours || '',
      pricing_info: req.query.pricing_info || req.query.pricing || '',
      fallback_message: req.query.fallback_message || req.query.fallback || '',
      faq_data: faqData,
      escalation_keywords: escalationKeywords,
      active: req.query.active !== 'false',
      updated_at: new Date().toISOString()
    };

    const result = await saveTrainingToSupabase(configData);
    const refreshed = await getTraining();
    return res.status(200).json({
      success: true,
      message: 'Config atualizada via GET',
      saved: result,
      confirmed_greeting: refreshed?.greeting_message
    });
  }

  if (action === 'list') {
    const { data, error } = await supabase.from('conversations').select('*').order('last_message_time', { ascending: false });
    if (error) throw error;
    return res.status(200).json((data || []).map(c => ({
      telefone: c.phone_number, nome: c.contact_name || c.phone_number,
      emIntervencao: c.status === 'human', etapa: c.status,
      ultimaAtividade: c.last_message_time, ultima: c.last_message || 'Sem mensagens'
    })));
  }

  if (action === 'messages') {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();
    const { data: messages, error } = await supabase.from('messages').select('*').eq('phone_number', phone).order('created_at', { ascending: true });
    if (error) throw error;
    return res.status(200).json({
      mensagens: (messages || []).map(m => ({
        data: m.created_at,
        tipo: m.direction === 'outbound' ? (m.sender_type === 'human' ? 'humano' : 'bot') : 'cliente',
        mensagem: m.content,
        nome: m.sender_type === 'human' ? 'Voce' : (m.sender_type === 'bot' ? 'Bot' : 'Cliente')
      })),
      emIntervencao: conv?.status === 'human'
    });
  }

  // GET status
  const training = await getTraining();
  return res.status(200).json({
    status: 'online',
    greeting: training?.greeting_message,
    bot_active: training?.active !== false,
    bot_name: training?.bot_name,
    company: training?.company_name
  });
}

// ========== POST ==========
if (req.method === 'POST') {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  }

  const action = req.query.action;

  // ----- POST actions (intervene / release / send) -----
  if (action) {
    const phone = body.phone;
    if (action === 'intervene') {
      await supabase.from('conversations').upsert(
        { phone_number: phone, status: 'human', updated_at: new Date().toISOString() },
        { onConflict: 'phone_number' }
      );
      await saveMessage(phone, 'Atendente humano assumiu.', 'outbound', 'system');
      return res.status(200).json({ ok: true });
    }
    if (action === 'release') {
      await supabase.from('conversations').upsert(
        { phone_number: phone, status: 'bot', updated_at: new Date().toISOString() },
        { onConflict: 'phone_number' }
      );
      await saveMessage(phone, 'Bot reassumiu.', 'outbound', 'system');
      return res.status(200).json({ ok: true });
    }
    if (action === 'send') {
      if (!body.message) return res.status(400).json({ error: 'Message required' });
      await saveMessage(phone, body.message, 'outbound', 'human');
      if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) await sendWhatsAppMessage(phone, body.message);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  // ----- POST do WhatsApp -----
  const isWhatsApp = body.object === 'whatsapp_business_account';
  if (isWhatsApp) {
    console.log('=== WHATSAPP MESSAGE ===');

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(200).send('OK');
    }

    const message = messages[0];
    if (message.type !== 'text') return res.status(200).send('OK');

    const from = message.from;
    const text = message.text?.body || '';
    const contactName = value?.contacts?.[0]?.profile?.name || from;

    console.log(`Msg de ${from}: "${text}"`);

    // Sempre buscar training atualizado do Supabase — sem cache
    const training = await getTraining();
    console.log('Training ativo:', {
      greeting: training?.greeting_message?.substring(0, 60),
      active: training?.active,
      company: training?.company_name
    });

    if (training.active === false) {
      await saveMessage(from, text, 'inbound', 'human', contactName);
      return res.status(200).send('Bot off');
    }

    await saveMessage(from, text, 'inbound', 'bot', contactName);

    // Verificar modo humano
    let convStatus = 'bot';
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('status')
        .eq('phone_number', from)
        .single();
      if (conv) convStatus = conv.status;
    } catch (e) {}

    if (convStatus === 'human') return res.status(200).send('Human mode');

    // Gerar resposta com training do Supabase
    const responseData = generateResponse(text, training);
    const response = responseData.text;

    console.log('Resposta:', response.substring(0, 100));

    if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
      try { await sendWhatsAppMessage(from, response); } catch (e) { console.error('Erro WA:', e.message); }
    }

    await saveMessage(from, response, 'outbound', 'bot', contactName);

    if (responseData.escalate) {
      await alertHumanIntervention(from, contactName, text);
      await supabase.from('conversations').upsert(
        { phone_number: from, status: 'human', updated_at: new Date().toISOString() },
        { onConflict: 'phone_number' }
      );
    }

    if (responseData.isVisit) {
      await alertVisitScheduled(from, contactName, text);
    }

    return res.status(200).json({ success: true, response });
  }

  // ----- POST do Painel de Treinamento -----
  // Detectar se é uma atualização de config (tem campos de treinamento)
  const isPanelUpdate = (
    body.bot_name !== undefined ||
    body.greeting_message !== undefined ||
    body.company_name !== undefined ||
    body.personality !== undefined ||
    body.services !== undefined
  );

  if (isPanelUpdate) {
    console.log('=== SALVANDO CONFIG DO PAINEL ===');
    console.log('Greeting recebida:', body.greeting_message?.substring(0, 80));

    const trainingData = {
      bot_name: body.bot_name ?? '',
      company_name: body.company_name ?? '',
      greeting_message: body.greeting_message ?? body.greeting ?? '',
      personality: body.personality ?? '',
      services: body.services ?? '',
      business_hours: body.business_hours ?? body.hours ?? '',
      pricing_info: body.pricing_info ?? body.pricing ?? '',
      fallback_message: body.fallback_message ?? body.fallback ?? '',
      faq_data: Array.isArray(body.faq_data) ? body.faq_data : [],
      escalation_keywords: Array.isArray(body.escalation_keywords) ? body.escalation_keywords : [],
      active: body.active !== false && body.active !== 'false',
      updated_at: new Date().toISOString()
    };

    const saved = await saveTrainingToSupabase(trainingData);

    // Confirmar lendo de volta do banco
    const refreshed = await getTraining();
    console.log('Confirmado no banco:', refreshed?.greeting_message?.substring(0, 60));

    return res.status(200).json({
      success: true,
      message: 'Configuracao salva com sucesso',
      greeting: trainingData.greeting_message,
      id: saved?.id,
      confirmed_greeting: refreshed?.greeting_message,
      confirmed_active: refreshed?.active
    });
  }

  return res.status(200).json({ message: 'Received' });
}

return res.status(405).send('Method not allowed');
```

} catch (error) {
console.error(‘ERRO GLOBAL:’, error);
return res.status(200).json({ error: true, message: error.message, handled: true });
}
}

// ========== SUPABASE ==========

async function saveTrainingToSupabase(data) {
try {
console.log(’=== saveTrainingToSupabase ===’, ‘greeting:’, data.greeting_message?.substring(0, 50));

```
const { data: existing, error: findError } = await supabase
  .from('bot_training')
  .select('id')
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (findError) console.log('Erro ao buscar registro:', findError.message);

let result;

if (existing?.id) {
  console.log('UPDATE no ID:', existing.id);
  const { data: updatedData, error: updateError } = await supabase
    .from('bot_training')
    .update(data)
    .eq('id', existing.id)
    .select();

  if (updateError) { console.error('Erro UPDATE:', updateError); throw updateError; }
  result = updatedData?.[0];
  console.log('UPDATE ok, greeting confirmada:', result?.greeting_message?.substring(0, 50));
} else {
  console.log('INSERT novo registro');
  const { data: insertedData, error: insertError } = await supabase
    .from('bot_training')
    .insert(data)
    .select();

  if (insertError) { console.error('Erro INSERT:', insertError); throw insertError; }
  result = insertedData?.[0];
  console.log('INSERT ok');
}

return result;
```

} catch (e) {
console.error(‘Erro saveTraining:’, e.message);
throw e;
}
}

async function getTraining() {
try {
const { data, error } = await supabase
.from(‘bot_training’)
.select(’*’)
.order(‘updated_at’, { ascending: false })
.limit(1)
.maybeSingle();

```
if (error) {
  console.log('Erro getTraining:', error.message);
  return { ...defaultTraining };
}

if (data) {
  console.log('Training carregado do Supabase:', data.greeting_message?.substring(0, 50));
  return data;
}

console.log('Banco vazio — usando default');
return { ...defaultTraining };
```

} catch (e) {
console.error(‘Excecao getTraining:’, e.message);
return { …defaultTraining };
}
}

function generateResponse(userMessage, training) {
const msg = (userMessage || ‘’).toLowerCase().trim();
const t = training || defaultTraining;

if (!msg) {
return { text: t.greeting_message || ‘Ola! Como posso ajudar?’, escalate: false, isVisit: false };
}

const greetings = [‘oi’, ‘ola’, ‘olá’, ‘bom dia’, ‘boa tarde’, ‘boa noite’, ‘hey’, ‘hi’, ‘hello’, ‘eai’, ‘eae’, ‘fala’];
if (greetings.some(g => msg === g || msg.startsWith(g + ’ ’))) {
return { text: t.greeting_message || ‘Ola! Como posso ajudar?’, escalate: false, isVisit: false };
}

const visitKeywords = [‘agendar’, ‘visita’, ‘marcar’, ‘horario’, ‘quando’, ‘dia’, ‘data’, ‘chegar’, ‘ir ai’, ‘ir até’, ‘passar ai’, ‘ir na loja’, ‘vir buscar’, ‘entregar’, ‘levar’];
const isVisitIntent = visitKeywords.some(kw => msg.includes(kw));

const faq = Array.isArray(t.faq_data) ? t.faq_data : [];
for (const item of faq) {
if (!item.question || !item.answer) continue;
const words = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
const matches = words.filter(w => msg.includes(w)).length;
if (matches >= 2 || msg.includes(item.question.toLowerCase())) {
return { text: item.answer, escalate: false, isVisit: isVisitIntent };
}
}

if (/preco|valor|custa|quanto|orcamento/i.test(msg)) {
return {
text: (t.pricing_info || ‘Consulte-nos para orcamento.’) + ‘\n\nPosso agendar um orcamento gratuito!’,
escalate: false, isVisit: isVisitIntent
};
}

if (/horario|hora|aberto|funciona/i.test(msg)) {
return {
text: ’⏰ ’ + (t.business_hours || ‘Horario comercial’) + ‘\n\nEstamos prontos!’,
escalate: false, isVisit: isVisitIntent
};
}

if (/servico|conserta|reparo|arruma|troca/i.test(msg)) {
return {
text: ’🔧 ’ + (t.services || ‘Diversos servicos.’) + ‘\n\nQual voce precisa?’,
escalate: false, isVisit: isVisitIntent
};
}

const escKeywords = Array.isArray(t.escalation_keywords) ? t.escalation_keywords : [];
const shouldEscalate = escKeywords.some(w => msg.includes(w.toLowerCase()));
if (shouldEscalate) {
return { text: ‘👨‍💼 Entendido! Transferindo para atendente humano. Aguarde…’, escalate: true, isVisit: false };
}

if (isVisitIntent) {
return {
text: ‘Perfeito! Vou registrar seu interesse em agendamento.\n\n’ + (t.business_hours || ‘’),
escalate: false, isVisit: true
};
}

return {
text: (t.fallback_message || ‘Nao compreendi.’) + ‘\n\nOu digite “atendente”!’,
escalate: false, isVisit: false
};
}

async function saveMessage(phone, content, direction, senderType, contactName = null) {
try {
let convId = null;
const { data: existing } = await supabase
.from(‘conversations’)
.select(‘id’)
.eq(‘phone_number’, phone)
.maybeSingle();

```
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
    phone_number: phone,
    contact_name: contactName,
    status: 'bot',
    last_message: content,
    last_message_time: new Date().toISOString(),
    unread: direction === 'inbound',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).select().single();
  convId = newConv?.id;
}

await supabase.from('messages').insert({
  conversation_id: convId,
  phone_number: phone,
  direction,
  content,
  sender_type: senderType,
  created_at: new Date().toISOString()
});
```

} catch (error) {
console.error(‘Erro saveMessage:’, error.message);
}
}

async function sendWhatsAppMessage(to, text) {
if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return { simulated: true };
const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
method: ‘POST’,
headers: {
‘Authorization’: `Bearer ${WHATSAPP_TOKEN}`,
‘Content-Type’: ‘application/json’
},
body: JSON.stringify({
messaging_product: ‘whatsapp’,
recipient_type: ‘individual’,
to,
type: ‘text’,
text: { body: text }
})
});
const data = await response.json();
if (!response.ok) throw new Error(data.error?.message || `Erro ${response.status}`);
return data;
}
