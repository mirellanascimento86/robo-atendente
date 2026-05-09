import { createClient } from '@supabase/supabase-js';

// ✅ SEUS DADOS DO SUPABASE
const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

// ⚠️ VARIAVEIS DE AMBIENTE DO META (configure no Vercel)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Usar service role key no servidor para bypassar RLS
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Cache simples com TTL de 30 segundos para não sobrecarregar o Supabase
let trainingCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 segundos

export default async function handler(req, res) {
    // ==========================================
    // CORS & HEADERS
    // ==========================================
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ==========================================
    // VERIFICACAO DO WEBHOOK (Meta) - GET
    // ==========================================
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const challenge = req.query['hub.challenge'];
        const verifyToken = req.query['hub.verify_token'];
        
        console.log('🔍 Webhook verification:', { mode, verifyToken });
        
        if (mode === 'subscribe') {
            console.log('✅ Webhook verificado pelo Meta');
            return res.status(200).send(challenge);
        }
        
        // API do Painel de Intervencao
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
        
        return res.status(400).json({ error: 'Invalid action' });
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
                    .upsert({ 
                        phone_number: phone, 
                        status: 'human', 
                        updated_at: new Date().toISOString() 
                    }, { onConflict: 'phone_number' });

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
                    .upsert({ 
                        phone_number: phone, 
                        status: 'bot', 
                        updated_at: new Date().toISOString() 
                    }, { onConflict: 'phone_number' });

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
    // RECEBIMENTO DE MENSAGENS DO WHATSAPP (POST)
    // ==========================================
    if (req.method === 'POST') {
        try {
            const body = req.body;
            console.log('📩 Webhook recebido:', JSON.stringify(body, null, 2));

            // Verificar se é um evento valido do WhatsApp
            if (!body.object || body.object !== 'whatsapp_business_account') {
                return res.status(200).send('OK - Not WhatsApp event');
            }

            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            const message = value?.messages?.[0];

            // Se nao for mensagem de texto, apenas confirmar recebimento
            if (!message || message.type !== 'text') {
                console.log('📭 Evento nao-texto ignorado');
                return res.status(200).send('OK');
            }

            const from = message.from;
            const text = message.text?.body || '';
            const contactName = value?.contacts?.[0]?.profile?.name || from;
            const messageId = message.id;

            console.log(`💬 Mensagem de ${from} (${contactName}): ${text}`);

            // 🔄 BUSCAR CONFIGURACAO ATUALIZADA DO BOT (COM CACHE INTELIGENTE)
            const training = await getLatestTraining();
            
            if (!training) {
                console.error('❌ Nenhuma configuração de treinamento encontrada');
                return res.status(500).json({ error: 'Configuração não encontrada' });
            }

            // Se nao conseguiu buscar do Supabase, usar configuracao padrao
            if (!training) {
                console.warn('⚠️ Sem treinamento no Supabase, usando padrao');
                training = getDefaultTraining();
            }

            // 2. Verificar se bot esta ativo
            if (training.active === false) {
                console.log('🔴 Bot desativado');
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('Bot desativado');
            }

            // 3. Salvar mensagem do cliente
            await saveMessage(from, text, 'inbound', 'bot', contactName);

            // 4. Verificar se conversa esta em modo humano
            let conversationStatus = 'bot';
            try {
                const { data: conversation } = await supabase
                    .from('conversations')
                    .select('status')
                    .eq('phone_number', from)
                    .single();
                
                if (conversation) {
                    conversationStatus = conversation.status;
                }
            } catch (e) {
                console.log('ℹ️ Conversa nao existe ainda, criando...');
            }

            if (conversationStatus === 'human') {
                console.log('👨‍💼 Modo humano ativo, nao respondendo');
                return res.status(200).send('Modo humano ativo');
            }

            // 5. Gerar resposta do bot baseada no treinamento ATUALIZADO
            const botResponse = await generateResponse(text, training, from);
            console.log('🤖 Resposta gerada:', botResponse);

            // 6. Enviar resposta pelo WhatsApp
            let whatsappSent = false;
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                try {
                    await sendWhatsAppMessage(from, botResponse);
                    whatsappSent = true;
                } catch (waError) {
                    console.error('❌ Erro WhatsApp API:', waError);
                }
            } else {
                console.log('⚠️ Token WhatsApp nao configurado');
            }

            // 7. Salvar resposta do bot no banco
            await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

            return res.status(200).json({ 
                success: true, 
                response: botResponse,
                phone: from,
                whatsappSent,
                messageId
            });

        } catch (error) {
            console.error('❌ Erro no webhook:', error);
            return res.status(500).json({ error: error.message, stack: error.stack });
        }
    }

    return res.status(405).send('Method not allowed');
}

// ==========================================
// BUSCAR TREINAMENTO MAIS RECENTE DO SUPABASE
// ==========================================
async function getLatestTraining() {
    const now = Date.now();
    
    // Se cache ainda válido (menos de 30s), usar cache
    if (trainingCache && (now - cacheTimestamp) < CACHE_TTL) {
        console.log('📦 Usando cache do treinamento (TTL ativo)');
        return trainingCache;
    }
    
    try {
        // Buscar SEMPRE o registro mais recente (ordena por updated_at desc)
        const { data, error } = await supabase
            .from('bot_training')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();
        
        if (error) {
            console.error('❌ Erro ao buscar treinamento:', error);
            // Se erro, tentar usar cache antigo mesmo expirado
            if (trainingCache) {
                console.log('⚠️ Usando cache expirado devido a erro');
                return trainingCache;
            }
            return null;
        }
        
        if (data) {
            trainingCache = data;
            cacheTimestamp = now;
            console.log('✅ Treinamento atualizado do Supabase:', data.bot_name, '| Ativo:', data.active);
            return data;
        }
        
        return null;
    } catch (e) {
        console.error('❌ Exceção ao buscar treinamento:', e);
        // Fallback para cache expirado
        if (trainingCache) {
            console.log('⚠️ Usando cache expirado devido a exceção');
            return trainingCache;
        }
        return null;
    }
}

// ==========================================
// LIMPAR CACHE (chamar quando painel salvar)
// ==========================================
async function clearTrainingCache() {
    trainingCache = null;
    cacheTimestamp = 0;
    console.log('🧹 Cache de treinamento limpo');
}

// ==========================================
// CONFIGURACAO PADRAO (quando Supabase falha)
// ==========================================
function getDefaultTraining() {
    return {
        bot_name: 'Assistente',
        company_name: 'Minha Empresa',
        greeting_message: 'Ola! Seja bem-vindo(a). Como posso ajuda-lo(a) hoje?',
        personality: 'Seja cordial, elegante e objetivo.',
        services: 'Conserto de celulares, notebooks, tablets e acessórios.',
        business_hours: 'Seg-Sex: 9h as 18h | Sab: 9h as 13h',
        pricing_info: 'Realizamos orçamento gratuito e sem compromisso.',
        fallback_message: 'Nao compreendi bem. Posso te ajudar com orçamentos, horarios, serviços e agendamentos.',
        faq_data: [],
        escalation_keywords: ['atendente', 'humano', 'pessoa', 'reclamacao', 'cancelar', 'chefe', 'gerente', 'supervisor'],
        active: true
    };
}

// ==========================================
// FUNCAO PRINCIPAL DE GERACAO DE RESPOSTA (ASYNC)
// ==========================================
async function generateResponse(userMessage, training, phoneNumber) {
    const msg = userMessage.toLowerCase().trim();
    
    // 1. Saudacoes
    const greetings = ['oi', 'ola', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae', 'ola!', 'oi!'];
    if (greetings.some(g => msg.includes(g))) {
        return training.greeting_message || 'Ola! Como posso ajudar?';
    }

    // 2. FAQ Inteligente
    const faq = training.faq_data || [];
    for (const item of faq) {
        const questionWords = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchCount = questionWords.filter(word => msg.includes(word)).length;
        if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
            return item.answer;
        }
    }

    // 3. Palavras-chave por categoria
    if (/preço|preco|valor|custa|quanto|cobrar|custo|orçamento|orcamento/i.test(msg)) {
        return (training.pricing_info || 'Entre em contato para orçamento.') + '\n\nPosso agendar um orçamento gratuito para voce! Qual equipamento precisa de assistencia?';
    }

    if (/horario|hora|horário|aberto|funciona|atende|abre|fecha/i.test(msg)) {
        return '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos para te atender! 😊';
    }

    if (/serviço|servico|servicos|faz|conserta|concerta|arruma|troca|reparo|reparar/i.test(msg)) {
        return '🔧 ' + (training.services || 'Oferecemos diversos servicos.') + '\n\nQual desses servicos voce precisa? Posso te passar mais detalhes!';
    }

    if (/local|endereço|endereco|onde|fica|chegar|maps/i.test(msg)) {
        return '📍 Nossa assistencia fica em local de facil acesso! Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".';
    }

    if (/garantia|garante|garantir/i.test(msg)) {
        return '✅ Todos os nossos servicos possuem garantia! O prazo varia conforme o tipo de reparo (geralmente 30 a 90 dias).\n\nA garantia cobre o mesmo defeito reparado. Quer saber mais sobre algum servico especifico?';
    }

    if (/prazo|tempo|demora|rapido|demorar|urgente/i.test(msg)) {
        return '⏱️ O prazo depende do defeito e da disponibilidade de pecas.\n\nFazemos orçamento em ate 24h! Qual equipamento voce tem?';
    }

    if (/agendar|marcar|quando|posso ir|visita|agendamento/i.test(msg)) {
        return '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema/defeito?\n3️⃣ Qual dia e horario prefere?\n\nOu se preferir, posso transferir voce para um atendente humano agora mesmo! 👨‍💼';
    }

    // 4. Escalonamento para humano
    const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor'];
    if (escalationWords.some(word => msg.includes(word.toLowerCase()))) {
        // Transferir para humano (async, nao bloquear resposta)
        if (phoneNumber) {
            supabase
                .from('conversations')
                .upsert({ 
                    phone_number: phoneNumber, 
                    status: 'human', 
                    updated_at: new Date().toISOString(),
                    contact_name: 'Cliente'
                }, { onConflict: 'phone_number' })
                .then(() => console.log('🔄 Conversa transferida para humano:', phoneNumber))
                .catch(err => console.error('Erro ao transferir:', err));
        }
        
        return '👨‍💼 Entendido! Vou transferir voce para um atendente humano agora mesmo. Por favor, aguarde um momento... ⏳\n\n(Seu atendente ja foi notificado e respondera em breve!)';
    }

    // 5. Fallback
    return (training.fallback_message || 'Nao entendi bem. Posso te ajudar com orçamentos, horarios, servicos e agendamentos.') + '\n\nOu digite "atendente" para falar com uma pessoa!';
}

// ==========================================
// SALVAR MENSAGEM NO BANCO
// ==========================================
async function saveMessage(phone, content, direction, senderType, contactName = null) {
    try {
        // Buscar ou criar conversa
        let conversationId = null;
        
        try {
            const { data: existingConv } = await supabase
                .from('conversations')
                .select('id')
                .eq('phone_number', phone)
                .single();
            
            if (existingConv) {
                conversationId = existingConv.id;
                // Atualizar conversa existente
                await supabase
                    .from('conversations')
                    .update({
                        contact_name: contactName || undefined,
                        last_message: content,
                        last_message_time: new Date().toISOString(),
                        unread: direction === 'inbound',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', conversationId);
            }
        } catch (e) {
            // Conversa nao existe, criar
        }
        
        if (!conversationId) {
            const { data: newConv, error: convError } = await supabase
                .from('conversations')
                .insert({
                    phone_number: phone,
                    contact_name: contactName,
                    status: 'bot',
                    last_message: content,
                    last_message_time: new Date().toISOString(),
                    unread: direction === 'inbound',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (convError) {
                console.error('Erro criar conversa:', convError);
                return;
            }
            conversationId = newConv?.id;
        }

        // Inserir mensagem
        const { error: msgError } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            phone_number: phone,
            direction: direction,
            content: content,
            sender_type: senderType,
            created_at: new Date().toISOString()
        });

        if (msgError) {
            console.error('Erro salvar mensagem:', msgError);
        } else {
            console.log('💾 Mensagem salva:', direction, phone);
        }

    } catch (error) {
        console.error('❌ Erro ao salvar mensagem:', error);
    }
}

// ==========================================
// ENVIAR MENSAGEM PELO WHATSAPP (API META)
// ==========================================
async function sendWhatsAppMessage(to, text) {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
        console.log('⚠️ WhatsApp nao configurado. Mensagem nao enviada.');
        return { simulated: true };
    }
    
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

        console.log('✅ Mensagem enviada para', to);
        return data;

    } catch (error) {
        console.error('❌ Erro ao enviar WhatsApp:', error);
        throw error;
    }
}
