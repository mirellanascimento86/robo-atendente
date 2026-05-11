// ==========================================
// WEBHOOK WHATSAPP PRO - VERSÃO CORRIGIDA
// Responde mensagens no WhatsApp corretamente
// API Meta Graph v22.0 - 2026
// ==========================================

import { createClient } from '@supabase/supabase-js';

// ==========================================
// CONFIGURAÇÃO
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ATENDENTE_ID = process.env.TELEGRAM_ATENDENTE_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// FLUXO DE ATENDIMENTO
// ==========================================
const FLUXO = {
  SAUDACAO: 'saudacao',
  AGUARDANDO_EQUIPAMENTO: 'aguardando_equipamento',
  AGUARDANDO_CONFIRMACAO_HORARIO: 'aguardando_confirmacao_horario',
  AGUARDANDO_BAIRRO: 'aguardando_bairro',
  AGUARDANDO_ENDERECO: 'aguardando_endereco',
  VISITA_MARCADA: 'visita_marcada',
  HUMANO: 'humano',
  NAO_ATENDE: 'nao_atende'
};

// Bairros categorizados
const BAIRROS = {
  BOTAFOGO: ['botafogo'],
  ZONA_SUL: ['copacabana', 'ipanema', 'leblon', 'laranjeiras', 'flamengo', 'lagoa', 'jardim botanico', 'gavea', 'sao conrado', 'barra da tijuca', 'recreio', 'vidigal', 'rocha', 'catete', 'gloria', 'humaita', 'urca'],
  ZONA_NORTE: ['tijuca', 'vila isabel', 'grajau', 'maracana', 'andarahy', 'engenho novo', 'engenho de dentro', 'meier', 'alto da boa vista', 'jacarepagua', 'tanque', 'freguesia', 'pechincha', 'curicica', 'gardênia azul', 'cidade de deus', 'praça seca', 'anil', 'guaratiba', 'senador camara', 'bangu', 'padre miguel', 'realengo', 'madureira', 'cascadura', 'quintino', 'pilares', 'encantado', 'manguinhos', 'bonsucesso', 'ramos', 'olearia', 'cordovil', 'parada de lucas', 'vigario geral', 'jardim america', 'honea', 'rocha miranda', 'coelho neto', 'acari', 'barros filho', 'costa barros', 'parque colombia', 'igrejinha', 'tomas coelho', 'engenheiro leal', 'inhauma', 'cachambi', 'del castilho', 'engenho da rainha', 'higienopolis', 'maria da graca', 'triagem'],
  ZONA_OESTE: ['campo grande', 'santa cruz', 'sepetiba', 'itaguai', 'seropedica', 'paracambi', 'japeri', 'queimados', 'nova iguacu', 'nilopolis', 'mesquita', 'belford roxo', 'sao joao de meriti', 'duque de caxias', 'mage', 'guapimirim'],
  BAIXADA: ['niteroi', 'sao goncalo', 'ituaborai', 'tangua', 'rio bonito', 'cachoeiras de macacu', 'mangaratiba', 'angra dos reis', 'paraty']
};

const TAXAS_VISITA = {
  BOTAFOGO: 100,
  ZONA_SUL: 120,
  ZONA_NORTE: 190,
  ZONA_OESTE: null,
  BAIXADA: null
};

const PALAVRAS_CHAVE_HUMANO = ['humano', 'atendente', 'pessoa', 'falar com', 'falar com gente', 'falar com alguem', 'quero falar', 'preciso de ajuda', 'ajuda', 'suporte', 'representante', 'gerente', 'chefe', 'dono', 'proprietario', 'responsavel'];

// ==========================================
// HANDLER PRINCIPAL (VERCEL)
// ==========================================
export default async function handler(req, res) {
  // Log para debug
  console.log(`[${req.method}] ${req.url}`);
  console.log('Query:', req.query);
  console.log('Body:', JSON.stringify(req.body).substring(0, 500));

  // ==========================================
  // VERIFICAÇÃO DO WEBHOOK (GET) - META
  // ==========================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('Verificação:', { mode, token, challenge });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook] Verificado com sucesso!');
      return res.status(200).send(challenge);
    }

    // Endpoints da API do painel
    const action = req.query.action;

    if (action === 'list') {
      return await listarConversas(req, res);
    }

    if (action === 'messages') {
      return await buscarMensagens(req, res);
    }

    return res.status(403).send('Forbidden');
  }

  // ==========================================
  // REQUISIÇÕES POST
  // ==========================================
  if (req.method === 'POST') {
    // Verificar se é webhook do Meta
    if (req.body && req.body.object === 'whatsapp_business_account') {
      // Responder imediatamente para Meta (200ms)
      res.status(200).send('EVENT_RECEIVED');

      // Processar assíncronamente
      try {
        await processarWebhookMeta(req.body);
      } catch (error) {
        console.error('[Erro] Processar webhook:', error);
      }
      return;
    }

    // Endpoints da API do painel (POST)
    const action = req.query.action;

    if (action === 'intervene') {
      return await assumirControle(req, res);
    }

    if (action === 'release') {
      return await liberarRobo(req, res);
    }

    if (action === 'send') {
      return await enviarMensagemHumano(req, res);
    }

    return res.status(400).json({ erro: 'Ação não reconhecida' });
  }

  return res.status(405).send('Method Not Allowed');
}

// ==========================================
// PROCESSAR WEBHOOK DO META
// ==========================================
async function processarWebhookMeta(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      if (value.messages && value.messages.length > 0) {
        for (const message of value.messages) {
          await processarMensagemRecebida(message, value);
        }
      }

      // Status updates (entregue, lido, etc)
      if (value.statuses) {
        for (const status of value.statuses) {
          console.log(`[Status] ${status.status} para ${status.id}`);
        }
      }
    }
  }
}

// ==========================================
// PROCESSAR MENSAGEM RECEBIDA
// ==========================================
async function processarMensagemRecebida(message, metadata) {
  const from = message.from;
  const text = message.text?.body || '';
  const timestamp = message.timestamp;
  const messageId = message.id;
  const nome = metadata.contacts?.[0]?.profile?.name || null;

  console.log(`[Recebido] De: ${from} | Nome: ${nome} | Texto: ${text}`);

  // Buscar ou criar conversa no Supabase
  let { data: conversa, error } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', from)
    .single();

  if (error || !conversa) {
    console.log('[Nova conversa] Criando...');

    const { data: novaConversa, error: createError } = await supabase
      .from('conversas')
      .insert({
        telefone: from,
        nome: nome,
        etapa: FLUXO.SAUDACAO,
        em_intervencao: false,
        ultima_atividade: new Date().toISOString(),
        ultima: text,
        mensagens: [],
        dados_visita: {},
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) {
      console.error('[Erro] Criar conversa:', createError);
      return;
    }
    conversa = novaConversa;
  } else {
    // Atualizar nome se não tiver
    if (nome && !conversa.nome) {
      await supabase.from('conversas').update({ nome }).eq('telefone', from);
    }
  }

  // Salvar mensagem do cliente no histórico
  await salvarMensagemNoBanco(from, text, 'cliente', timestamp, messageId);

  // Verificar se está em intervenção humana
  if (conversa.em_intervencao) {
    console.log('[Intervenção] Cliente enviou mensagem, notificando...');
    await notificarPainel(from, 'nova_mensagem', { texto: text, tipo: 'cliente' });
    await enviarTelegram(`💬 <b>Cliente respondeu (Intervenção)</b>\n📱 ${from}\n👤 ${nome || 'N/A'}\n📝 ${text}`);
    return;
  }

  // Verificar palavras-chave para humano
  if (detectarPalavraChaveHumano(text)) {
    console.log('[Palavra-chave] Detectada!');
    await ativarIntervencao(from, conversa, 'palavra_chave');
    return;
  }

  // Processar fluxo de atendimento
  await processarFluxoAtendimento(from, text, conversa);
}

// ==========================================
// FLUXO DE ATENDIMENTO AUTOMÁTICO
// ==========================================
async function processarFluxoAtendimento(phone, text, conversa) {
  const etapa = conversa.etapa;
  const textoLower = text.toLowerCase().trim();

  console.log(`[Fluxo] Etapa atual: ${etapa} | Texto: ${text}`);

  switch (etapa) {
    case FLUXO.SAUDACAO:
      // Primeira mensagem do cliente - enviar saudação
      await enviarMensagemWhatsApp(phone, 'Olá! Qual equipamento está com problema e qual a marca?');
      await atualizarEtapa(phone, FLUXO.AGUARDANDO_EQUIPAMENTO);
      break;

    case FLUXO.AGUARDANDO_EQUIPAMENTO:
      // Cliente informou equipamento e marca
      await atualizarDadosVisita(phone, { equipamento: text });

      // Calcular horário (2h a partir de agora)
      const horarioVisita = calcularHorarioVisita();
      await atualizarDadosVisita(phone, { horario_sugerido: horarioVisita });

      await enviarMensagemWhatsApp(phone, `Gostaria de visita para hoje às ${horarioVisita}?`);
      await atualizarEtapa(phone, FLUXO.AGUARDANDO_CONFIRMACAO_HORARIO);
      break;

    case FLUXO.AGUARDANDO_CONFIRMACAO_HORARIO:
      if (textoLower.match(/sim|yes|ok|pode ser|confirmo|quero|gostaria|aceito|topo|fechado|beleza|bora/)) {
        await enviarMensagemWhatsApp(phone, 'Perfeito! Qual o bairro?');
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_BAIRRO);
      } else if (textoLower.match(/nao|não|no|nope|outro horario|mais tarde|mais cedo|nao posso|depois/)) {
        await enviarMensagemWhatsApp(phone, 'Entendo. Posso oferecer outro horário ou você prefere falar com um atendente? Digite "atendente" para falar com uma pessoa.');
      } else {
        await enviarMensagemWhatsApp(phone, 'Desculpe, não entendi. Digite "sim" para confirmar o horário ou "não" para escolher outro.');
      }
      break;

    case FLUXO.AGUARDANDO_BAIRRO:
      const bairroInfo = identificarBairro(textoLower);
      await atualizarDadosVisita(phone, { bairro: text, bairro_categoria: bairroInfo.categoria });

      if (bairroInfo.categoria === 'BOTAFOGO') {
        await enviarMensagemWhatsApp(phone, 'A visita para o bairro de Botafogo é R$100. Gostaria de prosseguir?');
        await atualizarDadosVisita(phone, { taxa_visita: 100 });
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_ENDERECO);
      } else if (bairroInfo.categoria === 'ZONA_SUL') {
        await enviarMensagemWhatsApp(phone, 'A visita para seu bairro é R$120. Essa taxa é deduzida do valor final caso o orçamento seja aprovado. Gostaria de prosseguir?');
        await atualizarDadosVisita(phone, { taxa_visita: 120 });
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_ENDERECO);
      } else if (bairroInfo.categoria === 'ZONA_NORTE') {
        await enviarMensagemWhatsApp(phone, 'A visita para seu bairro é R$190. Essa taxa é deduzida do valor final caso o orçamento seja aprovado. Gostaria de prosseguir?');
        await atualizarDadosVisita(phone, { taxa_visita: 190 });
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_ENDERECO);
      } else if (bairroInfo.categoria === 'ZONA_OESTE' || bairroInfo.categoria === 'BAIXADA') {
        await enviarMensagemWhatsApp(phone, 'Infelizmente no momento não atendemos a sua região.');
        await atualizarEtapa(phone, FLUXO.NAO_ATENDE);
        await enviarTelegram(`❌ <b>Região não atendida</b>\n📱 ${phone}\n🏘️ ${text}`);
      } else {
        await enviarMensagemWhatsApp(phone, 'Não reconheci esse bairro. Poderia confirmar o nome ou digitar "atendente" para falar com uma pessoa?');
      }
      break;

    case FLUXO.AGUARDANDO_ENDERECO:
      if (textoLower.match(/sim|yes|ok|pode ser|confirmo|quero|gostaria|aceito|topo|fechado|prosseguir|bora/)) {
        await enviarMensagemWhatsApp(phone, 'Ótimo! Por favor, informe o endereço completo (rua, número, complemento e ponto de referência).');
        await atualizarEtapa(phone, FLUXO.VISITA_MARCADA);
      } else if (textoLower.match(/nao|não|no|nope|caro|muito caro|desconto|desconta|diminui|abaixa|reduz/)) {
        await processarNegociacao(phone, conversa);
      } else {
        await enviarMensagemWhatsApp(phone, 'Digite "sim" para prosseguir ou "não" se precisar de ajuda com o valor.');
      }
      break;

    case FLUXO.VISITA_MARCADA:
      // Cliente enviou endereço
      await atualizarDadosVisita(phone, { endereco: text });

      // Confirmar visita
      const dados = conversa.dados_visita || {};
      const msgConfirmacao = `✅ *Visita marcada!*\n\n📍 Endereço: ${text}\n🏘️ Bairro: ${dados.bairro || 'N/A'}\n⏰ Horário: ${dados.horario_sugerido || 'N/A'}\n🔧 Equipamento: ${dados.equipamento || 'N/A'}\n💰 Taxa de visita: R$${dados.taxa_visita || 'N/A'}\n\nUm técnico confirmará em breve. Obrigado!`;

      await enviarMensagemWhatsApp(phone, msgConfirmacao);
      await atualizarEtapa(phone, 'visita_confirmada');

      // Enviar notificação completa ao Telegram
      await enviarNotificacaoVisita(phone, conversa, text);
      break;

    default:
      // Se etapa desconhecida, reiniciar
      await atualizarEtapa(phone, FLUXO.SAUDACAO);
      await enviarMensagemWhatsApp(phone, 'Olá! Qual equipamento está com problema e qual a marca?');
  }
}

// ==========================================
// NEGOCIAÇÃO DE DESCONTO
// ==========================================
async function processarNegociacao(phone, conversa) {
  const dados = conversa.dados_visita || {};
  const categoria = dados.bairro_categoria;
  const taxaAtual = dados.taxa_visita || 0;

  if (categoria === 'BOTAFOGO') {
    await enviarMensagemWhatsApp(phone, 'Posso oferecer um desconto especial! A visita em Botafogo pode sair de *GRÁTIS* hoje. Gostaria de aproveitar?');
    await atualizarDadosVisita(phone, { taxa_visita: 0, desconto_aplicado: true });
  } else if (categoria === 'ZONA_SUL') {
    if (taxaAtual > 100) {
      await enviarMensagemWhatsApp(phone, 'Posso fazer um desconto especial! A visita pode sair por *R$100* (era R$120). Essa taxa é deduzida do valor final. Topa?');
      await atualizarDadosVisita(phone, { taxa_visita: 100, desconto_aplicado: true });
    } else {
      await enviarMensagemWhatsApp(phone, 'Já estou no limite do desconto para sua região. Posso oferecer R$100. Gostaria de prosseguir?');
    }
  } else {
    await enviarMensagemWhatsApp(phone, 'Infelizmente não tenho autorização para descontos nessa região. O valor é fixo. Gostaria de prosseguir mesmo assim?');
  }
}

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function calcularHorarioVisita() {
  const agora = new Date();
  agora.setHours(agora.getHours() + 2);
  return agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function identificarBairro(texto) {
  const textoLower = texto.toLowerCase().trim();

  for (const [categoria, bairros] of Object.entries(BAIRROS)) {
    for (const bairro of bairros) {
      if (textoLower.includes(bairro)) {
        return { categoria, bairro };
      }
    }
  }

  return { categoria: 'DESCONHECIDO', bairro: texto };
}

function detectarPalavraChaveHumano(texto) {
  const textoLower = texto.toLowerCase();
  return PALAVRAS_CHAVE_HUMANO.some(palavra => textoLower.includes(palavra));
}

// ==========================================
// SUPABASE - OPERAÇÕES
// ==========================================

async function salvarMensagemNoBanco(phone, texto, tipo, timestamp, messageId) {
  const mensagem = {
    id: messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    tipo: tipo,
    mensagem: texto,
    data: new Date(timestamp ? parseInt(timestamp) * 1000 : Date.now()).toISOString(),
    timestamp: timestamp || Math.floor(Date.now() / 1000)
  };

  // Buscar mensagens atuais
  const { data: conversa } = await supabase
    .from('conversas')
    .select('mensagens')
    .eq('telefone', phone)
    .single();

  const mensagens = conversa?.mensagens || [];
  mensagens.push(mensagem);

  // Atualizar conversa
  const { error } = await supabase
    .from('conversas')
    .update({
      mensagens: mensagens,
      ultima: texto,
      ultima_atividade: new Date().toISOString()
    })
    .eq('telefone', phone);

  if (error) {
    console.error('[Erro] Salvar mensagem:', error);
  }

  // Notificar painel em tempo real
  await notificarPainel(phone, 'nova_mensagem', mensagem);
}

async function atualizarEtapa(phone, etapa) {
  const { error } = await supabase
    .from('conversas')
    .update({ etapa: etapa, ultima_atividade: new Date().toISOString() })
    .eq('telefone', phone);

  if (error) console.error('[Erro] Atualizar etapa:', error);
}

async function atualizarDadosVisita(phone, dados) {
  const { data: conversa } = await supabase
    .from('conversas')
    .select('dados_visita')
    .eq('telefone', phone)
    .single();

  const dadosAtuais = conversa?.dados_visita || {};

  const { error } = await supabase
    .from('conversas')
    .update({
      dados_visita: { ...dadosAtuais, ...dados },
      ultima_atividade: new Date().toISOString()
    })
    .eq('telefone', phone);

  if (error) console.error('[Erro] Atualizar dados visita:', error);
}

async function ativarIntervencao(phone, conversa, motivo) {
  // Atualizar no Supabase
  const { error } = await supabase
    .from('conversas')
    .update({
      em_intervencao: true,
      etapa: FLUXO.HUMANO,
      motivo_intervencao: motivo,
      ultima_atividade: new Date().toISOString()
    })
    .eq('telefone', phone);

  if (error) {
    console.error('[Erro] Ativar intervenção:', error);
    return;
  }

  // Enviar mensagem ao cliente
  await enviarMensagemWhatsApp(phone, '⏳ Um atendente humano será conectado em instantes. Aguarde...');

  // Notificar Telegram
  const msgTelegram = `🚨 <b>INTERVENÇÃO HUMANA SOLICITADA</b>\n\n📱 Cliente: ${phone}\n🏷️ Nome: ${conversa.nome || 'N/A'}\n💬 Última msg: ${conversa.ultima || 'N/A'}\n🔍 Motivo: ${motivo === 'palavra_chave' ? 'Palavra-chave detectada' : 'Solicitação direta'}\n\n⚡ Acesse o painel: ${process.env.PAINEL_URL || 'https://seu-painel.vercel.app'}`;

  await enviarTelegram(msgTelegram);

  // Notificar painel
  await notificarPainel(phone, 'intervencao_ativada', { motivo });
}

// ==========================================
// ENVIAR MENSAGEM WHATSAPP - API META CORRETA
// ==========================================

async function enviarMensagemWhatsApp(phone, texto) {
  try {
    // URL correta da API Meta Graph v22.0
    const url = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`;

    console.log(`[WhatsApp] Enviando para ${phone}: ${texto.substring(0, 50)}...`);
    console.log(`[WhatsApp] URL: ${url}`);
    console.log(`[WhatsApp] Token: ${WHATSAPP_TOKEN ? 'Configurado' : 'AUSENTE!'}`);
    console.log(`[WhatsApp] Phone ID: ${WHATSAPP_PHONE_ID || 'AUSENTE!'}`);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { 
        preview_url: false,
        body: texto 
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log(`[WhatsApp] Status: ${response.status}`);
    console.log(`[WhatsApp] Resposta:`, JSON.stringify(data));

    if (!response.ok) {
      console.error('[Erro] WhatsApp API:', data);

      // Se erro de token inválido, logar mais detalhes
      if (data.error && data.error.code === 190) {
        console.error('[ERRO CRÍTICO] Token inválido ou expirado!');
      }
      if (data.error && data.error.code === 100) {
        console.error('[ERRO CRÍTICO] Phone ID inválido!');
      }

      return { ok: false, erro: data.error?.message || 'Erro desconhecido' };
    }

    // Salvar mensagem do bot no histórico
    await salvarMensagemNoBanco(phone, texto, 'bot', null, data.messages?.[0]?.id);

    console.log('[WhatsApp] ✅ Enviado com sucesso! ID:', data.messages?.[0]?.id);
    return { ok: true, messageId: data.messages?.[0]?.id };

  } catch (error) {
    console.error('[Erro] Enviar WhatsApp:', error);
    return { ok: false, erro: error.message };
  }
}

// ==========================================
// NOTIFICAÇÕES TELEGRAM
// ==========================================

async function enviarNotificacaoVisita(phone, conversa, endereco) {
  const dados = conversa.dados_visita || {};
  const nome = conversa.nome || 'Cliente';

  const msg = `🔧 <b>NOVA VISITA MARCADA</b>\n\n👤 <b>Cliente:</b> ${nome}\n📱 <b>Telefone:</b> ${phone}\n📍 <b>Endereço:</b> ${endereco}\n🏘️ <b>Bairro:</b> ${dados.bairro || 'N/A'}\n⏰ <b>Horário:</b> ${dados.horario_sugerido || 'N/A'}\n🔧 <b>Serviço:</b> ${dados.equipamento || 'N/A'}\n💰 <b>Taxa Visita:</b> R$${dados.taxa_visita || 'N/A'}\n📊 <b>Etapa:</b> ${conversa.etapa}\n\n✅ Visita confirmada pelo bot`;

  await enviarTelegram(msg);
}

async function enviarTelegram(mensagem) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('[Telegram] Não configurado, pulando...');
      return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Erro] Telegram:', data);
    } else {
      console.log('[Telegram] ✅ Notificação enviada');
    }
  } catch (error) {
    console.error('[Erro] Telegram:', error);
  }
}

// ==========================================
// PAINEL - NOTIFICAÇÕES REALTIME
// ==========================================

async function notificarPainel(phone, evento, dados) {
  try {
    await supabase
      .from('notificacoes_painel')
      .insert({
        telefone: phone,
        evento: evento,
        dados: dados,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('[Erro] Notificar painel:', error);
  }
}

// ==========================================
// API PARA O PAINEL - ENDPOINTS
// ==========================================

async function listarConversas(req, res) {
  try {
    const { data, error } = await supabase
      .from('conversas')
      .select('*')
      .order('ultima_atividade', { ascending: false });

    if (error) throw error;

    res.status(200).json({ conversas: data });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function buscarMensagens(req, res) {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

  try {
    const { data, error } = await supabase
      .from('conversas')
      .select('mensagens, em_intervencao, etapa, nome, dados_visita, ultima_atividade')
      .eq('telefone', phone)
      .single();

    if (error) throw error;

    res.status(200).json({
      mensagens: data.mensagens || [],
      emIntervencao: data.em_intervencao,
      etapa: data.etapa,
      nome: data.nome,
      dadosVisita: data.dados_visita,
      ultimaAtividade: data.ultima_atividade
    });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function assumirControle(req, res) {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

  try {
    const { error } = await supabase
      .from('conversas')
      .update({
        em_intervencao: true,
        etapa: FLUXO.HUMANO,
        interveniente: req.body.atendente || 'humano',
        ultima_atividade: new Date().toISOString()
      })
      .eq('telefone', phone);

    if (error) throw error;

    // Enviar mensagem ao cliente
    await enviarMensagemWhatsApp(phone, '👤 Você está falando agora com um atendente humano. Como posso ajudar?');

    // Notificar Telegram
    await enviarTelegram(`👤 <b>Atendente assumiu controle</b>\n📱 ${phone}`);

    res.status(200).json({ ok: true, message: 'Controle assumido' });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function liberarRobo(req, res) {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

  try {
    const { error } = await supabase
      .from('conversas')
      .update({
        em_intervencao: false,
        etapa: FLUXO.SAUDACAO,
        interveniente: null,
        ultima_atividade: new Date().toISOString()
      })
      .eq('telefone', phone);

    if (error) throw error;

    // Enviar mensagem ao cliente
    await enviarMensagemWhatsApp(phone, '✅ Atendimento automatizado retomado. Olá! Qual equipamento está com problema e qual a marca?');

    res.status(200).json({ ok: true, message: 'Robô liberado' });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function enviarMensagemHumano(req, res) {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ erro: 'Telefone e mensagem obrigatórios' });

  try {
    // Verificar se está em intervenção
    const { data: conversa } = await supabase
      .from('conversas')
      .select('em_intervencao')
      .eq('telefone', phone)
      .single();

    if (!conversa?.em_intervencao) {
      return res.status(403).json({ erro: 'Conversa não está em intervenção humana' });
    }

    // Enviar pelo WhatsApp
    const resultado = await enviarMensagemWhatsApp(phone, message);

    if (!resultado.ok) {
      return res.status(500).json({ erro: resultado.erro });
    }

    // Salvar como mensagem humana
    await salvarMensagemNoBanco(phone, message, 'humano', null, resultado.messageId);

    res.status(200).json({ ok: true, message: 'Mensagem enviada' });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}
