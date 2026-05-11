// api/webhook.js - Webhook principal para WhatsApp + Painel de Intervenção
// Deploy no Vercel como Serverless Function

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
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Grupo de notificações
const TELEGRAM_ATENDENTE_ID = process.env.TELEGRAM_ATENDENTE_ID; // Atendente individual

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
  BOT AFOGO: ['botafogo'],
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
  // Verificação do webhook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook] Verificado com sucesso');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // Recebimento de mensagens (POST)
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      if (body.object !== 'whatsapp_business_account') {
        return res.sendStatus(404);
      }

      // Responder imediatamente para Meta (queue-first architecture)
      res.status(200).send('OK');

      // Processar assíncronamente
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          
          if (value.messages) {
            for (const message of value.messages) {
              await processarMensagem(message, value.metadata);
            }
          }
        }
      }
    } catch (error) {
      console.error('[Webhook] Erro:', error);
      // Já respondemos 200, logar erro
    }
  }
}

// ==========================================
// PROCESSAMENTO DE MENSAGEM
// ==========================================
async function processarMensagem(message, metadata) {
  const from = message.from;
  const text = message.text?.body || '';
  const timestamp = message.timestamp;
  const messageId = message.id;

  console.log(`[Mensagem] De: ${from}, Texto: ${text}`);

  // Buscar ou criar conversa
  let { data: conversa, error } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', from)
    .single();

  if (error || !conversa) {
    // Criar nova conversa
    const { data: novaConversa, error: createError } = await supabase
      .from('conversas')
      .insert({
        telefone: from,
        nome: null,
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
  }

  // Verificar se está em intervenção humana
  if (conversa.em_intervencao) {
    await salvarMensagem(from, text, 'cliente', timestamp, messageId);
    
    // Notificar painel via realtime
    await notificarPainel(from, 'nova_mensagem', { texto: text });
    
    // Notificar Telegram que cliente enviou mensagem enquanto humano atua
    await enviarTelegram(`💬 <b>Cliente respondeu (Intervenção)</b>\n📱 ${from}\n📝 ${text}`);
    
    return;
  }

  // Verificar palavras-chave para humano
  if (detectarPalavraChaveHumano(text)) {
    await salvarMensagem(from, text, 'cliente', timestamp, messageId);
    await ativarIntervencao(from, conversa, 'palavra_chave');
    return;
  }

  // Salvar mensagem do cliente
  await salvarMensagem(from, text, 'cliente', timestamp, messageId);

  // Processar fluxo
  await processarFluxo(from, text, conversa);
}

// ==========================================
// FLUXO DE CONVERSA
// ==========================================
async function processarFluxo(phone, text, conversa) {
  const etapa = conversa.etapa;
  const textoLower = text.toLowerCase().trim();

  switch (etapa) {
    case FLUXO.SAUDACAO:
      await enviarWhatsApp(phone, 'Olá, Qual equipamento está com problema e qual a marca?');
      await atualizarEtapa(phone, FLUXO.AGUARDANDO_EQUIPAMENTO);
      break;

    case FLUXO.AGUARDANDO_EQUIPAMENTO:
      // Extrair equipamento e marca
      const dadosEquipamento = extrairEquipamento(textoLower);
      await atualizarDadosVisita(phone, { equipamento: text, ...dadosEquipamento });
      
      // Calcular horário (2h a partir de agora)
      const horarioVisita = calcularHorarioVisita();
      
      await enviarWhatsApp(phone, `Gostaria de visita para hoje às ${horarioVisita}?`);
      await atualizarDadosVisita(phone, { horario_sugerido: horarioVisita });
      await atualizarEtapa(phone, FLUXO.AGUARDANDO_CONFIRMACAO_HORARIO);
      break;

    case FLUXO.AGUARDANDO_CONFIRMACAO_HORARIO:
      if (textoLower.match(/sim|yes|ok|pode ser|confirmo|quero|gostaria|aceito|topo|fechado/)) {
        await enviarWhatsApp(phone, 'Perfeito. Qual o bairro?');
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_BAIRRO);
      } else if (textoLower.match(/nao|não|no|nope|outro horario|mais tarde|mais cedo|nao posso/)) {
        // Oferecer horários alternativos ou intervenção humana
        await enviarWhatsApp(phone, 'Entendo. Posso oferecer outro horário ou você prefere falar com um atendente? Digite "atendente" para falar com uma pessoa.');
      } else {
        await enviarWhatsApp(phone, 'Desculpe, não entendi. Digite "sim" para confirmar o horário ou "não" para escolher outro.');
      }
      break;

    case FLUXO.AGUARDANDO_BAIRRO:
      const bairroInfo = identificarBairro(textoLower);
      await atualizarDadosVisita(phone, { bairro: text, bairro_categoria: bairroInfo.categoria });

      if (bairroInfo.categoria === 'BOTAFOGO') {
        await enviarWhatsApp(phone, 'A visita para o bairro de Botafogo é R$100. Gostaria de prosseguir?');
        await atualizarDadosVisita(phone, { taxa_visita: 100 });
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_ENDERECO);
      } else if (bairroInfo.categoria === 'ZONA_SUL') {
        await enviarWhatsApp(phone, 'A visita para seu bairro é R$120. Essa taxa é deduzida do valor final caso o orçamento seja aprovado. Gostaria de prosseguir?');
        await atualizarDadosVisita(phone, { taxa_visita: 120 });
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_ENDERECO);
      } else if (bairroInfo.categoria === 'ZONA_NORTE') {
        await enviarWhatsApp(phone, 'A visita para seu bairro é R$190. Essa taxa é deduzida do valor final caso o orçamento seja aprovado. Gostaria de prosseguir?');
        await atualizarDadosVisita(phone, { taxa_visita: 190 });
        await atualizarEtapa(phone, FLUXO.AGUARDANDO_ENDERECO);
      } else if (bairroInfo.categoria === 'ZONA_OESTE' || bairroInfo.categoria === 'BAIXADA') {
        await enviarWhatsApp(phone, 'Infelizmente no momento não atendemos a sua região.');
        await atualizarEtapa(phone, FLUXO.NAO_ATENDE);
        
        // Notificar Telegram sobre região não atendida
        await enviarTelegram(`❌ <b>Região não atendida</b>\n📱 ${phone}\n🏘️ ${text}`);
      } else {
        // Bairro não reconhecido, pedir confirmação ou oferecer atendente
        await enviarWhatsApp(phone, 'Não reconheci esse bairro. Poderia confirmar o nome ou digitar "atendente" para falar com uma pessoa?');
      }
      break;

    case FLUXO.AGUARDANDO_ENDERECO:
      if (textoLower.match(/sim|yes|ok|pode ser|confirmo|quero|gostaria|aceito|topo|fechado|prosseguir/)) {
        await enviarWhatsApp(phone, 'Ótimo! Por favor, informe o endereço completo (rua, número, complemento e ponto de referência).');
        await atualizarEtapa(phone, FLUXO.VISITA_MARCADA);
      } else if (textoLower.match(/nao|não|no|nope|caro|muito caro|desconto|desconta|diminui|abaixa|reduz/)) {
        // Lógica de desconto
        await processarNegociacao(phone, conversa);
      } else {
        await enviarWhatsApp(phone, 'Digite "sim" para prosseguir ou "não" se precisar de ajuda com o valor.');
      }
      break;

    case FLUXO.VISITA_MARCADA:
      // Cliente enviou endereço
      await atualizarDadosVisita(phone, { endereco: text });
      
      // Confirmar visita
      const dados = conversa.dados_visita || {};
      const msgConfirmacao = `✅ Visita marcada!\n\n📍 Endereço: ${text}\n🏘️ Bairro: ${dados.bairro || 'N/A'}\n⏰ Horário: ${dados.horario_sugerido || 'N/A'}\n🔧 Equipamento: ${dados.equipamento || 'N/A'}\n💰 Taxa de visita: R$${dados.taxa_visita || 'N/A'}\n\nUm técnico confirmará em breve. Obrigado!`;
      
      await enviarWhatsApp(phone, msgConfirmacao);
      await atualizarEtapa(phone, 'visita_confirmada');
      
      // Enviar notificação completa ao Telegram
      await enviarNotificacaoVisita(phone, conversa, text);
      break;

    default:
      // Se etapa desconhecida, reiniciar
      await atualizarEtapa(phone, FLUXO.SAUDACAO);
      await enviarWhatsApp(phone, 'Olá, Qual equipamento está com problema e qual a marca?');
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
    // Pode zerar a taxa
    await enviarWhatsApp(phone, 'Posso oferecer um desconto especial! A visita em Botafogo pode sair de GRAÇA hoje. Gostaria de aproveitar?');
    await atualizarDadosVisita(phone, { taxa_visita: 0, desconto_aplicado: true });
  } else if (categoria === 'ZONA_SUL') {
    // Pode reduzir até R$100
    if (taxaAtual > 100) {
      await enviarWhatsApp(phone, 'Posso fazer um desconto especial! A visita pode sair por R$100 (era R$120). Essa taxa é deduzida do valor final. Topa?');
      await atualizarDadosVisita(phone, { taxa_visita: 100, desconto_aplicado: true });
    } else {
      await enviarWhatsApp(phone, 'Já estou no limite do desconto para sua região. Posso oferecer R$100. Gostaria de prosseguir?');
    }
  } else {
    // Sem desconto para outras regiões
    await enviarWhatsApp(phone, 'Infelizmente não tenho autorização para descontos nessa região. O valor é fixo. Gostaria de prosseguir mesmo assim?');
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

function extrairEquipamento(texto) {
  // Lógica simples para extrair equipamento e marca
  const partes = texto.split(/e|,/);
  return {
    equipamento_raw: texto,
    marca: partes.length > 1 ? partes[1].trim() : 'Não informada'
  };
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

async function salvarMensagem(phone, texto, tipo, timestamp, messageId) {
  const mensagem = {
    id: messageId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    tipo: tipo, // 'cliente', 'bot', 'humano', 'sistema'
    mensagem: texto,
    data: new Date(timestamp ? timestamp * 1000 : Date.now()).toISOString(),
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
    .update({ etapa: etapa })
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
      dados_visita: { ...dadosAtuais, ...dados }
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
      motivo_intervencao: motivo
    })
    .eq('telefone', phone);

  if (error) {
    console.error('[Erro] Ativar intervenção:', error);
    return;
  }

  // Enviar mensagem ao cliente
  await enviarWhatsApp(phone, '⏳ Um atendente humano será conectado em instantes. Aguarde...');

  // Notificar Telegram
  const msgTelegram = `🚨 <b>INTERVENÇÃO HUMANA SOLICITADA</b>\n\n📱 Cliente: ${phone}\n🏷️ Nome: ${conversa.nome || 'N/A'}\n💬 Última msg: ${conversa.ultima || 'N/A'}\n🔍 Motivo: ${motivo === 'palavra_chave' ? 'Palavra-chave detectada' : 'Solicitação direta'}\n\n⚡ Acesse o painel: ${process.env.PAINEL_URL || 'https://seu-painel.vercel.app'}`;
  
  await enviarTelegram(msgTelegram);
  
  // Notificar painel
  await notificarPainel(phone, 'intervencao_ativada', { motivo });
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
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });
    
    console.log('[Telegram] Notificação enviada');
  } catch (error) {
    console.error('[Erro] Telegram:', error);
  }
}

// ==========================================
// WHATSAPP - ENVIAR MENSAGEM
// ==========================================

async function enviarWhatsApp(phone, texto) {
  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { body: texto }
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('[Erro] WhatsApp API:', data);
      return;
    }

    // Salvar mensagem do bot no histórico
    await salvarMensagem(phone, texto, 'bot', null, data.messages?.[0]?.id);

    console.log('[WhatsApp] Enviado:', texto);
  } catch (error) {
    console.error('[Erro] Enviar WhatsApp:', error);
  }
}

// ==========================================
// PAINEL DE INTERVENÇÃO - REALTIME
// ==========================================

async function notificarPainel(phone, evento, dados) {
  try {
    // Usar Supabase Realtime para notificar o painel
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
// API PARA O PAINEL (ENDPOINTS ADICIONAIS)
// ==========================================

// Endpoint para listar conversas (usado pelo painel)
export async function listarConversas(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

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

// Endpoint para buscar mensagens de uma conversa
export async function buscarMensagens(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const { phone } = req.query;
  if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

  try {
    const { data, error } = await supabase
      .from('conversas')
      .select('mensagens, em_intervencao, etapa, nome, dados_visita')
      .eq('telefone', phone)
      .single();

    if (error) throw error;

    res.status(200).json({
      mensagens: data.mensagens || [],
      emIntervencao: data.em_intervencao,
      etapa: data.etapa,
      nome: data.nome,
      dadosVisita: data.dados_visita
    });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

// Endpoint para intervenção humana (POST)
export async function assumirControle(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { phone } = req.body;
  if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

  try {
    const { error } = await supabase
      .from('conversas')
      .update({
        em_intervencao: true,
        etapa: FLUXO.HUMANO,
        interveniente: req.body.atendente || 'humano'
      })
      .eq('telefone', phone);

    if (error) throw error;

    // Notificar Telegram
    await enviarTelegram(`👤 <b>Atendente assumiu controle</b>\n📱 ${phone}`);

    res.status(200).json({ ok: true, message: 'Controle assumido' });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

// Endpoint para liberar robô
export async function liberarRobo(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { phone } = req.body;
  if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

  try {
    const { error } = await supabase
      .from('conversas')
      .update({
        em_intervencao: false,
        etapa: FLUXO.SAUDACAO,
        interveniente: null
      })
      .eq('telefone', phone);

    if (error) throw error;

    // Enviar mensagem ao cliente
    await enviarWhatsApp(phone, '✅ Atendimento automatizado retomado. Como posso ajudar?');

    res.status(200).json({ ok: true, message: 'Robô liberado' });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

// Endpoint para enviar mensagem pelo atendente
export async function enviarMensagemHumano(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

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
    await enviarWhatsApp(phone, message);

    // Salvar como mensagem humana
    await salvarMensagem(phone, message, 'humano', null, null);

    res.status(200).json({ ok: true, message: 'Mensagem enviada' });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}
