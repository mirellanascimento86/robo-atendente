// ============================================
// RC REFORMA E CONSTRUÇÃO - SISTEMA COMPLETO v2.0
// Integração: WhatsApp + Google Calendar + Telegram + Painel Admin
// ============================================

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const CONFIG = {
  // Dados da Empresa
  empresa: {
    nome: 'RC Reforma e Construção',
    instagram: 'https://share.google/5n4VM0DwDTlDgEX3C',
    polo: 'Botafogo',
    cnpj: process.env.CNPJ_EMPRESA || ''
  },
  
  // Técnicos por categoria
  tecnicos: {
    // Reformas e construção
    marcenaria: { nome: 'Técnico Marcenaria', telefone: '5521978791765', email: '' },
    reforma: { nome: 'Técnico Reforma', telefone: '5521968112176', email: '' },
    hidraulica: { nome: 'Técnico Hidráulica', telefone: '5521968112176', email: '' },
    eletrica: { nome: 'Técnico Elétrica', telefone: '5521968112176', email: '' },
    pintura: { nome: 'Técnico Pintura', telefone: '5521968112176', email: '' },
    gesso: { nome: 'Técnico Gesso', telefone: '5521968112176', email: '' },
    pedreiro: { nome: 'Técnico Pedreiro', telefone: '5521968112176', email: '' },
    
    // Eletrodomésticos (NOVOS)
    ar_condicionado: { nome: 'Técnico Ar Condicionado', telefone: '5521XXXXXXXX', email: '' },
    lavadora: { nome: 'Técnico Lava e Seca', telefone: '5521XXXXXXXX', email: '' },
    geladeira: { nome: 'Técnico Refrigerador', telefone: '5521XXXXXXXX', email: '' },
    eletrodomesticos: { nome: 'Técnico Eletrodomésticos', telefone: '5521XXXXXXXX', email: '' }
  },
  
  // Preços
  precoVisita: 180,
  precoZonaSulComDesconto: 90,
  
  // Bairros atendidos (Zona Sul + Centro prioritários)
  bairrosAtendidos: [
    // Zona Sul
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha',
    // Centro e adjacências
    'centro', 'lapa', 'santa teresa', 'cinelândia', 'cinelandida',
    'praça mauá', 'praca maua', 'carioca', 'uruguaiana', 'saara',
    // Outros com prioridade menor
    'tijuca', 'vila isabel', 'grajau', 'maracana', 'vila da pena'
  ],
  
  // CATEGORIAS DE SERVIÇOS EXPANDIDAS
  categorias: {
    // REFORMAS E CONSTRUÇÃO
    marcenaria: {
      sinonimos: ['marcenaria', 'marceneiro', 'armário', 'armario', 'guarda roupa', 'cozinha planejada', 
                 'closet', 'escritório', 'escritorio', 'bancada', 'prateleira', 'nicho', 'porta', 
                 'janela', 'madeira', 'mdf', 'compensado', 'sarrafo', 'tábua', 'tabua', 'carpintaria'],
      tecnicos: ['marcenaria']
    },
    
    hidraulica: {
      sinonimos: ['hidráulica', 'hidraulica', 'encanamento', 'encanador', 'vazamento', 'vazando', 
                 'cano', 'cano estourado', 'torneira', 'torneira pingando', 'ralo', 'pia entupida', 
                 'vaso sanitário', 'vaso sanitario', 'privada', 'descarga', 'caixa d\'água', 
                 'caixa dagua', 'bomba d\'água', 'bomba dagua', 'aquecedor', 'boiler', 'sifão', 
                 'sifao', 'registro', 'válvula', 'valvula', 'hidrante', 'água quente', 'agua quente',
                 'fogão', 'fogao', 'fogareiro', 'instalação de gás', 'instalacao de gas', 'gas'],
      tecnicos: ['hidraulica']
    },
    
    eletrica: {
      sinonimos: ['elétrica', 'eletrica', 'eletricista', 'fiação', 'fiacao', 'disjuntor', 'tomada', 
                 'interruptor', 'lâmpada', 'lampada', 'lustre', 'pendente', 'spot', 'led', 'chuveiro', 
                 'ducha', 'aquecedor elétrico', 'aquecedor eletrico', 'fio', 'cabo', 'quadro', 
                 'quadro de luz', 'terra', 'aterramento', 'curto circuito', 'energia', 'luz'],
      tecnicos: ['eletrica']
    },
    
    pintura: {
      sinonimos: ['pintura', 'pintor', 'pintar', 'tinta', 'massa corrida', 'massa acrílica', 
                 'textura', 'grafiato', 'látex', 'latex', 'esmalte', 'verniz', 'selador', 
                 'fundos', 'acabamento', 'acabamento fino', 'parede', 'teto', 'muro', 'portão',
                 'portao', 'grade', 'serralheria pintada', 'retoque', 'mancha', 'mofo', 'umidade'],
      tecnicos: ['pintura']
    },
    
    alvenaria: {
      sinonimos: ['pedreiro', 'alvenaria', 'construção', 'construcao', 'reforma', 'obra', 'tijolo', 
                 'bloco', 'cimento', 'areia', 'brita', 'concreto', 'ferro', 'vergalhão', 'vergalhao',
                 'sapata', 'alicerce', 'parede', 'divisória', 'divisoria', 'reboco', 'rebocar',
                 'assentar', 'assentamento', 'piso', 'cerâmica', 'ceramica', 'porcelanato', 
                 'azulejo', 'pastilha', 'revestimento', 'impermeabilização', 'impermeabilizacao',
                 'laje', 'forro', 'telhado', 'cobertura', 'calha', 'rufo', 'churrasqueira',
                 'bancada', 'pia', 'tanque', 'nicho', 'box', 'box blindex'],
      tecnicos: ['pedreiro', 'reforma']
    },
    
    gesso: {
      sinonimos: ['gesso', 'gesseiro', 'drywall', 'placa de gesso', 'forro de gesso', 'sanca', 
                 'sanca aberta', 'sanca fechada', 'moldura', 'roda teto', 'cantoneira', 'divisória',
                 'divisoria de gesso', 'parede de drywall', 'estrutura de gesso', 'acartonado',
                 'gesso 3d', 'gesso acartonado', 'steel frame', 'perfil de aço', 'perfil de aco'],
      tecnicos: ['gesso']
    },
    
    serralheria: {
      sinonimos: ['serralheria', 'serralheiro', 'portão', 'portao', 'grade', 'janela de ferro', 
                 'porta de ferro', 'cobertura metálica', 'cobertura metalica', 'mezanino', 
                 'escada de ferro', 'corrimão', 'corrimao', 'guarda corpo', 'estrutura metálica',
                 'estrutura metalica', 'solda', 'soldagem', 'alumínio', 'aluminio', 'inox'],
      tecnicos: ['reforma', 'marcenaria']
    },
    
    // ELETRODOMÉSTICOS (NOVOS)
    ar_condicionado: {
      sinonimos: ['ar condicionado', 'arcondicionado', 'split', 'janela', 'portátil', 'portatil', 
                 'inverter', 'quente e frio', 'frio', 'somente frio', 'instalação de ar', 
                 'instalacao de ar', 'desinstalação', 'desinstalacao', 'manutenção', 'manutencao',
                 'limpeza', 'higienização', 'higienizacao', 'gas', 'recarga', 'vazamento de gas',
                 'compressor', 'condensadora', 'evaporadora', 'controle remoto', 'sensor', 
                 'filtro', 'barulho', 'vibração', 'vibracao', 'não liga', 'nao liga', 'não gela',
                 'nao gela', 'pingando', 'gelo', 'congelando', 'termostato', 'placa', 'placa eletronica',
                 'placa eletrônica', 'capacitor', 'motor', 'ventilador', 'serpentina', 'tubulação',
                 'tubulacao', 'dreno', 'bomba dreno'],
      tecnicos: ['ar_condicionado', 'eletrodomesticos']
    },
    
    lavadora: {
      sinonimos: ['lava e seca', 'lavaeseca', 'máquina de lavar', 'maquina de lavar', 'lavadora', 
                 'secadora', 'lava roupa', 'louça', 'louca', 'lava louça', 'lava louca', 
                 'eletrodoméstico', 'eletrodomestico', 'brastemp', 'consul', 'electrolux', 'samsung',
                 'lg', 'panasonic', 'midea', 'springer', 'ge', 'continental', 'bosch', 'siemens',
                 'não centrifuga', 'nao centrifuga', 'não seca', 'nao seca', 'vazando água', 
                 'não drena', 'nao drena', 'não liga', 'nao liga', 'trava de segurança', 
                 'porta não abre', 'mangueira', 'filtro', 'bomba', 'atuador', 'placa', 
                 'motor', 'variator', 'correia', 'embreagem', 'cesto', 'tambor', 'aquece',
                 'não aquece', 'nao aquece', 'erro', 'código de erro', 'codigo de erro', 'display'],
      tecnicos: ['lavadora', 'eletrodomesticos']
    },
    
    geladeira: {
      sinonimos: ['geladeira', 'refrigerador', 'frigobar', 'freezer', 'cônsul', 'consul', 'brastemp', 
                 'electrolux', 'samsung', 'lg', 'panasonic', 'midea', 'springer', 'ge', 'continental',
                 'bosch', 'siemens', 'duplex', 'inverse', 'frost free', 'cycle defrost', 
                 'não gela', 'nao gela', 'não congela', 'nao congela', 'muito gelo', 
                 'formando gelo', 'vazando água', 'água no piso', 'barulho', 'ventilador', 
                 'compressor', 'motor', 'termostato', 'sensor', 'bimetal', 'resistência', 
                 'resistencia', 'lâmpada', 'lampada', 'placa', 'placa eletrônica', 'placa eletronica',
                 'display', 'painel', 'código de erro', 'codigo de erro', 'degelo', 'dreno entupido',
                 'borracha', 'borracha de vedação', 'prateleira', 'gaveta', 'porta', 'dobradiça',
                 'dobradica', 'pé', 'pe', 'nivelador', '127v', '220v', 'inverter', 'duplex'],
      tecnicos: ['geladeira', 'eletrodomesticos']
    }
  },
  
  // Configurações de ambiente
  numeroRC: process.env.NUMERO_RC || '',
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  telegramChatIdRelatorios: process.env.TELEGRAM_CHAT_ID_RELATORIOS || process.env.TELEGRAM_CHAT_ID,
  
  // Google Calendar
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID,
  googleServiceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  
  // Palavras de risco para intervenção humana
  palavrasRisco: [
    'processo', 'judicial', 'advogado', 'procon', 'reclamação', 'reclamacao',
    'polícia', 'policia', 'denunciar', 'denúncia', 'denuncia', 'crime',
    'golpe', 'fraude', 'enganado', 'enganaram', 'calote', 'caloteiro',
    'não entendi nada', 'nao entendi nada', 'tá me enrolando', 'tah me enrolando',
    'quero falar com humano', 'quero falar com pessoa', 'atendente humano',
    'você não entende', 'voce nao entende', 'robô burro', 'robo burro',
    'cancelar tudo', 'não quero mais', 'nao quero mais', 'desisto',
    'horrível', 'horrivel', 'péssimo', 'pessimo', 'terrível', 'terrivel',
    'ódio', 'odio', 'raiva', 'estressei', 'nervoso', 'indignado'
  ]
};

// ============================================
// ESTADO GLOBAL (persiste durante execução)
// ============================================

const clientes = {};
const processadas = new Set();
const conversas = [];
const agendamentos = [];
const intervenções = new Set();
let googleAuthClient = null;

// ============================================
// INICIALIZAÇÃO GOOGLE CALENDAR
// ============================================

async function inicializarGoogleCalendar() {
  if (!CONFIG.googleServiceAccountKey || !CONFIG.googleCalendarId) {
    console.log('⚠️ Google Calendar não configurado');
    return false;
  }
  
  try {
    const credentials = JSON.parse(
      Buffer.from(CONFIG.googleServiceAccountKey, 'base64').toString()
    );
    
    googleAuthClient = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    
    await googleAuthClient.authorize();
    console.log('✅ Google Calendar conectado');
    return true;
  } catch (e) {
    console.error('❌ Erro Google Calendar:', e.message);
    return false;
  }
}

// ============================================
// HANDLER PRINCIPAL
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
    // Inicializa Google Calendar na primeira requisição
    if (!googleAuthClient && CONFIG.googleServiceAccountKey) {
      await inicializarGoogleCalendar();
    }
    
    // Verificação webhook Meta
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      console.log('🔔 Verificação webhook:', req.query);
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // Painel de Controle
    if (req.query.action) {
      return await handlePainel(req, res);
    }

    // Webhook WhatsApp - resposta imediata + processamento async
    if (req.method === 'POST') {
      res.status(200).send('OK');
      
      // Processa em background
      processarWebhookAsync(req.body).catch(err => {
        console.error('Erro async:', err);
        enviarTelegramAdmin(`🚨 ERRO CRÍTICO: ${err.message}`);
      });
      
      return;
    }

    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAMENTO ASSÍNCRONO WHATSAPP
// ============================================

async function processarWebhookAsync(body) {
  console.log('📥 Webhook recebido:', JSON.stringify(body).substring(0, 500));
  
  if (!body || body.object !== 'whatsapp_business_account') {
    console.log('❌ Não é WhatsApp business account');
    return;
  }
  
  const entry = body.entry?.[0];
  if (!entry) return;
  
  const changes = entry.changes?.[0]?.value;
  if (!changes || changes.statuses) return;
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return;
  
  // Evita duplicados
  if (processadas.has(msg.id)) {
    console.log('♻️ Mensagem já processada:', msg.id);
    return;
  }
  processadas.add(msg.id);
  setTimeout(() => processadas.delete(msg.id), 3600000);
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  if (telefone === CONFIG.numeroRC) return;
  
  // Notifica Telegram de nova mensagem
  await enviarTelegramAdmin(
    `💬 *NOVA MENSAGEM*\n` +
    `👤 ${nome}\n` +
    `📱 ${telefone}\n` +
    `📝 ${msg.type === 'text' ? msg.text.body.substring(0, 100) : `[${msg.type}]`}`
  );
  
  // Verifica intervenção humana
  if (intervenções.has(telefone)) {
    conversas.push({
      telefone,
      tipo: 'cliente',
      mensagem: msg.text?.body || `[${msg.type}]`,
      data: new Date().toISOString()
    });
    return;
  }
  
  // Processa por tipo
  let texto = '';
  
  if (msg.type === 'text') {
    texto = msg.text.body;
  } else if (msg.type === 'image') {
    texto = '[imagem recebida]';
    await processarImagem(telefone, nome, msg.image);
  } else if (msg.type === 'audio' || msg.type === 'voice') {
    await enviarWhatsApp(telefone, 
      "No momento não consigo ouvir áudios. Pode descrever por escrito? 📸 Se quiser, envie fotos do problema!"
    );
    return;
  } else {
    return;
  }
  
  // Registra conversa
  conversas.push({
    telefone,
    tipo: 'cliente',
    mensagem: texto,
    data: new Date().toISOString()
  });
  
  // Inicializa cliente
  if (!clientes[telefone]) {
    clientes[telefone] = { 
      nome, 
      etapa: 'INICIO', 
      dados: {},
      ultimaAtividade: Date.now(),
      telefone
    };
  }
  
  const cli = clientes[telefone];
  cli.ultimaAtividade = Date.now();
  
  // Detecta risco
  if (detectarRisco(texto.toLowerCase())) {
    intervenções.add(telefone);
    await enviarWhatsApp(telefone, 
      `Entendo sua frustração. Vou transferir você imediatamente para um atendente humano. Por favor, aguarde um momento. 🙏`
    );
    await enviarTelegramAdmin(`🚨 *INTERVENÇÃO AUTOMÁTICA*\n${nome} (${telefone})\nMensagem: ${texto.substring(0, 100)}`);
    return;
  }
  
  // Processa resposta
  const resp = await processarMensagem(cli, texto.toLowerCase(), texto, nome, telefone);
  
  if (resp) {
    await enviarWhatsApp(telefone, resp);
    conversas.push({
      telefone,
      tipo: 'bot',
      mensagem: resp,
      data: new Date().toISOString()
    });
  }
}

// ============================================
// PAINEL DE CONTROLE
// ============================================

async function handlePainel(req, res) {
  const { action } = req.query;
  
  switch (action) {
    case 'list': {
      const lista = Object.entries(clientes).map(([tel, d]) => ({
        telefone: tel,
        nome: d.nome,
        etapa: d.etapa,
        ultimaAtividade: new Date(d.ultimaAtividade).toLocaleString('pt-BR'),
        emIntervencao: intervenções.has(tel),
        resumo: d.dados.servico && d.dados.bairro 
          ? `${d.dados.servico} em ${d.dados.bairro}` 
          : 'Iniciando'
      }));
      return res.json({ conversas: lista, total: lista.length });
    }
    
    case 'messages': {
      const { phone } = req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      const historico = conversas.filter(c => c.telefone === phone);
      const cliente = clientes[phone];
      
      return res.json({
        telefone: phone,
        nome: cliente?.nome || 'Desconhecido',
        etapa: cliente?.etapa || 'N/A',
        emIntervencao: intervenções.has(phone),
        mensagens: historico,
        dados: cliente?.dados || {}
      });
    }
    
    case 'intervene': {
      const { phone, usuario } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.add(phone);
      await enviarWhatsApp(phone, `Olá! Um atendente humano assumiu esta conversa. Em que posso ajudar?`);
      await enviarTelegramAdmin(`🚨 *INTERVENÇÃO MANUAL*\n${phone}\nPor: ${usuario || 'Sistema'}`);
      
      return res.json({ sucesso: true });
    }
    
    case 'release': {
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.delete(phone);
      await enviarWhatsApp(phone, `Obrigado! Retomando atendimento automatizado. Como posso ajudar?`);
      
      return res.json({ sucesso: true });
    }
    
    case 'send': {
      const { phone, mensagem, usuario } = req.body;
      if (!phone || !mensagem) return res.status(400).json({ erro: 'Telefone e mensagem obrigatórios' });
      
      await enviarWhatsApp(phone, mensagem);
      conversas.push({ telefone: phone, tipo: 'humano', mensagem, data: new Date().toISOString(), atendente: usuario });
      
      return res.json({ sucesso: true });
    }
    
    case 'orcamento_status': {
      // Recebe status do orçamento (aceito ou recusado)
      const { phone, status, valor, observacao, usuario } = req.body;
      
      if (status === 'aceito') {
        await enviarTelegramAdmin(
          `✅ *ORÇAMENTO ACEITO*\n` +
          `👤 ${clientes[phone]?.nome || phone}\n` +
          `💰 Valor: R$${valor}\n` +
          `📝 ${observacao || ''}`
        );
        
        // Atualiza evento no Google Calendar
        await atualizarEventoCalendar(phone, 'Orçamento Aceito - ' + valor);
        
      } else if (status === 'recusado') {
        await enviarTelegramAdmin(
          `❌ *ORÇAMENTO RECUSADO*\n` +
          `👤 ${clientes[phone]?.nome || phone}\n` +
          `📝 Motivo: ${observacao || 'Não informado'}`
        );
      }
      
      return res.json({ sucesso: true });
    }
    
    case 'relatorio_diario': {
      // Gera relatório diário manual
      await gerarRelatorioDiario();
      return res.json({ sucesso: true, mensagem: 'Relatório enviado ao Telegram' });
    }
    
    case 'stats': {
      const hoje = new Date().toDateString();
      const visitasHoje = agendamentos.filter(a => 
        new Date(a.criadoEm).toDateString() === hoje
      ).length;
      
      return res.json({
        totalConversas: Object.keys(clientes).length,
        emAtendimento: Object.values(clientes).filter(c => 
          c.etapa !== 'AGENDADO' && c.etapa !== 'INICIO'
        ).length,
        agendamentosHoje: visitasHoje,
        totalAgendamentos: agendamentos.length,
        intervencoesAtivas: intervenções.size,
        orcamentosPendentes: agendamentos.filter(a => a.status === 'aguardando_orcamento').length
      });
    }
    
    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}

// ============================================
// LÓGICA DE VENDAS
// ============================================

async function processarMensagem(cli, t, original, nome, telefone) {
  const d = cli.dados;
  
  // Saudação inicial
  if (cli.etapa === 'INICIO' && t.match(/(oi|olá|ola|bom dia|boa tarde|boa noite|hey)/)) {
    return `Olá, ${nome}! 👋 Sou da *RC Reforma e Construção*.

Posso ajudar com:
🔧 *Reformas*: Marcenaria, Hidráulica, Elétrica, Pintura, Gesso, Pedreiro
❄️ *Eletrodomésticos*: Ar Condicionado, Lava e Seca, Geladeira

Para agilizar, me informe:
1️⃣ Qual serviço você precisa?
2️⃣ Qual bairro do Rio?

Se quiser, envie fotos do problema! 📸`;
  }

  // Objeções
  if (t.match(/(caro|muito caro|tá caro|absurdo|roubando|não tenho dinheiro)/)) {
    const ehEletro = d.categoria && ['ar_condicionado', 'lavadora', 'geladeira'].includes(d.categoria);
    
    if (ehEletro) {
      return `Entendo sua preocupação, ${nome}!

Para *eletrodomésticos*, o valor da visita técnica é *R$180*, mas:
✅ Diagnóstico completo do aparelho
✅ Orçamento detalhado na hora
✅ Se aprovar o conserto: visita fica *GRÁTIS* (abatida do valor)

Também temos desconto de *50% na Zona Sul* (R$90) e *GRÁTIS* em Botafogo!

Posso verificar disponibilidade do técnico especializado?`;
    }
    
    return `Entendo, ${nome}! 

📋 *Visita Técnica: R$180*
• Profissional vai até você
• Orçamento detalhado no local
• Se aprovar: R$180 vira desconto no total

💰 *Descontos especiais:*
• Zona Sul: 50% OFF (R$90)
• Botafogo: *GRÁTIS* 🎉

Posso verificar disponibilidade?`;
  }

  if (t.match(/(quem é você|você é robô|atendente)/)) {
    return `Sou o assistente virtual da *RC Reforma e Construção*! 🤖

Estou aqui para agilizar seu atendimento 24h. Se precisar de um humano, é só dizer *"falar com pessoa"* a qualquer momento.

Como posso ajudar hoje?`;
  }

  // Fluxo principal
  switch (cli.etapa) {
    case 'INICIO':
      return await etapaInicio(cli, t, original, nome);
    case 'AGUARDANDO_BAIRRO':
      return etapaAguardandoBairro(cli, t, original);
    case 'AGUARDANDO_SERVICO':
      return etapaAguardandoServico(cli, t, original);
    case 'CONFIRMA_ATENDIMENTO_HOJE':
      return etapaConfirmaAtendimentoHoje(cli, t, original);
    case 'APRESENTA_VALOR':
      return etapaApresentaValor(cli, t, original);
    case 'VERIFICAR_AGENDA':
      return await etapaVerificarAgenda(cli, t, original);
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original);
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original);
    case 'CONFIRMAR_VISITA':
      return await etapaConfirmarVisita(cli, t, original, telefone);
    case 'AGENDADO':
      return etapaPosAgendamento(cli, t, original);
    default:
      cli.etapa = 'INICIO';
      return `Olá, ${nome}! Qual serviço você precisa e em qual bairro?`;
  }
}

// ===== ETAPAS DO FUNIL =====

async function etapaInicio(cli, t, original, nome) {
  const d = cli.dados;
  const { categoria, servico, bairro } = extrairCategoriaServicoEBairro(t, original);
  
  if (categoria && bairro) {
    d.categoria = categoria;
    d.servico = servico;
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    
    const tipoServico = ['ar_condicionado', 'lavadora', 'geladeira'].includes(categoria) 
      ? 'eletrodoméstico' 
      : 'reforma';
    
    return `Perfeito! ${servico} em ${bairro}.

Você precisa de atendimento *urgente para hoje* ou podemos agendar para amanhã/outro dia?

📅 Verifico disponibilidade do técnico de ${tipoServico} especializado!`;
  }
  
  if (categoria) {
    d.categoria = categoria;
    d.servico = servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo! Você precisa de *${servico}*. 

Qual bairro do Rio de Janeiro?`;
  }
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return `Entendi, *${bairro}*. 

Qual serviço você precisa?

*Reformas*: Marcenaria, Hidráulica, Elétrica, Pintura, Gesso, Pedreiro
*Eletrodomésticos*: Ar Condicionado, Lava e Seca, Geladeira`;
  }
  
  if (t.match(/(quanto custa|qual o preço|valor)/)) {
    return `Depende do serviço e bairro! 

*Reformas*: Visita R$180 (R$90 Zona Sul, GRÁTIS Botafogo)
*Eletrodomésticos*: Visita R$180 (diagnóstico + orçamento)

Qual serviço e bairro? Aí te passo valores exatos!`;
  }
  
  return `Oi! Sou da RC Reforma. Para ajudar:

Qual serviço você precisa?
🔧 Marcenaria, Hidráulica, Elétrica, Pintura, Gesso, Pedreiro
❄️ Ar Condicionado, Lava e Seca, Geladeira

E qual bairro do Rio?`;
}

function etapaAguardandoBairro(cli, t, original) {
  const d = cli.dados;
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Ótimo! ${d.servico} em ${bairro}.

Precisa de atendimento *para hoje* (urgente) ou podemos agendar?`;
  }
  
  return `Qual bairro do Rio de Janeiro?`;
}

function etapaAguardandoServico(cli, t, original) {
  const d = cli.dados;
  const { categoria, servico } = extrairCategoriaServicoEBairro(t, original);
  
  if (categoria) {
    d.categoria = categoria;
    d.servico = servico;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Perfeito! ${servico} em ${d.bairro}.

Precisa de atendimento *urgente para hoje* ou podemos agendar?`;
  }
  
  return `Qual serviço você precisa em ${d.bairro}?

🔧 Reformas: Marcenaria, Hidráulica, Elétrica, Pintura, Gesso, Pedreiro
❄️ Eletrodomésticos: Ar Condicionado, Lava e Seca, Geladeira`;
}

function etapaConfirmaAtendimentoHoje(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(hoje|urgente|urgência|vazando|quebrou|emergência|não liga|nao liga|não gela|nao gela)/)) {
    d.urgente = true;
    cli.etapa = 'APRESENTA_VALOR';
    
    const ehEletro = ['ar_condicionado', 'lavadora', 'geladeira'].includes(d.categoria);
    const valor = d.bairro.toLowerCase().includes('botafogo') ? 0 : 
                  verificarAtendimento(d.bairro) ? 90 : 180;
    
    return `Entendi que é urgente! 🚨

${ehEletro ? 'Técnico em eletrodomésticos' : 'Profissional'} para *HOJE*:

📋 *Visita Técnica: ${valor === 0 ? 'GRÁTIS' : 'R$' + valor}*
• Diagnóstico completo no local
• Orçamento detalhado
• ${valor > 0 ? 'Valor abatido se aprovar' : 'Cortesia especial Botafogo!'}

Posso verificar disponibilidade na agenda para hoje?`;
  }
  
  if (t.match(/(amanhã|amanha|depois|próximo|outro dia)/)) {
    d.urgente = false;
    cli.etapa = 'APRESENTA_VALOR';
    return `Sem problemas! Para agendar:

📋 Visita técnica com descontos especiais
💰 Zona Sul: R$90 | Botafogo: GRÁTIS

Posso verificar na agenda?`;
  }
  
  return `Você precisa de atendimento *para hoje* (urgente) ou *amanhã/outro dia*?`;
}

function etapaApresentaValor(cli, t, original) {
  const d = cli.dados;
  const ehEletro = ['ar_condicionado', 'lavadora', 'geladeira'].includes(d.categoria);
  
  if (t.match(/(não|nao|não vou pagar|grátis|caro)/)) {
    if (d.bairro.toLowerCase().includes('botafogo')) {
      d.valorVisita = 0;
      cli.etapa = 'VERIFICAR_AGENDA';
      return `Como você é de *Botafogo*, visita técnica é *GRÁTIS*! 🎉

Sem custo nenhum. Posso verificar disponibilidade?`;
    }
    
    if (verificarAtendimento(d.bairro)) {
      d.valorVisita = 90;
      return `Posso oferecer *50% de desconto*: *R$90*

${ehEletro ? 'Inclui diagnóstico completo do aparelho!' : 'Inclui avaliação técnica completa!'}

Podemos prosseguir?`;
    }
  }
  
  if (t.match(/(sim|pode|ok|claro|verifica|agenda)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Ótimo! Consultando agenda do técnico... ⏳

Para *quando* você prefere?
• Hoje
• Amanhã  
• Outro dia específico

Me informa!`;
  }
  
  return `Posso verificar disponibilidade para ${d.servico} em ${d.bairro}?`;
}

async function etapaVerificarAgenda(cli, t, original) {
  const d = cli.dados;
  
  let dataPreferida = null;
  let dataFormatada = null;
  
  if (t.match(/(hoje)/)) {
    const horaAtual = new Date().getHours();
    if (horaAtual >= 18) {
      return `Já são mais de 18h. Posso agendar o primeiro horário de *amanhã*?

Ou prefere outro dia?`;
    }
    dataPreferida = 'hoje';
    dataFormatada = new Date().toLocaleDateString('pt-BR');
  } else if (t.match(/(amanhã|amanha)/)) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    dataPreferida = 'amanhã';
    dataFormatada = amanha.toLocaleDateString('pt-BR');
  } else {
    const dataEsp = extrairData(t, original);
    if (dataEsp) {
      dataPreferida = dataEsp;
      dataFormatada = dataEsp;
    }
  }
  
  if (!dataPreferida) {
    return `Para *quando* você precisa? (hoje, amanhã, ou data específica)`;
  }
  
  // Verifica disponibilidade no Google Calendar
  const tecnicosDisponiveis = await verificarDisponibilidadeTecnicos(
    d.categoria, 
    dataPreferida
  );
  
  if (tecnicosDisponiveis.length === 0) {
    // Tenta próximo dia
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const tecnicosAmanha = await verificarDisponibilidadeTecnicos(
      d.categoria,
      amanha.toLocaleDateString('pt-BR')
    );
    
    if (tecnicosAmanha.length > 0) {
      return `Para ${dataPreferida} nossos técnicos estão com agenda cheia. 😕

Mas tenho disponibilidade para *amanhã*! Posso agendar para amanhã?`;
    }
    
    return `Estamos com alta demanda nesse período. 😕

Posso verificar para ${getProximosDias(2)} ou ${getProximosDias(3)}?

Qual desses dias te atende?`;
  }
  
  d.data = dataPreferida;
  d.dataFormatada = dataFormatada;
  d.tecnicoAlocado = tecnicosDisponiveis[0]; // Pega primeiro disponível
  cli.etapa = 'AGUARDANDO_HORARIO';
  
  return `✅ *Temos vaga para ${dataPreferida}!*

Qual horário seria melhor?
• Manhã (9h às 12h)
• Tarde (14h às 17h)
• Noite (18h às 20h) - se urgente

Qual prefere?`;
}

function etapaAguardandoHorario(cli, t, original) {
  const d = cli.dados;
  const hora = extrairHora(original);
  
  if (hora) {
    d.hora = hora;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ ${hora} anotado!

Agora preciso do *endereço completo*:

📍 Rua, número, complemento
🏢 Apartamento ou Casa

Qual o endereço?`;
  }
  
  if (t.match(/manhã|manha/)) {
    d.hora = '09:00-12:00';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Manhã (9h-12h) anotado! 

Endereço completo, por favor:`;
  }
  
  if (t.match(/tarde/)) {
    d.hora = '14:00-17:00';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Tarde (14h-17h) anotada!

Endereço completo, por favor:`;
  }
  
  if (t.match(/noite/)) {
    d.hora = '18:00-20:00';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Noite (18h-20h) anotada!

Endereço completo, por favor:`;
  }
  
  return `Qual horário? (ex: 10h, 14:30, manhã, tarde, noite)`;
}

function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;
  
  if (original.length > 8 && (t.match(/(rua|av|avenida|número|apartamento|casa)/) || t.match(/\d+/))) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_VISITA';
    
    const valor = d.bairro.toLowerCase().includes('botafogo') ? 0 : 
                  verificarAtendimento(d.bairro) ? 90 : 180;
    d.valorVisita = valor;
    
    const ehEletro = ['ar_condicionado', 'lavadora', 'geladeira'].includes(d.categoria);
    
    return `📋 *RESUMO DO AGENDAMENTO*

Serviço: ${d.servico}
Data: ${d.data} (${d.dataFormatada})
Horário: ${d.hora}
Endereço: ${original}
Valor: ${valor === 0 ? '*GRÁTIS* 🎉' : `R$${valor}`}
${ehEletro ? 'Técnico: Especialista em eletrodomésticos' : 'Profissional: ' + d.tecnicoAlocado}

*Tudo correto?* Responda *sim* para confirmar!`;
  }
  
  return `Preciso do endereço completo (rua, número, complemento). Qual é?`;
}

async function etapaConfirmarVisita(cli, t, original, telefone) {
  const d = cli.dados;
  
  if (t.match(/(sim|pode|ok|confirmo|tá bom|perfeito)/)) {
    cli.etapa = 'AGENDADO';
    
    const agendamento = {
      id: Date.now().toString(),
      telefone,
      nome: cli.nome,
      categoria: d.categoria,
      servico: d.servico,
      bairro: d.bairro,
      data: d.data,
      dataFormatada: d.dataFormatada,
      hora: d.hora,
      endereco: d.endereco,
      valor: d.valorVisita,
      tecnico: d.tecnicoAlocado,
      status: 'confirmado',
      criadoEm: new Date().toISOString(),
      orcamentoStatus: 'pendente'
    };
    
    agendamentos.push(agendamento);
    
    // Cria evento no Google Calendar
    await criarEventoCalendar(agendamento);
    
    // Notifica técnico específico
    await notificarTecnico(agendamento);
    
    // Notifica Telegram admin
    await enviarTelegramAdmin(
      `✅ *NOVA VISITA MARCADA*\n\n` +
      `📅 ${d.data} às ${d.hora}\n` +
      `🔧 ${d.servico} (${d.categoria})\n` +
      `📍 ${d.endereco}\n` +
      `👤 ${cli.nome}\n` +
      `📱 ${telefone}\n` +
      `💰 ${d.valorVisita === 0 ? 'GRÁTIS' : 'R$'+d.valorVisita}\n` +
      `👨‍🔧 Técnico: ${d.tecnicoAlocado}`
    );
    
    // Agenda lembrete
    agendarLembrete(agendamento);
    
    const ehEletro = ['ar_condicionado', 'lavadora', 'geladeira'].includes(d.categoria);
    
    return `🎉 *VISITA CONFIRMADA!*

📅 ${d.data} às ${d.hora}
📍 ${d.endereco}
🔧 ${d.servico}
${ehEletro ? '❄️ Técnico especializado em eletrodomésticos' : ''}
${d.valorVisita > 0 ? `💰 R$${d.valorVisita} (pagar no ato)` : '💰 GRÁTIS'}

*O que acontece agora:*
1️⃣ Técnico confirmará em até *48h*
2️⃣ Lembrete automático 2h antes
3️⃣ ${ehEletro ? 'Diagnóstico e orçamento do aparelho' : 'Orçamento detalhado no local'}

Precisa remarcar? Avise com *2h de antecedência*.

Mais alguma dúvida? 😊`;
  }
  
  if (t.match(/(não|nao|mudar|alterar)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Sem problema! O que precisa alterar?

• Data/horário
• Endereço
• Serviço

Me informa!`;
  }
  
  return `Posso confirmar para ${d.data} às ${d.hora}? Responda *sim* ou diga o que alterar.`;
}

function etapaPosAgendamento(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(remarcar|mudar data|alterar)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Entendido! Vamos remarcar.

Para qual novo dia você prefere?
• Hoje (outro horário)
• Amanhã
• Outro dia

Me informa que verifico na agenda!`;
  }
  
  if (t.match(/(cancelar|desistir|não quero mais)/)) {
    // Remove agendamento
    const idx = agendamentos.findIndex(a => 
      a.telefone === cli.telefone && a.status === 'confirmado'
    );
    if (idx > -1) {
      agendamentos[idx].status = 'cancelado';
      enviarTelegramAdmin(`❌ CANCELAMENTO\n${cli.nome} cancelou visita de ${d.servico}`);
    }
    
    cli.etapa = 'INICIO';
    return `Cancelamento anotado. 😔

Se mudar de ideia ou precisar no futuro, é só chamar!

Boa sorte!`;
  }
  
  if (t.match(/(orçamento aprovado|aceitei|vou fazer|quero fazer)/)) {
    // Atualiza status
    const agendamento = agendamentos.find(a => 
      a.telefone === cli.telefone && a.status === 'confirmado'
    );
    if (agendamento) {
      agendamento.orcamentoStatus = 'aceito';
      enviarTelegramAdmin(`✅ *ORÇAMENTO ACEITO PELO CLIENTE*\n${cli.nome} - ${d.servico}\nValor: ${d.valorOrçamento || 'Não informado'}`);
    }
    
    return `Que ótimo, ${cli.nome}! 🎉 

Agradecemos a confiança! O técnico entrará em contato para confirmar detalhes do serviço.

Se precisar de mais alguma coisa, estou por aqui!`;
  }
  
  if (t.match(/(orçamento recusado|não vou fazer|muito caro o serviço)/)) {
    const agendamento = agendamentos.find(a => 
      a.telefone === cli.telefone && a.status === 'confirmado'
    );
    if (agendamento) {
      agendamento.orcamentoStatus = 'recusado';
      enviarTelegramAdmin(`❌ *ORÇAMENTO RECUSADO*\n${cli.nome} - ${d.servico}\nMotivo: Preço alto ou outro`);
    }
    
    return `Entendido, ${cli.nome}. Sem problemas!

Agradecemos a oportunidade. Se precisar no futuro ou quiser uma segunda opinião, é só chamar.

Boa sorte! 🍀`;
  }
  
  return `Olá! Sua visita está confirmada. 

Se precisar *remarcar*, *tirar dúvidas* ou *falar com pessoa*, é só avisar! 😊`;
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function extrairCategoriaServicoEBairro(t, original) {
  const categoria = identificarCategoria(t);
  const servico = categoria ? extrairServicoEspecifico(t, categoria) : null;
  const bairro = extrairBairro(t, original);
  
  return { categoria, servico, bairro };
}

function identificarCategoria(texto) {
  for (const [cat, dados] of Object.entries(CONFIG.categorias)) {
    for (const sinonimo of dados.sinonimos) {
      if (texto.includes(sinonimo)) {
        return cat;
      }
    }
  }
  return null;
}

function extrairServicoEspecifico(texto, categoria) {
  const cat = CONFIG.categorias[categoria];
  if (!cat) return categoria;
  
  // Retorna o primeiro sinônimo encontrado ou o nome da categoria
  for (const sinonimo of cat.sinonimos) {
    if (texto.includes(sinonimo)) {
      return sinonimo.charAt(0).toUpperCase() + sinonimo.slice(1);
    }
  }
  
  return categoria.charAt(0).toUpperCase() + categoria.slice(1);
}

function extrairBairro(t, original) {
  for (const b of CONFIG.bairrosAtendidos) {
    if (t.includes(b)) return b.charAt(0).toUpperCase() + b.slice(1);
  }
  
  const m = original.match(/(em|no|na)\s+([A-Za-zÀ-ÿ\s]+)/i);
  if (m) {
    const possivel = m[2].trim().toLowerCase();
    for (const b of CONFIG.bairrosAtendidos) {
      if (possivel.includes(b)) return b.charAt(0).toUpperCase() + b.slice(1);
    }
    if (possivel.length > 2) return possivel.charAt(0).toUpperCase() + possivel.slice(1);
  }
  return null;
}

function extrairHora(txt) {
  const m = txt.match(/(\d{1,2})[:h]?(\d{2})?/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]||'00'}` : null;
}

function extrairData(t, original) {
  const hoje = new Date();
  
  if (t.match(/segunda/)) return getDataFutura(1);
  if (t.match(/terça|terca/)) return getDataFutura(2);
  if (t.match(/quarta/)) return getDataFutura(3);
  if (t.match(/quinta/)) return getDataFutura(4);
  if (t.match(/sexta/)) return getDataFutura(5);
  
  const m = original.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
  
  const d = original.match(/dia\s+(\d{1,2})/i);
  if (d) return `${d[1].padStart(2,'0')}/${(hoje.getMonth()+1).toString().padStart(2,'0')}`;
  
  return null;
}

function getDataFutura(diasSemana) {
  const hoje = new Date();
  const atual = hoje.getDay();
  const dias = (diasSemana + 7 - atual) % 7 || 7;
  hoje.setDate(hoje.getDate() + dias);
  return hoje.toLocaleDateString('pt-BR');
}

function getProximosDias(dias) {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric' });
}

function verificarAtendimento(bairro) {
  if (!bairro) return false;
  const n = bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CONFIG.bairrosAtendidos.some(b => n.includes(b));
}

function detectarRisco(texto) {
  return CONFIG.palavrasRisco.some(p => texto.includes(p));
}

// ============================================
// INTEGRAÇÕES EXTERNAS
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`📤 PARA ${numero}: ${texto.substring(0, 80)}...`);
  
  if (!CONFIG.whatsappToken || !CONFIG.whatsappPhoneId) {
    console.error('❌ WhatsApp não configurado');
    return false;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const res = await fetch(`https://graph.facebook.com/v18.0/${CONFIG.whatsappPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numero,
        type: 'text',
        text: { body: texto }
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      const data = await res.json();
      console.error('❌ Erro WhatsApp:', res.status, data);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('❌ Erro envio WhatsApp:', e.message);
    return false;
  }
}

async function enviarTelegramAdmin(mensagem) {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.log('ℹ️ Telegram não configurado');
    return false;
  }
  
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    return true;
  } catch (e) {
    console.error('❌ Erro Telegram:', e.message);
    return false;
  }
}

async function processarImagem(telefone, nome, imagemData) {
  const cli = clientes[telefone];
  const categoria = cli?.dados?.categoria;
  
  let tecnicoTel = CONFIG.tecnicos.reforma.telefone;
  if (categoria && CONFIG.tecnicos[categoria]) {
    tecnicoTel = CONFIG.tecnicos[categoria].telefone;
  }
  
  await enviarWhatsApp(tecnicoTel, 
    `📸 ${nome} (${telefone}) enviou foto de ${cli?.dados?.servico || 'serviço'}.\nVerifique no painel ou solicite mais fotos.`
  );
  
  await enviarTelegramAdmin(`📸 Nova imagem de ${nome} (${telefone})\nCategoria: ${categoria || 'Não identificada'}`);
}

async function notificarTecnico(agendamento) {
  const { categoria, servico, data, hora, endereco, nome, telefone, valor, tecnico } = agendamento;
  
  // Encontra telefone do técnico
  let tecnicoTel = null;
  if (categoria && CONFIG.tecnicos[categoria]) {
    tecnicoTel = CONFIG.tecnicos[categoria].telefone;
  } else {
    tecnicoTel = CONFIG.tecnicos.reforma.telefone;
  }
  
  const ehEletro = ['ar_condicionado', 'lavadora', 'geladeira'].includes(categoria);
  
  const mensagem = 
    `🔔 *NOVA VISITA AGENDADA*\n\n` +
    `Serviço: ${servico}\n` +
    `Data: ${data} às ${hora}\n` +
    `Endereço: ${endereco}\n` +
    `Cliente: ${nome}\n` +
    `WhatsApp: ${telefone}\n` +
    `Valor visita: ${valor === 0 ? 'GRÁTIS' : 'R$'+valor}\n` +
    `${ehEletro ? '⚠️ Eletrodoméstico - Levar ferramentas específicas\n' : ''}` +
    `\nEntre em contato em até 48h para confirmar.`;
  
  await enviarWhatsApp(tecnicoTel, mensagem);
}

// ============================================
// GOOGLE CALENDAR INTEGRAÇÃO
// ============================================

async function verificarDisponibilidadeTecnicos(categoria, dataStr) {
  if (!googleAuthClient) {
    // Se não tiver Google Calendar configurado, permite agendar (controle manual)
    console.log('⚠️ Google Calendar não conectado - permitindo agendamento');
    const cat = CONFIG.categorias[categoria];
    return cat ? cat.tecnicos : ['reforma'];
  }
  
  try {
    const calendar = google.calendar({ version: 'v3', auth: googleAuthClient });
    
    // Converte data string para objeto Date
    let dataBusca;
    if (dataStr === 'hoje') {
      dataBusca = new Date();
    } else if (dataStr === 'amanhã') {
      dataBusca = new Date();
      dataBusca.setDate(dataBusca.getDate() + 1);
    } else {
      const [dia, mes] = dataStr.split('/');
      dataBusca = new Date(new Date().getFullYear(), parseInt(mes) - 1, parseInt(dia));
    }
    
    // Define início e fim do dia
    const timeMin = new Date(dataBusca);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(dataBusca);
    timeMax.setHours(23, 59, 59, 999);
    
    // Busca eventos do dia
    const response = await calendar.events.list({
      calendarId: CONFIG.googleCalendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const eventos = response.data.items || [];
    const horariosOcupados = eventos.map(e => ({
      inicio: new Date(e.start.dateTime),
      fim: new Date(e.end.dateTime),
      titulo: e.summary
    }));
    
    // Verifica quais técnicos da categoria têm disponibilidade
    const cat = CONFIG.categorias[categoria];
    const tecnicosPossiveis = cat ? cat.tecnicos : ['reforma'];
    
    // Simulação: verifica se há muitos agendamentos no dia
    // Na prática, você precisaria marcar qual técnico em cada evento
    const agendamentosNoDia = eventos.length;
    
    if (agendamentosNoDia >= 8) { // Limite arbitrário de 8 visitas por dia
      return []; // Dia cheio
    }
    
    return tecnicosPossiveis;
    
  } catch (e) {
    console.error('❌ Erro ao verificar agenda:', e.message);
    // Em caso de erro, permite agendar para não bloquear vendas
    const cat = CONFIG.categorias[categoria];
    return cat ? cat.tecnicos : ['reforma'];
  }
}

async function criarEventoCalendar(agendamento) {
  if (!googleAuthClient) {
    console.log('⚠️ Google Calendar não conectado - evento não criado');
    return false;
  }
  
  try {
    const calendar = google.calendar({ version: 'v3', auth: googleAuthClient });
    
    // Parse data e hora
    let dataEvento;
    if (agendamento.data === 'hoje') {
      dataEvento = new Date();
    } else if (agendamento.data === 'amanhã') {
      dataEvento = new Date();
      dataEvento.setDate(dataEvento.getDate() + 1);
    } else {
      const [dia, mes] = agendamento.data.split('/');
      dataEvento = new Date(new Date().getFullYear(), parseInt(mes) - 1, parseInt(dia));
    }
    
    // Define horário (padrão 10h se não especificado)
    let hora = 10;
    let minuto = 0;
    if (agendamento.hora && agendamento.hora.includes(':')) {
      const [h, m] = agendamento.hora.split(':');
      hora = parseInt(h);
      minuto = parseInt(m) || 0;
    }
    
    const inicio = new Date(dataEvento);
    inicio.setHours(hora, minuto, 0);
    
    const fim = new Date(inicio);
    fim.setHours(fim.getHours() + 1); // 1 hora de duração
    
    const ehEletro = ['ar_condicionado', 'lavadora', 'geladeira'].includes(agendamento.categoria);
    
    const event = {
      summary: `${ehEletro ? '❄️' : '🔧'} ${agendamento.servico} - ${agendamento.nome}`,
      location: agendamento.endereco,
      description: 
        `Cliente: ${agendamento.nome}\n` +
        `Telefone: ${agendamento.telefone}\n` +
        `Serviço: ${agendamento.servico}\n` +
        `Categoria: ${agendamento.categoria}\n` +
        `Valor visita: R$${agendamento.valor}\n` +
        `Técnico: ${agendamento.tecnico}\n` +
        `Status: Aguardando orçamento`,
      start: {
        dateTime: inicio.toISOString(),
        timeZone: 'America/Sao_Paulo'
      },
      end: {
        dateTime: fim.toISOString(),
        timeZone: 'America/Sao_Paulo'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 120 } // 2h antes
        ]
      }
    };
    
    const response = await calendar.events.insert({
      calendarId: CONFIG.googleCalendarId,
      resource: event
    });
    
    console.log('✅ Evento criado no Google Calendar:', response.data.id);
    
    // Salva ID do evento para atualizações futuras
    agendamento.googleEventId = response.data.id;
    
    return true;
    
  } catch (e) {
    console.error('❌ Erro ao criar evento:', e.message);
    return false;
  }
}

async function atualizarEventoCalendar(telefone, status) {
  const agendamento = agendamentos.find(a => 
    a.telefone === telefone && a.googleEventId
  );
  
  if (!agendamento || !googleAuthClient) return false;
  
  try {
    const calendar = google.calendar({ version: 'v3', auth: googleAuthClient });
    
    await calendar.events.patch({
      calendarId: CONFIG.googleCalendarId,
      eventId: agendamento.googleEventId,
      resource: {
        description: agendamento.description + `\n\nSTATUS: ${status}`
      }
    });
    
    return true;
  } catch (e) {
    console.error('❌ Erro ao atualizar evento:', e.message);
    return false;
  }
}

// ============================================
// SISTEMA DE LEMBRETES E RELATÓRIOS
// ============================================

function agendarLembrete(agendamento) {
  // Calcula tempo até 2h antes do agendamento
  // Na Vercel, isso precisa ser feito via Cron Job externo ou Redis
  console.log(`⏰ Lembrete agendado para ${agendamento.data} ${agendamento.hora}`);
  
  // Aqui você implementaria integração com serviço de cron
  // Exemplo: enviar para Redis, ou usar Vercel Cron Jobs (pago)
}

// Relatório diário automático (deve ser chamado por cron job)
async function gerarRelatorioDiario() {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  
  const dataStr = ontem.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  
  // Filtra atividades do dia anterior
  const visitasOntem = agendamentos.filter(a => {
    const dataAgendamento = new Date(a.criadoEm);
    return dataAgendamento.toDateString() === ontem.toDateString();
  });
  
  const novosClientes = Object.values(clientes).filter(c => {
    const dataCadastro = new Date(c.ultimaAtividade);
    return dataCadastro.toDateString() === ontem.toDateString();
  });
  
  const mensagensOntem = conversas.filter(c => {
    const dataMsg = new Date(c.data);
    return dataMsg.toDateString() === ontem.toDateString();
  }).length;
  
  const orcamentosAceitos = visitasOntem.filter(a => a.orcamentoStatus === 'aceito').length;
  const orcamentosRecusados = visitasOntem.filter(a => a.orcamentoStatus === 'recusado').length;
  const orcamentosPendentes = visitasOntem.filter(a => a.orcamentoStatus === 'pendente').length;
  
  const relatorio = 
    `📊 *RELATÓRIO DIÁRIO - ${dataStr}*\n\n` +
    `👥 *Atendimento:*\n` +
    `• Novos clientes: ${novosClientes.length}\n` +
    `• Total de mensagens: ${mensagensOntem}\n` +
    `• Intervenções humanas: ${Array.from(intervenções).length}\n\n` +
    `📅 *Agendamentos:*\n` +
    `• Visitas marcadas: ${visitasOntem.length}\n` +
    `• Orçamentos aceitos: ${orcamentosAceitos} ✅\n` +
    `• Orçamentos recusados: ${orcamentosRecusados} ❌\n` +
    `• Aguardando resposta: ${orcamentosPendentes} ⏳\n\n` +
    `💰 *Conversão:*\n` +
    `${visitasOntem.length > 0 ? Math.round((orcamentosAceitos / visitasOntem.length) * 100) : 0}% de aprovação\n\n` +
    `Próximo passo: Acompanhar pendentes! 🚀`;
  
  await enviarTelegramAdmin(relatorio);
  
  // Envia para canal de relatórios separado se configurado
  if (CONFIG.telegramChatIdRelatorios && CONFIG.telegramChatIdRelatorios !== CONFIG.telegramChatId) {
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatIdRelatorios,
        text: relatorio,
        parse_mode: 'Markdown'
      })
    });
  }
}

// Exporta função para ser chamada por cron job externo
export { gerarRelatorioDiario };

// ============================================// ============================================
// CONFIGURAÇÃO VARIÁVEIS DE AMBIENTE (CONTINUAÇÃO)
// ============================================

/*
Configurações necessárias na Vercel:

WHATSAPP_TOKEN=EAAXXXXX...
WHATSAPP_PHONE_ID=3XXXXXXXXX...
NUMERO_RC=5521XXXXXXXX
CNPJ_EMPRESA=XX.XXX.XXX/0001-XX (opcional)

TELEGRAM_BOT_TOKEN=7XXXXXX:XXXXXXXXXXXXXXXX
TELEGRAM_CHAT_ID=-100XXXXXXXXXX
TELEGRAM_CHAT_ID_RELATORIOS=-100XXXXXXXXXX (opcional - canal separado para relatórios)

GOOGLE_CALENDAR_ID=seu-email@gmail.com ou ID do calendário
GOOGLE_SERVICE_ACCOUNT_KEY=base64_do_json_do_service_account

// IMPORTANTE: Para Google Calendar, você precisa:
// 1. Criar projeto no Google Cloud Console (https://console.cloud.google.com)
// 2. Ativar Google Calendar API
// 3. Criar Service Account em IAM & Admin > Service Accounts
// 4. Gerar chave JSON e fazer download
// 5. Converter JSON para base64: cat arquivo.json | base64
// 6. Compartilhar calendário com o email do Service Account (com permissão de edição)
*/

// ============================================
// DEPENDÊNCIAS package.json
// ============================================

/*
{
  "dependencies": {
    "googleapis": "^128.0.0",
    "google-auth-library": "^9.0.0"
  }
}
*/

// ============================================
// VERCEL.JSON CONFIGURAÇÃO RECOMENDADA
// ============================================

/*
{
  "functions": {
    "api/index.js": {
      "maxDuration": 30
    }
  },
  "crons": [
    {
      "path": "/api/cron/relatorio",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/cron/lembretes",
      "schedule": "*/15 * * * *"
    }
  ]
}
*/

// ============================================
// ENDPOINTS ADICIONAIS PARA CRON JOBS (criar arquivos separados)
// ============================================

// api/cron/relatorio.js
/*
import { gerarRelatorioDiario } from '../index.js';

export default async function handler(req, res) {
  // Verifica secret para segurança
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  await gerarRelatorioDiario();
  res.json({ sucesso: true, mensagem: 'Relatório enviado' });
}
*/

// api/cron/lembretes.js
/*
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  // Verifica agendamentos nas próximas 2h30min e envia lembretes
  const agora = new Date();
  const daqui2h = new Date(agora.getTime() + 2.5 * 60 * 60 * 1000);
  
  for (const ag of agendamentos) {
    if (ag.status !== 'confirmado') continue;
    
    // Parse data/hora do agendamento
    let dataAgendamento;
    if (ag.data === 'hoje') {
      dataAgendamento = new Date();
    } else if (ag.data === 'amanhã') {
      dataAgendamento = new Date();
      dataAgendamento.setDate(dataAgendamento.getDate() + 1);
    } else {
      const [dia, mes] = ag.data.split('/');
      dataAgendamento = new Date(new Date().getFullYear(), parseInt(mes) - 1, parseInt(dia));
    }
    
    // Ajusta hora
    if (ag.hora && ag.hora.includes(':')) {
      const [h, m] = ag.hora.split(':');
      dataAgendamento.setHours(parseInt(h), parseInt(m), 0);
    }
    
    // Se está dentro da janela de 2h-2h30min
    if (dataAgendamento > agora && dataAgendamento <= daqui2h && !ag.lembreteEnviado) {
      // Envia lembrete para cliente
      await enviarWhatsApp(ag.telefone, 
        `⏰ *Lembrete de Visita Técnica*\n\n` +
        `Olá! Passando para lembrar que temos agendado para *hoje* às *${ag.hora}*.\n\n` +
        `📍 ${ag.endereco}\n` +
        `🔧 ${ag.servico}\n\n` +
        `O técnico confirmará quando estiver a caminho. Qualquer imprevisto, avise!`
      );
      
      // Envia lembrete para técnico
      const tecnicoTel = CONFIG.tecnicos[ag.categoria]?.telefone || CONFIG.tecnicos.reforma.telefone;
      await enviarWhatsApp(tecnicoTel,
        `⏰ *Lembrete de Visita*\n\n` +
        `Daqui 2h - ${ag.hora}\n` +
        `${ag.servico}\n` +
        `${ag.endereco}\n` +
        `Cliente: ${ag.nome} - ${ag.telefone}`
      );
      
      ag.lembreteEnviado = true;
      
      await enviarTelegramAdmin(`⏰ *Lembrete enviado*\n${ag.nome} - ${ag.data} ${ag.hora}`);
    }
  }
  
  res.json({ sucesso: true, lembretesEnviados: agendamentos.filter(a => a.lembreteEnviado).length });
}
*/

// ============================================
// CHECKLIST DE IMPLEMENTAÇÃO
// ============================================

/*
1. ✅ Criar projeto no Google Cloud Console
2. ✅ Ativar Google Calendar API
3. ✅ Criar Service Account e baixar chave JSON
4. ✅ Converter chave para base64 e adicionar à Vercel
5. ✅ Compartilhar calendário com email do Service Account
6. ✅ Criar bot no Telegram (@BotFather)
7. ✅ Adicionar bot ao grupo e pegar chat ID
8. ✅ Configurar webhook no Meta Developers
9. ✅ Adicionar números dos técnicos de eletrodomésticos
10. ✅ Testar fluxo completo
11. ✅ Configurar cron jobs na Vercel (requer plano Pro ou usar serviço externo)
*/

// ============================================
// TELEFONES DOS TÉCNICOS - ATUALIZAR AQUI
// ============================================

/*
Substituir no CONFIG.tecnicos:

ar_condicionado: { 
  nome: 'Técnico Ar Condicionado', 
  telefone: '5521XXXXXXXX',  // <-- COLOQUE O NÚMERO REAL AQUI
  email: '' 
},

lavadora: { 
  nome: 'Técnico Lava e Seca', 
  telefone: '5521XXXXXXXX',  // <-- COLOQUE O NÚMERO REAL AQUI
  email: '' 
},

geladeira: { 
  nome: 'Técnico Refrigerador', 
  telefone: '5521XXXXXXXX',  // <-- COLOQUE O NÚMERO REAL AQUI
  email: '' 
}
*/
// ============================================
// TRATAMENTO DE ERROS E RECUPERAÇÃO
// ============================================

// Captura erros não tratados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  enviarTelegramAdmin(`🚨 *ERRO NÃO TRATADO*\n\`\`\`${reason}\`\`\``);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  enviarTelegramAdmin(`🚨 *EXCEÇÃO CRÍTICA*\n\`\`\`${error.message}\`\`\``);
});

// ============================================
// FUNÇÃO DE TESTE E DIAGNÓSTICO
// ============================================

async function testarConexoes() {
  console.log('🧪 Testando conexões...');
  
  // Testa WhatsApp
  if (CONFIG.whatsappToken && CONFIG.whatsappPhoneId) {
    console.log('✅ WhatsApp configurado');
  } else {
    console.error('❌ WhatsApp NÃO configurado');
  }
  
  // Testa Telegram
  if (CONFIG.telegramBotToken && CONFIG.telegramChatId) {
    console.log('✅ Telegram configurado');
    await enviarTelegramAdmin('🤖 *Bot iniciado* - Sistema RC Reformas online');
  } else {
    console.error('❌ Telegram NÃO configurado');
  }
  
  // Testa Google Calendar
  if (CONFIG.googleServiceAccountKey && CONFIG.googleCalendarId) {
    const ok = await inicializarGoogleCalendar();
    if (ok) {
      console.log('✅ Google Calendar conectado');
    }
  } else {
    console.log('⚠️ Google Calendar não configurado (opcional)');
  }
}

// Executa teste na primeira importação
testarConexoes();

// ============================================
// EXPORTAÇÕES ADICIONAIS
// ============================================

export { 
  clientes, 
  agendamentos, 
  conversas, 
  intervenções,
  enviarWhatsApp,
  enviarTelegramAdmin,
  gerarRelatorioDiario
};
  
  
