import { createClient } from '@supabase/supabase-js';

// ✅ SEUS DADOS DO SUPABASE
const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTY4MjMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

// ⚠️ VARIÁVEIS DE AMBIENTE DO META (configure no Vercel)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
    // Verificação do webhook (Meta)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const challenge = req.query['hub.challenge'];
        
        if (mode === 'subscribe') {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    // Recebimento de mensagens
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
            const msgId = message.id;

            // 1. Buscar configuração atual do bot
            const { data: training, error: trainingError } = await supabase
                .from('bot_training')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (trainingError || !training) {
                console.error('Erro ao buscar treinamento:', trainingError);
                return res.status(200).send('OK');
            }

            // 2. Verificar se bot está ativo
            if (!training.active) {
                await saveMessage(from, text, 'inbound', 'human');
                return res.status(200).send('Bot desativado - aguardando humano');
            }

            // 3. Salvar mensagem do cliente
            await saveMessage(from, text, 'inbound', 'bot');

            // 4. Verificar se conversa está em modo humano
            const { data: conversation } = await supabase
                .from('conversations')
                .select('status')
                .eq('phone_number', from)
                .single();

            if (conversation?.status === 'human') {
                // Modo humano ativo - apenas salva, não responde
                return res.status(200).send('Modo humano ativo');
            }

            // 5. Gerar resposta do bot
            const botResponse = generateResponse(text, training);

            // 6. Enviar resposta pelo WhatsApp
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                await sendWhatsAppMessage(from, botResponse);
            } else {
                console.log('⚠️ Token do WhatsApp não configurado. Resposta simulada:', botResponse);
            }

            // 7. Salvar resposta do bot
            await saveMessage(from, botResponse, 'outbound', 'bot');

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

// Função principal de geração de resposta (MESMA LÓGICA DO TREINAMENTO)
function generateResponse(userMessage, training) {
    const msg = userMessage.toLowerCase().trim();
    
    // 1. Saudações
    const greetings = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae'];
    if (greetings.some(g => msg.includes(g))) {
        return training.greeting_message;
    }

    // 2. FAQ
    const faq = training.faq_data || [];
    for (const item of faq) {
        const questionWords = item.question.toLowerCase().split(' ');
        const matchCount = questionWords.filter(word => msg.includes(word)).length;
        if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
            return item.answer;
        }
    }

    // 3. Palavras-chave por categoria
    if (msg.includes('preço') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto')) {
        return `${training.pricing_info}\n\nPosso agendar um orçamento gratuito para você! Qual equipamento precisa de assistência?`;
    }

    if (msg.includes('horário') || msg.includes('hora') || msg.includes('aberto') || msg.includes('funciona') || msg.includes('atende')) {
        return `⏰ ${training.business_hours}\n\nEstamos prontos para te atender! 😊`;
    }

    if (msg.includes('serviço') || msg.includes('faz') || msg.includes('conserta') || msg.includes('concerta') || msg.includes('arruma') || msg.includes('troca')) {
        return `🔧 ${training.services}\n\nQual desses serviços você precisa? Posso te passar mais detalhes!`;
    }

    if (msg.includes('local') || msg.includes('endereço') || msg.includes('onde') || msg.includes('fica')) {
        return `📍 Nossa assistência fica em local de fácil acesso! Posso te enviar a localização ou você pode buscar no Google Maps por "${training.company_name}".\n\nPrefere atendimento delivery? Buscamos e entregamos seu aparelho! 🚚`;
    }

    if (msg.includes('garantia') || msg.includes('garante')) {
        return `✅ Todos os nossos serviços possuem garantia! O prazo varia conforme o tipo de reparo (geralmente 30 a 90 dias).\n\nA garantia cobre o mesmo defeito reparado. Quer saber mais sobre algum serviço específico?`;
    }

    if (msg.includes('prazo') || msg.includes('tempo') || msg.includes('demora') || msg.includes('rápido')) {
        return `⏱️ O prazo depende do defeito e da disponibilidade de peças:\n• Troca de tela: 30min a 2h\n• Formatação: 2-4h\n• Reparos complexos: 1-3 dias\n\nFazemos orçamento em até 24h! Qual equipamento você tem?`;
    }

    if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('quando') || msg.includes('posso ir')) {
        return `📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema/defeito?\n3️⃣ Qual dia e horário prefere?\n\nOu se preferir, posso transferir você para um atendente humano agora mesmo! 👨‍💼`;
    }

    // 4. Escalonamento para humano
    const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamação', 'problema grave', 'cancelar', 'chefe', 'gerente'];
    if (escalationWords.some(word => msg.includes(word))) {
        // Atualizar conversa para humano no banco
        supabase
            .from('conversations')
            .update({ status: 'human', updated_at: new Date().toISOString() })
            .eq('phone_number', from)
            .then(() => console.log('🔄 Conversa transferida para humano:', from))
            .catch(err => console.error('Erro ao transferir:', err));
        
        return `👨‍💼 Entendido! Vou transferir você para um atendente humano agora mesmo. Por favor, aguarde um momento... ⏳\n\n(Seu atendente já foi notificado e responderá em breve!)`;
    }

    // 5. Fallback
    return `${training.fallback_message}\n\nPosso te ajudar com:\n• 💰 Preços e orçamentos\n• ⏰ Horários de funcionamento\n• 🔧 Nossos serviços\n• 📅 Agendamentos\n• 📍 Localização\n\nOu digite "atendente" para falar com uma pessoa!`;
}

// Salvar mensagem no banco
async function saveMessage(phone, content, direction, senderType) {
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

// Enviar mensagem pelo WhatsApp (API do Meta)
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
