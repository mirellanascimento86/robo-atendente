// ============================================
// WEBHOOK WHATSAPP - RC REFORMA E CONSTRUCAO
// Versao com PAINEL DE INTERVENCAO
// ============================================

// CONFIGURACAO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';

// ============================================
// MEMORIA DO SISTEMA (substituir por banco depois)
// ============================================

// Armazena todas as conversas: { telefone -> { dados } }
const conversas = new Map();

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  // CORS - ESSENCIAL para o painel funcionar
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;

    // ===== 1. VERIFICACAO DO WEBHOOK (Meta) =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL =====
    
    // LISTAR CONVERSAS (GET ?action=list)
    if (action === 'list') {
      const lista = Array.from(conversas.values())
        .sort((a, b) => new Date(b.ultimaAtividade) - new Date(a.ultimaAtividade));
      
      return res.status(200).json({ conversas: lista });
    }

    // BUSCAR MENSAGENS (GET ?action=messages&phone=...)
    if (action === 'messages') {
      const phone = req.query.phone;
      const conv = conversas.get(phone);
      
      if (!conv) {
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }
      
      return res.status(200).json({ mensagens: conv.mensagens || [] });
    }

    // ASSUMIR CONTROLE (POST ?action=intervene)
    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      const conv = conversas.get(phone);
      
      if (conv) {
        conv.emIntervencao = true;
        conv.mensagens.push({
          tipo: 'system',
          mensagem: '⚡ Humano assumiu o controle',
          data: new Date().toISOString()
        });
      }
      
      return res.status(200).json({ ok: true, emIntervencao: true });
    }

    // LIBERAR ROBO (POST ?action=release)
    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;
      const conv = conversas.get(phone);
      
      if (conv) {
        conv.emIntervencao = false;
        conv.mensagens.push({
          tipo: 'system',
          mensagem: '🤖 Robo retomou o atendimento',
          data: new Date().toISOString()
        });
      }
      
      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    // ENVIAR MENSAGEM MANUAL (POST ?action=send)
    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;
      
      // Envia pelo WhatsApp API
      const enviado = await enviarWhatsApp(phone, message);
      
      if (enviado) {
        // Salva na conversa
        const conv = conversas.get(phone);
        if (conv) {
          conv.mensagens.push({
            tipo: 'humano',
            mensagem: message,
            data: new Date().toISOString(),
            nome: 'Atendente'
          });
          conv.ultima = message;
          conv.ultimaAtividade = new Date().toISOString();
        }
      }
      
      return res.status(200).json({ ok: enviado });
    }

    // ===== 3. RECEBER MENSAGEM DO WHATSAPP (POST normal) =====
    if (req.method === 'POST' && !action) {
      // Responde imediatamente ao Meta
      res.status(200).send('OK');
      
      // Processa em background
      processarMensagem(req.body).catch(err => {
        console.error('Erro ao processar:', err);
      });
      
      return;
    }

    // Rota padrao
    res.status(200).send('Webhook RC Reforma - OK');

  } catch (e) {
    console.error('ERRO:', e.message);
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
  
  if (changes.statuses) return; // Ignora status
  
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
      etapa: 'novo',
      ultimaAtividade: new Date().toISOString(),
      ultima: ''
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
  
  console.log(`[${telefone}] ${nome}: ${texto}`);
  
  // SE NAO ESTIVER EM INTERVENCAO, RESPONDE AUTOMATICAMENTE
  if (!conv.emIntervencao) {
    const resposta = gerarResposta(texto.toLowerCase(), nome);
    await enviarWhatsApp(telefone, resposta);
    
    // Salva resposta do bot na conversa
    conv.mensagens.push({
      tipo: 'bot',
      mensagem: resposta,
      data: new Date().toISOString(),
      nome: 'Robo'
    });
    
    conv.ultima = resposta;
    conv.ultimaAtividade = new Date().toISOString();
  }
}

// ============================================
// GERAR RESPOSTA (mesma logica)
// ============================================

function gerarResposta(texto, nome) {
  if (texto.match(/(oi|ola|bom dia|boa tarde|boa noite|hey|eai)/)) {
    return `Ola, ${nome}! Sou o assistente da RC Reforma e Construcao.

Posso ajudar com:
• Reformas: Marcenaria, Hidraulica, Eletrica, Pintura, Gesso, Pedreiro
• Eletrodomesticos: Ar Condicionado, Lava e Seca, Geladeira

Qual servico voce precisa e em qual bairro do Rio?`;
  }
  
  if (texto.match(/(preco|valor|custo|quanto|caro)/)) {
    return `Nossa visita tecnica custa R$180.

• Zona Sul: 50% OFF = R$90
• Botafogo: GRATIS

O valor da visita e abatido se voce aprovar o orcamento.

Qual servico e bairro?`;
  }
  
  if (texto.match(/(agendar|marcar|visita|tecnico|horario)/)) {
    return `Posso agendar uma visita tecnica para voce!

Me informe:
1. Qual servico precisa?
2. Qual bairro?
3. Prefere hoje, amanha ou outro dia?
4. Qual horario: manha, tarde ou noite?`;
  }
  
  if (texto.match(/(servico|faz|trabalho|ajuda)/)) {
    return `Trabalhamos com:

REFORMAS:
• Marcenaria, Hidraulica, Eletrica, Pintura, Gesso, Pedreiro

ELETRODOMESTICOS:
• Ar Condicionado, Lava e Seca, Geladeira

Qual voce precisa?`;
  }
  
  if (texto.match(/(humano|pessoa|atendente|funcionario)/)) {
    return `Entendido! Vou transferir voce para um atendente humano.

Aguarde um momento, por favor.`;
  }
  
  if (texto.match(/(tchau|ate|obrigado|valeu)/)) {
    return `Obrigado pelo contato, ${nome}!

RC Reforma e Construcao - Botafogo
Atendimento 24h`;
  }
  
  return `Entendi, ${nome}!

Para agilizar seu atendimento, me diga:
1. Qual servico precisa?
2. Qual bairro do Rio?

Ou pergunte sobre precos, horarios ou servicos disponiveis.`;
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
