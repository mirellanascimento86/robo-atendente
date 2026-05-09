import { createClient } from '@supabase/supabase-js';

// ==========================================
// CONFIGURACAO DO SUPABASE
// ==========================================
const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

// VARIAVEIS DE AMBIENTE DO META (configure no Vercel)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Usar service role key no servidor para bypassar RLS
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ==========================================
// CACHE INTELIGENTE COM INVALIDACAO POR updated_at
// ==========================================
let trainingCache = null;
let cacheTimestamp = 0;
let cacheUpdatedAt = null;
const CACHE_TTL = 10000;

// ==========================================
// HANDLER PRINCIPAL
// ==========================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // VERIFICACAO DO WEBHOOK (Meta) - GET
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe') {
            console.log('Webhook verificado pelo Meta');
            return res.status(200).send(challenge);
        }

        const action = req.query.action;

        if (action === 'list') {
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
                return res.status(500).json({ error: error.message });
            }
        }

        if (action === 'messages') {
            const phone = req.query.phone;
            if (!phone) return res.status(400).json({ error: 'Phone required' });
            try {
                const { data: conversation } = await supabase
                    .from('conversations')
                    .select('*')
                    .eq('phone_number', phone)
                    .single();
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
                return res.status(500).json({ error: error.message });
            }
        }

        // LIMPAR CACHE DO TREINAMENTO (chamado pelo painel apos salvar)
        if (action === 'clearcache') {
            trainingCache = null;
            cacheTimestamp = 0;
            cacheUpdatedAt = null;
            console.log('Cache de treinamento LIMPO pelo painel - proxima mensagem buscara dados frescos do Supabase');
            return res.status(200).json({ 
                ok: true, 
                message: 'Cache limpo',
                timestamp: new Date().toISOString()
            });
        }

        return res.status(400).json({ error: 'Invalid action' });
    }

    // ACOES DO PAINEL (POST com action)
    if (req.method === 'POST' && req.query.action) {
        const action = req.query.action;
        const body = req.body;
        const phone = body.phone;

        if (action === 'intervene') {
            try {
                await supabase.from('conversations').upsert({ 
                    phone_number: phone, status: 'human', updated_at: new Date().toISOString() 
                }, { onConflict: 'phone_number' });
                await saveMessage(phone, 'Atendente humano assumiu o controle.', 'outbound', 'system');
                return res.status(200).json({ ok: true });
            } catch (error) { return res.status(500).json({ error: error.message }); }
        }

        if (action === 'release') {
            try {
                await supabase.from('conversations').upsert({ 
                    phone_number: phone, status: 'bot', updated_at: new Date().toISOString() 
                }, { onConflict: 'phone_number' });
                await saveMessage(phone, 'Robo reassumiu o atendimento.', 'outbound', 'system');
                return res.status(200).json({ ok: true });
            } catch (error) { return res.status(500).json({ error: error.message }); }
        }

        if (action === 'send') {
            try {
                const message = body.message;
                if (!message) return res.status(400).json({ error: 'Message required' });
                await saveMessage(phone, message, 'outbound', 'human');
                if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) await sendWhatsAppMessage(phone, message);
                return res.status(200).json({ ok: true });
            } catch (error) { return res.status(500).json({ error: error.message }); }
        }
    }

    // RECEBIMENTO DE MENSAGENS DO WHATSAPP (POST)
    if (req.method === 'POST') {
        try {
            const body = req.body;
            if (!body.object || body.object !== 'whatsapp_business_account') {
                return res.status(200).send('OK');
            }
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            const message = value?.messages?.[0];
            if (!message || message.type !== 'text') return res.status(200).send('OK');

            const from = message.from;
            const text = message.text?.body || '';
            const contactName = value?.contacts?.[0]?.profile?.name || from;

            // BUSCAR CONFIGURACAO ATUALIZADA DO BOT
            const training = await getLatestTraining();

            if (!training) {
                const fallback = 'Ola! Estou com dificuldades tecnicas. Digite "atendente" para falar com uma pessoa.';
                await saveMessage(from, text, 'inbound', 'bot', contactName);
                await saveMessage(from, fallback, 'outbound', 'bot', contactName);
                if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) await sendWhatsAppMessage(from, fallback);
                return res.status(200).json({ success: true, response: fallback, fallback: true });
            }

            if (training.active === false) {
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('Bot desativado');
            }

            await saveMessage(from, text, 'inbound', 'bot', contactName);

            // Verificar modo humano
            let conversationStatus = 'bot';
            try {
                const { data: conversation } = await supabase
                    .from('conversations').select('status').eq('phone_number', from).single();
                if (conversation) conversationStatus = conversation.status;
            } catch (e) {}

            if (conversationStatus === 'human') return res.status(200).send('Modo humano');

            const botResponse = generateResponse(text, training, from);

            let whatsappSent = false;
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                try { await sendWhatsAppMessage(from, botResponse); whatsappSent = true; } 
                catch (e) { console.error('Erro WhatsApp:', e.message); }
            }

            await saveMessage(from, botResponse, 'outbound', 'bot', contactName);
            return res.status(200).json({ success: true, response: botResponse, whatsappSent });

        } catch (error) {
            console.error('Erro critico:', error);
            return res.status(200).json({ error: error.message, handled: true });
        }
    }
    return res.status(405).send('Method not allowed');
}

// BUSCAR TREINAMENTO MAIS RECENTE - CACHE INTELIGENTE
async function getLatestTraining() {
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
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            if (trainingCache) return trainingCache;
            return null;
        }

        if (data) {
            // Verificar se dados no Supabase sao mais recentes que cache
            if (cacheUpdatedAt && data.updated_at && new Date(data.updated_at) <= new Date(cacheUpdatedAt)) {
                cacheTimestamp = now;
                return trainingCache;
            }
            trainingCache = data;
            cacheTimestamp = now;
            cacheUpdatedAt = data.updated_at;
            return data;
        }
        return null;
    } catch (e) {
        if (trainingCache) return trainingCache;
        return null;
    }
}

function generateResponse(userMessage, training, phoneNumber) {
    const msg = userMessage.toLowerCase().trim();
    const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello'];
    if (greetings.some(g => msg === g || msg.startsWith(g + ' '))) {
        return training.greeting_message || 'Ola! Como posso ajudar?';
    }

    const faq = training.faq_data || [];
    for (const item of faq) {
        if (!item.question || !item.answer) continue;
        const words = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchCount = words.filter(word => msg.includes(word)).length;
        if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) return item.answer;
    }

    if (/preco|valor|custa|quanto|orcamento/i.test(msg)) {
        return (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito!';
    }
    if (/horario|hora|aberto|funciona/i.test(msg)) {
        return '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos!';
    }
    if (/servico|conserta|reparo|arruma/i.test(msg)) {
        return '🔧 ' + (training.services || 'Diversos servicos.') + '\n\nQual voce precisa?';
    }

    const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa'];
    if (escalationWords.some(word => msg.includes(word.toLowerCase()))) {
        if (phoneNumber) {
            supabase.from('conversations').upsert({ 
                phone_number: phoneNumber, status: 'human', updated_at: new Date().toISOString()
            }, { onConflict: 'phone_number' }).catch(() => {});
        }
        return '👨‍💼 Transferindo para atendente humano. Aguarde...';
    }

    return (training.fallback_message || 'Nao entendi. Posso ajudar com orcamentos, horarios e servicos.') + 
           '\n\nOu digite "atendente"!';
}

async function saveMessage(phone, content, direction, senderType, contactName = null) {
    try {
        let conversationId = null;
        const { data: existingConv } = await supabase
            .from('conversations').select('id').eq('phone_number', phone).single().catch(() => ({ data: null }));

        if (existingConv) {
            conversationId = existingConv.id;
            await supabase.from('conversations').update({
                contact_name: contactName || undefined,
                last_message: content,
                last_message_time: new Date().toISOString(),
                unread: direction === 'inbound',
                updated_at: new Date().toISOString()
            }).eq('id', conversationId).catch(() => {});
        } else {
            const { data: newConv } = await supabase.from('conversations').insert({
                phone_number: phone, contact_name: contactName, status: 'bot',
                last_message: content, last_message_time: new Date().toISOString(),
                unread: direction === 'inbound',
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            }).select().single().catch(() => ({ data: null }));
            conversationId = newConv?.id;
        }

        await supabase.from('messages').insert({
            conversation_id: conversationId, phone_number: phone,
            direction, content, sender_type: senderType,
            created_at: new Date().toISOString()
        }).catch(() => {});
    } catch (error) { console.error('Erro salvar mensagem:', error); }
}

async function sendWhatsAppMessage(to, text) {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return { simulated: true };
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Erro ${response.status}`);
    return data;
}

        
