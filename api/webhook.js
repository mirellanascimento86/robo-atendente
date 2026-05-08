import { createClient } from '@supabase/supabase-js';

// ✅ SEUS DADOS DO SUPABASE
const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTY4MjMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

// ⚠️ VARIAVEIS DE AMBIENTE DO META (configure no Vercel)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
    // ==========================================
    // VERIFICACAO DO WEBHOOK (Meta)
    // ==========================================
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const challenge = req.query['hub.challenge'];
        
        if (mode === 'subscribe') {
            console.log('✅ Webhook verificado pelo Meta');
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    // ==========================================
    // API DO PAINEL DE INTERVENCAO (GET)
    // ==========================================
    if (req.method === 'GET' && req.query.action) {
        const action = req.query.action;
        
        // LISTAR CONVERSAS
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
                console.error('❌ Erro listar:', error);
                return res.status(500).json({ error: error.message });
            }
        }

        // BUSCAR MENSAGENS DE UMA CONVERSA
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
                console.error('❌ Erro mensagens:', error);
                return res.status(500).json({ error: error.message });
            }
        }
    }

    // ==========================================
    // ACOES DO PAINEL (POST)
    // ==========================================
    if (req.method === 'POST' && req.query.action) {
        const action = req.query.action;
        const body = req.body;
        const phone = body.phone;

        // ASSUMIR CONTROLE (Intervencao Humana)
        if (action === 'intervene') {
            try {
                await supabase
                    .from('conversations')
                    .update({ status: 'human', updated_at: new Date().toISOString() })
                    .eq('phone_number', phone);

                await saveMessage(phone, '👨‍💼 Atendente humano assumiu o controle da conversa.', 'outbound', 'system');

                return res.status(200).json({ ok: true, message: 'Intervencao ativada' });
            } catch (error) {
                return res.status(500).json({ error: error.message });
            }
        }

        // LIBERAR ROBO
        if (action === 'release') {
            try {
                await supabase
                    .from('conversations')
                    .update({ status: 'bot', updated_at: new Date().toISOString() })
                    .eq('phone_number', phone);

                await saveMessage(phone, '🤖 Robo reassumiu o atendimento.', 'outbound', 'system');

                return res.status(200).json({ ok: true, message: 'Robo liberado' });
            } catch (error) {
                return res.status(500).json({ error: error.message });
            }
        }

        // ENVIAR MENSAGEM PELO PAINEL
        if (action === 'send') {
            try {
                const message = body.message;
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

    // ==========================================
    // RECEBIMENTO DE MENSAGENS DO WHATSAPP
    // ==========================================
    if (req.method === 'POST') {
        try {
            const body = req.body;
            console.log('📩 Webhook recebido:', JSON.stringify(body));

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

            // 1. Buscar configuracao atual do bot no Supabase
            const { data: training, error: trainingError } = await supabase
                .from('bot_training')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (trainingError || !training) {
                console.error('Erro ao buscar treinamento:', trainingError);
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('OK - Sem treinamento');
            }

            // 2. Verificar se bot esta ativo
            if (!training.active) {
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('Bot desativado');
            }

            // 3. Salvar mensagem do cliente
            await saveMessage(from, text, 'inbound', 'bot', contactName);

            // 4. Verificar se conversa esta em modo humano
            const { data: conversation } = await supabase
                .from('conversations')
                .select('status')
                .eq('phone_number', from)
                .single();

            if (conversation?.status === 'human') {
                return res.status(200).send('Modo humano ativo');
            }

            // 5. Gerar resposta do bot baseada no treinamento
            const botResponse = generateResponse(text, training);

            // 6. Enviar resposta pelo WhatsApp
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                await sendWhatsAppMessage(from, botResponse);
            } else {
                console.log('⚠️ Token nao configurado. Resposta simulada:', botResponse);
            }

            // 7. Salvar resposta do bot
            await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

            return res.status(200).json({ 
                success: true, 
                response: botResponse,
                phone: from 
            });

        } catch (error) {
            console.error('❌ Erro no webhook:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).send('Method not allowed');
}

// ==========================================
// FUNCAO PRINCIPAL DE GERACAO DE RESPOSTA
// ==========================================
function generateResponse(userMessage, training) {
    const msg = userMessage.toLowerCase().trim();
    
    // 1. Saudacoes
    const greetings = ['oi', 'ola', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae', 'ola!', 'oi!'];
    if (greetings.some(g => msg.includes(g))) {
        return training.greeting_message || 'Ola! Como posso ajudar?';
    }

    // 2. FAQ Inteligente
    const faq = training.faq_data || [];
    for (const item of faq) {
        const questionWords = item.question.toLowerCase().split(' ').filter(w => w.length > 2);
        const matchCount = questionWords.filter(word => msg.includes(word)).length;
        if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
            return item.answer;
        }
    }

    // 3. Palavras-chave por categoria
    if (msg.includes('preco') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto') || msg.includes('cobrar')) {
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

    // 4. Escalonamento para humano
    const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor'];
    if (escalationWords.some(word => msg.includes(word))) {
        // Transferir para humano
        supabase
            .from('conversations')
            .update({ status: 'human', updated_at: new Date().toISOString() })
            .eq('phone_number', from)
            .then(() => console.log('🔄 Conversa transferida para humano'))
            .catch(err => console.error('Erro ao transferir:', err));
        
        return '👨‍💼 Entendido! Vou transferir voce para um atendente humano agora mesmo. Por favor, aguarde um momento... ⏳\n\n(Seu atendente ja foi notificado e respondera em breve!)';
    }

    // 5. Fallback
    return (training.fallback_message || 'Nao entendi bem. Posso te ajudar com orcamentos, horarios, servicos e agendamentos.') + '\n\nOu digite "atendente" para falar com uma pessoa!';
}

// ==========================================
// SALVAR MENSAGEM NO BANCO
// ==========================================
async function saveMessage(phone, content, direction, senderType, contactName = null) {
    try {
        // Buscar ou criar conversa
        let { data: conversation } = await supabase
            .from('conversations')
            .select('id')
            .eq('phone_number', phone)
            .single();

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
            
            if (convError) throw convError;
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

        if (msgError) throw msgError;

    } catch (error) {
        console.error('❌ Erro ao salvar mensagem:', error);
    }
}

// ==========================================
// ENVIAR MENSAGEM PELO WHATSAPP (API META)
// ==========================================
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

        console.log('✅ Mensagem enviada:', data);
        return data;

    } catch (error) {
        console.error('❌ Erro ao enviar WhatsApp:', error);
        throw error;
    }
}
