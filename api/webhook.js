import { createClient } from '@supabase/supabase-js';

// ==========================================
// CONFIGURACAO DO SUPABASE
// ==========================================
const SUPABASE_URL = 'https://fwcljognwdutsagppxcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2xqb2dud2R1dHNhZ3BweGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjgyMzMsImV4cCI6MjA5MDQ3MjgyM30.6n8MejPbWRZlJnfZylrsK37_jwFha3FE7Xbj_Sn8VcE';

// VARIAVEIS DE AMBIENTE DO META (configure no Vercel)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// IMPORTANTE: Usar SERVICE ROLE KEY no servidor para bypassar RLS
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ==========================================
// CACHE INTELIGENTE
// ==========================================
let trainingCache = null;
let cacheTimestamp = 0;
let cacheUpdatedAt = null;
const CACHE_TTL = 5000; // 5 segundos

// ==========================================
// CONFIGURACAO PADRAO (FALLBACK)
// ==========================================
function getDefaultTraining() {
  return {
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
    active: true,
    updated_at: new Date().toISOString()
  };
}

// ==========================================
// HANDLER PRINCIPAL
// ==========================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ==========================================
    // POST SEM ACTION = DADOS DO PAINEL DE TREINAMENTO
    // ==========================================
    if (req.method === 'POST' && !req.query.action) {
        try {
            console.log('=== RECEBENDO CONFIG DO PAINEL ===');
            console.log('Body recebido:', JSON.stringify(req.body, null, 2));

            const data = req.body;
            
            if (!data || typeof data !== 'object') {
                return res.status(400).json({ error: 'Body invalido' });
            }

            // Montar objeto para salvar no Supabase
            const trainingData = {
                bot_name: data.bot_name || 'Assistente',
                company_name: data.company_name || 'Minha Empresa',
                greeting_message: data.greeting_message || 'Ola! Como posso ajudar?',
                personality: data.personality || '',
                services: data.services || '',
                business_hours: data.business_hours || '',
                pricing_info: data.pricing_info || '',
                fallback_message: data.fallback_message || '',
                faq_data: data.faq_data || [],
                escalation_keywords: data.escalation_keywords || [],
                active: data.active !== false,
                updated_at: new Date().toISOString()
            };

            console.log('Salvando no Supabase:', trainingData);

            // Verificar se ja existe registro
            const { data: existing } = await supabase
                .from('bot_training')
                .select('id')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            let result;
            
            if (existing) {
                // Atualizar registro existente
                console.log('Atualizando registro existente ID:', existing.id);
                result = await supabase
                    .from('bot_training')
                    .update(trainingData)
                    .eq('id', existing.id)
                    .select()
                    .single();
            } else {
                // Criar novo registro
                console.log('Criando novo registro');
                result = await supabase
                    .from('bot_training')
                    .insert(trainingData)
                    .select()
                    .single();
            }

            if (result.error) {
                console.error('Erro Supabase:', result.error);
                return res.status(500).json({ 
                    error: 'Erro ao salvar no Supabase', 
                    details: result.error.message 
                });
            }

            // Limpar cache para forcar recarregamento
            trainingCache = null;
            cacheTimestamp = 0;
            cacheUpdatedAt = null;

            console.log('✓ Configuracao salva com sucesso!');
            console.log('Greeting nova:', trainingData.greeting_message);

            return res.status(200).json({
                success: true,
                message: 'Configuracao recebida e salva',
                greeting: trainingData.greeting_message,
                id: result.data?.id
            });

        } catch (error) {
            console.error('Erro ao processar POST do painel:', error);
            return res.status(500).json({ 
                error: error.message,
                stack: error.stack 
            });
        }
    }

    // ==========================================
    // GET - Verificacao Meta e acoes do painel
    // ==========================================
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
            } catch (error) {
                return res.status(500).json({ error: error.message });
            }
        }

        if (action === 'clearcache') {
            trainingCache = null;
            cacheTimestamp = 0;
            cacheUpdatedAt = null;
            console.log('Cache LIMPO pelo painel');
            return res.status(200).json({ ok: true, message: 'Cache limpo', timestamp: new Date().toISOString() });
        }

        return res.status(400).json({ error: 'Invalid action' });
    }

    // ==========================================
    // POST COM ACTION - Acoes do painel (intervene, release, send)
    // ==========================================
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

    // ==========================================
    // POST - Recebimento de mensagens do WhatsApp
    // ==========================================
    if (req.method === 'POST') {
        try {
            const body = req.body;
            console.log('Webhook recebido:', JSON.stringify(body, null, 2));

            if (!body.object || body.object !== 'whatsapp_business_account') {
                return res.status(200).send('OK');
            }

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

            console.log(`Mensagem de ${from}: ${text}`);

            // BUSCAR TREINAMENTO - com fallback automatico
            let training = await getLatestTraining();

            // Se nao encontrou no Supabase, usar padrao e tentar criar
            if (!training) {
                console.log('Treinamento nao encontrado no Supabase, usando padrao...');
                training = getDefaultTraining();
                await createDefaultTrainingIfNotExists();
            }

            // Verificar se bot esta ativo
            if (training.active === false) {
                console.log('Bot desativado pelo painel');
                await saveMessage(from, text, 'inbound', 'human', contactName);
                return res.status(200).send('Bot desativado');
            }

            // Salvar mensagem do cliente
            await saveMessage(from, text, 'inbound', 'bot', contactName);

            // Verificar modo humano
            let conversationStatus = 'bot';
            try {
                const { data: conversation } = await supabase
                    .from('conversations').select('status').eq('phone_number', from).single();
                if (conversation) conversationStatus = conversation.status;
            } catch (e) {}

            if (conversationStatus === 'human') {
                console.log('Modo humano ativo');
                return res.status(200).send('Modo humano');
            }

            // Gerar resposta
            const botResponse = generateResponse(text, training, from);
            console.log('Resposta gerada:', botResponse);

            // Enviar pelo WhatsApp
            let whatsappSent = false;
            if (WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
                try {
                    await sendWhatsAppMessage(from, botResponse);
                    whatsappSent = true;
                    console.log('Mensagem enviada para WhatsApp');
                } catch (waError) {
                    console.error('Erro WhatsApp API:', waError.message);
                }
            } else {
                console.log('Token WhatsApp nao configurado');
            }

            // Salvar resposta do bot
            await saveMessage(from, botResponse, 'outbound', 'bot', contactName);

            return res.status(200).json({ success: true, response: botResponse, whatsappSent });

        } catch (error) {
            console.error('Erro critico no webhook:', error);
            return res.status(200).json({ error: error.message, handled: true });
        }
    }

    return res.status(405).send('Method not allowed');
}

// ==========================================
// BUSCAR TREINAMENTO COM FALLBACK
// ==========================================
async function getLatestTraining() {
    const now = Date.now();

    if (trainingCache && (now - cacheTimestamp) < CACHE_TTL) {
        console.log('Usando cache do treinamento');
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
            console.error('Erro ao buscar treinamento:', error.message, 'Codigo:', error.code);
            if (error.code === 'PGRST116') {
                console.log('Nenhum treinamento encontrado no Supabase');
                return null;
            }
            if (trainingCache) return trainingCache;
            return null;
        }

        if (data) {
            if (cacheUpdatedAt && data.updated_at && new Date(data.updated_at) <= new Date(cacheUpdatedAt)) {
                cacheTimestamp = now;
                return trainingCache;
            }
            trainingCache = data;
            cacheTimestamp = now;
            cacheUpdatedAt = data.updated_at;
            console.log('Treinamento carregado do Supabase:', data.bot_name, 'FAQ:', (data.faq_data || []).length);
            return data;
        }
        return null;
    } catch (e) {
        console.error('Excecao ao buscar treinamento:', e.message);
        if (trainingCache) return trainingCache;
        return null;
    }
}

// ==========================================
// CRIAR TREINAMENTO PADRAO SE NAO EXISTIR
// ==========================================
async function createDefaultTrainingIfNotExists() {
    try {
        const defaultTraining = getDefaultTraining();
        const { data, error } = await supabase
            .from('bot_training')
            .insert(defaultTraining)
            .select()
            .single();

        if (error) {
            console.log('Nao foi possivel criar padrao no Supabase:', error.message);
            return false;
        }

        console.log('Treinamento padrao criado no Supabase com ID:', data.id);
        trainingCache = data;
        cacheTimestamp = Date.now();
        cacheUpdatedAt = data.updated_at;
        return true;
    } catch (e) {
        console.error('Erro ao criar padrao:', e.message);
        return false;
    }
}

// ==========================================
// GERAR RESPOSTA DO BOT
// ==========================================
function generateResponse(userMessage, training, phoneNumber) {
    const msg = userMessage.toLowerCase().trim();

    // 1. Saudacoes
    const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hi', 'hello', 'eai', 'eae'];
    if (greetings.some(g => msg === g || msg.startsWith(g + ' ') || msg.endsWith(' ' + g))) {
        return training.greeting_message || 'Ola! Como posso ajudar?';
    }

    // 2. FAQ Inteligente
    const faq = training.faq_data || [];
    for (const item of faq) {
        if (!item.question || !item.answer) continue;
        const questionWords = item.question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchCount = questionWords.filter(word => msg.includes(word)).length;
        if (matchCount >= 2 || msg.includes(item.question.toLowerCase())) {
            return item.answer;
        }
    }

    // 3. Palavras-chave por categoria
    if (/preco|preco|valor|custa|quanto|cobrar|custo|orcamento|orcamento/i.test(msg)) {
        return (training.pricing_info || 'Entre em contato para orcamento.') + '\n\nPosso agendar um orcamento gratuito para voce! Qual equipamento precisa de assistencia?';
    }

    if (/horario|hora|horario|aberto|funciona|atende|abre|fecha/i.test(msg)) {
        return '⏰ ' + (training.business_hours || 'Horario comercial') + '\n\nEstamos prontos para te atender! 😊';
    }

    if (/servico|servico|servicos|faz|conserta|concerta|arruma|troca|reparo|reparar/i.test(msg)) {
        return '🔧 ' + (training.services || 'Oferecemos diversos servicos.') + '\n\nQual desses servicos voce precisa? Posso te passar mais detalhes!';
    }

    if (/local|endereco|endereco|onde|fica|chegar|maps/i.test(msg)) {
        return '📍 Nossa assistencia fica em local de facil acesso! Voce pode buscar no Google Maps por "' + (training.company_name || 'nossa empresa') + '".';
    }

    if (/garantia|garante|garantir/i.test(msg)) {
        return '✅ Todos os nossos servicos possuem garantia! O prazo varia conforme o tipo de reparo (geralmente 30 a 90 dias).\n\nA garantia cobre o mesmo defeito reparado. Quer saber mais sobre algum servico especifico?';
    }

    if (/prazo|tempo|demora|rapido|demorar|urgente/i.test(msg)) {
        return '⏱️ O prazo depende do defeito e da disponibilidade de pecas.\n\nFazemos orcamento em ate 24h! Qual equipamento voce tem?';
    }

    if (/agendar|marcar|quando|posso ir|visita|agendamento/i.test(msg)) {
        return '📅 Perfeito! Para agendar, preciso saber:\n1️⃣ Qual equipamento?\n2️⃣ Qual o problema/defeito?\n3️⃣ Qual dia e horario prefere?\n\nOu se preferir, posso transferir voce para um atendente humano agora mesmo! 👨‍💼';
    }

    // 4. Escalonamento para humano
    const escalationWords = training.escalation_keywords || ['atendente', 'humano', 'pessoa', 'reclamacao', 'problema grave', 'cancelar', 'chefe', 'gerente', 'supervisor'];
    if (escalationWords.some(word => msg.includes(word.toLowerCase()))) {
        if (phoneNumber) {
            supabase.from('conversations').upsert({ 
                phone_number: phoneNumber, status: 'human', updated_at: new Date().toISOString(), contact_name: 'Cliente'
            }, { onConflict: 'phone_number' }).then(() => console.log('Conversa transferida para humano:', phoneNumber)).catch(() => {});
        }
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

// ==========================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ==========================================
async function sendWhatsAppMessage(to, text) {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
        console.log('WhatsApp nao configurado');
        return { simulated: true };
    }
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
