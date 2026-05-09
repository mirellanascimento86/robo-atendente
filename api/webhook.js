import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,PATCH,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
}

// Default MINIMAL — só se banco estiver VAZIO
function defaultT() {
  return {
    bot_name: 'Assistente',
    company_name: 'Empresa',
    greeting_message: 'Ola! Como posso ajudar?',
    personality: '',
    services: '',
    business_hours: '',
    pricing_info: '',
    fallback_message: 'Nao compreendi. Digite "atendente" para falar com humano.',
    faq_data: [],
    escalation_keywords: ['atendente','humano','pessoa','reclamacao','cancelar','chefe','gerente','supervisor'],
    active: true,
  };
}

// ══════════════════════════════════════════════════════════════
// GET TRAINING — SEMPRE do banco, NUNCA do cache
// ══════════════════════════════════════════════════════════════
async function getTraining() {
  try {
    const { data, error } = await supabase
      .from('bot_training')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[getTraining] ERRO:', error.message);
      return defaultT();
    }

    if (!data) {
      console.log('[getTraining] BANCO VAZIO — usando default');
      return defaultT();
    }

    // Garantir arrays
    if (!Array.isArray(data.faq_data)) data.faq_data = [];
    if (!Array.isArray(data.escalation_keywords)) data.escalation_keywords = [];

    console.log('[getTraining] OK — greeting:', data.greeting_message);
    return data;
  } catch (e) {
    console.error('[getTraining] EXCECAO:', e.message);
    return defaultT();
  }
}

// ══════════════════════════════════════════════════════════════
// SAVE TRAINING — salva no banco
// ══════════════════════════════════════════════════════════════
async function saveTraining(data) {
  if (!Array.isArray(data.faq_data)) data.faq_data = [];
  if (!Array.isArray(data.escalation_keywords)) data.escalation_keywords = [];
  data.updated_at = new Date().toISOString();

  console.log('[saveTraining] Salvando greeting:', data.greeting_message);

  try {
    const { data: existing } = await supabase
      .from('bot_training')
      .select('id')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let result, error;

    if (existing?.id) {
      console.log('[saveTraining] UPDATE id:', existing.id);
      ({ data: result, error } = await supabase
        .from('bot_training')
        .update(data)
        .eq('id', existing.id)
        .select()
        .single());
    } else {
      console.log('[saveTraining] INSERT novo');
      ({ data: result, error } = await supabase
        .from('bot_training')
        .insert(data)
        .select()
        .single());
    }

    if (error) {
      console.error('[saveTraining] ERRO:', error.message);
      throw error;
    }

    console.log('[saveTraining] OK id:', result?.id);
    return result;
  } catch (e) {
    console.error('[saveTraining] EXCECAO:', e.message);
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════
// EXTRAINdo DADOS — aceita qualquer formato (body, query, etc)
// ══════════════════════════════════════════════════════════════
function extractTraining(src) {
  let faq = src.faq_data || [];
  let esc = src.escalation_keywords || [];
  
  if (typeof faq === 'string') try { faq = JSON.parse(faq); } catch { faq = []; }
  if (typeof esc === 'string') try { esc = JSON.parse(esc); } catch { esc = []; }

  return {
    bot_name: String(src.bot_name ?? ''),
    company_name: String(src.company_name ?? ''),
    greeting_message: String(src.greeting_message ?? src.greeting ?? ''),
    personality: String(src.personality ?? ''),
    services: String(src.services ?? ''),
    business_hours: String(src.business_hours ?? src.hours ?? ''),
    pricing_info: String(src.pricing_info ?? src.pricing ?? ''),
    fallback_message: String(src.fallback_message ?? src.fallback ?? ''),
    faq_data: Array.isArray(faq) ? faq : [],
    escalation_keywords: Array.isArray(esc) ? esc : [],
    active: src.active !== false && src.active !== 'false',
  };
}

const TRAINING_KEYS = ['bot_name','company_name','greeting_message','greeting','personality','services','business_hours','pricing_info','fallback_message','faq_data','escalation_keywords','active'];

// ══════════════════════════════════════════════════════════════
// GERAR RESPOSTA
// ══════════════════════════════════════════════════════════════
function respond(userMsg, t) {
  const msg = (userMsg || '').toLowerCase().trim();
  if (!msg) return { text: t.greeting_message, escalate: false, isVisit: false };

  const hi = ['oi','ola','olá','bom dia','boa tarde','boa noite','hey','hi','hello','eai','eae','fala'];
  if (hi.some(g => msg === g || msg.startsWith(g + ' ')))
    return { text: t.greeting_message, escalate: false, isVisit: false };

  const visitKw = ['agendar','visita','marcar','horario','quando','dia','data','ir ai','passar ai','vir buscar','entregar','levar'];
  const isVisit = visitKw.some(k => msg.includes(k));

  for (const item of (t.faq_data || [])) {
    if (!item.question || !item.answer) continue;
    const words = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.filter(w => msg.includes(w)).length >= 2 || msg.includes(item.question.toLowerCase()))
      return { text: item.answer, escalate: false, isVisit };
  }

  if (/preco|valor|custa|quanto|orcamento/i.test(msg))
    return { text: (t.pricing_info||'Consulte-nos.')+'\n\nPosso agendar um orcamento gratuito!', escalate:false, isVisit };

  if (/horario|hora|aberto|funciona/i.test(msg))
    return { text: '⏰ '+(t.business_hours||'Horario comercial')+'\n\nEstamos prontos!', escalate:false, isVisit };

  if (/servico|conserta|reparo|arruma|troca/i.test(msg))
    return { text: '🔧 '+(t.services||'Diversos servicos.')+'\n\nQual voce precisa?', escalate:false, isVisit };

  if ((t.escalation_keywords||[]).some(w => msg.includes(w.toLowerCase())))
    return { text: '👨‍💼 Entendido! Transferindo para atendente humano. Aguarde...', escalate:true, isVisit:false };

  if (isVisit)
    return { text: 'Perfeito! Vou registrar seu interesse.\n\n'+(t.business_hours||''), escalate:false, isVisit:true };

  return { text: (t.fallback_message||'Nao compreendi.')+'\n\nOu digite "atendente"!', escalate:false, isVisit:false };
}

// ══════════════════════════════════════════════════════════════
// TELEGRAM
// ══════════════════════════════════════════════════════════════
async function telegram(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_GROUP_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) { console.error('[telegram]', e.message); }
}

// ══════════════════════════════════════════════════════════════
// SALVAR MENSAGEM
// ══════════════════════════════════════════════════════════════
async function saveMsg(phone, content, direction, senderType, contactName = null) {
  try {
    const { data: ex } = await supabase.from('conversations').select('id').eq('phone_number', phone).maybeSingle();
    let convId;
    if (ex?.id) {
      convId = ex.id;
      await supabase.from('conversations').update({
        contact_name: contactName||undefined, last_message: content,
        last_message_time: new Date().toISOString(), unread: direction==='inbound',
        updated_at: new Date().toISOString(),
      }).eq('id', convId);
    } else {
      const { data: nc } = await supabase.from('conversations').insert({
        phone_number: phone, contact_name: contactName, status: 'bot', last_message: content,
        last_message_time: new Date().toISOString(), unread: direction==='inbound',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select().single();
      convId = nc?.id;
    }
    await supabase.from('messages').insert({
      conversation_id: convId, phone_number: phone,
      direction, content, sender_type: senderType, created_at: new Date().toISOString(),
    });
  } catch (e) { console.error('[saveMsg]', e.message); }
}

// ══════════════════════════════════════════════════════════════
// WHATSAPP SEND
// ══════════════════════════════════════════════════════════════
async function sendWA(to, text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return { simulated: true };
  const r = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{ body:text } }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `WA ${r.status}`);
  return d;
}

// ══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const q = req.query || {};
  console.log(`\n=== ${req.method} action=${q.action || 'none'} ===`);

  try {

    // ══════ GET ═══════════════════════════════════════════════
    if (req.method === 'GET') {

      // Verificação Meta
      if (q['hub.mode'] === 'subscribe' && q['hub.challenge'])
        return res.status(200).send(q['hub.challenge']);

      // GET status — retorna TODOS os campos do training
      if (!q.action || q.action === 'status') {
        const t = await getTraining();
        return res.status(200).json({
          success: true,
          status: 'online',
          ...t,
          greeting: t.greeting_message,
          bot_active: t.active,
        });
      }

      // Salvar config via GET (fallback)
      if (q.action === 'updateconfig' || q.action === 'saveconfig') {
        const d = extractTraining(q);
        const saved = await saveTraining(d);
        const confirmed = await getTraining();
        return res.status(200).json({
          success: true,
          method: 'GET',
          confirmed_greeting: confirmed.greeting_message,
          confirmed_active: confirmed.active,
          id: saved?.id,
        });
      }

      if (q.action === 'list') {
        const { data } = await supabase.from('conversations').select('*').order('last_message_time', { ascending: false });
        return res.status(200).json((data||[]).map(c => ({
          telefone: c.phone_number, nome: c.contact_name || c.phone_number,
          emIntervencao: c.status === 'human', etapa: c.status,
          ultimaAtividade: c.last_message_time, ultima: c.last_message || '',
        })));
      }

      if (q.action === 'messages') {
        if (!q.phone) return res.status(400).json({ error: 'Phone required' });
        const { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', q.phone).single();
        const { data: msgs } = await supabase.from('messages').select('*').eq('phone_number', q.phone).order('created_at', { ascending: true });
        return res.status(200).json({
          mensagens: (msgs||[]).map(m => ({
            data: m.created_at,
            tipo: m.direction === 'outbound' ? (m.sender_type === 'human' ? 'humano' : 'bot') : 'cliente',
            mensagem: m.content,
            nome: m.sender_type === 'human' ? 'Voce' : (m.sender_type === 'bot' ? 'Bot' : 'Cliente'),
          })),
          emIntervencao: conv?.status === 'human',
        });
      }

      return res.status(200).json({ ok: true });
    }

    // ══════ POST ══════════════════════════════════════════════
    if (req.method === 'POST') {

      // Ações do painel
      if (q.action === 'intervene') {
        await supabase.from('conversations').upsert(
          { phone_number: body.phone, status: 'human', updated_at: new Date().toISOString() },
          { onConflict: 'phone_number' }
        );
        await saveMsg(body.phone, 'Atendente humano assumiu.', 'outbound', 'system');
        return res.status(200).json({ ok: true });
      }

      if (q.action === 'release') {
        await supabase.from('conversations').upsert(
          { phone_number: body.phone, status: 'bot', updated_at: new Date().toISOString() },
          { onConflict: 'phone_number' }
        );
        await saveMsg(body.phone, 'Bot reassumiu.', 'outbound', 'system');
        return res.status(200).json({ ok: true });
      }

      if (q.action === 'send') {
        if (!body.message) return res.status(400).json({ error: 'Message required' });
        await saveMsg(body.phone, body.message, 'outbound', 'human');
        if (WHATSAPP_TOKEN) await sendWA(body.phone, body.message);
        return res.status(200).json({ ok: true });
      }

      // ── WHATSAPP WEBHOOK ───────────────────────────────────
      if (body.object === 'whatsapp_business_account') {
        const msgs = body.entry?.[0]?.changes?.[0]?.value?.messages;
        if (!msgs?.length) return res.status(200).send('OK');
        
        const message = msgs[0];
        if (message.type !== 'text') return res.status(200).send('OK');

        const from = message.from;
        const text = message.text?.body || '';
        const contactName = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || from;

        console.log(`[WA] ${from}: "${text}"`);

        // BUSCAR TRAINING DO BANCO — SEMPRE
        const t = await getTraining();
        console.log('[WA] Training usado:', t.greeting_message?.substring(0, 50));

        if (!t.active) {
          await saveMsg(from, text, 'inbound', 'human', contactName);
          return res.status(200).send('Bot off');
        }

        await saveMsg(from, text, 'inbound', 'bot', contactName);

        const { data: conv } = await supabase.from('conversations').select('status').eq('phone_number', from).maybeSingle();
        if (conv?.status === 'human') return res.status(200).send('Human mode');

        const r = respond(text, t);
        console.log('[WA] Resposta:', r.text.substring(0, 100));

        try { await sendWA(from, r.text); } catch(e) { console.error('[WA] send erro:', e.message); }
        await saveMsg(from, r.text, 'outbound', 'bot', contactName);

        if (r.escalate) {
          await telegram(`🚨 <b>INTERVENÇÃO HUMANA</b>\n\n📱 ${contactName}\n🔢 ${from}\n💬 "${text}"\n\n🔗 <a href="https://wa.me/${from.replace(/\D/g,'')}">Atender</a>`);
          await supabase.from('conversations').upsert(
            { phone_number: from, status: 'human', updated_at: new Date().toISOString() },
            { onConflict: 'phone_number' }
          );
        }

        if (r.isVisit) {
          await telegram(`📅 <b>VISITA AGENDADA</b>\n\n📱 ${contactName}\n🔢 ${from}\n📝 "${text}"\n\n🔗 <a href="https://wa.me/${from.replace(/\D/g,'')}">Abrir</a>`);
        }

        return res.status(200).json({ success: true, response: r.text });
      }

      // ── SALVAR TREINAMENTO DO PAINEL (POST direto) ─────────
      if (TRAINING_KEYS.some(k => k in body)) {
        console.log('[PAINEL] Recebido POST de treinamento');
        const d = extractTraining(body);
        const saved = await saveTraining(d);
        const confirmed = await getTraining();
        return res.status(200).json({
          success: true,
          confirmed_greeting: confirmed.greeting_message,
          confirmed_active: confirmed.active,
          id: saved?.id,
        });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[ERR]', err.message);
    return res.status(200).json({ error: true, message: err.message });
  }
}
