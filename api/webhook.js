// ============================================================
// WEBHOOK WHATSAPP PRO - RC REFORMA E CONSTRUCAO
// MongoDB + Backup Email + Persistencia Total
// ============================================================

import { MongoClient } from 'mongodb';
import nodemailer from 'nodemailer';

// CONFIGURACAO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'roboatendente';
const MONGODB_URI = process.env.MONGODB_URI;
const EMAIL_USER = process.env.EMAIL_USER;      // ex: seuemail@gmail.com
const EMAIL_PASS = process.env.EMAIL_PASS;      // senha de app do Gmail
const EMAIL_BACKUP = process.env.EMAIL_BACKUP;  // email que recebe backup

// Conexao MongoDB
let client = null;
let db = null;

async function getDb() {
  if (!client) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('whatsapp_pro');
    console.log('[DB] Conectado ao MongoDB');
  }
  return db;
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = await getDb();
    const conversasCol = db.collection('conversas');
    const { action } = req.query;

    // ===== 1. VERIFICACAO WEBHOOK META =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL =====

    // LISTAR CONVERSAS
    if (action === 'list') {
      const lista = await conversasCol
        .find({}, { projection: { mensagens: { $slice: -1 } } })
        .sort({ ultimaAtividade: -1 })
        .limit(200)
        .toArray();

      // Formatar para o painel
      const formatadas = lista.map(c => ({
        telefone: c.telefone,
        nome: c.nome,
        emIntervencao: c.emIntervencao || false,
        etapa: c.etapa || 'novo',
        ultimaAtividade: c.ultimaAtividade,
        ultima: c.ultima || 'Sem mensagens',
        mensagens: c.mensagens || []
      }));

      return res.status(200).json({ conversas: formatadas });
    }

    // BUSCAR MENSAGENS COMPLETAS
    if (action === 'messages') {
      const phone = req.query.phone;
      const conv = await conversasCol.findOne({ telefone: phone });

      if (!conv) {
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }

      return res.status(200).json({ 
        mensagens: conv.mensagens || [],
        emIntervencao: conv.emIntervencao || false,
        telefone: conv.telefone,
        nome: conv.nome
      });
    }

    // ASSUMIR CONTROLE
    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;

      await conversasCol.updateOne(
        { telefone: phone },
        { 
          $set: { 
            emIntervencao: true,
            ultimaAtividade: new Date().toISOString()
          },
          $push: {
            mensagens: {
              tipo: 'system',
              mensagem: '⚡ Humano assumiu o controle',
              data: new Date().toISOString(),
              nome: 'Sistema'
            }
          }
        },
        { upsert: true }
      );

      return res.status(200).json({ ok: true, emIntervencao: true });
    }

    // LIBERAR ROBO
    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;

      await conversasCol.updateOne(
        { telefone: phone },
        { 
          $set: { 
            emIntervencao: false,
            ultimaAtividade: new Date().toISOString()
          },
          $push: {
            mensagens: {
              tipo: 'system',
              mensagem: '🤖 Robo retomou o atendimento',
              data: new Date().toISOString(),
              nome: 'Sistema'
            }
          }
        }
      );

      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    // ENVIAR MENSAGEM MANUAL
    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;

      const conv = await conversasCol.findOne({ telefone: phone });

      if (!conv || !conv.emIntervencao) {
        return res.status(403).json({ 
          ok: false, 
          erro: 'Nao esta em intervencao',
          emIntervencao: conv?.emIntervencao || false
        });
      }

      const enviado = await enviarWhatsApp(phone, message);

      if (enviado) {
        await conversasCol.updateOne(
          { telefone: phone },
          {
            $push: {
              mensagens: {
                tipo: 'humano',
                mensagem: message,
                data: new Date().toISOString(),
                nome: 'Atendente'
              }
            },
            $set: {
              ultima: message,
              ultimaAtividade: new Date().toISOString()
            }
          }
        );
      }

      return res.status(200).json({ ok: enviado });
    }

    // BACKUP MANUAL
    if (action === 'backup' && req.method === 'POST') {
      const { email } = req.body;
      const resultado = await fazerBackup(email || EMAIL_BACKUP);
      return res.status(200).json({ ok: resultado });
    }

    // EXPORTAR CONVERSA
    if (action === 'export' && req.method === 'GET') {
      const phone = req.query.phone;
      const conv = await conversasCol.findOne({ telefone: phone });

      if (!conv) return res.status(404).json({ erro: 'Nao encontrado' });

      const csv = converterParaCSV(conv.mensagens || []);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="conversa_${phone}.csv"`);
      return res.status(200).send(csv);
    }

    // ===== 3. RECEBER MENSAGEM DO WHATSAPP =====
    if (req.method === 'POST' && !action) {
      res.status(200).send('OK');
      processarMensagem(req.body, conversasCol).catch(console.error);
      return;
    }

    res.status(200).send('Webhook RC Reforma Pro - OK');

  } catch (e) {
    console.error('ERRO:', e);
    res.status(200).send('OK');
  }
}

// ============================================================
// PROCESSAR MENSAGEM RECEBIDA
// ============================================================

async function processarMensagem(body, conversasCol) {
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
  const agora = new Date().toISOString();

  console.log(`[RECEBIDO] ${telefone} (${nome}): ${texto.substring(0, 60)}`);

  // Buscar ou criar conversa no MongoDB
  let conv = await conversasCol.findOne({ telefone: telefone });

  if (!conv) {
    conv = {
      telefone: telefone,
      nome: nome,
      mensagens: [],
      emIntervencao: false,
      etapa: 'novo',
      ultimaAtividade: agora,
      ultima: '',
      criadoEm: agora
    };
    await conversasCol.insertOne(conv);
  }

  // Adicionar mensagem do cliente
  const mensagemCliente = {
    tipo: 'cliente',
    mensagem: texto,
    data: agora,
    nome: nome
  };

  await conversasCol.updateOne(
    { telefone: telefone },
    {
      $push: { mensagens: mensagemCliente },
      $set: {
        nome: nome,
        ultima: texto,
        ultimaAtividade: agora
      }
    }
  );

  // Se nao estiver em intervencao, responde automaticamente
  if (!conv.emIntervencao) {
    const resposta = gerarResposta(texto.toLowerCase(), nome);
    const enviado = await enviarWhatsApp(telefone, resposta);

    if (enviado) {
      await conversasCol.updateOne(
        { telefone: telefone },
        {
          $push: {
            mensagens: {
              tipo: 'bot',
              mensagem: resposta,
              data: new Date().toISOString(),
              nome: 'Robo'
            }
          },
          $set: {
            ultima: resposta,
            ultimaAtividade: new Date().toISOString()
          }
        }
      );
    }
  } else {
    console.log(`[BOT] BLOQUEADO - conversa em intervencao humana`);
  }
}

// ============================================================
// GERAR RESPOSTA
// ============================================================

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

// ============================================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ============================================================

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

    return true;
  } catch (e) {
    console.error('Erro ao enviar:', e.message);
    return false;
  }
}

// ============================================================
// BACKUP POR EMAIL
// ============================================================

async function fazerBackup(emailDestino) {
  if (!EMAIL_USER || !EMAIL_PASS || !emailDestino) {
    console.log('[BACKUP] Email nao configurado');
    return false;
  }

  try {
    const db = await getDb();
    const conversasCol = db.collection('conversas');
    const todas = await conversasCol.find({}).toArray();

    // Criar CSV
    let csv = 'Telefone,Nome,Data,Ultima Mensagem,Em Intervencao\n';
    todas.forEach(c => {
      csv += `"${c.telefone}","${c.nome || ''}","${c.ultimaAtividade || ''}","${(c.ultima || '').replace(/"/g, '""')}","${c.emIntervencao ? 'SIM' : 'NAO'}"\n`;
    });

    // Enviar email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: EMAIL_USER,
      to: emailDestino,
      subject: `Backup WhatsApp Pro - ${new Date().toLocaleDateString('pt-BR')}`,
      text: `Backup automatico do WhatsApp Pro.\nTotal de conversas: ${todas.length}\nData: ${new Date().toLocaleString('pt-BR')}`,
      attachments: [{
        filename: `backup_whatsapp_${new Date().toISOString().split('T')[0]}.csv`,
        content: csv
      }]
    });

    console.log('[BACKUP] Enviado para', emailDestino);
    return true;
  } catch (e) {
    console.error('[BACKUP] Erro:', e.message);
    return false;
  }
}

function converterParaCSV(mensagens) {
  let csv = 'Data,Tipo,Remetente,Mensagem\n';
  mensagens.forEach(m => {
    const data = new Date(m.data).toLocaleString('pt-BR');
    const tipo = m.tipo || 'desconhecido';
    const nome = m.nome || '';
    const msg = (m.mensagem || '').replace(/"/g, '""');
    csv += `"${data}","${tipo}","${nome}","${msg}"\n`;
  });
  return csv;
}
