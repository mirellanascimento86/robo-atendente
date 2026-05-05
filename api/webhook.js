// ============================================
// WEBHOOK WHATSAPP + API DO PAINEL HTML
// Tudo em um arquivo só
// ============================================

import { MongoClient } from 'mongodb';

// Config
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';
const MONGODB_URI = process.env.MONGODB_URI;

// Conexão MongoDB
let client = null;
let db = null;

async function connectDB() {
  if (db) return db;
  if (!MONGODB_URI) throw new Error('MONGODB_URI não configurado');
  
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db('rc_reforma');
  console.log('✅ MongoDB conectado');
  return db;
}

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action } = req.query;

    // ===== VERIFICAÇÃO META (GET com hub.mode) =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== API DO PAINEL HTML =====

    // GET ?action=list → listar conversas
    if (req.method === 'GET' && action === 'list') {
      const database = await connectDB();
      const conversas = await database.collection('conversas')
        .find({})
        .sort({ ultimaAtividade: -1 })
        .toArray();

      const lista = conversas.map(c => ({
        telefone: c.telefone,
        nome: c.nome || 'Desconhecido',
        emIntervencao: c.emIntervencao || false,
        ultima: c.ultima || 'Sem mensagens',
        ultimaAtividade: c.ultimaAtividade || new Date().toISOString()
      }));

      return res.json(lista);
    }

    // GET ?action=messages&phone=XXX → buscar mensagens
    if (req.method === 'GET' && action === 'messages') {
      const { phone } = req.query;
      if (!phone) return res.json([]);

      const database = await connectDB();
      const doc = await database.collection('mensagens').findOne({ telefone: phone });
      return res.json(doc ? doc.mensagens : []);
    }

    // POST ?action=intervene → assumir controle
    if (req.method === 'POST' && action === 'intervene') {
      const { phone } = req.body;
      if (!phone) return res.json({ erro: 'Telefone obrigatório' });

      const database = await connectDB();
      await database.collection('conversas').updateOne(
        { telefone: phone },
        { $set: { emIntervencao: true, updatedAt: new Date() } },
        { upsert: true }
      );

      await enviarWhatsApp(phone, '👤 *Atendente humano entrou no chat*\n\nComo posso ajudar?');

      await salvarMensagemDB(phone, null, {
        tipo: 'sistema',
        nome: 'Sistema',
        mensagem: 'Atendente humano entrou no chat',
        texto: 'Atendente humano entrou no chat',
        data: new Date().toISOString()
      });

      return res.json({ ok: true, mensagem: 'Intervenção ativada' });
    }

    // POST ?action=release → liberar robô
    if (req.method === 'POST' && action === 'release') {
      const { phone } = req.body;
      if (!phone) return res.json({ erro: 'Telefone obrigatório' });

      const database = await connectDB();
      await database.collection('conversas').updateOne(
        { telefone: phone },
        { $set: { emIntervencao: false, updatedAt: new Date() } },
        { upsert: true }
      );

      await enviarWhatsApp(phone, '🤖 *Robô retomou o atendimento*\n\nPosso ajudar em algo mais?');

      await salvarMensagemDB(phone, null, {
        tipo: 'sistema',
        nome: 'Sistema',
        mensagem: 'Robô retomou o atendimento',
        texto: 'Robô retomou o atendimento',
        data: new Date().toISOString()
      });

      return res.json({ ok: true, mensagem: 'Robô liberado' });
    }

    // POST ?action=send → enviar mensagem humana
    if (req.method === 'POST' && action === 'send') {
      const { phone, message } = req.body;
      if (!phone || !message) return res.json({ erro: 'Telefone e mensagem obrigatórios' });

      await enviarWhatsApp(phone, message);

      await salvarMensagemDB(phone, null, {
        tipo: 'humano',
        nome: 'Atendente',
        mensagem: message,
        texto: message,
        data: new Date().toISOString()
      });

      return res.json({ ok: true });
    }

    // ===== RECEBER MENSAGEM DO WHATSAPP =====
    if (req.method === 'POST') {
      res.status(200).send('OK');
      processarMensagem(req.body).catch(err => {
        console.error('Erro ao processar:', err);
      });
      return;
    }

    res.status(200).send('Webhook RC Reforma - OK');

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
  if (msg.type !== 'text') return;

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = msg.text.body;

  console.log(`📩 ${nome} (${telefone}): ${texto}`);

  // Salvar mensagem do cliente no MongoDB
  await salvarMensagemDB(telefone, nome, {
    tipo: 'cliente',
    nome: nome,
    mensagem: texto,
    texto: texto,
    data: new Date().toISOString()
  });

  // Verificar intervenção
  const database = await connectDB();
  const conversa = await database.collection('conversas').findOne({ telefone });
  
  if (conversa && conversa.emIntervencao) {
    console.log('🔴 Intervenção ativa - robô não responde');
    return;
  }

  // Gerar resposta do robô
  const resposta = gerarResposta(texto.toLowerCase(), nome);

  // Salvar resposta do robô
  await salvarMensagemDB(telefone, nome, {
    tipo: 'robo',
    nome: 'Assistente RC',
    mensagem: resposta,
    texto: resposta,
    data: new Date().toISOString()
  });

  // Enviar resposta
  await enviarWhatsApp(telefone, resposta);
}

// ============================================
// SALVAR MENSAGEM NO MONGODB
// ============================================

async function salvarMensagemDB(telefone, nome, mensagem) {
  const database = await connectDB();
  const conversasColl = database.collection('conversas');
  const mensagensColl = database.collection('mensagens');

  // Atualizar conversa
  await conversasColl.updateOne(
    { telefone },
    {
      $set: {
        telefone,
        nome: nome || 'Cliente',
        ultima: mensagem.mensagem || mensagem.texto,
        ultimaAtividade: new Date().toISOString(),
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date(),
        emIntervencao: false
      }
    },
    { upsert: true }
  );

  // Adicionar mensagem ao histórico
  await mensagensColl.updateOne(
    { telefone },
    {
      $push: { mensagens: mensagem },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
}

// ============================================
// LÓGICA DE RESPOSTAS DO ROBÔ
// ============================================

function gerarResposta(texto, nome) {
  if (texto.match(/(oi|ola|bom dia|boa tarde|boa noite|hey|eai)/)) {
    return `Olá, ${nome}! Sou o assistente da RC Reforma e Construção.

Posso ajudar com:
• Reformas: Marcenaria, Hidráulica, Elétrica, Pintura, Gesso, Pedreiro
• Eletrodomésticos: Ar Condicionado, Lava e Seca, Geladeira

Qual serviço você precisa e em qual bairro do Rio?`;
  }

  if (texto.match(/(preco|valor|custo|quanto|caro)/)) {
    return `Nossa visita técnica custa R$180.

• Zona Sul: 50% OFF = R$90
• Botafogo: GRÁTIS

O valor da visita é abatido se você aprovar o orçamento.

Qual serviço e bairro?`;
  }

  if (texto.match(/(agendar|marcar|visita|tecnico|horario)/)) {
    return `Posso agendar uma visita técnica para você!

Me informe:
1. Qual serviço precisa?
2. Qual bairro?
3. Prefere hoje, amanhã ou outro dia?
4. Qual horário: manhã, tarde ou noite?`;
  }

  if (texto.match(/(servico|faz|trabalho|ajuda)/)) {
    return `Trabalhamos com:

REFORMAS:
• Marcenaria (armários, cozinhas, closets)
• Hidráulica (vazamentos, torneiras, encanamento)
• Elétrica (fiação, tomadas, chuveiros)
• Pintura (interna e externa)
• Gesso (drywall, sancas, forros)
• Pedreiro (reformas, alvenaria)

ELETRODOMÉSTICOS:
• Ar Condicionado (instalação, limpeza, conserto)
• Lava e Seca (conserto, manutenção)
• Geladeira (conserto, gás, motor)

Qual você precisa?`;
  }

  if (texto.match(/(bairro|onde|local|endereco)/)) {
    return `Atendemos toda a Zona Sul, Centro e Tijuca do Rio de Janeiro.

Bairros principais:
• Botafogo (visita GRÁTIS)
• Copacabana, Ipanema, Leblon
• Flamengo, Laranjeiras, Catete
• Lapa, Centro, Santa Teresa
• Tijuca, Vila Isabel

Qual o seu bairro?`;
  }

  if (texto.match(/(humano|pessoa|atendente|funcionario)/)) {
    return `Entendido! Vou transferir você para um atendente humano.

Aguarde um momento, por favor. 👤`;
  }

  if (texto.match(/(tchau|ate|obrigado|valeu)/)) {
    return `Obrigado pelo contato, ${nome}!

Se precisar de mais alguma coisa, é só chamar.

RC Reforma e Construção - Botafogo
Atendimento 24h`;
  }

  return `Entendi, ${nome}!

Para agilizar seu atendimento, me diga:
1. Qual serviço precisa? (ex: hidráulica, pintura, ar condicionado)
2. Qual bairro do Rio?

Ou se preferir, me pergunte sobre preços, horários ou serviços disponíveis.`;
}

// ============================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ Variáveis não configuradas!');
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
      console.error('❌ Erro WhatsApp API:', response.status, erro);
      return false;
    }

    console.log('✅ Enviado para', numero);
    return true;

  } catch (e) {
    console.error('❌ Erro ao enviar:', e.message);
    return false;
  }
}
