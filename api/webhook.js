// ============================================
// RC ATENDIMENTO - WHATSAPP BOT COMPLETO
// Tudo em um único arquivo
// ============================================

// CONFIGURAÇÕES - Edite aqui se precisar
const CONFIG = {
  // Números dos técnicos (com código do país 55)
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176'
  },
  
  // Preços
  precoZonaSul: 180,
  precoOutros: 220,
  
  // Bairros Zona Sul (adicione mais se necessário)
  bairrosZonaSul: ['ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 'lagoa', 'gávea', 'jardim botânico', 'humaitá', 'urca', 'catete', 'glória', 'laranjeiras'],
  
  // Mensagens
  saudacao: `Olá! Bem-vindo ao Atendimento Digital da RC. Sou seu consultor virtual. Qual serviço você precisa e em qual bairro?`
};

// Pega variáveis de ambiente
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Memória temporária (reset quando reiniciar)
const clientes = {};

// ============================================
// HANDLER PRINCIPAL (Vercel/Node.js)
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // 1. VERIFICAÇÃO DO WEBHOOK (Meta/WhatsApp)
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      
      if (mode === 'subscribe' && token === 'roboatendente') {
        console.log('✅ Webhook verificado');
        return res.status(200).send(challenge);
      }
      return res.status(403).send('Forbidden');
    }
    
    // 2. RECEBER MENSAGEM (POST do WhatsApp)
    if (req.method === 'POST') {
      return await receberMensagem(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('❌ ERRO:', erro);
    return res.status(200).send('OK'); // Sempre retorna 200 pro WhatsApp
  }
}

// ============================================
// PROCESSAR MENSAGEM RECEBIDA
// ============================================

async function receberMensagem(req, res) {
  const body = req.body;
  
  // Verifica se é evento do WhatsApp
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  // Extrai dados da mensagem
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (!message || message.type !== 'text') {
    return res.status(200).send('OK');
  }
  
  const telefone = message.from;
  const nome = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = message.text.body;
  
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Inicializa cliente se for novo
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      etapa: 'inicio',
      servico: null,
      bairro: null,
      valor: null,
      data: null,
      hora: null,
      endereco: null
    };
  }
  
  const cliente = clientes[telefone];
  
  // PROCESSA A MENSAGEM E GERA RESPOSTA
  const resposta = await processarMensagem(cliente, texto);
  
  // ENVIA RESPOSTA DE VOLTA
  if (resposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      console.log('✅ Resposta enviada');
    } else {
      console.error('❌ Falha ao enviar resposta');
    }
  }
  
  return res.status(200).send('OK');
}

// ============================================
// LÓGICA DO AT ATENDIMENTO (IA Simplificada)
// ============================================

async function processarMensagem(cliente, texto) {
  const t = texto.toLowerCase();
  
  // ETAPA 1: Saudação inicial
  if (cliente.etapa === 'inicio') {
    cliente.etapa = 'coletando_servico';
    return CONFIG.saudacao;
  }
  
  // ETAPA 2: Receber serviço e bairro
  if (cliente.etapa === 'coletando_servico') {
    // Tenta extrair serviço e bairro com IA ou análise simples
    const info = await extrairInformacoes(texto);
    
    if (info.servico) cliente.servico = info.servico;
    if (info.bairro) cliente.bairro = info.bairro;
    
    // Se ainda não tem ambos
    if (!cliente.servico && !cliente.bairro) {
      return `Por favor, me informe o serviço que deseja (pintura, reforma, marcenaria, etc) e o bairro.`;
    }
    if (!cliente.servico) {
      return `Qual serviço você precisa? (pintura, reforma, marcenaria, gesso, elétrica, hidráulica)`;
    }
    if (!cliente.bairro) {
      return `Em qual bairro precisa do serviço?`;
    }
    
    // Tem ambos - calcula valor
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => cliente.bairro.toLowerCase().includes(b));
    cliente.valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
    const regiao = isZonaSul ? 'Zona Sul' : 'sua região';
    
    cliente.etapa = 'aguardando_data';
    
    return `Perfeito! Para ${cliente.servico} no bairro ${cliente.bairro} (${regiao}):

💰 Valor da visita técnica: R$${cliente.valor}
✅ Será abatido do orçamento final se aprovar
💳 Pagamento no ato da visita (Pix, cartão ou dinheiro)

Para quando você gostaria de agendar? (dia e horário)`;
  }
  
  // ETAPA 3: Receber data/hora
  if (cliente.etapa === 'aguardando_data') {
    // Extrai data e hora do texto
    const { data, hora } = extrairDataHora(texto);
    
    if (data) cliente.data = data;
    if (hora) cliente.hora = hora;
    
    if (!cliente.data || !cliente.hora) {
      return `Por favor, informe o dia e o horário que prefere (ex: amanhã às 14h, ou 15/04 às 10:00)`;
    }
    
    cliente.etapa = 'aguardando_endereco';
    return `✅ ${cliente.servico} agendado para ${cliente.data} às ${cliente.hora}.

Para finalizar, preciso do endereço completo (rua, número, complemento e ponto de referência):`;
  }
  
  // ETAPA 4: Receber endereço e finalizar
  if (cliente.etapa === 'aguardando_endereco') {
    cliente.endereco = texto;
    cliente.etapa = 'finalizado';
    
    // Envia notificação ao técnico
    await notificarTecnico(cliente);
    
    return `🎉 *Agendamento Confirmado!*

📋 Resumo:
🔧 Serviço: ${cliente.servico}
📍 Local: ${cliente.bairro} - ${cliente.endereco}
📅 Data: ${cliente.data} às ${cliente.hora}
💰 Investimento: R$${cliente.valor}

Nosso técnico foi notificado e entrará em contato para confirmar. 

Agradecemos a preferência! 🏠✨`;
  }
  
  // Se já finalizou, reinicia
  if (cliente.etapa === 'finalizado') {
    cliente.etapa = 'inicio';
    return `Olá novamente! Posso ajudar com mais alguma coisa? Qual serviço você precisa?`;
  }
  
  return `Desculpe, não entendi. Pode repetir, por favor?`;
}

// ============================================
// EXTRAIR INFORMAÇÕES COM IA (Groq ou Simples)
// ============================================

async function extrairInformacoes(texto) {
  const t = texto.toLowerCase();
  const resultado = { servico: null, bairro: null };
  
  // Lista de serviços
  const servicos = ['pintura', 'reforma', 'marcenaria', 'gesso', 'piso', 'banheiro', 'cozinha', 'elétrica', 'eletrica', 'hidraulica', 'hidraulica', 'construção', 'construcao', 'telhado', 'azulejo', 'armário', 'armario', 'movel', 'móvel'];
  
  // Detecta serviço
  for (const servico of servicos) {
    if (t.includes(servico)) {
      resultado.servico = servico;
      break;
    }
  }
  
  // Detecta bairro (heurística: palavra após "bairro" ou última palavra capitalizada)
  const matchBairro = texto.match(/bairro[\\s:]*([^,\\.\\n]+)/i);
  if (matchBairro) {
    resultado.bairro = matchBairro[1].trim();
  } else {
    // Procura palavra capitalizada no final
    const palavras = texto.split(/\\s+/);
    for (let i = palavras.length - 1; i >= 0; i--) {
      if (/^[A-Z][a-z]+$/.test(palavras[i])) {
        resultado.bairro = palavras[i];
        break;
      }
    }
  }
  
  // Se tiver Groq, usa para refinar
  if (GROQ_API_KEY && (!resultado.servico || !resultado.bairro)) {
    try {
      const refinado = await analisarComGroq(texto);
      if (refinado.servico) resultado.servico = refinado.servico;
      if (refinado.bairro) resultado.bairro = refinado.bairro;
    } catch (e) {
      console.log('Erro Groq, usando análise simples');
    }
  }
  
  return resultado;
}

// Análise com Groq (opcional)
async function analisarComGroq(texto) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [{
        role: 'user',
        content: `Extraia serviço e bairro da mensagem. Responda em JSON: {"servico": "...", "bairro": "..."}\n\nMensagem: "${texto}"`
      }],
      temperature: 0.1,
      max_tokens: 100
    })
  });
  
  const data = await response.json();
  const content = data.choices[0].message.content;
  const json = content.match(/\\{[^}]+\\}/);
  
  if (json) return JSON.parse(json[0]);
  return { servico: null, bairro: null };
}

// Extrair data e hora do texto
function extrairDataHora(texto) {
  const t = texto.toLowerCase();
  const resultado = { data: null, hora: null };
  
  // Detecta "hoje"
  if (t.includes('hoje')) {
    resultado.data = new Date().toLocaleDateString('pt-BR');
  }
  // Detecta "amanhã"
  else if (t.includes('amanhã') || t.includes('amanha')) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    resultado.data = amanha.toLocaleDateString('pt-BR');
  }
  
  // Detecta hora (ex: 14h, 14:00, 14h30)
  const horaMatch = texto.match(/(\\d{1,2})[h:](\\d{2})?/);
  if (horaMatch) {
    resultado.hora = `${horaMatch[1]}:${horaMatch[2] || '00'}`;
  }
  
  return resultado;
}

// ============================================
// ENVIAR MENSAGEM WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`📤 Enviando para ${numero}: ${texto.substring(0, 50)}...`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ ERRO: WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID não configurados');
    return false;
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
        to: numero,
        type: 'text',
        text: { body: texto }
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Erro WhatsApp API:', data);
      return false;
    }
    
    return true;
    
  } catch (e) {
    console.error('❌ Exceção:', e.message);
    return false;
  }
}

// ============================================
// NOTIFICAR TÉCNICO
// ============================================

async function notificarTecnico(cliente) {
  // Escolhe técnico baseado no serviço
  let numeroTecnico;
  
  if (cliente.servico === 'marcenaria' || cliente.servico.includes('móvel') || cliente.servico.includes('armário')) {
    numeroTecnico = CONFIG.tecnicos.marcenaria;
  } else if (cliente.servico.includes('hidraulica') || cliente.servico.includes('encanamento') || cliente.servico.includes('vazamento')) {
    numeroTecnico = CONFIG.tecnicos.hidraulica;
  } else {
    numeroTecnico = CONFIG.tecnicos.reforma; // Padrão para reformas gerais
  }
  
  const mensagem = `🛠️ *NOVO AGENDAMENTO - RC REFORMAS*

👤 *Cliente:* ${cliente.nome}
📱 *Telefone:* ${cliente.telefone}
🔧 *Serviço:* ${cliente.servico}
📍 *Bairro:* ${cliente.bairro}
🏠 *Endereço:* ${cliente.endereco}
📅 *Data:* ${cliente.data}
⏰ *Horário:* ${cliente.hora}
💰 *Valor Visita:* R$${cliente.valor}

✅ *Confirmar disponibilidade respondendo aqui*`;

  console.log(`\n📤 Notificando técnico (${numeroTecnico})...`);
  
  const enviado = await enviarWhatsApp(numeroTecnico, mensagem);
  
  if (enviado) {
    console.log('✅ Técnico notificado com sucesso');
  } else {
    console.error('❌ Falha ao notificar técnico');
  }
  
  return enviado;
}
