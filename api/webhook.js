import { createClient } from ‘@supabase/supabase-js’;

const SUPABASE_URL = ‘https://fwcljognwdutsagppxcq.supabase.co’;
const SUPABASE_KEY = ‘eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTY4MjMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE’;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CORS HEADERS ──────────────────────────────────────────────────────────────
function setCors(res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
setCors(res);
if (req.method === ‘OPTIONS’) return res.status(200).end();

```
// ── Meta Webhook Verification ──────────────────────────────────────────────
if (req.method === 'GET' && req.query['hub.mode']) {
    if (req.query['hub.mode'] === 'subscribe') {
        console.log('✅ Webhook verificado');
        return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
}

// ── List Conversations ─────────────────────────────────────────────────────
if (req.method === 'GET' && req.query.action === 'list') {
    try {
        const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .order('last_message_time', { ascending: false });

        if (error) throw error;

        const conversas = (data || []).map(conv => ({
            telefone: conv.phone_number,
            nome: conv.contact_name || conv.phone_number,
            emIntervencao: conv.status === 'human',
            etapa: conv.status,
            ultimaAtividade: conv.last_message_time,
            ultima: conv.last_message || 'Sem mensagens',
            mensagens: []
        }));

        return res.status(200).json(conversas);
    } catch (err) {
        console.error('❌ Listar:', err);
        return res.status(500).json({ error: err.message, conversas: [] });
    }
}

// ── Fetch Messages ─────────────────────────────────────────────────────────
if (req.method === 'GET' && req.query.action === 'messages') {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    try {
        const [{ data: conv }, { data: msgs, error }] = await Promise.all([
            supabase.from('conversations').select('*').eq('phone_number', phone).maybeSingle(),
            supabase.from('messages').select('*').eq('phone_number', phone).order('created_at', { ascending: true })
        ]);

        if (error) throw error;

        const mensagens = (msgs || []).map(m => ({
            id: m.id,
            data: m.created_at,
            timestamp: m.created_at,
            tipo: m.direction === 'outbound'
                ? (m.sender_type === 'human' ? 'humano' : (m.sender_type === 'system' ? 'system' : 'bot'))
                : 'cliente',
            mensagem: m.content,
            texto: m.content,
            content: m.content,
            nome: m.sender_type === 'human' ? 'Você' : (m.sender_type === 'bot' ? 'Bot' : (m.sender_type === 'system' ? 'Sistema' : 'Cliente'))
        }));

        return res.status(200).json({
            mensagens,
            emIntervencao: conv?.status === 'human',
            nome: conv?.contact_name
        });
    } catch (err) {
        console.error('❌ Mensagens:', err);
        return res.status(500).json({ error: err.message, mensagens: [] });
    }
}

// ── Panel Actions ──────────────────────────────────────────────────────────
if (req.method === 'POST' && req.query.action) {
    const { action } = req.query;
    const { phone, message } = req.body || {};

    if (action === 'intervene') {
        try {
            await supabase.from('conversations')
                .update({ status: 'human', updated_at: new Date().toISOString() })
                .eq('phone_number', phone);
            await saveMessage(phone, '👨‍💼 Atendente humano assumiu o controle.', 'outbound', 'system');
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (action === 'release') {
        try {
            await supabase.from('conversations')
                .update({ status: 'bot', updated_at: new Date().toISOString() })
                .eq('phone_number', phone);
            await saveMessage(phone, '🤖 Robô reassumiu o atendimento.', 'outbound', 'system');
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (action === 'send') {
        if (!message) return res.status(400).json({ error: 'Message required' });
        try {
            await saveMessage(phone, message, 'outbound', 'human');
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                await sendWhatsApp(phone, message);
            }
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }
}

// ── Receive WhatsApp Messages ──────────────────────────────────────────────
if (req.method === 'POST') {
    try {
        const body = req.body;
        console.log('📩 Webhook:', JSON.stringify(body).substring(0, 300));

        const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        const value   = body?.entry?.[0]?.changes?.[0]?.value;

        // Only process text messages; acknowledge everything else silently
        if (!message || message.type !== 'text') {
            return res.status(200).send('OK');
        }

        const from        = message.from;
        const text        = message.text?.body || '';
        const contactName = value?.contacts?.[0]?.profile?.name || from;

        // Save incoming message first so it's never lost
        await saveMessage(from, text, 'inbound', 'client', contactName);

        // Load training — if missing, skip bot reply but keep message saved
        const { data: training } = await supabase
            .from('bot_training')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!training || !training.active) {
            console.log('ℹ️ Bot desativado ou sem treinamento');
            return res.status(200).send('OK');
        }

        // Check if conversation is in human mode
        const { data: conv } = await supabase
            .from('conversations')
            .select('status')
            .eq('phone_number', from)
            .maybeSingle();

        if (conv?.status === 'human') {
            console.log('ℹ️ Conversa em modo humano:', from);
            return res.status(200).send('OK');
        }

        // Generate and send bot reply
        const reply = await generateResponse(text, training, from);

        if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
            await sendWhatsApp(from, reply);
        } else {
            console.log('⚠️ Token ausente — resposta simulada:', reply.substring(0, 80));
        }

        await saveMessage(from, reply, 'outbound', 'bot', contactName);

        return res.status(200).json({ ok: true });

    } catch (err) {
        console.error('❌ Webhook error:', err);
        // Always return 200 to Meta — never let it retry infinitely
        return res.status(200).json({ ok: false, error: err.message });
    }
}

return res.status(405).send('Method not allowed');
```

}

// ─── GENERATE RESPONSE ────────────────────────────────────────────────────────
async function generateResponse(userMessage, training, phoneNumber) {
const msg = userMessage.toLowerCase().trim();

```
// 1. Greetings
const greetings = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae'];
if (greetings.some(g => msg === g || msg.startsWith(g + ' ') || msg.endsWith(' ' + g))) {
    return training.greeting_message || 'Olá! Como posso ajudar?';
}

// 2. Smart FAQ
const faq = training.faq_data || [];
for (const item of faq) {
    const words = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matches = words.filter(w => msg.includes(w)).length;
    if (matches >= 2 || msg.includes(item.question.toLowerCase())) {
        return item.answer;
    }
}

// 3. Category keywords
if (/preço|valor|custa|quanto|cobrar|custo/i.test(msg)) {
    return (training.pricing_info || 'Entre em contato para orçamento.') +
        '\n\nPosso agendar um orçamento gratuito! Qual equipamento precisa de assistência?';
}
if (/horário|horario|hora|aberto|funciona|atende|abre|fecha/i.test(msg)) {
    return '⏰ ' + (training.business_hours || 'Horário comercial.') + '\n\nEstamos prontos para te atender! 😊';
}
if (/serviço|servico|conserta|reparo|arruma|troca|faz/i.test(msg)) {
    return '🔧 ' + (training.services || 'Oferecemos diversos serviços.') + '\n\nQual serviço você precisa?';
}
if (/endereço|endereco|local|onde|fica|chegar/i.test(msg)) {
    return `📍 Você pode nos encontrar buscando "${training.company_name || 'nossa empresa'}" no Google Maps!`;
}
if (/garantia|garante/i.test(msg)) {
    return '✅ Todos os serviços possuem garantia (30 a 90 dias conforme o reparo). Quer saber sobre algum serviço específico?';
}
if (/prazo|demora|rápido|rapido|tempo/i.test(msg)) {
    return '⏱️ Prazo varia conforme o defeito e peças. Fazemos diagnóstico em até 24h! Qual equipamento você tem?';
}
if (/agendar|marcar|posso ir|visita|agendamento/i.test(msg)) {
    return '📅 Para agendar preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema?\n3️⃣ Qual dia e horário prefere?\n\nOu digite "atendente" para falar com uma pessoa!';
}

// 4. Escalation keywords → hand off to human
const escalation = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'cancelar', 'chefe', 'gerente'];
if (escalation.some(w => msg.includes(w.toLowerCase()))) {
    // Fire-and-forget status update
    supabase.from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber)
        .then(() => console.log('🔄 Transferido para humano:', phoneNumber))
        .catch(e => console.error('Erro transferência:', e));

    return '👨‍💼 Vou transferir você para um atendente agora mesmo. Aguarde um momento... ⏳\n\n(Você será atendido em breve!)';
}

// 5. Fallback
return (training.fallback_message || 'Desculpe, não entendi bem.') +
    '\n\nPosso ajudar com:\n• 💰 Preços e orçamentos\n• ⏰ Horários\n• 🔧 Serviços\n• 📅 Agendamentos\n\nOu digite "atendente" para falar com uma pessoa!';
```

}

// ─── SAVE MESSAGE ─────────────────────────────────────────────────────────────
async function saveMessage(phone, content, direction, senderType, contactName = null) {
try {
// Upsert conversation
let { data: conv } = await supabase
.from(‘conversations’).select(‘id’).eq(‘phone_number’, phone).maybeSingle();

```
    if (!conv) {
        const { data: newConv, error } = await supabase
            .from('conversations')
            .insert({
                phone_number: phone,
                contact_name: contactName,
                status: 'bot',
                last_message: content,
                last_message_time: new Date().toISOString(),
                unread: true
            })
            .select().single();
        if (error) { console.error('Criar conversa:', error); return; }
        conv = newConv;
    } else {
        await supabase.from('conversations').update({
            ...(contactName ? { contact_name: contactName } : {}),
            last_message: content,
            last_message_time: new Date().toISOString(),
            unread: true
        }).eq('id', conv.id);
    }

    // Insert message
    const { error } = await supabase.from('messages').insert({
        conversation_id: conv.id,
        phone_number: phone,
        direction,
        content,
        sender_type: senderType
    });
    if (error) console.error('Salvar mensagem:', error);

} catch (err) {
    console.error('❌ saveMessage:', err);
}
```

}

// ─── SEND WHATSAPP MESSAGE ────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
const res = await fetch(url, {
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

```
const data = await res.json();
if (!res.ok) {
    console.error('❌ WhatsApp API:', data);
    throw new Error(data.error?.message || 'Erro WhatsApp API');
}
console.log('✅ WhatsApp enviado:', data.messages?.[0]?.id);
return data;
```

}
