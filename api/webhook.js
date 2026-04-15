// ============================================
// RC REFORMA E CONSTRUÇÃO - SISTEMA COMPLETO
// WhatsApp Bot + Painel de Controle + Integrações
// ============================================

const CONFIG = {
  // Dados da Empresa
  empresa: {
    nome: 'RC Reforma e Construção',
    instagram: 'https://share.google/5n4VM0DwDTlDgEX3C',
    site: 'https://infomixbotafogo.com.br/servicos/pedreiro/',
    polo: 'Botafogo'
  },
  
  // Técnicos
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176',
    eletrica: '5521968112176',
    pintura: '5521968112176',
    gesso: '5521968112176',
    pedreiro: '5521968112176'
  },
  
  // Preços
  precoVisita: 180,
  precoZonaSulComDesconto: 90,
  
  // Bairros Zona Sul + Centro (atendimento prioritário)
  bairrosAtendidos: [
    // Zona Sul
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha',
    // Centro e adjacências
    'centro', 'lapa', 'santa teresa', 'cinelândia', 'cinelandida',
    'praça mauá', 'praca maua', 'carioca', 'uruguaiana'
  ],
  
  // Serviços oferecidos
  servicos: [
    'pedreiro', 'pintura', 'marcenaria', 'hidráulica', 'hidraulica', 
    'elétrica', 'eletrica', 'reforma', 'azulejo', 'gesso', 
    'vazamento', 'encanamento', 'serralheria', 'drywall', 
    'porcelanato', 'revestimento', 'impermeabilização', 'impermeabilizacao',
    'trocar', 'consertar', 'instalar', 'reparar', 'montar',
    'armário', 'armario', 'porta', 'janela', 'piso', 'parede',
    'banheiro', 'cozinha', 'quarto', 'sala', 'área', 'area', 'varanda'
  ],
  
  // Configurações
  numeroRC: process.env.NUMERO_RC || '',
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  
  // Telegram para notificações
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  
  // Google Calendar (configurar depois)
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID,
  googleServiceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  
  // Palavras de risco/confusão para intervenção humana
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
// ESTADO GLOBAL
// ============================================

const clientes = {};        // Dados dos clientes
const conversas = [];       // Histórico para painel
const processadas = new Set(); // IDs de mensagens processadas
const agendamentos = [];    // Lista de visitas agendadas
const intervenções = new Set(); // Telefones em modo humano

// ============================================
// HANDLER PRINCIPAL (Vercel/Node)
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
    // Webhook WhatsApp (GET - verificação)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // Painel de Controle (endpoints com ?action=)
    if (req.method === 'GET' && req.query.action) {
      return await handlePainel(req, res);
    }
    
    if (req.method === 'POST' && req.query.action) {
      return await handlePainel(req, res);
    }

    // Webhook WhatsApp (POST - mensagens)
    if (req.method === 'POST' && req.body?.object === 'whatsapp_business_account') {
      return await receberWhatsApp(req, res);
    }

    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO GERAL:', e.message, e.stack);
    return res.status(200).send('OK');
  }
}

// ============================================
// PAINEL DE CONTROLE - ENDPOINTS
// ============================================

async function handlePainel(req, res) {
  const { action } = req.query;
  
  switch (action) {
    case 'list': {
      // Lista todas as conversas ativas
      const lista = Object.entries(clientes).map(([telefone, dados]) => ({
        telefone,
        nome: dados.nome,
        etapa: dados.etapa,
        ultimaAtividade: dados.ultimaAtividade,
        emIntervencao: intervenções.has(telefone),
        resumo: dados.dados.servico && dados.dados.bairro 
          ? `${dados.dados.servico} em ${dados.dados.bairro}` 
          : 'Iniciando atendimento'
      }));
      return res.json({ conversas: lista, total: lista.length });
    }
    
    case 'messages': {
      // Retorna mensagens de uma conversa específica
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
      // Assumir controle humano
      const { phone, usuario } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.add(phone);
      
      // Notifica o cliente
      await enviarWhatsApp(phone, 
        `Olá! Um de nossos atendentes humanos assumiu esta conversa para melhor atendê-lo. Em que posso ajudar?`
      );
      
      // Log no Telegram
      await enviarTelegram(`🚨 INTERVENÇÃO HUMANA\nTelefone: ${phone}\nAtendente: ${usuario || 'Não informado'}\nData: ${new Date().toLocaleString('pt-BR')}`);
      
      return res.json({ sucesso: true, mensagem: 'Intervenção ativada', telefone: phone });
    }
    
    case 'release': {
      // Liberar robô
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.delete(phone);
      
      await enviarWhatsApp(phone,
        `Obrigado pelo contato! Vou retomar o atendimento automatizado. Como posso ajudá-lo hoje?`
      );
      
      return res.json({ sucesso: true, mensagem: 'Robô liberado', telefone: phone });
    }
    
    case 'send': {
      // Enviar mensagem manual
      const { phone, mensagem, usuario } = req.body;
      if (!phone || !mensagem) return res.status(400).json({ erro: 'Telefone e mensagem obrigatórios' });
      
      await enviarWhatsApp(phone, mensagem);
      
      // Registra no histórico
      conversas.push({
        telefone: phone,
        tipo: 'humano',
        mensagem,
        data: new Date().toISOString(),
        atendente: usuario || 'Sistema'
      });
      
      return res.json({ sucesso: true, mensagem: 'Mensagem enviada' });
    }
    
    case 'read': {
      // Marcar como lida (visualização no painel)
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      if (clientes[phone]) {
        clientes[phone].lida = true;
      }
      
      return res.json({ sucesso: true });
    }
    
    case 'stats': {
      // Estatísticas gerais
      return res.json({
        totalConversas: Object.keys(clientes).length,
        emAtendimento: Object.values(clientes).filter(c => c.etapa !== 'AGENDADO' && c.etapa !== 'INICIO').length,
        agendamentosHoje: agendamentos.filter(a => a.data === 'hoje').length,
        intervencoesAtivas: intervenções.size,
        ultimas24h: conversas.filter(c => new Date(c.data) > new Date(Date.now() - 86400000)).length
      });
    }
    
    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}

// ============================================
// WHATSAPP - RECEBIMENTO DE MENSAGENS
// ============================================

async function receberWhatsApp(req, res) {
  const body = req.body;
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  
  if (!changes || changes.statuses) {
    return res.status(200).send('OK');
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return res.status(200).send('OK');
  
  // Evita duplicados
  if (processadas.has(msg.id)) return res.status(200).send('OK');
  processadas.add(msg.id);
  setTimeout(() => processadas.delete(msg.id), 3600000);
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  const tipo = msg.type;
  
  // Ignora próprio número
  if (telefone === CONFIG.numeroRC) return res.status(200).send('OK');
  
  // Verifica se está em intervenção humana
  if (intervenções.has(telefone)) {
    // Apenas registra a mensagem, não responde automaticamente
    conversas.push({
      telefone,
      tipo: 'cliente',
      mensagem: msg.text?.body || `[${tipo}]`,
      data: new Date().toISOString()
    });
    
    // Notifica no Telegram que há mensagem aguardando
    await enviarTelegram(`💬 Nova mensagem em intervenção\nCliente: ${nome} (${telefone})\nTipo: ${tipo}\nHorário: ${new Date().toLocaleString('pt-BR')}`);
    
    return res.status(200).send('OK');
  }
  
  // Processa mensagem
  let texto = '';
  let conteudo = '';
  
  if (tipo === 'text') {
    texto = msg.text.body;
    conteudo = texto;
  } else if (tipo === 'image') {
    texto = '[imagem recebida]';
    conteudo = msg.image?.id || 'imagem';
    
    // Encaminha imagem para o técnico apropriado
    await processarImagem(telefone, nome, msg.image, clientes[telefone]?.dados?.servico);
  } else if (tipo === 'audio') {
    texto = '[áudio recebido]';
    await enviarWhatsApp(telefone, "No momento não consigo ouvir áudios. Pode descrever por escrito o que precisa, por favor? 📸 Se quiser, envie fotos do local!");
    return res.status(200).send('OK');
  } else if (tipo === 'document') {
    texto = '[documento recebido]';
  } else {
    texto = `[${tipo}]`;
  }
  
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Registra no histórico
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
      ultimaAtividade: new Date().toISOString()
    };
  }
  
  const cli = clientes[telefone];
  cli.ultimaAtividade = new Date().toISOString();
  
  // Verifica palavras de risco/confusão
  if (detectarRisco(texto.toLowerCase())) {
    intervenções.add(telefone);
    await enviarWhatsApp(telefone, 
      `Entendo sua frustração. Vou transferir você imediatamente para um de nossos atendentes humanos que poderá resolver sua situação com atenção especial. Por favor, aguarde um momento. 🙏`
    );
    await enviarTelegram(`🚨 ALERTA DE RISCO\nCliente: ${nome} (${telefone})\nMensagem: ${texto}\nAção: Intervenção automática ativada`);
    return res.status(200).send('OK');
  }
  
  // Processa resposta do bot
  const resp = await processarMensagem(cli, texto.toLowerCase(), conteudo, nome);
  
  if (resp) {
    await enviarWhatsApp(telefone, resp);
    
    // Registra resposta do bot
    conversas.push({
      telefone,
      tipo: 'bot',
      mensagem: resp,
      data: new Date().toISOString()
    });
  }
  
  return res.status(200).send('OK');
}

// ============================================
// LÓGICA DE VENDAS - PROCESSAMENTO
// ============================================

async function processarMensagem(cli, t, original, nome) {
  const d = cli.dados;
  
  // ===== SAUDAÇÃO INICIAL (sempre gentil) =====
  if (cli.etapa === 'INICIO' && t.match(/(oi|olá|ola|bom dia|boa tarde|boa noite|hey|hi|hello)/)) {
    return `Olá, ${nome}! 👋 Sou o assistente virtual da *RC Reforma e Construção*. 
    
Para te ajudar da melhor forma, me conta: 
1️⃣ Qual serviço você precisa? (pedreiro, pintura, hidráulica, elétrica, marcenaria...)
2️⃣ Qual bairro do Rio de Janeiro?

Se quiser, pode enviar fotos do local também! 📸`;
  }

  // ===== DETECÇÃO DE RISCO/CONFUSÃO =====
  if (detectarRisco(t)) {
    intervenções.add(cli.telefone);
    return `Percebi que posso não estar entendendo direito sua necessidade. Vou chamar um atendente humano especializado para cuidar do seu caso com toda atenção. Por favor, aguarde um momento.`;
  }

  // ===== OBJEÇÕES COMUNS (detectadas em qualquer etapa) =====
  
  // Preço caro
  if (t.match(/(caro|car demais|muito caro|tá caro|tah caro|absurdo|exagerado|roubando|mamando|abusado|não tenho dinheiro|não posso pagar|tá louco)/)) {
    return `Entendo perfeitamente, ${nome}. Deixa eu te explicar o valor da visita técnica de *R$180*:

✅ O profissional vai até você e analisa tudo no local
✅ Você recebe um orçamento detalhado e transparente  
✅ Se aprovar o serviço, esses R$180 são *abatidos do valor total*
✅ Se não aprovar, você tem a avaliação técnica de um especialista

Na Zona Sul, inclusive, consigo oferecer *50% de desconto* (sai por R$90). E se você for de *Botafogo*, posso zerar essa taxa como cortesia especial! 🎯

O que acha de verificarmos a disponibilidade?`;
  }

  // Comparar preços
  if (t.match(/(comparar|outras empresas|vou pesquisar|vou ver outro|orçamento de outro)/)) {
    return `Compreendo totalmente, ${nome}! É sempre bom comparar. 

Se você já tiver algum orçamento de outra empresa, pode me enviar que verificamos se conseguimos cobrir o valor com a mesma qualidade RC Reformas. 

Nosso diferencial é o profissionalismo e a garantia de quem atende a clientes exigentes na Zona Sul há meses. 

Quer verificar nossa disponibilidade mesmo assim?`;
  }

  // Desconfiança/Pagamento
  if (t.match(/(não confio|nao confio|pagar antes|dinheiro adiantado|sinal|golpe|enganar)/)) {
    return `Sua desconfiança é natural e importante, ${nome}! 

A RC Reforma e Construção trabalha assim:
• Pagamento do serviço: 50% no início + 50% na conclusão  
• Ou pode pagar 100% na conclusão se preferir maior segurança
• PIX ou dinheiro - você escolhe
• Contrato e nota fiscal disponíveis

O valor da visita (R$180) é pago no ato, mas como te disse, vira desconto no serviço. 

Posso agendar para você conhecer nosso trabalho pessoalmente?`;
  }

  // Quem é você/Robô
  if (t.match(/(quem é você|quem e voce|você é robô|voce e robo|é humano|e humano|atendente|quem fala)/)) {
    return `Sou o assistente virtual da *RC Reforma e Construção*! 🤖➡️👷‍♂️

Estou aqui para agilizar seu atendimento, mas se em algum momento você preferir falar com uma pessoa real, é só pedir que transfiro imediatamente para nossa equipe humana.

Meu objetivo é entender o que você precisa e marcar a visita técnica no melhor horário disponível. 

Como posso ajudar hoje?`;
  }

  // Só queria saber preço/Informação
  if (t.match(/(só queria saber|so queria saber|só tirei dúvida|so tirei duvida|depois eu falo|depois eu entro em contato)/)) {
    return `Sem problemas, ${nome}! Fico feliz em ter ajudado com as informações. 

Quando precisar de um orçamento real com visita técnica, é só chamar. Estarei por aqui! 

E se tiver mais alguma dúvida agora, fique à vontade. 😊`;
  }

  // Vou pensar/Decidir depois
  if (t.match(/(vou pensar|volto depois|depois eu decido|vou analisar)/)) {
    return `Claro, ${nome}! Analise com calma. 

Só não deixe o problema piorar - quanto antes resolver, melhor! 

Quando quiser agendar, é só mandar uma mensagem. Normalmente temos vagas para *hoje ou amanhã*. 

Boa sorte e volte sempre! 🛠️`;
  }

  // Cancelar/Desistir
  if (t.match(/(desisti|cancela|quero cancelar|desistir|não quero mais|nao quero mais)/)) {
    return `Sinto muito em saber disso, ${nome}. 😔

Pode me contar o que aconteceu? Talvez eu possa resolver ou ajustar algo para você. Se for questão de valor, horário ou qualquer outra coisa, vamos conversar!

Se for emergência (vazamento, risco elétrico), por favor me avise que priorizamos esses casos.`;
  }

  // ===== FLUXO PRINCIPAL POR ETAPA =====
  
  switch (cli.etapa) {
    case 'INICIO':
      return await etapaInicio(cli, t, original);
      
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
      
    case 'AGUARDANDO_DATA_ESPECIFICA':
      return etapaAguardandoDataEspecifica(cli, t, original);
      
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original);
      
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original);
      
    case 'CONFIRMAR_VISITA':
      return etapaConfirmarVisita(cli, t, original);
      
    case 'AGENDADO':
      return etapaPosAgendamento(cli, t, original);
      
    default:
      cli.etapa = 'INICIO';
      return `Olá, ${nome}! Me informe o serviço e o bairro que deseja atendimento, por favor.`;
  }
}

// ===== ETAPAS DO FUNIL DE VENDAS =====

async function etapaInicio(cli, t, original) {
  const d = cli.dados;
  const { servico, bairro } = extrairServicoEBairro(t, original);
  
  // Se temos ambos
  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    
    // Verifica se atende o bairro
    if (!verificarAtendimento(bairro)) {
      return `Entendo que você precisa de ${servico}. No momento, nosso polo é em *Botafogo* e atendemos prioritariamente a *Zona Sul e Centro* do Rio. 

Para o bairro ${bairro}, posso verificar se temos disponibilidade, mas o valor da visita seria diferenciado devido à distância. Deseja que eu consulte mesmo assim?`;
    }
    
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Perfeito! ${servico.charAt(0).toUpperCase() + servico.slice(1)} em ${bairro.charAt(0).toUpperCase() + bairro.slice(1)}. 

Você precisa de atendimento *urgente para hoje* ou podemos agendar para os próximos dias? 
    
📅 Tenho vagas disponíveis para hoje e amanhã normalmente.`;
  }
  
  // Só tem serviço
  if (servico) {
    d.servico = servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo! Você precisa de *${servico}*. 

Qual bairro do Rio de Janeiro precisa do atendimento?`;
  }
  
  // Só tem bairro
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return `Entendi, atendimento em *${bairro}*. 

Qual serviço você precisa? (pedreiro, pintura, hidráulica, elétrica, marcenaria, gesso...)`;
  }
  
  // Não identificou nada específico
  if (t.match(/(quanto custa|qual o preço|valor|orçamento)/)) {
    return `Para te passar valores precisos, preciso saber:
1️⃣ Qual serviço você precisa?
2️⃣ Qual bairro?

Cada caso é único! Mas a visita técnica custa *R$180* (com desconto de 50% na Zona Sul e *grátis* em Botafogo). 

E aí, me conta o que precisa? 🔧`;
  }
  
  // Saudação genérica ou não entendeu
  return `Oi! Sou da RC Reforma e Construção. Para te ajudar rápido:

Qual serviço você precisa e em qual bairro do Rio? 

Exemplos: "pintura em Ipanema", "vazamento em Copacabana", "marcenaria em Botafogo"...`;
}

function etapaAguardandoBairro(cli, t, original) {
  const d = cli.dados;
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    
    if (!verificarAtendimento(bairro)) {
      return `Anotado: ${bairro}. Como nosso polo é em Botafogo, atendemos prioritariamente Zona Sul e Centro. 

Para ${bairro}, posso verificar disponibilidade especial. Você precisa de atendimento *urgente hoje* ou podemos agendar?`;
    }
    
    return `Ótimo! ${d.servico} em ${bairro}. 

Você precisa de atendimento *para hoje* ou podemos agendar para amanhã/outro dia?`;
  }
  
  return `Qual bairro do Rio de Janeiro? (Se for fora da Zona Sul/Centro, me avise que verifico disponibilidade)`;
}

function etapaAguardandoServico(cli, t, original) {
  const d = cli.dados;
  const servico = extrairServico(t);
  
  if (servico) {
    d.servico = servico;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    
    return `Perfeito! ${servico} em ${d.bairro}.

Precisa de atendimento *urgente para hoje* ou podemos agendar para os próximos dias?`;
  }
  
  return `Qual serviço você precisa em ${d.bairro}? 

Posso ajudar com: pedreiro, pintura, hidráulica, elétrica, marcenaria, gesso, revestimentos...`;
}

function etapaConfirmaAtendimentoHoje(cli, t, original) {
  const d = cli.dados;
  
  // Urgência/hoje
  if (t.match(/(hoje|urgente|urgência|urgencia|vazando|quebrou|emergência|emergencia|preciso agora|caiu)/)) {
    d.urgente = true;
    cli.etapa = 'APRESENTA_VALOR';
    
    return `Entendi que é urgente! 🚨

Antes de confirmar a visita para *HOJE*, preciso te explicar como funciona:

📋 *Visita Técnica: R$180*
• Profissional vai até você e avalia tudo
• Você recebe orçamento detalhado no local
• Se aprovar o serviço: R$180 vira desconto no total
• Se não aprovar: fica com a avaliação técnica

💰 *Descontos especiais:*
• Zona Sul: 50% OFF (R$90)
• Botafogo: *GRÁTIS* (cortesia especial!)

Seu bairro (${d.bairro}) ${d.bairro.toLowerCase().includes('botafogo') ? 'tem visita GRÁTIS!' : d.bairro.toLowerCase().includes('ipanema') || d.bairro.toLowerCase().includes('copacabana') || d.bairro.toLowerCase().includes('leblon') || d.bairro.toLowerCase().includes('flamengo') || d.bairro.toLowerCase().includes('lagoa') || d.bairro.toLowerCase().includes('humaita') || d.bairro.toLowerCase().includes('jardim botanico') || d.bairro.toLowerCase().includes('gavea') ? 'tem 50% de desconto (R$90)!' : 'é R$180'}

Tudo bem? Posso verificar a disponibilidade do técnico para *hoje*?`;
  }
  
  // Amanhã/outro dia
  if (t.match(/(amanhã|amanha|depois|próximo dia|proximo dia|outro dia|semana que vem|próxima semana|proxima semana)/)) {
    d.urgente = false;
    cli.etapa = 'APRESENTA_VALOR';
    
    return `Sem problemas! Para agendar com antecedência:

📋 *Visita Técnica: R$180*
• Profissional qualificado no local
• Orçamento detalhado e transparente
• Valor abatido do total se aprovar

💰 *Descontos:*
• Zona Sul: 50% OFF (R$90)
• Botafogo: *GRÁTIS*

Seu bairro (${d.bairro}) ${d.bairro.toLowerCase().includes('botafogo') ? 'tem visita GRÁTIS!' : verificarAtendimento(d.bairro) ? 'tem 50% de desconto (R$90)!' : 'fica em R$180'}

Posso verificar na agenda e apresentar opções de data?`;
  }
  
  // Genérico/sim
  if (t.match(/(sim|pode|ok|claro|verifica|verificar)/)) {
    cli.etapa = 'APRESENTA_VALOR';
    return `Perfeito! Então vamos ao valor da visita técnica:

💰 *R$180* - visita técnica completa
${verificarAtendimento(d.bairro) && !d.bairro.toLowerCase().includes('botafogo') ? '• Com 50% OFF na Zona Sul: *R$90*' : ''}
${d.bairro.toLowerCase().includes('botafogo') ? '• Em Botafogo: *GRÁTIS* (cortesia especial)' : ''}

O valor é pago no ato da visita (PIX ou dinheiro) e se você aprovar o orçamento do serviço, esses R$${d.bairro.toLowerCase().includes('botafogo') ? '0' : verificarAtendimento(d.bairro) ? '90' : '180'} viram desconto no total.

Posso verificar disponibilidade na agenda?`;
  }
  
  return `Você precisa de atendimento *para hoje* (urgente) ou podemos agendar para *amanhã/outro dia*?`;
}

function etapaApresentaValor(cli, t, original) {
  const d = cli.dados;
  
  // Objeção ao valor
  if (t.match(/(caro|muito caro|não vou pagar|nao vou pagar|grátis|gratis|de graça|de graca|sem pagar|absurdo)/)) {
    if (d.bairro.toLowerCase().includes('botafogo')) {
      d.valorVisita = 0;
      return `Como você é de *Botafogo*, nosso bairro polo, vou fazer uma exceção especial: *VISITA TÉCNICA GRÁTIS*! 🎉

Sem custo nenhum para avaliar seu ${d.servico}. Se aprovar o orçamento, ótimo. Se não, fica a avaliação de graça mesmo.

Posso verificar disponibilidade na agenda agora?`;
    } else if (verificarAtendimento(d.bairro)) {
      return `Entendo... Posso oferecer *50% de desconto* para Zona Sul. Fica *R$90* a visita técnica.

Ou, se você conseguir trazer o serviço para Botafogo (se for algo transportável), aí sim consigo visita 100% gratuita!

O que prefere?`;
    } else {
      return `Infelizmente para bairros fora da Zona Sul/Centro, precisamos manter o valor de R$180 devido ao deslocamento.

Mas garanto: o profissionalismo compensa. E se aprovar o serviço, esse valor vira desconto.

Quer verificar disponibilidade mesmo assim?`;
    }
  }
  
  // Desconto
  if (t.match(/(desconto|faz mais barato|consegue abaixar|tem desconto|faz por)/)) {
    if (d.bairro.toLowerCase().includes('botafogo')) {
      d.valorVisita = 0;
      return `Para Botafogo posso zerar a visita! *GRÁTIS*! 🎯

Só me confirmar se quer agendar que verifico a agenda.`;
    }
    return `Melhor desconto possível: 50% na Zona Sul (R$90). 

Ou, se for algo que dê para avaliar em Botafogo, aí consigo *grátis*!

Qual opção te atende?`;
  }
  
  // Aceitou/Avançar
  if (t.match(/(sim|pode|ok|claro|tá bom|tah bom|pode ser|verifica|agenda|vamos|bora)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Ótimo! Deixa eu consultar a agenda do técnico... ⏳

Para qual dia você tem preferência?
• *Hoje* (se for urgente)
• *Amanhã*
• Outro dia específico?

Me diz que verifico a disponibilidade!`;
  }
  
  // Não aceitou
  if (t.match(/(não|nao|não quero|nao quero|desisti)/)) {
    return `Sem problemas, ${cli.nome}! Se mudar de ideia ou precisar de outra informação, é só chamar.

Seu contato fica salvo aqui. Boa sorte! 🍀`;
  }
  
  return `Posso verificar na agenda a disponibilidade para sua visita de ${d.servico} em ${d.bairro}?

Só confirmar que entendeu o valor (R$${d.bairro.toLowerCase().includes('botafogo') ? '0 (grátis)' : verificarAtendimento(d.bairro) ? '90' : '180'}) e eu consulto as datas disponíveis!`;
}

async function etapaVerificarAgenda(cli, t, original) {
  const d = cli.dados;
  
  // Hoje
  if (t.match(/(hoje|hoje ainda|ainda hoje)/)) {
    const horaAtual = new Date().getHours();
    
    if (horaAtual >= 18) {
      return `Já são mais de 18h, mas posso tentar agendar o primeiro horário de *amanhã* de manhã. 

Ou prefere agendar para outro dia?`;
    }
    
    // Simula consulta à agenda (depois integrar com Google Calendar)
    const disponivel = await consultarAgenda('hoje', d.servico);
    
    if (disponivel) {
      d.data = 'hoje';
      d.dataFormatada = new Date().toLocaleDateString('pt-BR');
      cli.etapa = 'AGUARDANDO_HORARIO';
      
      return `✅ *Temos vaga para HOJE!*

Qual horário seria melhor?
• Manhã (9h às 12h)
• Tarde (14h às 17h)
• Noite (18h às 20h) - se urgente

Me informa que confirmo com o técnico!`;
    } else {
      return `Hoje está bem corrido... 😅 

Mas tenho vaga para *amanhã* cedo ou para ${getProximosDias(2)}.

Qual desses te atende melhor?`;
    }
  }
  
  // Amanhã
  if (t.match(/(amanhã|amanha)/)) {
    const disponivel = await consultarAgenda('amanhã', d.servico);
    
    if (disponivel) {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      d.data = 'amanhã';
      d.dataFormatada = amanha.toLocaleDateString('pt-BR');
      cli.etapa = 'AGUARDANDO_HORARIO';
      
      return `✅ *Amanhã temos disponibilidade!*

Qual período prefere?
• Manhã (9h às 12h)
• Tarde (14h às 17h)

Qual melhor horário para você?`;
    } else {
      return `Amanhã está fechado... 😕

Mas tenho para ${getProximosDias(2)} ou ${getProximosDias(3)}. Algum desses serve?`;
    }
  }
  
  // Outro dia específico
  const dataEspecifica = extrairData(t, original);
  if (dataEspecifica) {
    d.data = dataEspecifica;
    d.dataFormatada = dataEspecifica;
    cli.etapa = 'AGUARDANDO_HORARIO';
    
    return `Anotado: ${dataEspecifica}. 

Qual horário seria ideal?
• Manhã (9h-12h)
• Tarde (14h-17h)

Me informa o horário!`;
  }
  
  // Genérico
  if (t.match(/(qualquer dia|tanto faz|o que tiver|mais breve)/)) {
    return `Então vou oferecer o mais breve possível:

1️⃣ *Hoje* (se ainda der tempo)
2️⃣ *Amanhã* de manhã
3️⃣ ${getProximosDias(2)}

Qual sua preferência?`;
  }
  
  return `Para *quando* você precisa?

Posso verificar:
• Hoje (se urgente)
• Amanhã
• Outro dia específico

Me informa que consulto a agenda do técnico! 📅`;
}

function etapaAguardandoHorario(cli, t, original) {
  const d = cli.dados;
  
  // Extrai horário específico
  const hora = extrairHora(original);
  
  if (hora) {
    d.hora = hora;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    
    return `✅ ${hora} anotado!

Agora preciso do *endereço completo* para o técnico:

📍 Rua/Avenida:
🔢 Número:
🏢 Apartamento ou Casa:
📝 Complemento (opcional):

Pode enviar!`;
  }
  
  // Períodos genéricos
  if (t.match(/manhã|manha/)) {
    d.hora = 'a definir (manhã)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    
    return `✅ Período da manhã (9h-12h) anotado!

Agora preciso do *endereço completo*:

📍 Rua/Avenida:
🔢 Número:  
🏢 Apartamento ou Casa:
📝 Complemento (se houver):

Qual o endereço?`;
  }
  
  if (t.match(/tarde/)) {
    d.hora = 'a definir (tarde)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    
    return `✅ Período da tarde (14h-17h) anotado!

Agora preciso do *endereço completo*:

📍 Rua/Avenida:
🔢 Número:
🏢 Apartamento ou Casa:
📝 Complemento (se houver):

Qual o endereço?`;
  }
  
  if (t.match(/noite/)) {
    d.hora = 'a definir (noite)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    
    return `✅ Período da noite (18h-20h) anotado!

Agora preciso do *endereço completo*:

📍 Rua/Avenida:
🔢 Número:
🏢 Apartamento ou Casa:
📝 Complemento (se houver):

Qual o endereço?`;
  }
  
  return `Qual horário específico ou período?

Exemplos: "10h", "manhã", "tarde", "14:30"...`;
}

function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;
  
  // Verifica se parece um endereço válido
  if (original.length > 8 && (
    t.match(/(rua|av|avenida|alameda|travessa|estrada|rodovia|número|numero|nº|n°|apartamento|ap|casa|sobrado|loja|sala|bloco|andar)/) ||
    t.match(/\d+/)
  )) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_VISITA';
    
    // Calcula valor final
    let valorFinal = 180;
    if (d.bairro.toLowerCase().includes('botafogo')) valorFinal = 0;
    else if (verificarAtendimento(d.bairro)) valorFinal = 90;
    d.valorVisita = valorFinal;
    
    return `📋 *RESUMO DO AGENDAMENTO*

Serviço: ${d.servico}
Data: ${d.data} (${d.dataFormatada})
Horário: ${d.hora}
Endereço: ${original}
Valor da visita: ${valorFinal === 0 ? '*GRÁTIS* 🎉' : `R$${valorFinal}`}
Pagamento: ${valorFinal > 0 ? 'PIX ou dinheiro no ato da visita' : 'Nenhum (cortesia Botafogo)'}

*Está tudo correto?* 

✅ Confirme com "sim" ou "ok" para agendar
🔄 Ou me avise se precisa alterar algo`;
  }
  
  // Se enviou algo muito curto ou sem indicação de endereço
  if (original.length < 8) {
    return `Preciso do endereço completo, por favor:

Exemplo: "Rua das Flores, 123, apto 45, Botafogo"

Qual seu endereço?`;
  }
  
  return `Qual o endereço completo para a visita técnica?

(Inclua rua, número, complemento se houver)`;
}

async function etapaConfirmarVisita(cli, t, original) {
  const d = cli.dados;
  
  if (t.match(/(sim|pode|ok|confirmo|tá bom|tah bom|perfeito|ótimo|otimo|beleza|fechado)/)) {
    // Finaliza agendamento
    cli.etapa = 'AGENDADO';
    
    const agendamento = {
      id: Date.now(),
      telefone: cli.telefone || 'unknown',
      nome: cli.nome,
      servico: d.servico,
      bairro: d.bairro,
      data: d.data,
      dataFormatada: d.dataFormatada,
      hora: d.hora,
      endereco: d.endereco,
      valor: d.valorVisita,
      status: 'confirmado',
      criadoEm: new Date().toISOString()
    };
    
    agendamentos.push(agendamento);
    
    // Notifica técnico
    const tecnico = CONFIG.tecnicos[d.servico] || CONFIG.tecnicos.reforma;
    await enviarWhatsApp(tecnico, 
      `🔔 *NOVA VISITA AGENDADA*\n\nServiço: ${d.servico}\nData: ${d.data} - ${d.hora}\nEndereço: ${d.endereco}\nCliente: ${cli.nome}\nWhatsApp: ${cli.telefone}\nValor: ${d.valorVisita === 0 ? 'GRÁTIS' : 'R$' + d.valorVisita}\n\nEntre em contato com o cliente em até 48h para confirmar.`
    );
    
    // Notifica Telegram
    await enviarTelegram(
      `✅ *VISITA CONFIRMADA*\n\n` +
      `📅 ${d.data} às ${d.hora}\n` +
      `🔧 ${d.servico}\n` +
      `📍 ${d.endereco} (${d.bairro})\n` +
      `👤 ${cli.nome}\n` +
      `📱 ${cli.telefone}\n` +
      `💰 ${d.valorVisita === 0 ? 'GRÁTIS (Botafogo)' : 'R$' + d.valorVisita}\n` +
      `⏰ Agendado em: ${new Date().toLocaleString('pt-BR')}`
    );
    
    // Agenda lembrete (2h antes)
    agendarLembrete(agendamento);
    
    // Adiciona ao Google Calendar (quando configurar)
    await adicionarAoCalendario(agendamento);
    
    return `🎉 *VISITA CONFIRMADA!*

📅 ${d.data} às ${d.hora}
📍 ${d.endereco}
🔧 ${d.servico}
${d.valorVisita > 0 ? `💰 R$${d.valorVisita} (pagar no ato)` : '💰 GRÁTIS'}

*O que acontece agora:*
1️⃣ Nosso técnico entrará em contato em até *48h* para confirmar
2️⃣ Você receberá um *lembrete automático* 2h antes da visita
3️⃣ No dia, o profissional avalia tudo e entrega orçamento detalhado

Se precisar remarcar, é só me avisar com *2h de antecedência*.

Mais alguma dúvida? Estou aqui! 😊`;
  }
  
  if (t.match(/(não|nao|mudar|alterar|trocar|errado|corrigir)/)) {
    cli.etapa = 'AGUARDANDO_DATA_ESPECIFICA';
    return `Sem problema! O que precisa alterar?

• Data/horário
• Endereço  
• Serviço

Me informa que ajusto!`;
  }
  
  return `Posso confirmar a visita para ${d.data} às ${d.hora} em ${d.endereco}?

Responda *sim* para confirmar ou me diga o que precisa alterar!`;
}

function etapaPosAgendamento(cli, t, original) {
  const d = cli.dados;
  
  // Remarcar
  if (t.match(/(remarcar|mudar data|alterar|outro dia|não posso mais|nao posso mais)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Entendido! Vamos remarcar.

Para qual novo dia você prefere?
• Hoje (outro horário)
• Amanhã
• Outro dia

Me informa que verifico na agenda!`;
  }
  
  // Cancelar
  if (t.match(/(cancelar|desistir|não quero mais|nao quero mais)/)) {
    // Remove da lista de agendamentos
    const idx = agendamentos.findIndex(a => a.telefone === cli.telefone && a.status === 'confirmado');
    if (idx > -1) {
      agendamentos[idx].status = 'cancelado';
      await enviarTelegram(`❌ CANCELAMENTO\nCliente ${cli.nome} (${cli.telefone}) cancelou visita de ${d.servico} para ${d.data}`);
    }
    
    cli.etapa = 'INICIO';
    return `Cancelamento anotado. 😔

Se mudar de ideia ou precisar no futuro, é só chamar. Ficaremos felizes em atendê-lo!

Boa sorte!`;
  }
  
  // Avaliação (só se perguntar especificamente após serviço)
  if (t.match(/(serviço realizado|trabalho concluído|terminou|acabou)/)) {
    return `Que ótimo que o serviço foi concluído! 🎉

${cli.nome}, se você ficou satisfeito com nosso trabalho, uma *avaliação no Google* ajuda muito nosso crescimento e permite atender mais pessoas como você! 

Posso te enviar o link para avaliar? Leva menos de 1 minuto e faz toda diferença para nós. 🙏

Se não ficou 100% satisfeito, por favor me conte o que aconteceu que vou resolver imediatamente!`;
  }
  
  // Dúvidas gerais
  if (t.match(/(dúvida|duvida|pergunta|queria saber)/)) {
    return `Claro! Pode fazer sua pergunta sobre o serviço, pagamento, garantia... Estou aqui para ajudar!`;
  }
  
  return `Olá! Sua visita está confirmada para ${d.data} às ${d.hora}. 

Se precisar *remarcar* (com 2h de antecedência) ou tiver qualquer dúvida, é só avisar!

Caso queira falar com um atendente humano, diga *"falar com pessoa"* a qualquer momento. 😊`;
}

function etapaAguardandoDataEspecifica(cli, t, original) {
  // Volta para seleção de data
  cli.etapa = 'VERIFICAR_AGENDA';
  return `Ok! Vamos recomeçar a data.

Prefere *hoje*, *amanhã* ou outro dia específico?`;
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function extrairServicoEBairro(t, original) {
  const servico = extrairServico(t);
  const bairro = extrairBairro(t, original);
  return { servico, bairro };
}

function extrairServico(t) {
  for (const s of CONFIG.servicos) {
    if (t.includes(s)) return s;
  }
  return null;
}

function extrairBairro(t, original) {
  // Primeiro tenta nos bairros conhecidos
  for (const b of CONFIG.bairrosAtendidos) {
    if (t.includes(b)) return b;
  }
  
  // Tenta extrair com padrão "em X" ou "no X"
  const m = original.match(/(em|no|na)\s+([A-Za-zÀ-ÿ\s]+)/i);
  if (m) {
    const possivel = m[2].trim().toLowerCase();
    // Verifica se está na lista
    for (const b of CONFIG.bairrosAtendidos) {
      if (possivel.includes(b)) return b;
    }
    // Retorna o que o usuário digitou mesmo se não conhecemos
    if (possivel.length > 2) return possivel;
  }
  
  return null;
}

function extrairHora(txt) {
  // Padrões: 10:30, 10h, 10h30, 10
  const m = txt.match(/(\d{1,2})[:h]?(\d{2})?/);
  if (m) {
    const hora = m[1].padStart(2, '0');
    const min = m[2] || '00';
    return `${hora}:${min}`;
  }
  return null;
}

function extrairData(t, original) {
  // Padrões: 15/04, 15-04, dia 15, próxima segunda
  const hoje = new Date();
  
  if (t.match(/(segunda|seg)/)) {
    const dias = (1 + 7 - hoje.getDay()) % 7 || 7;
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + dias);
    return data.toLocaleDateString('pt-BR');
  }
  if (t.match(/(terça|terca|ter)/)) {
    const dias = (2 + 7 - hoje.getDay()) % 7 || 7;
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + dias);
    return data.toLocaleDateString('pt-BR');
  }
  if (t.match(/(quarta|qua)/)) {
    const dias = (3 + 7 - hoje.getDay()) % 7 || 7;
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + dias);
    return data.toLocaleDateString('pt-BR');
  }
  if (t.match(/(quinta|qui)/)) {
    const dias = (4 + 7 - hoje.getDay()) % 7 || 7;
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + dias);
    return data.toLocaleDateString('pt-BR');
  }
  if (t.match(/(sexta|sex)/)) {
    const dias = (5 + 7 - hoje.getDay()) % 7 || 7;
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + dias);
    return data.toLocaleDateString('pt-BR');
  }
  
  // Data numérica DD/MM ou DD-MM
  const m = original.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}`;
  }
  
  // "Dia 15"
  const d = original.match(/dia\s+(\d{1,2})/i);
  if (d) {
    return `${d[1].padStart(2, '0')}/${(hoje.getMonth() + 1).toString().padStart(2, '0')}`;
  }
  
  return null;
}

function verificarAtendimento(bairro) {
  if (!bairro) return false;
  const n = bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CONFIG.bairrosAtendidos.some(b => n.includes(b));
}

function getProximosDias(dias) {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric' });
}

function detectarRisco(texto) {
  return CONFIG.palavrasRisco.some(palavra => texto.includes(palavra));
}

// ============================================
// INTEGRAÇÕES EXTERNAS
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 PARA ${numero}: ${texto.substring(0, 100)}...`);
  
  if (!CONFIG.whatsappToken || !CONFIG.whatsappPhoneId) {
    console.error('❌ WhatsApp não configurado');
    return false;
  }
  
  try {
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
      })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ Erro WhatsApp API:', res.status, data);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('❌ Erro ao enviar WhatsApp:', e.message);
    return false;
  }
}

async function enviarTelegram(mensagem) {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.log('ℹ️ Telegram não configurado:', mensagem.substring(0, 50));
    return false;
  }
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    
    return res.ok;
  } catch (e) {
    console.error('❌ Erro Telegram:', e.message);
    return false;
  }
}

async function processarImagem(telefone, nome, imagemData, servico) {
  // Encaminha informação da imagem para o técnico
  const tecnico = servico ? (CONFIG.tecnicos[servico] || CONFIG.tecnicos.reforma) : CONFIG.tecnicos.reforma;
  
  await enviarWhatsApp(tecnico, 
    `📸 *IMAGEM RECEBIDA*\n\nDe: ${nome} (${telefone})\n${servico ? 'Serviço: ' + servico : 'Serviço não definido ainda'}\n\nO cliente enviou uma foto para avaliação. Acesse o painel para visualizar ou solicite que ele envie mais detalhes pelo WhatsApp.`
  );
  
  await enviarTelegram(`📸 Nova imagem de ${nome} (${telefone})${servico ? ' - ' + servico : ''}`);
  
  return true;
}

async function consultarAgenda(data, servico) {
  // TODO: Integrar com Google Calendar API
  // Por enquanto, simula disponibilidade
  return true;
}

async function adicionarAoCalendario(agendamento) {
  // TODO: Implementar integração Google Calendar
  console.log('📅 Agendamento para Google Calendar:', agendamento);
  return true;
}

function agendarLembrete(agendamento) {
  // Calcula tempo até 2h antes do agendamento
  // TODO: Implementar sistema de cron/jobs para enviar lembrete real
  console.log(`⏰ Lembrete agendado para ${agendamento.data} ${agendamento.hora} (2h antes)`);
}

// ============================================
// VARIÁVEIS DE AMBIENTE NECESSÁRIAS
// ============================================

/*
Configure na Vercel:

WHATSAPP_TOKEN=seu_token_aqui
WHATSAPP_PHONE_ID=seu_phone_id_aqui
NUMERO_RC=seu_numero_aqui
TELEGRAM_BOT_TOKEN=token_do_bot_telegram
TELEGRAM_CHAT_ID=id_do_grupo_ou_chat
GOOGLE_CALENDAR_ID=email_do_calendario
GOOGLE_SERVICE_ACCOUNT_KEY=chave_json_do_service_account

Para Google Calendar, você precisará:
1. Criar projeto no Google Cloud Console
2. Ativar Google Calendar API
3. Criar Service Account
4. Compartilhar calendário com o email do Service Account
5. Baixar a chave JSON e converter para base64 ou salvar como secret
*/
