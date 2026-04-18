# Código completo corrigido - executando tudo de uma vez

codigo_completo = '''// ============================================
// RC REFORMA E CONSTRUÇÃO - VERSÃO ESTÁVEL
// Otimizado para Vercel (resposta rápida)
// ============================================

const CONFIG = {
  empresa: {
    nome: 'RC Reforma e Construção',
    instagram: 'https://share.google/5n4VM0DwDTlDgEX3C',
    polo: 'Botafogo'
  },
  
  // NOVOS SERVIÇOS ADICIONADOS
  tecnicos: {
    // Técnicos existentes
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176',
    eletrica: '5521968112176',
    pintura: '5521968112176',
    gesso: '5521968112176',
    pedreiro: '5521968112176',
    // NOVOS técnicos
    ar_condicionado: '5521968112176',
    maquina_lava_seca: '5521968112176',
    geladeira: '5521968112176'
  },
  
  precoVisita: 180,
  precoZonaSulComDesconto: 90,
  
  bairrosAtendidos: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha',
    'centro', 'lapa', 'santa teresa', 'cinelândia', 'cinelandida',
    'praça mauá', 'praca maua', 'carioca', 'uruguaiana'
  ],
  
  // Serviços organizados por tipo
  servicos: {
    reforma: ['pedreiro', 'pintura', 'marcenaria', 'hidraulica', 'eletrica', 'gesso', 'azulejo', 'reforma'],
    tecnico: ['ar_condicionado', 'maquina_lava_seca', 'geladeira'],
    geral: ['vazamento', 'encanamento', 'serralheria', 'drywall', 
            'porcelanato', 'revestimento', 'impermeabilizacao',
            'trocar', 'consertar', 'instalar', 'reparar', 'montar',
            'armario', 'porta', 'janela', 'piso', 'parede',
            'banheiro', 'cozinha', 'quarto', 'sala', 'area', 'varanda']
  },
  
  // Origens do cliente
  origens: {
    'RC': {
      nome: 'RC Reforma e Construção',
      url: 'https://share.google/5n4VM0DwDTlDgEX3C',
      tecnicos: ['marcenaria', 'reforma', 'hidraulica', 'eletrica', 'pintura', 'gesso', 'pedreiro']
    },
    'MAB': {
      nome: 'Mab Construção e Reforma',
      url: 'https://share.google/xCFetDX4PoyjDw4gH',
      tecnicos: ['marcenaria', 'reforma', 'hidraulica', 'eletrica', 'pintura']
    },
    'CONSERTA_RIO': {
      nome: 'Conserta Rio',
      url: 'https://share.google/iDf8oK9HV6J5Phkox',
      tecnicos: ['ar_condicionado', 'maquina_lava_seca', 'geladeira']
    }
  },
  
  numeroRC: process.env.NUMERO_RC || '',
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  
  // Google Agenda (compartilhado)
  googleAgenda: {
    enabled: true,
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    credenciais: process.env.GOOGLE_CREDENTIALS || null
  },
  
  palavrasRisco: [
    'processo', 'judicial', 'advogado', 'procon', 'reclamação', 'reclamacao',
    'polícia', 'policia', 'denunciar', 'denúncia', 'denuncia', 'crime',
    'golpe', 'fraude', 'enganado', 'enganaram', 'calote', 'caloteiro',
    'não entendi nada', 'nao entendi nada', 'tá me enrolando', 'tah me enrolando',
    'quero falar com humano', 'quero falar com pessoa', 'atendente humano',
    'você não entende', 'voce nao entende', 'robô burro', 'robo burro',
    'cancelar tudo', 'não quero mais', 'nao quero mais', 'Desisto',
    'Horrível', 'Horrivel', 'péssimo', 'pessimo', 'Terrível', 'Terrivel',
    'ódio', 'odio', 'raiva', 'estressei', 'nervoso', 'indignado'
  ]
};

// Estado global (reseta a cada deploy, mas funciona)
const clientes = {};
const processadas = new Set();
const conversas = [];
const agendamentos = [];
const intervenções = new Set();

// ============================================
// HANDLER PRINCIPAL - RESPONDE IMEDIATAMENTE
// ============================================

export default async function handler(req, res) {
  // CORS imediato
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verificação do webhook (Meta) - resposta imediata
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

    // Webhook WhatsApp - PROCESSAMENTO ASSÍNCRONO
    if (req.method === 'POST') {
      // Responde OK IMEDIATAMENTE para não timeout
      res.status(200).send('OK');
      
      // Processa em background (não bloqueia a resposta)
      processarWebhookAsync(req.body).catch(err => {
        console.error('Erro async:', err);
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
// PROCESSAMENTO ASSÍNCRONO (não bloqueia resposta)
// ============================================

async function processarWebhookAsync(body) {
  console.log('📥 Webhook recebido:', JSON.stringify(body).substring(0, 500));
  
  if (!body || body.object !== 'whatsapp_business_account') {
    console.log('❌ Não é WhatsApp business account');
    return;
  }
  
  const entry = body.entry?.[0];
  if (!entry) {
    console.log('❌ Sem entry');
    return;
  }
  
  const changes = entry.changes?.[0]?.value;
  if (!changes) {
    console.log('❌ Sem changes');
    return;
  }
  
  // Ignora status updates (delivered, read, etc)
  if (changes.statuses) {
    console.log('ℹ️ Status update ignorado');
    return;
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) {
    console.log('❌ Sem mensagem ou ID');
    return;
  }
  
  // Evita duplicados
  if (processadas.has(msg.id)) {
    console.log('♻️ Mensagem já processada:', msg.id);
    return;
  }
  processadas.add(msg.id);
  
  // Limpa cache após 1 hora
  setTimeout(() => processadas.delete(msg.id), 3600000);
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  console.log(`\\\\n📨 ${nome} (${telefone}): [${msg.type}]`);
  
  // Detecta origem do cliente
  const origem = detectarOrigem(msg);
  
  // Ignora próprio número
  if (telefone === CONFIG.numeroRC) {
    console.log('ℹ️ Mensagem do próprio RC, ignorando');
    return;
  }
  
  // Verifica intervenção humana
  if (intervenções.has(telefone)) {
    console.log('👤 Modo intervenção ativo para:', telefone);
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
    console.log('Texto:', texto);
  } else if (msg.type === 'image') {
    texto = '[imagem recebida]';
    await processarImagem(telefone, nome, msg.image, origem);
  } else if (msg.type === 'audio' || msg.type === 'voice') {
    await enviarWhatsApp(telefone, "No momento não consigo ouvir áudios. Pode descrever por escrito o que precisa? 📸 Se quiser, envie fotos do local!");
    return;
  } Else if (msg.type === 'document') {
    texto = '[documento recebido]';
  } else {
    console.log('Tipo não tratado:', msg.type);
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
  if (!clientes[Telefone]) {
    clientes[Telefone] = { 
      nome, 
      etapa: 'INICIO', 
      dados: {},
      ultimaAtividade: Date.now(),
      origem: origem
    };
  }
  
  const cli = clientes[Telefone];
  cli.ultimaAtividade = Date.now();
  
  // Detecta risco
  if (detectarRisco(texto.toLowerCase())) {
    console.log('🚨 Palavra de risco detectada!');
    intervenções.add(telefone);
    await enviarWhatsApp(telefone, 
      `Entendo sua frustração. Vou transferir você imediatamente para um atendente humano. Por favor, aguarde um momento. 🙏`
    );
    await enviarTelegram(`🚨 INTERVENÇÃO AUTOMÁTICA\\\\n${nome} (${telefone})\\\\nMensagem: ${texto.substring(0, 100)}`);
    return;
  }
  
  // Processa resposta
  const resp = await processarMensagem(cli, texto.ToLowerCase(), texto, nome, telefone, origem);
  
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
// DETECTAR ORIGEM DO CLIENTE
// ============================================

function detectarOrigem(msg) {
  // Verifica se há contexto de origem na mensagem
  if (msg.context?.forwarded) {
    // Mensagem encaminhada - verificar se há link
    const texto = msg.text?.body || '';
    
    // Verifica links de origem
    if (texto.includes('share.google/5n4VM0DwDTlDgEX3C')) return 'RC';
    if (texto.includes('share.google/xCFetDX4PoyjDw4gH')) return 'MAB';
    if (texto.includes('share.google/iDf8oK9HV6J5Phkox')) return 'CONSERTA_RIO';
    
    // Verifica se o nome contém indicação
    const nome = msg.contacts?.[0]?.profile?.name || '';
    if (nome.toLowerCase().includes('conserta')) return 'CONSERTA_RIO';
    if (nome.toLowerCase().includes('mab')) return 'MAB';
  }
  
  // Se não detectou, retorna RC como padrão
  return 'RC';
}

// ============================================
// PAINEL DE CONTROLE
// ============================================

async function handlePainel(req, res) {
  const { action } = req.query;
  
  switch (action) {
    case 'list': {
      const lista = Object.entries(clientes).map(([telefone, dados]) => ({
        telefone,
        nome: dados.nome,
        etapa: dados.etapa,
        ultimaAtividade: new Date(dados.ultimaAtividade).toLocaleString('pt-BR'),
        emIntervencao: intervenções.has(telefone),
        resumo: dados.dados.servico && dados.dados.bairro 
          ? `${dados.dados.servico} em ${dados.dados.bairro}` 
          : 'Iniciando'
      }));
      return res.json({ conversas: lista, total: lista.length });
    }
    
    case 'messages': {
      const { phone } = req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      const historico = conversas.filter(c => c.telefone === phone);
      const cliente = clientes[Phone];
      
      return res.json({
        telefone: phone,
        nome: cliente?.nome || 'Desconhecido',
        etapa: cliente?.etapa || 'N/A',
        emIntervencao: intervenções.has(Phone),
        mensagens: historico,
        dados: cliente?.dados || {}
      });
    }
    
    case 'intervene': {
      const { phone, usuario } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.add(phone);
      await enviarWhatsApp(Phone, `Olá! Um atendente humano assumiu esta conversa. Em que posso ajudar?`);
      await enviarTelegram(`🚨 INTERVENÇÃO\\\\n${phone}\\\\nAtendente: ${usuario || 'Não informado'}`);
      
      return res.json({ sucesso: true, mensagem: 'Intervenção ativada' });
    }
    
    case 'release': {
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });
      
      intervenções.delete(Phone);
      await enviarWhatsApp(Phone, `Obrigado! Retomando atendimento automatizado. Como posso ajudar?`);
      
      return res.json({ sucesso: true, mensagem: 'Robô liberado' });
    }
    
    case 'send': {
      const { phone, mensagem, usuario } = req.body;
      if (!phone || !mensagem) return res.status(400).json({ erro: 'Telefone e mensagem obrigatórios' });
      
      await enviarWhatsApp(Phone, mensagem);
      conversas.push({ telefone: phone, tipo: 'humano', mensagem, data: new Date().toISOString(), atendente: usuario || 'Sistema' });
      
      return res.json({ sucesso: true });
    }
    
    case 'stats': {
      return res.json({
        totalConversas: Object.keys(clientes).length,
        emAtendimento: Object.values(clientes).filter(c => c.etapa !== 'AGENDADO' && c.etapa !== 'INICIO').length,
        agendamentosHoje: agendamentos.filter(a => IsHoje(a.Data)).length,
        intervencoesAtivas: intervenções.size
      });
    }
    
    case 'relatorio': {
      // Relatório diário às 19h
      const hoje = new Date();
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);
      
      const novosHoje = Object.entries(clientes).filter(([tel, c]) => {
        const dataCadastro = new Date(c.ultimaAtividade);
        return dataCadastro.toDateString() === hoje.toDateString();
      }).length;
      
      const visitasHoje = agendamentos.filter(a => IsHoje(a.Data)).length;
      const ServicosFechados = agendamentos.filter(a => a.status === 'confirmado').length;
      
      const porBairro = {};
      const porProfissional = {};
      
      agendamentos.forEach(a => {
        if (!PorBairro[a.bairro]) porBairro[a.bairro] = [];
        PorBairro[a.bairro].push(a);
        
        const Prof = a.profissional || 'Não atribuído';
        If (!PorProfissional[Prof]), porProfissional[Prof] = [];
        PorProfissional[Prof].push(A);
      });
      
      return res.json({
        data: Hoje.toLocaleDateString('pt-BR'),
        NovosClientes: novosHoje,
        VisitasAgendadas: visitasHoje,
        ServicosFechados: servicosFechados,
        PorBairro: porBairro,
        PorProfissional: porProfissional,
        TotalAgendamentos: agendamentos.length
      });
    }
    
    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}

function IsHoje(dataStr) {
  const hoje = new Date();
  return dataStr === 'hoje' || dataStr === hoje.toLocaleDateString('pt-BR');
}

// ============================================
// LÓGICA DE VENDAS SIMPLIFICADA
// ============================================

async function processarMensagem(cli, t, original, nome, telefone, origem) {
  const d = cli.dados;
  
  // Saudação inicial
  if (cli.etapa === 'INICIO' && t.match(/(oi|olá|ola|bom dia|boa tarde|boa noite|hey)/)) {
    // Detecta se é técnico ou reforma baseado na origem
    const isTecnico = ['CONSERTA_RIO'].includes(origem) || 
                       t.match(/(ar condicionado|geladeira|maquina lava|secar|secadora)/);
    
    if (isTecnico) {
      return `Olá! Bem-vind(a) ao atendimento digital. Qual serviço Deseja e qual bairro?`;
    } else {
      return `Olá! Sou da *RC Reforma e Construção*.

Para Te ajudar rápido, me conta:
1️⃣ Qual serviço Precisa? (pedreiro, pintura, hidráulica, elétrica, marcenaria...)
2️⃣ Qual bairro do Rio?

Se quiser, envie Fotos! 📸`;
    }
  }

  // Objeções em qualquer etapa
  if (t.match(/(caro|muito caro|tá caro|tah caro|absurdo|roubando|não tenho dinheiro)/)) {
    return `Entendo, ${nome}! Deixa eu explicar:

📋 *Visita Técnica: R$180*
• Profissional vai até você e avalia tudo
• Orçamento detalhado no local
• Se aprovar: R$180 vira desconto no total

💰 *Descontos especiais:*
• Zona Sul: 50% OFF (R$90)
• Botafogo: *GRÁTIS* (cortesia!)

Posso verificar disponibilidade?`;
  }

  if (t.match(/(quem é você|quem e voce|você é robô|voce e robo)/)) {
    return `Sou o assistente virtual da *RC Reforma e Construção*! 🤖

Estou aqui para agilizar seu atendimento. Se quiser falar com uma pessoa real, é só pedir a qualquer momento.

Como posso ajudar hoje?`;
  }

  if (t.match(/(vou pensar|volto depois|depois eu decido)/)) {
    return `Sem problemas, ${nome}! Analise com calma.

Quando quiser agendar, é só chamar: Normalmente temos vagas para *hoje ou amanhã*.

Boa sorte! 🛠️`;
  }

  // Fluxo principal
  switch (cli.etapa) {
    case 'INICIO':
      return await etapaInicio(cli, t, original, nome, origem);
    case 'AGUARDANDO_SERVICO':
      return etapaAguardandoServico(cli, t, original, nome, origem);
    case 'AGUARDANDO_BAIRRO':
      return etapaAguardandoBairro(cli, t, original, nome, origem);
    case 'CONFIRMA_ATENDIMENTO_HOJE':
      return etapaConfirmaAtendimentoHoje(cli, t, original, nome, origem);
    case 'APRESENTA_VALOR':
      return etapaApresentaValor(cli, t, original, nome, origem);
    case 'VERIFICAR_AGENDA':
      return await etapaVerificarAgenda(cli, t, original, nome, origem);
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original, nome, origem);
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original, nome, origem);
    case 'CONFIRMAR_VISITA':
      return await etapaConfirmarVisita(cli, t, original, nome, telefone, origem);
    case 'AGENDADO':
      return `Olá! Sua visita está confirmada. Se precisar Remarcar ou tirar dúvidas, é só avisar! 😊`;
    default:
      cli.etapa = 'INICIO';
      return `Olá, ${nome}! Me informe o Serviço e o bairro que deseja atendimento.`;
  }
}

// ===== ETAPAS =====

async function etapaInicio(cli, t, original, nome, origem) {
  const d = cli.dados;
  
  // Extrai serviço e bairro (pode vir em qualquer ordem)
  const extracao = extrairServicoEBairro(t, original, origem);
  
  if (extracao.servico && extracao.bairro) {
    d.servico = extracao.servico;
    d.bairro = extracao.bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Perfeito! ${extracao.servico} em ${extracao.bairro}.

Você Precisa de atendimento *urgente para hoje* ou podemos Agendar?`;
  }
  
  if (extracao.servico) {
    d.servico = extracao.servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo! Você Precisa de *${extracao.servico}*. Qual bairro do Rio?`;
  }
  
  if (extracao.bairro) {
    d.bairro = extracao.bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return `Entendi, *${extracao.bairro}*. Qual serviço você Precisa?`;
  }
  
  if (t.match(/(quanto custa|qual o preço|valor)/)) {
    return `Para valores Precisos, Preciso saber o Serviço e bairro. Cada caso é único!

Mas a Visita Técnica é *R$180* (R$90 na Zona Sul, *GRÁTIS* em Botafogo).

Qual serviço E bairro? 🔧`;
  }
  
  return `Oi! Sou da RC Reforma. Para ajudar:

Qual serviço você Precisa e em qual bairro?

Ex: "Pintura em Ipanema", "Vazamento em Copacabana"...`;
}

async function etapaAguardandoServico(cli, t, original, nome, origem) {
  const d = cli.dados;
  const servico = extrairServico(t, original, origem);
  
  if (servico) {
    d.servico = servico;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Perfeito! ${servico} em ${d.bairro}.

Você Precisa de atendimento *para hoje* (urgente) ou podemos Agendar?`;
  }
  
  return `Qual serviço você Precisa em ${d.bairro}?`;
}

async function etapaAguardandoBairro(cli, t, original, nome, origem) {
  const d = cli.dados;
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Ótimo! ${d.servico} em ${bairro}.

Precisa de atendimento *para hoje* (urgente) ou podemos Agendar?`;
  }
  
  return `Qual bairro do Rio de Janeiro?`;
}

async function etapaConfirmaAtendimentoHoje(cli, t, original, nome, origem) {
  const d = cli.dados;
  
  if (t.match(/(hoje|urgente|urgência|vazando|quebrou|emergência)/)) {
    d.urgente = true;
    cli.etapa = 'APRESENTA_VALOR';
    
    const Valor = calcularValorVisita(d.bairro, origem);
    D.valorVisita = valor;
    
    // Se for técnico, vai para fluxo de técnico
    if (['ar_condicionado', 'maquina_lava_seca', 'geladeira'].includes(d.servico)) {
      return await FluxoTecnico(cli, t, nome, telefone, origem);
    }
    
    // Se for reforma, vai para fluxo de reforma
    return await FluxoReforma(cli, t, Nome, origem);
  }
  
  if (t.match(/(amanhã|amanha|depois|próximo|proximo|outro dia)/)) {
    d.urgente = false;
    cli.etapa = 'APRESENTA_VALOR';
    
    const Valor = calcularValorVisita(d.bairro, origem);
    D.valorVisita = valor;
    
    // Se for técnico
    if (['ar_condicionado', 'maquina_lava_seca', 'geladeira'].includes(d.servico)) {
      return await FluxoTecnico(cli, t, Nome, origem);
    }
    
    return await FluxoReforma(cli, t, Nome, origem);
  }
  
  return `Você Precisa de atendimento *para hoje* (urgente) ou *amanhã/outro dia*?`;
}

// ============================================
// FLUXO PARA SERVIÇOS TÉCNICOS (AR, LAVA E SECA, GELADEIRA)
// ============================================

async function FluxoTecnico(cli, t, nome, origem) {
  const d = cli.dados;
  
  if (d.urgente) {
    return `Para um orçamento mais Preciso, é necessário uma visita. Há uma Pequena taxa no valor de *R$${d.valorVisita}*, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de Prosseguir?`;
  } else {
    return `Para um orçamento mais Preciso, é necessário uma visita. Há uma Pequena taxa no valor de *R$${d.valorVisita}*, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de Prosseguir?`;
  }
}

async function FluxoReforma(cli, t, nome, origem) {
  const d = cli.dados;
  
  if (d.urgente) {
    return `Para um orçamento mais Preciso, é necessário uma visita. Há uma Pequena taxa no valor de *R$${d.valorVisita}*, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de Prosseguir?`;
  } Else {
    return `Para um orçamento mais Preciso, é necessário uma visita. Há uma Pequena taxa no valor de *R$${d.valorVisita}*, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de Prosseguir?`;
  }
}

async function etapaApresentaValor(cli, t, original, nome, origem) {
  const d = cli.dados;
  
  if (t.match(/(não|nao|não vou pagar|nao vou pagar|grátis|gratis|caro)/)) {
    // Cliente não quer pagar visita - oferecer desconto
    if (d.bairro.toLowerCase().includes('botafogo')) {
      d.valorVisita = 0;
      cli.etapa = 'VERIFICAR_AGENDA';
      return `Como você é de *Botafogo*, visita técnica é *GRÁTIS*! 🎉

Sem custo nenhum. Posso verificar disponibilidade na agenda?`;
    }
    
    // Analisa Se Pode dar desconto
    const podeDesconto = verificarAtendimento(d.bairro);
    if (podeDesconto) {
      return `Posso Oferecer *50% de desconto* para Zona Sul: *R$90*

Ou, Se conseguir trazer o serviço para Botafogo, fica 100% gratuito!

O que Prefere?`;
    }
  }
  
  if (t.match(/(sim|pode|ok|claro|verifica|agenda|vamos)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Ótimo! Deixa eu consultar a agenda... ⏳

Para *quando* você Prefere?
• Hoje
• Amanhã  
• Outro dia específico

Me informa!`;
  }
  
  return `Posso verificar disponibilidade na agenda para ${d.servico} em ${d.bairro}?`;
}

async function etapaVerificarAgenda(cli, t, original, nome, origem) {
  const d = cli.dados;
  
  if (t.match(/(hoje)/)) {
    const HoraAtual = new Date().getHours();
    If (HoraAtual >= 18) {
      return `Já são mais de 18h. Posso agendar o primeiro horário de *amanhã*?

Ou Prefere Outro dia?`;
    }
    
    d.data = 'hoje';
    d.dataFormatada = new Date().toLocaleDateString('pt-BR');
    cli.etapa = 'AGUARDANDO_HORARIO';
    
    return `✅ *Temos vaga para HOJE!*

Qual horário seria melhor?
• Manhã (9h às 12h)
• Tarde (14h às 17h)

Qual Prefere?`;
  }
  
  if (t.match(/(amanhã|amanha)/)) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    d.data = 'amanhã';
    d.dataFormatada = amanha.toLocaleDateString('pt-BR');
    cli.etapa = 'AGUARDANDO_HORARIO';
    
    return `✅ *Amanhã temos disponibilidade!*

Qual Período?
• Manhã (9h-12h)
• Tarde (14h-17h)

Qual melhor horário?`;
  }
  
  const dataEspecifica = extrairData(T, original);
  If (dataEspecifica) {
    d.data = dataEspecifica;
    D.dataFormatada = dataEspecifica;
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Anotado: ${dataEspecifica}. Qual horário seria ideal?`;
  }
  
  return `Para *quando* você Precisa? (hoje, amanhã, ou Outro dia)`;
}

function etapaAguardandoHorario(cli, t, original) {
  const d = cli.dados;
  const hora = extrairHora(original);
  
  if (hora) {
    d.hora = hora;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ ${hora} anotado!

Agora Preciso do *endereço completo*:

📍 Rua, número, complemento
🏢 Apartamento ou Casa

Qual o Endereço?`;
  }
  
  if (t.match(/Manhã|manha/)) {
    d.hora = 'Manhã (9h-12h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Manhã anotado! 

Endereço completo, por favor:
📍 Rua, número, complemento`;
  }
  
  if (t.match(/tarde/)) {
    d.hora = 'Tarde (14h-17h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Tarde anotada!

Endereço completo, por favor:
📍 Rua, número, complemento`;
  }
  
  return `Qual horário? (ex: 10h, 14:30, manhã, tarde)`;
}

async function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;
  
  if (original.length > 8 && (t.match(/(rua|av|avenida|número|numero|apartamento|casa)/) || t.match(/\\d+/))) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_VISITA';
    
    return `📋 *RESUMO DO AGENDAMENTO*

Serviço: ${d.servico}
Data: ${d.data} (${d.dataFormatada})
Horário: ${d.hora}
Endereço: ${original}
Valor: ${d.valorVisita === 0 ? '*GRÁTIS* 🎉' : `R$${d.valorVisita}`}

*Tudo correto?* Responda *sim* para confirmar ou me diga o que alterar!`;
  }
  
  return `Preciso do endereço completo (rua, número, complemento). Qual é?`;
}

async function etapaConfirmarVisita(cli, t, original, nome, telefone, origem) {
  const d = cli.dados;
  
  if (t.match(/(sim|pode|ok|confirmo|tá bom|tah bom|perfeito)/)) {
    cli.etapa = 'AGENDADO';
    
    // Determina profissional baseado no serviço
    const profissional = determinarProfissional(d.servico, origem);
    
    const agendamento = {
      id: Date.now(),
      telefone,
      nome: cli.nome,
      servico: d.servico,
      bairro: d.bairro,
      data: d.data,
      dataFormatada: d.dataFormatada,
      hora: d.hora,
      endereco: d.endereco,
      Valor: d.valorVisita,
      status: 'confirmado',
      profissional: profissional,
      Origem: origem
    };
    
    agendamentos.push(agendamento);
    
    // Agenda no Google Calendar
    await agendarGoogleCalendar(agendamento);
    
    // Notifica técnico
    await notificarProfissional(agendamento);
    
    // Notifica Telegram
    await enviarTelegram(
      `✅ VISITA CONFIRMADA\\\\n\\\\n📅 ${d.data} às ${d.hora}\\\\n🔧 ${d.servico}\\\\n📍 ${d.endereco}\\\\n👤 ${cli.nome}\\\\n📱 ${telefone}\\\\n💰 ${d.valorVisita === 0 ? 'GRÁTIS (Botafogo)' : 'R$'+d.valorVisita}`
    );
    
    return `🎉 *VISITA CONFIRMADA!*

📅 ${d.data} às ${d.hora}
📍 ${d.endereco}
🔧 ${d.servico}
${d.valorVisita > 0 ? `💰 R$${d.valorVisita} (pagar no ato)` : '💰 GRÁTIS'}

*Próximos passos:*
1️⃣ Profissional entrará em contato em até *48h*
2️⃣ Lembrete automático 2h antes
3️⃣ Orçamento detalhado no local

Precisa Remarcar? Avise com *2h de antecedência*.

Mais alguma dúvida? 😊`;
  }
  
  if (t.match(/(não|nao|mudar|alterar|trocar)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Sem problema! O que Precisa alterar?

• Data/horário
• Endereço
• Serviço

Me informa!`;
  }
  
  return `Posso Confirmar para ${d.data} às ${d.hora}? Responda *sim* ou diga o que alterar.`;
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function determinarProfissional(servico, origem) {
  // Se tem origem definida e serviço específico
  if (origem && CONFIG.origens[origem]) {
    const tECNICOS = CONFIG.origens[origem].tecnicos;
    if (tecnicos.includes(servico)) {
      return CONFIG.origens[origem].nome;
    }
  }
  
  // Fallback por tipo de serviço
  if (['ar_condicionado', 'geladeira', 'maquina_lava_seca'].includes(servico)) {
    return 'Conserta Rio';
  }
  
  if (['marcenaria', 'reforma'].includes(servico)) {
    return 'RC Reforma e Construção';
  }
  
  return 'Profissional';
}

function calcularValorVisita(bairro, origem) {
  // Se for Botafogo, é grátis
  if (bairro.toLowerCase().includes('botafogo')) return 0;
  
  // Se for Conserta Rio (técnico), valores diferentes
  if (origem === 'CONSERTA_RIO') {
    return 180; // Valor padrão para técnicos
  }
  
  // Se for Zona Sul
  if (verificarAtendimento(bairro)) {
    return 90; // 50% de desconto
  }
  
  return 180; // Valor padrão
}

function extrairServicoEBairro(t, original, origem) {
  return {
    servico: extrairServico(t, origem),
    bairro: extrairBairro(t, original)
  };
}

function extrairServico(t, origem) {
  // Primeiro verifica se é técnico
  for (const s of CONFIG.servicos.tecnico) {
    if (T.includes(s.replace('_', ' '))) return s;
  }
  
  // Depois verifica reforma
  for (const s of CONFIG.servicos.reforma) {
    If (T.includes(s)) return s;
  }
  
  // Depois verifica Geral
  for (const s of CONFIG.servicos.geral) {
    If (T.includes(s)) return s;
  }
  
  return null;
}

function extrairBairro(t, original) {
  for (const b of CONFIG.bairrosAtendidos) {
    If (t.includes(b)) return b;
  }
  
  const m = original.match(/(em|no|na)\\s+([A-Za-zÀ-ÿ\\s]+)/i);
  If (m) {
    const Possivel = m[2].trim().toLowerCase();
    for (const b of CONFIG.bairrosAtendidos) {
      If (Possivel.includes(B)) return b;
    }
    If (Possivel.length > 2) return Possivel;
  }
  return null;
}

function ExtrairHora(txt) {
  const m = txt.match(/(\\d{1,2})[:h]?(\\d{2})?/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]||'00'}` : null;
}

function extrairData(t, original) {
  const hoje = new Date();
  
  if (t.match(/segunda/)) return getDataFutura(1);
  if (t.match(/terça|terca/)) return GetDataFutura(2);
  If (t.match(/quarta/)) return GetDataFutura(3);
  If (t.match(/quinta/)) return GetDataFutura(4);
  If (t.match(/sexta/)) return GetDataFutura(5);
  
  const m = original.match(/(\\d{1,2})[\\/\\-](\\d{1,2})/);
  If (m) return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
  
  const d = Original.match(/dia\\s+(\\d{1,2})/i);
  If (d) return `${d[1].padStart(2,'0')}/${(hoje.getMonth()+1).toString().padStart(2,'0')}`;
  
  return null;
}

function GetDataFutura(diasSemana) {
  const hoje = new Date();
  const atual = hoje.getDay();
  const dias = (diasSemana + 7 - atual) % 7 || 7;
  hoje.setDate(hoje.getDate() + dias);
  return hoje.toLocaleDateString('pt-BR');
}

function verificarAtendimento(bairro) {
  If (!Bairro) return false;
  const n = Bairro.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  return CONFIG.bairrosAtendidos.some(b => n.includes(b));
}

function detectarRisco(texto) {
  return CONFIG.palavrasRisco.some(p => texto.includes(p));
}

// ============================================
// INTEGRAÇÕES
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`📤 PARA ${numero}: ${texto.substring(0, 80)}...`);
  
  if (!CONFIG.whatsappToken || !CONFIG.whatsappPhoneId) {
    console.error('❌ WhatsApp não configurado');
    return false;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    
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
    
    ClearTimeout(timeout);
    
    if (!res.ok) {
      const data = await res.json();
      console.error('❌ Erro WhatsApp API:', res.status, data);
      return false;
    }
    
    console.log('✅ Enviado');
    return true;
    
  } catch (e) {
    console.error('❌ Erro ao enviar:', e.message);
    return false;
  }
}

async function enviarTelegram(mensagem) {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.log('ℹ️ Telegram não configurado');
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

async function agendarGoogleCalendar(agendamento) {
  if (!CONFIG.googleAgenda.enabled) {
    console.log('ℹ️ Google Agenda não configurado');
    return;
  }
  
  // Implementação básica - em produção usar Google Calendar API
  console.log('📅 Agendamento no Google Calendar:', agendamento);
  
  // Aqui você implementaria a integração real com Google Calendar API
  // Criando um evento com os dados do agendamento
}

async function notificarProfissional(agendamento) {
  const profissional = agendamento.profissional;
  const configOrigem = CONFIG.origens[Object.keys(CONFIG.origens).find(k => 
    configOrigens[k].nome === profissional
  )];
  
  if (!configOrigem) {
    console.log('ℹ️ Profissional não mapeado para notificação direta');
    return;
  }
  
  const telefoneProfissional = configOrigem.telefone || CONFIG.tecnicos.reforma;
  
  const mensagem = `🔔 NOVA VISITA AGENDADA

📅 ${agendamento.data} às ${agendamento.hora}
🔧 ${agendamento.servico}
📍 ${agendamento.endereco}
👤 ${agendamento.nome}
📱 ${agendamento.telefone}
💰 ${agendamento.valor === 0 ? 'GRÁTIS' : 'R$'+agendamento.valor}

Por favor, Confirme disponibilidade.`;
  
  await enviarWhatsApp(telefoneProfissional, mensagem);
}

async function ProcessarImagem(telefone, nome, imagemData, origem) {
  // Encaminha imagem para o profissional adequado
  const servico = clientes[Telefone]?.dados?.servico || 'Não identificado';
  const profissional = determinarProfissional(servico, origem);
  
  const configOrigem = CONFIG.origens[Object.keys(CONFIG.origens).find(k => 
    configOrigens[k].nome === profissional
  )];
  
  If (configOrigem) {
    await enviarTelegram(`📸 ${nome} (${telefone}) enviou Imagem para ${profissional}\\\\nServiço: ${servico}`);
    
    // Salva Referência da imagem para o profissional acessar
    if (!Clientes[Telefone].imagens) clientes[Telefone].imagens = [];
    Clientes[Telefone].imagens.push({
      url: imagemData.url,
      caption: ImagemData.caption,
      data: new Date().toISOString()
    });
  }
}

export function GetRelatorioDiario() {
  const hoje = new Date();
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);
  
  const novosHoje = Object.entries(clientes).filter(([tel, c]) => {
    const dataCadastro = new Date(c.ultimaAtividade);
    return dataCadastro.toDateString() === hoje.toDateString();
  }).length;
  
  const VisitasHoje = agendamentos.filter(a => IsHoje(a.Data)).length;
  const ServicosFechados = agendamentos.filter(a => a.Status === 'confirmado').length;
  
  const porBairro = {};
  const porProfissional = {};
  
  agendamentos.forEach(a => {
    If (!PorBairro[a.bairro]) porBairro[a.bairro] = [];
    PorBairro[a.bairro].push(A);
    
    const Prof = a.profissional || 'Não atribuído';
    If (!PorProfissional[Prof]) porProfissional[Prof] = [];
    PorProfissional[Prof].push(A);
  });
  
  return {
    data: Hoje.toLocaleDateString('pt-BR'),
    NovosClientes: novosHoje,
    VisitasAgendadas: visitasHoje,
    ServicosFechados: servicosFechados,
    PorBairro: porBairro,
    PorProfissional: porProfissional,
    TotalAgendamentos: agendamentos.length
  };
}
'''

# Salvando o arquivo
with open('/mnt/agents/output/rc_reforma_bot_completo.js', 'w') as f:
    f.write(codigo_completo)

print("✅ Arquivo salvo com sucesso!")
print(f"📊 Tamanho: {len(codigo_completo)} caracteres")
