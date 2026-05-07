import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTY4MjMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // VERIFICAÇÃO META
    if (req.method === 'GET' && req.query['hub.mode']) {
        const mode = req.query['hub.mode'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe') return res.status(200).send(challenge);
        return res.status(403).send('Forbidden');
    }

    // API PAINEL - LISTAR
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
                etapa: conv.current_step || 1,
                ultimaAtividade: conv.last_message_time,
                ultima: conv.last_message || 'Sem mensagens',
                mensagens: []
            }));

            return res.status(200).json(conversas);
        } catch (error) {
            return res.status(500).json({ error: error.message, conversas: [] });
        }
    }

    // API PAINEL - MENSAGENS
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
            return res.status(500).json({ error: error.message, mensagens: [] });
        }
    }

    // AÇÕES DO PAINEL
    if (req.method === 'POST' && req.query.action) {
        const action = req.query.action;
        const body = req.body;
        const phone = body?.phone;

        if (action === 'intervene') {
            await supabase.from('conversations').update({ status: 'human', updated_at: new Date().toISOString() }).eq('phone_number', phone);
            await saveMessage(phone, '👨‍💼 Atendente humano assumiu o controle.', 'outbound', 'system');
            return res.status(200).json({ ok: true });
        }

        if (action === 'release') {
            await supabase.from('conversations').update({ status: 'bot', current_step: 1, updated_at: new Date().toISOString() }).eq('phone_number', phone);
            await saveMessage(phone, '🤖 Robo reassumiu o atendimento.', 'outbound', 'system');
            return res.status(200).json({ ok: true });
        }

        if (action === 'send') {
            const message = body?.message;
            if (!message) return res.status(400).json({ error: 'Message required' });
            await saveMessage(phone, message, 'outbound', 'human');
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) await sendWhatsAppMessage(phone, message);
            return res.status(200).json({ ok: true });
        }
    }

    // RECEBIMENTO WHATSAPP
    if (req.method === 'POST') {
        try {
            const body = req.body;
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            const message = value?.messages?.[0];

            if (!message || message.type !== 'text') {
                return res.status(200).send('OK');
            }

            const from = message.from;
            const text = message.text?.body || '';
            const contactName = value?.contacts?.[0]?.profile?.name || from;

            // Buscar treinamento
            const { data: training, error: trainingError } = await supabase
                .from('bot_training')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (trainingError || !training) {
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('OK');
            }

            if (!training.active) {
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('Bot desativado');
            }

            // Verificar modo humano
            const { data: conversation } = await supabase
                .from('conversations')
                .select('*')
                .eq('phone_number', from)
                .maybeSingle();

            if (conversation?.status === 'human') {
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('Modo humano');
            }

            // Salvar mensagem do cliente
            await saveMessage(from, text, 'inbound', 'bot', contactName);

            // ===== SISTEMA DE FLUXO COM MEMÓRIA =====
            const currentStep = conversation?.current_step || 1;
            const flowData = training.flow_data || [];
            const faqData = training.faq_data || [];
            const escalationWords = training.escalation_keywords || [];

            let botResponse = null;
            let nextStep = currentStep;
            const msg = text.toLowerCase().trim();

            // 1. VERIFICAR ESCALONAMENTO (qualquer etapa)
            if (escalationWords.some(word => msg.includes(word))) {
                await supabase.from('conversations').update({ status: 'human' }).eq('phone_number', from);
                botResponse = '👨‍💼 Entendido! Vou transferir voce para um atendente humano agora mesmo. Aguarde... ⏳';
                nextStep = 1;
            }

            // 2. VERIFICAR FAQ (qualquer etapa)
            if (!botResponse) {
                for (const item of faqData) {
                    const words = item.question.toLowerCase().split(' ').filter(w => w.length > 2);
                    const matchCount = words.filter(word => msg.includes(word)).length;
                    if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
                        botResponse = item.answer;
                        break;
                    }
                }
            }

            // 3. FLUXO POR ETAPA (o mais importante!)
            if (!botResponse && flowData.length > 0) {
                // Procurar regra que combine com a ETAPA ATUAL e a mensagem
                const matchingRules = flowData.filter(rule => {
                    if (rule.step !== currentStep) return false;
                    const conditions = rule.condition.toLowerCase().split(',').map(c => c.trim());
                    return conditions.some(condition => msg.includes(condition));
                });

                if (matchingRules.length > 0) {
                    const rule = matchingRules[0];
                    botResponse = rule.response.replace(/{company_name}/g, training.company_name || 'nossa empresa');
                    nextStep = rule.next_step;
                }
            }

            // 4. SAUDAÇÃO (Etapa 1, se não encontrou regra)
            if (!botResponse && currentStep === 1) {
                const greetings = ['oi', 'ola', 'ola', 'hey', 'bom dia', 'boa tarde', 'boa noite'];
                if (greetings.some(g => msg.includes(g))) {
                    botResponse = (training.greeting_message || 'Ola! Como posso ajudar?')
                        .replace(/{company_name}/g, training.company_name || 'nossa empresa');
                    nextStep = 2;
                }
            }

            // 5. FALLBACK (se não entendeu)
            if (!botResponse) {
                botResponse = (training.fallback_message || 'Nao entendi bem. Vamos comecar do inicio?')
                    .replace(/{company_name}/g, training.company_name || 'nossa empresa');
                nextStep = 1; // Volta ao inicio
            }

            // Atualizar etapa no banco
            await supabase
                .from('conversations')
                .update({ current_step: nextStep, updated_at: new Date().toISOString() })
                .eq('phone_number', from);

            // Enviar resposta
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                await sendWhatsAppMessage(from, botResponse);
            }

            // Salvar resposta do bot
            await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

            return res.status(200).json({ success: true, response: botResponse.substring(0, 50), step: nextStep });

        } catch (error) {
            console.error('❌ Erro:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).send('Method not allowed');
}

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

async function saveMessage(phone, content, direction, senderType, contactName = null) {
    try {
        let { data: conversation } = await supabase
            .from('conversations')
            .select('id')
            .eq('phone_number', phone)
            .maybeSingle();

        if (!conversation) {
            const { data: newConv, error } = await supabase
                .from('conversations')
                .insert({
                    phone_number: phone,
                    contact_name: contactName,
                    status: 'bot',
                    current_step: 1,
                    last_message: content,
                    last_message_time: new Date().toISOString(),
                    unread: true
                })
                .select()
                .single();
            
            if (error) throw error;
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

        await supabase.from('messages').insert({
            conversation_id: conversation.id,
            phone_number: phone,
            direction: direction,
            content: content,
            sender_type: senderType
        });

    } catch (error) {
        console.error('Erro salvar mensagem:', error);
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
            throw new Error(data.error?.message);
        }
        console.log('✅ Enviado:', data.messages?.[0]?.id);
        return data;
    } catch (error) {
        console.error('Erro enviar WhatsApp:', error);
        throw error;
    }
}
