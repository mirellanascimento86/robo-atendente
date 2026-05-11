// ==========================================
// WEBHOOK WHATSAPP PRO - Vercel Serverless
// ==========================================
// Este arquivo deve estar em: api/webhook.js
// ==========================================

import { createClient } from '@supabase/supabase-js';

// ==========================================
// CONFIGURAÇÃO
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const TELEGRAM_ATENDENTE_ID = process.env.TELEGRAM_ATENDENTE_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// FUNÇÃO PRINCIPAL - HANDLER VERCEL
// ==========================================
export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET - Verificação do webhook Meta
        if (req.method === 'GET') {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];

            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('✅ Webhook verificado pelo Meta');
                return res.status(200).send(challenge);
            }
            return res.status(403).send('Falha na verificação');
        }

        // POST - Receber mensagens e ações do painel
        if (req.method === 'POST') {
            const action = req.query.action;

            // Ações do painel de intervenção
            if (action === 'list') {
                return await listConversations(req, res);
            }
            if (action === 'messages') {
                return await getMessages(req, res);
            }
            if (action === 'intervene') {
                return await intervene(req, res);
            }
            if (action === 'release') {
                return await releaseControl(req, res);
            }
            if (action === 'send') {
                return await sendFromPanel(req, res);
            }

            // Webhook do WhatsApp (mensagens recebidas)
            return await receiveWhatsAppMessage(req, res);
        }

        return res.status(405).json({ error: 'Método não permitido' });
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        return res.status(500).json({ error: error.message });
    }
}

// ==========================================
// RECEBER MENSAGEM DO WHATSAPP
// ==========================================
async function receiveWhatsAppMessage(req, res) {
    const body = req.body;

    if (!body.entry || !body.entry[0].changes) {
        return res.status(200).send('OK');
    }

    const changes = body.entry[0].changes[0];
    const value = changes.value;

    if (!value.messages || value.messages.length === 0) {
        return res.status(200).send('OK');
    }

    const message = value.messages[0];
    const from = message.from;
    const text = message.text?.body || '';
    const name = value.contacts?.[0]?.profile?.name || 'Cliente';

    console.log(`📩 Mensagem de ${from}: ${text}`);

    // Salvar mensagem no banco
    await saveMessage(from, 'cliente', text, { nome: name });

    // Verificar se está em intervenção humana
    const conversa = await getOrCreateConversation(from, name);

    if (conversa.em_intervencao) {
        // Notificar Telegram que cliente enviou mensagem enquanto humano está no controle
        await notifyTelegram(
            `💬 <b>Nova mensagem do cliente</b>\n` +
            `👤 ${name} (${from})\n` +
            `📝 ${text}\n` +
            `⚠️ Cliente está no painel de intervenção`
        );
        return res.status(200).send('OK');
    }

    // Verificar palavras-chave para humano
    const palavrasChave = await getPalavrasChaveHumano();
    const querHumano = palavrasChave.some(p => 
        text.toLowerCase().includes(p.toLowerCase())
    );

    if (querHumano) {
        await updateConversation(from, { em_intervencao: true, etapa: 'humano' });
        await sendWhatsAppMessage(from, await getTreinamento('aviso_humano'));
        await notifyTelegram(
            `🚨 <b>Cliente solicitou atendimento humano!</b>\n` +
            `👤 ${name} (${from})\n` +
            `📝 ${text}\n` +
            `🔗 Acesse o painel de intervenção`
        );
        return res.status(200).send('OK');
    }

    // Processar fluxo do bot
    await processarFluxo(from, text, conversa, name);

    return res.status(200).send('OK');
}

// ==========================================
// FLUXO DO BOT - LÓGICA COMPLETA
// ==========================================
async function processarFluxo(phone, text, conversa, name) {
    const etapa = conversa.etapa || 'saudacao';
    const msgLower = text.toLowerCase().trim();

    // Respostas de sim/não
    const respostasSim = ['sim', 'yes', 's', 'ok', 'pode ser', 'claro', 'confirmo', 'quero'];
    const respostasNao = ['não', 'nao', 'no', 'n', 'não quero', 'desisto', 'cancela'];
    const isSim = respostasSim.some(r => msgLower.includes(r));
    const isNao = respostasNao.some(r => msgLower.includes(r));

    switch (etapa) {
        case 'saudacao':
            // Primeira mensagem ou reset - saudação e pergunta equipamento
            await sendWhatsAppMessage(phone, await getTreinamento('saudacao'));
            await updateConversation(phone, { etapa: 'aguardando_equipamento' });
            break;

        case 'aguardando_equipamento':
            // Cliente respondeu com equipamento e marca
            // Salvar informações
            await updateConversation(phone, { 
                equipamento: text,
                etapa: 'aguardando_horario' 
            });

            // Calcular horário (2h a partir de agora)
            const agora = new Date();
            agora.setHours(agora.getHours() + 2);
            const horarioStr = agora.toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });

            const msgHorario = (await getTreinamento('pergunta_horario')).replace('{horario}', horarioStr);
            await sendWhatsAppMessage(phone, msgHorario);
            await updateConversation(phone, { 
                horario_visita: agora.toISOString(),
                etapa: 'confirmando_horario' 
            });
            break;

        case 'confirmando_horario':
            if (isSim) {
                await sendWhatsAppMessage(phone, await getTreinamento('pergunta_bairro'));
                await updateConversation(phone, { etapa: 'aguardando_bairro' });
            } else if (isNao) {
                await sendWhatsAppMessage(phone, 'Sem problemas. Qual horário seria melhor para você?');
                await updateConversation(phone, { etapa: 'aguardando_novo_horario' });
            } else {
                await sendWhatsAppMessage(phone, 'Por favor, responda com "sim" para confirmar o horário ou informe outro horário preferido.');
            }
            break;

        case 'aguardando_novo_horario':
            // Cliente informou novo horário
            await sendWhatsAppMessage(phone, await getTreinamento('pergunta_bairro'));
            await updateConversation(phone, { 
                horario_visita: text,
                etapa: 'aguardando_bairro' 
            });
            break;

        case 'aguardando_bairro':
            // Identificar bairro e região
            const bairroInfo = await identificarBairro(text);

            await updateConversation(phone, { 
                bairro: bairroInfo.bairro,
                etapa: 'confirmando_preco' 
            });

            if (!bairroInfo.atende) {
                // Não atende a região
                await sendWhatsAppMessage(phone, await getTreinamento('nao_atende'));
                await updateConversation(phone, { etapa: 'nao_atende' });

                // Notificar Telegram
                await notifyTelegram(
                    `❌ <b>Cliente em região não atendida</b>\n` +
                    `👤 ${name} (${phone})\n` +
                    `🏘️ ${bairroInfo.bairro}\n` +
                    `📝 ${text}`
                );
            } else {
                // Atende - mostrar preço
                let msgPreco = '';
                if (bairroInfo.regiao === 'botafogo') {
                    msgPreco = await getTreinamento('preco_botafogo');
                } else if (bairroInfo.regiao === 'zona_sul') {
                    msgPreco = await getTreinamento('preco_zona_sul');
                } else if (bairroInfo.regiao === 'zona_norte') {
                    msgPreco = await getTreinamento('preco_zona_norte');
                }

                await sendWhatsAppMessage(phone, msgPreco);
                await updateConversation(phone, { 
                    valor_visita: bairroInfo.valor,
                    etapa: 'confirmando_preco' 
                });
            }
            break;

        case 'confirmando_preco':
            if (isSim) {
                await sendWhatsAppMessage(phone, await getTreinamento('pedir_endereco'));
                await updateConversation(phone, { etapa: 'aguardando_endereco' });
            } else if (isNao) {
                // Tentar oferecer desconto
                await tentarDesconto(phone, conversa);
            } else {
                await sendWhatsAppMessage(phone, 'Por favor, responda "sim" para prosseguir ou "não" para cancelar.');
            }
            break;

        case 'oferecendo_desconto':
            if (isSim) {
                await sendWhatsAppMessage(phone, await getTreinamento('pedir_endereco'));
                await updateConversation(phone, { etapa: 'aguardando_endereco' });
            } else if (isNao) {
                await sendWhatsAppMessage(phone, 'Entendido. Se precisar de nossos serviços no futuro, estamos à disposição!');
                await updateConversation(phone, { etapa: 'finalizado' });

                // Notificar Telegram que cliente recusou
                await notifyTelegram(
                    `❌ <b>Cliente recusou a visita</b>\n` +
                    `👤 ${name} (${phone})\n` +
                    `🏘️ ${conversa.bairro}\n` +
                    `💰 R$${conversa.valor_visita}`
                );
            } else {
                await sendWhatsAppMessage(phone, 'Por favor, responda "sim" para aceitar ou "não" para recusar.');
            }
            break;

        case 'aguardando_endereco':
            // Salvar endereço e finalizar
            await updateConversation(phone, { 
                endereco: text,
                etapa: 'visita_marcada',
                status: 'visita_marcada'
            });

            await sendWhatsAppMessage(phone, await getTreinamento('visita_marcada'));

            // Notificar Telegram com todas as informações
            const horarioVisita = conversa.horario_visita 
                ? new Date(conversa.horario_visita).toLocaleString('pt-BR')
                : 'A definir';

            await notifyTelegram(
                `✅ <b>NOVA VISITA MARCADA!</b>\n\n` +
                `👤 <b>Cliente:</b> ${name}\n` +
                `📱 <b>Telefone:</b> ${phone}\n` +
                `🏘️ <b>Bairro:</b> ${conversa.bairro || 'Não informado'}\n` +
                `📍 <b>Endereço:</b> ${text}\n` +
                `🔧 <b>Equipamento:</b> ${conversa.equipamento || 'Não informado'}\n` +
                `💰 <b>Valor visita:</b> R$${conversa.valor_visita || 'Não definido'}\n` +
                `🕐 <b>Horário:</b> ${horarioVisita}`
            );

            // Notificar atendente individual também
            if (TELEGRAM_ATENDENTE_ID) {
                await notifyTelegram(
                    `🔔 <b>Nova visita agendada!</b>\n` +
                    `Cliente: ${name}\n` +
                    `Endereço: ${text}\n` +
                    `Valor: R$${conversa.valor_visita}`,
                    TELEGRAM_ATENDENTE_ID
                );
            }
            break;

        case 'humano':
            // Em intervenção humana, não fazer nada (humano responde pelo painel)
            break;

        default:
            // Reset para saudação se etapa desconhecida
            await sendWhatsAppMessage(phone, await getTreinamento('saudacao'));
            await updateConversation(phone, { etapa: 'aguardando_equipamento' });
    }
}

// ==========================================
// TENTAR DESCONTO
// ==========================================
async function tentarDesconto(phone, conversa) {
    const bairroInfo = await identificarBairro(conversa.bairro || '');
    let novoValor = 0;
    let msgDesconto = '';

    if (bairroInfo.regiao === 'botafogo') {
        // Botafogo: pode zerar
        novoValor = 0;
        msgDesconto = (await getTreinamento('desc_botafogo')).replace('{valor}', '0');
    } else if (bairroInfo.regiao === 'zona_sul') {
        // Zona Sul: pode chegar até 100
        novoValor = 100;
        msgDesconto = (await getTreinamento('desc_zona_sul')).replace('{valor}', '100');
    } else {
        // Outros: sem desconto
        await sendWhatsAppMessage(phone, 'Entendido. Se mudar de ideia, estamos à disposição!');
        await updateConversation(phone, { etapa: 'finalizado' });
        return;
    }

    await sendWhatsAppMessage(phone, msgDesconto);
    await updateConversation(phone, { 
        valor_visita: novoValor,
        etapa: 'oferecendo_desconto' 
    });
}

// ==========================================
// IDENTIFICAR BAIRRO
// ==========================================
async function identificarBairro(texto) {
    const { data: bairros } = await supabase
        .from('bairros_precos')
        .select('*');

    const textoLower = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u030f]/g, '');

    // Procurar bairro exato ou parcial
    let encontrado = bairros.find(b => {
        const bairroNormalizado = b.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u030f]/g, '');
        return textoLower.includes(bairroNormalizado);
    });

    // Se não encontrou, tentar match parcial
    if (!encontrado) {
        encontrado = bairros.find(b => {
            const bairroNormalizado = b.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u030f]/g, '');
            const palavras = bairroNormalizado.split(' ');
            return palavras.some(p => textoLower.includes(p) && p.length > 3);
        });
    }

    if (encontrado) {
        return {
            bairro: encontrado.bairro,
            regiao: encontrado.regiao,
            valor: encontrado.valor_visita,
            atende: encontrado.atende
        };
    }

    // Se não identificou, assumir zona sul como padrão (ou perguntar novamente)
    return {
        bairro: texto,
        regiao: 'zona_sul',
        valor: 120,
        atende: true
    };
}

// ==========================================
// AÇÕES DO PAINEL DE INTERVENÇÃO
// ==========================================
async function listConversations(req, res) {
    const { data: conversas, error } = await supabase
        .from('conversas')
        .select('*')
        .order('ultima_atividade', { ascending: false });

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    // Buscar última mensagem de cada conversa
    const conversasComMensagens = await Promise.all(conversas.map(async (c) => {
        const { data: msgs } = await supabase
            .from('mensagens')
            .select('*')
            .eq('telefone', c.telefone)
            .order('created_at', { ascending: false })
            .limit(1);

        return {
            telefone: c.telefone,
            nome: c.nome,
            emIntervencao: c.em_intervencao,
            etapa: c.etapa,
            ultimaAtividade: c.ultima_atividade,
            ultima: c.ultima_mensagem || (msgs?.[0]?.mensagem || 'Sem mensagens'),
            mensagens: msgs || []
        };
    }));

    return res.status(200).json({ conversas: conversasComMensagens });
}

async function getMessages(req, res) {
    const phone = req.query.phone;

    const { data: mensagens, error } = await supabase
        .from('mensagens')
        .select('*')
        .eq('telefone', phone)
        .order('created_at', { ascending: true });

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    // Buscar estado atual da conversa
    const { data: conversa } = await supabase
        .from('conversas')
        .select('em_intervencao')
        .eq('telefone', phone)
        .single();

    return res.status(200).json({ 
        mensagens: mensagens || [],
        emIntervencao: conversa?.em_intervencao || false
    });
}

async function intervene(req, res) {
    const { phone } = req.body;

    await updateConversation(phone, { em_intervencao: true });

    // Adicionar mensagem de sistema
    await saveMessage(phone, 'sistema', '🔴 Atendente humano assumiu o controle', {});

    // Notificar Telegram
    const conversa = await getOrCreateConversation(phone);
    await notifyTelegram(
        `👤 <b>Intervenção humana ativada</b>\n` +
        `Cliente: ${conversa.nome || phone}\n` +
        `Telefone: ${phone}`
    );

    return res.status(200).json({ ok: true, emIntervencao: true });
}

async function releaseControl(req, res) {
    const { phone } = req.body;

    await updateConversation(phone, { em_intervencao: false });

    // Adicionar mensagem de sistema
    await saveMessage(phone, 'sistema', '🤖 Robô reassumiu o atendimento', {});

    // Continuar fluxo do bot
    const conversa = await getOrCreateConversation(phone);
    await processarFluxo(phone, '', conversa, conversa.nome || 'Cliente');

    return res.status(200).json({ ok: true, emIntervencao: false });
}

async function sendFromPanel(req, res) {
    const { phone, message } = req.body;

    // Enviar pelo WhatsApp
    await sendWhatsAppMessage(phone, message);

    // Salvar no banco como mensagem humana
    await saveMessage(phone, 'humano', message, {});

    return res.status(200).json({ ok: true });
}

// ==========================================
// FUNÇÕES AUXILIARES SUPABASE
// ==========================================
async function getOrCreateConversation(phone, name = null) {
    const { data: existing } = await supabase
        .from('conversas')
        .select('*')
        .eq('telefone', phone)
        .single();

    if (existing) {
        if (name && !existing.nome) {
            await supabase
                .from('conversas')
                .update({ nome: name })
                .eq('telefone', phone);
        }
        return existing;
    }

    const { data: created } = await supabase
        .from('conversas')
        .insert({ 
            telefone: phone, 
            nome: name,
            etapa: 'saudacao',
            em_intervencao: false
        })
        .select()
        .single();

    return created;
}

async function updateConversation(phone, updates) {
    const updateData = {
        ...updates,
        ultima_atividade: new Date().toISOString()
    };

    const { error } = await supabase
        .from('conversas')
        .update(updateData)
        .eq('telefone', phone);

    if (error) {
        console.error('Erro ao atualizar conversa:', error);
    }
}

async function saveMessage(phone, tipo, mensagem, metadata = {}) {
    // Garantir que conversa existe
    await getOrCreateConversation(phone);

    const { error } = await supabase
        .from('mensagens')
        .insert({
            telefone: phone,
            tipo: tipo,
            mensagem: mensagem,
            metadata: metadata
        });

    // Atualizar última mensagem na conversa
    await supabase
        .from('conversas')
        .update({ ultima_mensagem: mensagem })
        .eq('telefone', phone);

    if (error) {
        console.error('Erro ao salvar mensagem:', error);
    }
}

async function getTreinamento(chave) {
    const { data } = await supabase
        .from('treinamento')
        .select('valor')
        .eq('chave', chave)
        .eq('ativo', true)
        .single();

    return data?.valor || 'Mensagem não configurada';
}

async function getPalavrasChaveHumano() {
    const { data } = await supabase
        .from('palavras_chave_humano')
        .select('palavra');

    return data?.map(p => p.palavra) || [];
}

// ==========================================
// WHATSAPP API
// ==========================================
async function sendWhatsAppMessage(to, text) {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text }
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('Erro WhatsApp API:', result);
            return false;
        }

        // Salvar mensagem do bot no banco
        await saveMessage(to, 'bot', text, { message_id: result.messages?.[0]?.id });

        return true;
    } catch (error) {
        console.error('Erro ao enviar WhatsApp:', error);
        return false;
    }
}

// ==========================================
// TELEGRAM NOTIFICATIONS
// ==========================================
async function notifyTelegram(text, chatId = null) {
    const targetChat = chatId || TELEGRAM_GROUP_ID;

    if (!targetChat || !TELEGRAM_BOT_TOKEN) {
        console.log('Telegram não configurado, notificação ignorada');
        return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: targetChat,
                text: text,
                parse_mode: 'HTML'
            })
        });
    } catch (error) {
        console.error('Erro Telegram:', error);
    }
}
