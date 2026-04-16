// ============================================
// RC REFORMA E CONSTRUÇÃO - VERSÃO ESTÁVEL
// Otimizado para Vercel (resposta rápida)
// ============================================

const CONFIG = {
  empresa: {
    nome: 'RC Reforma e Construção',
    instagram: 'https://share.google/5n4VM0DwDTlDgEX3C',
    polo: 'Botafogo'
  },

  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176',
    eletrica: '5521968112176',
    pintura: '5521968112176',
    gesso: '5521968112176',
    pedreiro: '5521968112176'
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

  servicos: [
    'pedreiro', 'pintura', 'marcenaria', 'hidráulica', 'hidraulica', 
    'elétrica', 'eletrica', 'reforma', 'azulejo', 'gesso', 
    'vazamento', 'encanamento', 'serralheria', 'drywall', 
    'porcelanato', 'revestimento', 'impermeabilização', 'impermeabilizacao',
    'trocar', 'consertar', 'instalar', 'reparar', 'montar',
    'armário', 'armario', 'porta', 'janela', 'piso', 'parede',
    'banheiro', 'cozinha', 'quarto', 'sala', 'área', 'area', 'varanda'
  ],

  numeroRC: process.env.NUMERO_RC || '',
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

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

// Estado global simples (reseta a cada deploy, mas funciona)
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

  console.log(`\n📨 ${nome} (${telefone}): [${msg.type}]`);

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
    await processarImagem(telefone, nome, msg.image);
  } else if (msg.type === 'video') {
    texto = '[vídeo recebido]';
    await processarVideo(telefone, nome, msg.video);
  } else if (msg.type === 'audio' || msg.type === 'voice') {
    await enviarWhatsApp(telefone, "No momento não consigo ouvir áudios. Pode descrever por escrito o que precisa? Se quiser, envie fotos do local!");
    return;
  } else if (msg.type === 'document') {
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
  if (!clientes[telefone]) {
    clientes[telefone] = { 
      nome, 
      etapa: 'INICIO', 
      dados: {},
      ultimaAtividade: Date.now()
    };
  }

  const cli = clientes[telefone];
  cli.ultimaAtividade = Date.now();

  // Detecta risco
  if (detectarRisco(texto.toLowerCase())) {
    console.log('🚨 Palavra de risco detectada!');
    intervenções.add(telefone);
    await enviarWhatsApp(telefone, 
      `Entendo sua frustração. Vou transferir você imediatamente para um atendente humano. Por favor, aguarde um momento. 🙏`
    );
    await enviarTelegram(`🚨 INTERVENÇÃO AUTOMÁTICA\n${nome} (${telefone})\nMensagem: ${texto.substring(0, 100)}`);
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
      await enviarTelegram(`🚨 INTERVENÇÃO\n${phone}\nAtendente: ${usuario || 'Não informado'}`);

      return res.json({ sucesso: true, mensagem: 'Intervenção ativada' });
    }

    case 'release': {
      const { phone } = req.body || req.query;
      if (!phone) return res.status(400).json({ erro: 'Telefone obrigatório' });

      intervenções.delete(phone);
      await enviarWhatsApp(phone, `Obrigado! Retomando atendimento automatizado. Como posso ajudar?`);

      return res.json({ sucesso: true, mensagem: 'Robô liberado' });
    }

    case 'send': {
      const { phone, mensagem, usuario } = req.body;
      if (!phone || !mensagem) return res.status(400).json({ erro: 'Telefone e mensagem obrigatórios' });

      await enviarWhatsApp(phone, mensagem);
      conversas.push({ telefone: phone, tipo: 'humano', mensagem, data: new Date().toISOString(), atendente: usuario || 'Sistema' });

      return res.json({ sucesso: true });
    }

    case 'stats': {
      return res.json({
        totalConversas: Object.keys(clientes).length,
        emAtendimento: Object.values(clientes).filter(c => c.etapa !== 'AGENDADO' && c.etapa !== 'INICIO').length,
        agendamentosHoje: agendamentos.filter(a => a.data === 'hoje').length,
        intervencoesAtivas: intervenções.size
      });
    }

    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}

// ============================================
// LÓGICA DE VENDAS SIMPLIFICADA
// ============================================

async function processarMensagem(cli, t, original, nome, telefone) {
  const d = cli.dados;

  // Saudação inicial
  if (cli.etapa === 'INICIO' && t.match(/(oi|olá|ola|bom dia|boa tarde|boa noite|hey)/)) {
    return `Olá, ${nome}! 👋 Sou da *RC Reforma e Construção*.

Para te ajudar rápido, me conta:
1️⃣ Qual serviço precisa? (pedreiro, pintura, hidráulica, elétrica, marcenaria...)
2️⃣ Qual bairro do Rio?

Se quiser, envie fotos! 📸`;
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

Quando quiser agendar, é só chamar. Normalmente temos vagas para *hoje ou amanhã*.

Boa sorte! 🛠️`;
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
      return `Olá! Sua visita está confirmada. Se precisar remarcar ou tirar dúvidas, é só avisar! 😊`;
    default:
      cli.etapa = 'INICIO';
      return `Olá, ${nome}! Me informe o serviço e o bairro que deseja atendimento.`;
  }
}

// ===== ETAPAS =====

async function etapaInicio(cli, t, original, nome) {
  const d = cli.dados;
  const { servico, bairro } = extrairServicoEBairro(t, original);

  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';

    return `Perfeito! ${servico} em ${bairro}.

Você precisa de atendimento *urgente para hoje* ou podemos agendar para amanhã/outro dia?

📅 Tenho vagas disponíveis!`;
  }

  if (servico) {
    d.servico = servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo! Você precisa de *${servico}*. Qual bairro do Rio?`;
  }

  if (bairro) {
    d.bairro = bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return `Entendi, *${bairro}*. Qual serviço você precisa?`;
  }

  if (t.match(/(quanto custa|qual o preço|valor)/)) {
    return `Para valores precisos, preciso saber o serviço e bairro. Cada caso é único!

Mas a visita técnica é *R$180* (R$90 na Zona Sul, *GRÁTIS* em Botafogo).

Qual serviço e bairro? 🔧`;
  }

  return `Oi! Sou da RC Reforma. Para ajudar:

Qual serviço você precisa e em qual bairro?

Ex: "pintura em Ipanema", "vazamento em Copacabana"...`;
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
  const servico = extrairServico(t);

  if (servico) {
    d.servico = servico;
    cli.etapa = 'CONFIRMA_ATENDIMENTO_HOJE';
    return `Perfeito! ${servico} em ${d.bairro}.

Precisa de atendimento *urgente para hoje* ou podemos agendar?`;
  }

  return `Qual serviço você precisa em ${d.bairro}? (pedreiro, pintura, hidráulica, elétrica, marcenaria...)`;
}

function etapaConfirmaAtendimentoHoje(cli, t, original) {
  const d = cli.dados;

  if (t.match(/(hoje|urgente|urgência|vazando|quebrou|emergência)/)) {
    d.urgente = true;
    cli.etapa = 'APRESENTA_VALOR';

    const valor = d.bairro.toLowerCase().includes('botafogo') ? 0 : 
                  verificarAtendimento(d.bairro) ? 90 : 180;

    return `Entendi que é urgente! 🚨

Antes de confirmar para *HOJE*, explico o valor:

📋 *Visita Técnica: ${valor === 0 ? 'GRÁTIS' : 'R$' + valor}*
• Profissional vai até você
• Orçamento detalhado no local
• Se aprovar: ${valor > 0 ? 'valor é abatido do total' : 'sem custo mesmo!'}

${valor === 0 ? '🎉 Botafogo tem visita GRÁTIS!' : ''}

Posso verificar disponibilidade para hoje?`;
  }

  if (t.match(/(amanhã|amanha|depois|próximo|proximo|outro dia)/)) {
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

  if (t.match(/(não|nao|não vou pagar|nao vou pagar|grátis|gratis|caro)/)) {
    if (d.bairro.toLowerCase().includes('botafogo')) {
      d.valorVisita = 0;
      cli.etapa = 'VERIFICAR_AGENDA';
      return `Como você é de *Botafogo*, visita técnica é *GRÁTIS*! 🎉

Sem custo nenhum. Posso verificar disponibilidade na agenda?`;
    }

    if (verificarAtendimento(d.bairro)) {
      return `Posso oferecer *50% de desconto* para Zona Sul: *R$90*

Ou, se conseguir trazer o serviço para Botafogo, fica 100% gratuito!

O que prefere?`;
    }
  }

  if (t.match(/(sim|pode|ok|claro|verifica|agenda|vamos)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Ótimo! Deixa eu consultar a agenda... ⏳

Para *quando* você prefere?
• Hoje
• Amanhã  
• Outro dia específico

Me informa!`;
  }

  return `Posso verificar disponibilidade na agenda para ${d.servico} em ${d.bairro}?`;
}

async function etapaVerificarAgenda(cli, t, original) {
  const d = cli.dados;

  if (t.match(/(hoje)/)) {
    const horaAtual = new Date().getHours();
    if (horaAtual >= 18) {
      return `Já são mais de 18h. Posso agendar o primeiro horário de *amanhã*?

Ou prefere outro dia?`;
    }

    d.data = 'hoje';
    d.dataFormatada = new Date().toLocaleDateString('pt-BR');
    cli.etapa = 'AGUARDANDO_HORARIO';

    return `✅ *Temos vaga para HOJE!*

Qual horário seria melhor?
• Manhã (9h às 12h)
• Tarde (14h às 17h)
• Noite (18h às 20h)

Qual prefere?`;
  }

  if (t.match(/(amanhã|amanha)/)) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    d.data = 'amanhã';
    d.dataFormatada = amanha.toLocaleDateString('pt-BR');
    cli.etapa = 'AGUARDANDO_HORARIO';

    return `✅ *Amanhã temos disponibilidade!*

Qual período?
• Manhã (9h-12h)
• Tarde (14h-17h)

Qual melhor horário?`;
  }

  const dataEspecifica = extrairData(t, original);
  if (dataEspecifica) {
    d.data = dataEspecifica;
    d.dataFormatada = dataEspecifica;
    cli.etapa = 'AGUARDANDO_HORARIO';
    return `Anotado: ${dataEspecifica}. Qual horário seria ideal?`;
  }

  return `Para *quando* você precisa? (hoje, amanhã, ou outro dia)`;
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
    d.hora = 'manhã (9h-12h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Manhã anotado! 

Endereço completo, por favor:
📍 Rua, número, complemento`;
  }

  if (t.match(/tarde/)) {
    d.hora = 'tarde (14h-17h)';
    cli.etapa = 'AGUARDANDO_ENDERECO';
    return `✅ Tarde anotada!

Endereço completo, por favor:
📍 Rua, número, complemento`;
  }

  return `Qual horário? (ex: 10h, 14:30, manhã, tarde)`;
}

function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;

  if (original.length > 8 && (t.match(/(rua|av|avenida|número|numero|apartamento|casa)/) || t.match(/\d+/))) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_VISITA';

    const valor = d.bairro.toLowerCase().includes('botafogo') ? 0 : 
                  verificarAtendimento(d.bairro) ? 90 : 180;
    d.valorVisita = valor;

    return `📋 *RESUMO DO AGENDAMENTO*

Serviço: ${d.servico}
Data: ${d.data} (${d.dataFormatada})
Horário: ${d.hora}
Endereço: ${original}
Valor: ${valor === 0 ? '*GRÁTIS* 🎉' : `R$${valor}`}

*Tudo correto?* Responda *sim* para confirmar ou me diga o que alterar!`;
  }

  return `Preciso do endereço completo (rua, número, complemento). Qual é?`;
}

async function etapaConfirmarVisita(cli, t, original, telefone) {
  const d = cli.dados;

  if (t.match(/(sim|pode|ok|confirmo|tá bom|tah bom|perfeito)/)) {
    cli.etapa = 'AGENDADO';

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
      valor: d.valorVisita,
      status: 'confirmado'
    };

    agendamentos.push(agendamento);

    // Notifica técnico
    const tecnico = CONFIG.tecnicos[d.servico] || CONFIG.tecnicos.reforma;
    await enviarWhatsApp(tecnico, 
      `🔔 NOVA VISITA\n${d.servico} | ${d.data} ${d.hora}\n${d.endereco}\nCliente: ${cli.nome}\nTel: ${telefone}\nValor: ${d.valorVisita === 0 ? 'GRÁTIS' : 'R$'+d.valorVisita}`
    );

    // Notifica Telegram
    await enviarTelegram(
      `✅ VISITA CONFIRMADA\n\n📅 ${d.data} às ${d.hora}\n🔧 ${d.servico}\n📍 ${d.endereco}\n👤 ${cli.nome}\n📱 ${telefone}\n💰 ${d.valorVisita === 0 ? 'GRÁTIS (Botafogo)' : 'R$'+d.valorVisita}`
    );

    return `🎉 *VISITA CONFIRMADA!*

📅 ${d.data} às ${d.hora}
📍 ${d.endereco}
🔧 ${d.servico}
${d.valorVisita > 0 ? `💰 R$${d.valorVisita} (pagar no ato)` : '💰 GRÁTIS'}

*Próximos passos:*
1️⃣ Técnico entrará em contato em até *48h*
2️⃣ Lembrete automático 2h antes
3️⃣ Orçamento detalhado no local

Precisa remarcar? Avise com *2h de antecedência*.

Mais alguma dúvida? 😊`;
  }

  if (t.match(/(não|nao|mudar|alterar|trocar)/)) {
    cli.etapa = 'VERIFICAR_AGENDA';
    return `Sem problema! O que precisa alterar?

• Data/horário
• Endereço
• Serviço

Me informa!`;
  }

  return `Posso confirmar para ${d.data} às ${d.hora}? Responda *sim* ou diga o que alterar.`;
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function extrairServicoEBairro(t, original) {
  return {
    servico: extrairServico(t),
    bairro: extrairBairro(t, original)
  };
}

function extrairServico(t) {
  for (const s of CONFIG.servicos) {
    if (t.includes(s)) return s;
  }
  return null;
}

function extrairBairro(t, original) {
  for (const b of CONFIG.bairrosAtendidos) {
    if (t.includes(b)) return b;
  }

  const m = original.match(/(em|no|na)\s+([A-Za-zÀ-ÿ\s]+)/i);
  if (m) {
    const possivel = m[2].trim().toLowerCase();
    for (const b of CONFIG.bairrosAtendidos) {
      if (possivel.includes(b)) return b;
    }
    if (possivel.length > 2) return possivel;
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

function verificarAtendimento(bairro) {
  if (!bairro) return false;
  const n = bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

    clearTimeout(timeout);

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

async function encaminharMidia(numeroDestino, tipo, midiaId, caption = '') {
  console.log(`📤 ENCAMINHANDO ${tipo} PARA ${numeroDestino}: ${midiaId}`);

  if (!CONFIG.whatsappToken || !CONFIG.whatsappPhoneId) {
    console.error('❌ WhatsApp não configurado');
    return false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: numeroDestino,
      type: tipo,
      [tipo]: { id: midiaId }
    };

    if (caption) {
      body[tipo].caption = caption;
    }

    const res = await fetch(`https://graph.facebook.com/v18.0/${CONFIG.whatsappPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const data = await res.json();
      console.error('❌ Erro ao encaminhar mídia:', res.status, data);
      return false;
    }

    console.log('✅ Mídia encaminhada com sucesso');
    return true;

  } catch (e) {
    console.error('❌ Erro ao encaminhar mídia:', e.message);
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

async function processarImagem(telefone, nome, imagemData) {
  const cli = clientes[telefone];
  const servico = cli?.dados?.servico || '';

  // Determina o profissional baseado no serviço
  const isMarcenaria = servico && (
    servico.includes('marcenaria') || 
    servico.includes('armário') || 
    servico.includes('armario') || 
    servico.includes('porta') || 
    servico.includes('móvel') || 
    servico.includes('movel')
  );

  const tecnico = isMarcenaria ? CONFIG.tecnicos.marcenaria : CONFIG.tecnicos.reforma;
  const nomeProfissional = isMarcenaria ? 'João (Marcenaria)' : 'Anderson (Reformas)';

  const caption = `📸 Imagem de ${nome} (${telefone})\nServiço: ${servico || 'Não informado'}\nProfissional: ${nomeProfissional}`;

  // Encaminha a imagem real para o profissional
  if (imagemData.id) {
    await encaminharMidia(tecnico, 'image', imagemData.id, caption);
  }

  // Notifica também no Telegram
  await enviarTelegram(`📸 Nova imagem de ${nome} (${telefone})\nServiço: ${servico || 'Não informado'}\nEncaminhada para: ${nomeProfissional}`);

  // Responde ao cliente
  const variacoes = [
    "Recebi as imagens. Já encaminhei ao profissional responsável para análise. Retornarei em breve com o retorno.",
    "As fotos foram recebidas e encaminhadas ao profissional. Aguarde um momento que já retorno com o feedback.",
    "Imagens recebidas com sucesso. Já enviei ao profissional responsável. Em breve retorno com mais informações."
  ];
  const resposta = variacoes[Math.floor(Math.random() * variacoes.length)];
  await enviarWhatsApp(telefone, resposta);
}

async function processarVideo(telefone, nome, videoData) {
  const cli = clientes[telefone];
  const servico = cli?.dados?.servico || '';

  // Determina o profissional baseado no serviço
  const isMarcenaria = servico && (
    servico.includes('marcenaria') || 
    servico.includes('armário') || 
    servico.includes('armario') || 
    servico.includes('porta') || 
    servico.includes('móvel') || 
    servico.includes('movel')
  );

  const tecnico = isMarcenaria ? CONFIG.tecnicos.marcenaria : CONFIG.tecnicos.reforma;
  const nomeProfissional = isMarcenaria ? 'João (Marcenaria)' : 'Anderson (Reformas)';

  const caption = `🎥 Vídeo de ${nome} (${telefone})\nServiço: ${servico || 'Não informado'}\nProfissional: ${nomeProfissional}`;

  // Encaminha o vídeo real para o profissional
  if (videoData.id) {
    await encaminharMidia(tecnico, 'video', videoData.id, caption);
  }

  // Notifica também no Telegram
  await enviarTelegram(`🎥 Novo vídeo de ${nome} (${telefone})\nServiço: ${servico || 'Não informado'}\nEncaminhado para: ${nomeProfissional}`);

  // Responde ao cliente
  const variacoes = [
    "Recebi o vídeo. Já encaminhei ao profissional responsável para análise. Retornarei em breve com o retorno.",
    "O vídeo foi recebido e encaminhado ao profissional. Aguarde um momento que já retorno com o feedback.",
    "Vídeo recebido com sucesso. Já enviei ao profissional responsável. Em breve retorno com mais informações."
  ];
  const resposta = variacoes[Math.floor(Math.random() * variacoes.length)];
  await enviarWhatsApp(telefone, resposta);
}
