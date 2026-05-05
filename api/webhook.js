// ============================================
// WEBHOOK WHATSAPP - RC REFORMA E CONSTRUCAO
// Versao MINIMA e FUNCIONAL
// Apenas recebe mensagem e responde no WhatsApp
// ============================================

// CONFIGURACAO - Variaveis de ambiente da Vercel
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';  // Mesmo do Meta Developers

// ============================================
// HANDLER PRINCIPAL - Endpoint /api/webhook
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // ===== VERIFICACAO DO WEBHOOK (Meta) =====
    // Quando voce configura o webhook no Meta Developers,
    // ele envia um GET para verificar se a URL existe
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      console.log('Verificacao webhook Meta:', req.query);

      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        console.log('Token verificado com sucesso!');
        return res.status(200).send(req.query['hub.challenge']);
      }

      console.log('Token de verificacao invalido');
      return res.status(403).send('Forbidden');
    }

    // ===== RECEBER MENSAGEM DO WHATSAPP =====
    if (req.method === 'POST') {
      // Responde imediatamente ao Meta (obrigatorio - 20 segundos max)
      res.status(200).send('OK');

      // Processa a mensagem em background (sem bloquear a resposta)
      processarMensagem(req.body).catch(err => {
        console.error('Erro ao processar mensagem:', err);
      });

      return;
    }

    // Qualquer outra requisicao
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
  console.log('Body recebido:', JSON.stringify(body, null, 2));

  // Verifica se e uma mensagem valida do WhatsApp
  if (!body || body.object !== 'whatsapp_business_account') {
    console.log('Nao e mensagem do WhatsApp Business');
    return;
  }

  // Extrai dados da mensagem
  const entry = body.entry?.[0];
  if (!entry) {
    console.log('Sem entry no body');
    return;
  }

  const changes = entry.changes?.[0]?.value;
  if (!changes) {
    console.log('Sem changes no entry');
    return;
  }

  // Ignora atualizacoes de status (mensagem entregue, lida, etc)
  if (changes.statuses) {
    console.log('Ignorando status update');
    return;
  }

  // Pega a mensagem
  const msg = changes.messages?.[0];
  if (!msg) {
    console.log('Sem mensagem no changes');
    return;
  }

  const telefone = msg.from;  // Numero do cliente
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';

  console.log(`Mensagem de ${nome} (${telefone}):`, msg.type);

  // So processa mensagens de texto por enquanto
  if (msg.type !== 'text') {
    console.log('Tipo de mensagem nao suportado:', msg.type);
    return;
  }

  const texto = msg.text.body;
  console.log('Texto:', texto);

  // Gera resposta baseada no texto
  const resposta = gerarResposta(texto.toLowerCase(), nome);

  // Envia resposta de volta no WhatsApp
  await enviarWhatsApp(telefone, resposta);
}

// ============================================
// GERAR RESPOSTA (logica simples)
// ============================================

function gerarResposta(texto, nome) {
  // Saudacao
  if (texto.match(/(oi|ola|bom dia|boa tarde|boa noite|hey|eai)/)) {
    return `Ola, ${nome}! Sou o assistente da RC Reforma e Construcao.

Posso ajudar com:
• Reformas: Marcenaria, Hidraulica, Eletrica, Pintura, Gesso, Pedreiro
• Eletrodomesticos: Ar Condicionado, Lava e Seca, Geladeira

Qual servico voce precisa e em qual bairro do Rio?`;
  }

  // Preco
  if (texto.match(/(preco|valor|custo|quanto|caro)/)) {
    return `Nossa visita tecnica custa R$180.

• Zona Sul: 50% OFF = R$90
• Botafogo: GRATIS

O valor da visita e abatido se voce aprovar o orcamento.

Qual servico e bairro?`;
  }

  // Agendamento
  if (texto.match(/(agendar|marcar|visita|tecnico|horario)/)) {
    return `Posso agendar uma visita tecnica para voce!

Me informe:
1. Qual servico precisa?
2. Qual bairro?
3. Prefere hoje, amanha ou outro dia?
4. Qual horario: manha, tarde ou noite?`;
  }

  // Servicos
  if (texto.match(/(servico|faz|trabalho|ajuda)/)) {
    return `Trabalhamos com:

REFORMAS:
• Marcenaria (armarios, cozinhas, closets)
• Hidraulica (vazamentos, torneiras, encanamento)
• Eletrica (fiacao, tomadas, chuveiros)
• Pintura (interna e externa)
• Gesso (drywall, sancas, forros)
• Pedreiro (reformas, alvenaria)

ELETRODOMESTICOS:
• Ar Condicionado (instalacao, limpeza, conserto)
• Lava e Seca (conserto, manutencao)
• Geladeira (conserto, gas, motor)

Qual voce precisa?`;
  }

  // Bairros
  if (texto.match(/(bairro|onde|local|endereco)/)) {
    return `Atendemos toda a Zona Sul, Centro e Tijuca do Rio de Janeiro.

Bairros principais:
• Botafogo (visita GRATIS)
• Copacabana, Ipanema, Leblon
• Flamengo, Laranjeiras, Catete
• Lapa, Centro, Santa Teresa
• Tijuca, Vila Isabel

Qual o seu bairro?`;
  }

  // Humanos
  if (texto.match(/(humano|pessoa|atendente|funcionario)/)) {
    return `Entendido! Vou transferir voce para um atendente humano.

Aguarde um momento, por favor.`;
  }

  // Despedida
  if (texto.match(/(tchau|ate|obrigado|valeu)/)) {
    return `Obrigado pelo contato, ${nome}!

Se precisar de mais alguma coisa, e so chamar.

RC Reforma e Construcao - Botafogo
Atendimento 24h`;
  }

  // Resposta padrao
  return `Entendi, ${nome}!

Para agilizar seu atendimento, me diga:
1. Qual servico precisa? (ex: hidraulica, pintura, ar condicionado)
2. Qual bairro do Rio?

Ou se preferir, me pergunte sobre precos, horarios ou servicos disponiveis.`;
}

// ============================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`Enviando para ${numero}: ${texto.substring(0, 50)}...`);

  // Verifica se tem as variaveis configuradas
  if (!WHATSAPP_TOKEN) {
    console.error('ERRO: WHATSAPP_TOKEN nao configurado!');
    return false;
  }

  if (!WHATSAPP_PHONE_ID) {
    console.error('ERRO: WHATSAPP_PHONE_ID nao configurado!');
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
      console.error('Erro WhatsApp API:', response.status, erro);
      return false;
    }

    console.log('Mensagem enviada com sucesso!');
    return true;

  } catch (e) {
    console.error('Erro ao enviar mensagem:', e.message);
    return false;
  }
}
