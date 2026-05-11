// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// Versao com PAINEL DE INTERVENCAO
// ============================================

// CONFIGURACAO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

// ============================================
// MEMORIA DO SISTEMA
// ============================================
const conversas = new Map();

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;
    console.log(`[WEBHOOK] ${req.method} action=${action} query=`, req.query);

    // ===== 1. VERIFICACAO DO WEBHOOK (Meta) =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL =====

    // LISTAR CONVERSAS
    if (action === 'list') {
      const lista = Array.from(conversas.values())
        .sort((a, b) => new Date(b.ultimaAtividade || 0) - new Date(a.ultimaAtividade || 0));

      console.log(`[LIST] Retornando ${lista.length} conversas`);
      return res.status(200).json({ conversas: lista });
    }

    // BUSCAR MENSAGENS
    if (action === 'messages') {
      const phone = req.query.phone;
      const conv = conversas.get(phone);

      if (!conv) {
        console.log(`[MESSAGES] Conversa nao encontrada: ${phone}`);
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }

      console.log(`[MESSAGES] ${phone} - ${conv.mensagens?.length || 0} msgs, intervencao=${conv.emIntervencao}`);
      return res.status(200).json({ 
        mensagens: conv.mensagens || [],
        emIntervencao: conv.emIntervencao,
        telefone: conv.telefone,
        nome: conv.nome
      });
    }

    // ASSUMIR CONTROLE
    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      console.log(`[INTERVENE] Recebido phone=${phone}`);

      const conv = conversas.get(phone);

      if (!conv) {
        console.log(`[INTERVENE] Conversa nao existe, criando...`);
        conversas.set(phone, {
          telefone: phone,
          nome: 'Cliente',
          mensagens: [],
          emIntervencao: true,
          etapa: 'intervencao',
          ultimaAtividade: new Date().toISOString(),
          ultima: 'Intervencao iniciada'
        });
      } else {
        conv.emIntervencao = true;
        conv.ultimaAtividade = new Date().toISOString();
        conv.mensagens.push({
          tipo: 'system',
          mensagem: '⚡ Humano assumiu o controle',
          data: new Date().toISOString(),
          nome: 'Sistema'
        });
        console.log(`[INTERVENE] Conversa ${phone} agora emIntervencao=true`);
      }

      const convAtual = conversas.get(phone);
      return res.status(200).json({ 
        ok: true, 
        emIntervencao: true,
        telefone: phone,
        confirmado: convAtual.emIntervencao
      });
    }

    // LIBERAR ROBO
    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;
      console.log(`[RELEASE] phone=${phone}`);

      const conv = conversas.get(phone);

      if (conv) {
        conv.emIntervencao = false;
        conv.ultimaAtividade = new Date().toISOString();
        conv.mensagens.push({
          tipo: 'system',
          mensagem: '🤖 Robo retomou o atendimento',
          data: new Date().toISOString(),
          nome: 'Sistema'
        });
        console.log(`[RELEASE] Conversa ${phone} emIntervencao=false`);
      }

      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    // ENVIAR MENSAGEM MANUAL
    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;
      console.log(`[SEND] phone=${phone} message="${message?.substring(0,30)}..."`);

      const conv = conversas.get(phone);

      // VERIFICACAO CRITICA: so envia se estiver em intervencao
      if (!conv || !conv.emIntervencao) {
        console.log(`[SEND] BLOQUEADO - emIntervencao=${conv?.emIntervencao}`);
        return res.status(403).json({ 
          ok: false, 
          erro: 'Nao esta em intervencao',
          emIntervencao: conv?.emIntervencao || false
        });
      }

      // Envia pelo WhatsApp API
      const enviado = await enviarWhatsApp(phone, message);

      if (enviado) {
        conv.mensagens.push({
          tipo: 'humano',
          mensagem: message,
          data: new Date().toISOString(),
          nome: 'Atendente'
        });
        conv.ultima = message;
        conv.ultimaAtividade = new Date().toISOString();
        console.log(`[SEND] Mensagem enviada e salva`);
      }

      return res.status(200).json({ ok: enviado });
    }

    // ===== 3. RECEBER MENSAGEM DO WHATSAPP =====
    if (req.method === 'POST' && !action) {
      res.status(200).send('OK');

      processarMensagem(req.body).catch(err => {
        console.error('Erro ao processar:', err);
      });

      return;
    }

    res.status(200).send('Webhook Conserta Rio - OK');

  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAR MENSAGEM RECEBIDA
// ============================================

async function processarMensagem(body) {
  if (!body || body.object !== 'whatsapp_business_account') return;

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  if (!changes) return;

  if (changes.statuses) return;

  const msg = changes.messages?.[0];
  if (!msg) return;

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';

  if (msg.type !== 'text') return;

  const texto = msg.text.body;

  // CRIAR/ATUALIZAR CONVERSA
  if (!conversas.has(telefone)) {
    conversas.set(telefone, {
      telefone: telefone,
      nome: nome,
      mensagens: [],
      emIntervencao: false,
      etapa: 'saudacao',
      ultimaAtividade: new Date().toISOString(),
      ultima: '',
      equipamento: '',
      marca: '',
      bairro: '',
      endereco: '',
      dataVisita: '',
      horarioVisita: ''
    });
  }

  const conv = conversas.get(telefone);

  // ADICIONAR MENSAGEM DO CLIENTE
  conv.mensagens.push({
    tipo: 'cliente',
    mensagem: texto,
    data: new Date().toISOString(),
    nome: nome
  });

  conv.ultima = texto;
  conv.ultimaAtividade = new Date().toISOString();

  console.log(`[RECEBIDO] ${telefone} (${nome}): ${texto.substring(0,50)}`);
  console.log(`[ESTADO] emIntervencao=${conv.emIntervencao}, etapa=${conv.etapa}`);

  // SE NAO ESTIVER EM INTERVENCAO, RESPONDE AUTOMATICAMENTE
  if (!conv.emIntervencao) {
    const resposta = gerarResposta(texto, nome, conv);
    
    if (resposta) {
      await enviarWhatsApp(telefone, resposta);

      conv.mensagens.push({
        tipo: 'bot',
        mensagem: resposta,
        data: new Date().toISOString(),
        nome: 'Robo'
      });

      conv.ultima = resposta;
      conv.ultimaAtividade = new Date().toISOString();
      console.log(`[BOT] Resposta automatica enviada`);
    }
  } else {
    console.log(`[BOT] BLOQUEADO - conversa em intervencao humana`);
  }
}

// ============================================
// GERAR RESPOSTA - FLUXO CONSERTA RIO
// ============================================

function gerarResposta(texto, nome, conv) {
  const txt = texto.toLowerCase().trim();
  const etapa = conv.etapa;

  // ===== SOLICITACAO DE HUMANO =====
  if (txt.match(/(humano|pessoa|atendente|funcionario|falar com|falar com alguem|atendente humano)/)) {
    conv.emIntervencao = true;
    enviarTelegramIntervencao(conv.telefone, nome);
    return 'Um momento.';
  }

  // ===== FLUXO PRINCIPAL =====

  // ETAPA: SAUDACAO (primeira mensagem ou sem contexto)
  if (etapa === 'saudacao') {
    conv.etapa = 'equipamento';
    return 'Ola! Qual equipamento esta com problema e qual a marca?';
  }

  // ETAPA: EQUIPAMENTO (recebeu info do equipamento e marca)
  if (etapa === 'equipamento') {
    // Tenta extrair equipamento e marca da mensagem
    const info = extrairEquipamentoMarca(texto);
    if (info.equipamento) conv.equipamento = info.equipamento;
    if (info.marca) conv.marca = info.marca;
    
    conv.etapa = 'perguntar_visita';
    return 'Gostaria de marcar uma visita para hoje?';
  }

  // ETAPA: PERGUNTAR VISITA (resposta sim/nao para visita hoje)
  if (etapa === 'perguntar_visita') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top)/)) {
      conv.etapa = 'perguntar_bairro';
      return 'Qual o bairro?';
    } else if (txt.match(/(nao|não|nop|negativo|depois|outro dia|amanha|outro|mais tarde)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Quando poderia?';
    } else {
      // Se resposta nao clara, repete a pergunta
      return 'Gostaria de marcar uma visita para hoje?';
    }
  }

  // ETAPA: PERGUNTAR QUANDO (cliente disse nao para hoje)
  if (etapa === 'perguntar_quando') {
    conv.dataVisita = texto;
    conv.etapa = 'perguntar_horario';
    return 'Qual horario?';
  }

  // ETAPA: PERGUNTAR HORARIO
  if (etapa === 'perguntar_horario') {
    conv.horarioVisita = texto;
    conv.etapa = 'perguntar_endereco';
    return 'Qual o endereco?';
  }

  // ETAPA: PERGUNTAR BAIRRO (cliente disse sim para visita hoje)
  if (etapa === 'perguntar_bairro') {
    conv.bairro = texto;
    
    const bairroLower = txt;
    
    // Verifica se e Botafogo
    if (bairroLower.includes('botafogo')) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 100;
      return 'Em Botafogo a taxa da visita e R$100. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Verifica Zona Sul
    if (ehZonaSul(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 120;
      return 'Na Zona Sul a taxa da visita e R$120. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Verifica Zona Norte
    if (ehZonaNorte(bairroLower)) {
      conv.etapa = 'confirmar_taxa';
      conv.valorVisita = 190;
      return 'Na Zona Norte a taxa da visita e R$190. Essa taxa e deduzida do valor final, caso o orcamento seja aprovado. Gostaria de prosseguir?';
    }
    
    // Barra da Tijuca, Baixada ou outras regioes nao atendidas
    if (bairroLower.includes('barra') || bairroLower.includes('baixada') || bairroLower.includes('jacarepagua') || bairroLower.includes('recreio')) {
      conv.etapa = 'nao_atende';
      return 'Infelizmente nao atendemos na sua regiao no momento.';
    }
    
    // Se nao reconhecer o bairro, pergunta novamente ou assume zona sul
    // Por padrao, vamos perguntar de qual regiao
    conv.etapa = 'confirmar_taxa';
    conv.valorVisita = 120;
    return 'Qual a regiao? (Zona Sul, Zona Norte, Centro, etc.)';
  }

  // ETAPA: CONFIRMAR TAXA
  if (etapa === 'confirmar_taxa') {
    if (txt.match(/(sim|quero|pode ser|claro|ok|pode|gostaria|top|prossiga)/)) {
      conv.etapa = 'perguntar_endereco';
      return 'Qual o endereco?';
    } else if (txt.match(/(nao|não|nop|negativo|cancelar)/)) {
      conv.etapa = 'perguntar_quando';
      return 'Quando poderia?';
    } else {
      return 'Gostaria de prosseguir?';
    }
  }

  // ETAPA: PERGUNTAR ENDERECO
  if (etapa === 'perguntar_endereco') {
    conv.endereco = texto;
    conv.etapa = 'visita_marcada';
    
    // Envia para o Telegram
    enviarTelegramVisita(conv);
    
    return `Visita marcada para ${conv.dataVisita || 'hoje'} as ${conv.horarioVisita || 'a combinar'}.
    
Endereco: ${conv.endereco}
Taxa da visita: R$${conv.valorVisita}

Um tecnico da Conserta Rio entrara em contato para confirmar. Obrigado!`;
  }

  // ETAPA: VISITA MARCADA ou NAO ATENDE - resposta generica
  if (etapa === 'visita_marcada' || etapa === 'nao_atende') {
    return 'Posso ajudar com mais alguma coisa? Caso queira falar com um atendente, digite "humano".';
  }

  // Fallback: se etapa nao reconhecida, volta para pergunta de visita
  conv.etapa = 'perguntar_visita';
  return 'Gostaria de marcar uma visita para hoje?';
}

// ============================================
// FUNCOES AUXILIARES
// ============================================

function extrairEquipamentoMarca(texto) {
  const txt = texto.toLowerCase();
  
  const equipamentos = [
    'maquina de lavar', 'lava e seca', 'lava-seca', 'lavaeseca',
    'frigobar', 'geladeira', 'ar condicionado', 'ar-condicionado', 'arcondicionado'
  ];
  
  let equipamento = '';
  let marca = '';
  
  for (const eq of equipamentos) {
    if (txt.includes(eq)) {
      equipamento = eq;
      break;
    }
  }
  
  // Se nao encontrou equipamento especifico, usa o texto todo como equipamento
  if (!equipamento) {
    equipamento = texto;
  }
  
  // Tenta extrair marca (palavras comuns de marca)
  const marcas = ['brastemp', 'consul', 'electrolux', 'lg', 'samsung', 'panasonic', 'midea', 'springer', 'carrier', 'fujitsu', 'gree', 'philco', 'eletrolux'];
  for (const m of marcas) {
    if (txt.includes(m)) {
      marca = m;
      break;
    }
  }
  
  return { equipamento, marca };
}

function ehZonaSul(bairro) {
  const bairrosZonaSul = [
    'copacabana', 'ipanema', 'leblon', 'laranjeiras', 'flamengo', 'botafogo',
    'humaita', 'jardim botanico', 'gavea', 'sao conrado', 'vidigal', 'rocinha',
    'catete', 'gloria', 'cosme velho', 'santa teresa', 'urca', 'leme'
  ];
  return bairrosZonaSul.some(b => bairro.includes(b));
}

function ehZonaNorte(bairro) {
  const bairrosZonaNorte = [
    'tijuca', 'vila isabel', 'grajau', 'andaraí', 'maracana', 'engenho novo',
    'engenho de dentro', 'meier', 'alto da boa vista', 'praça da bandeira',
    'riachuelo', 'sao cristovao', 'benfica', 'caju', 'centro', 'lapa', 'cidade nova',
    'estacio', 'saude', ' gamboa', 'santo cristo', 'catumbi', 'rio comprido',
    'sao francisco xavier', 'jacarezinho', 'manguinhos', 'complexo', 'rocha',
    'rocha miranda', 'honorio gurgel', 'marechal hermes', 'deodoro', 'bento ribeiro',
    'oswaldo cruz', 'madureira', 'campinho', 'cascadura', 'quintino', 'pilares'
  ];
  return bairrosZonaNorte.some(b => bairro.includes(b));
}

// ============================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('Token ou Phone ID nao configurado');
    return false;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: numero,
          type: 'text',
          text: { body: texto }
        })
      }
    );

    if (!response.ok) {
      const erro = await response.json();
      console.error('Erro API:', erro);
      return false;
    }

    console.log('Mensagem enviada para', numero);
    return true;

  } catch (e) {
    console.error('Erro ao enviar:', e.message);
    return false;
  }
}

// ============================================
// TELEGRAM - ENVIO DE NOTIFICACOES
// ============================================

async function enviarTelegramVisita(conv) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    console.error('Telegram nao configurado');
    return;
  }

  const mensagem = `🛠️ *NOVA VISITA MARCADA - CONSERTA RIO*

📱 *Numero:* ${conv.telefone}
👤 *Nome:* ${conv.nome}
📍 *Endereco:* ${conv.endereco}
🏘️ *Bairro:* ${conv.bairro}
🔧 *Equipamento:* ${conv.equipamento}
🏷️ *Marca:* ${conv.marca || 'Nao informada'}
📅 *Data:* ${conv.dataVisita || 'Hoje'}
🕐 *Horario:* ${conv.horarioVisita || 'A combinar'}
💰 *Taxa Visita:* R$${conv.valorVisita || '---'}`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    console.log('[TELEGRAM] Visita enviada ao grupo');
  } catch (e) {
    console.error('[TELEGRAM] Erro:', e.message);
  }
}

async function enviarTelegramIntervencao(telefone, nome) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
    console.error('Telegram nao configurado');
    return;
  }

  const mensagem = `🚨 *INTERVENCAO HUMANA SOLICITADA - CONSERTA RIO*

📱 *Numero:* ${telefone}
👤 *Nome:* ${nome}

O cliente solicitou falar com um atendente humano.`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    console.log('[TELEGRAM] Intervencao enviada ao grupo');
  } catch (e) {
    console.error('[TELEGRAM] Erro:', e.message);
  }
}
