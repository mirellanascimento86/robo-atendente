// ============================================
// RC ATENDIMENTO - VERSÃO DIAGNÓSTICO E CORREÇÃO
// ============================================

const CONFIG = {
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176',
    eletrica: '5521968112176'
  },
  
  precoZonaSul: 180,
  precoOutros: 220,
  
  bairrosZonaSul: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha'
  ],
  
  numeroRC: process.env.NUMERO_RC || '',
  timeoutTecnico: 5 * 60 * 1000,
  lembrete2h: 2 * 60 * 60 * 1000
};

// VERIFICAÇÃO DE VARIÁVEIS (DIAGNÓSTICO)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// LOG DE DIAGNÓSTICO INICIAL
console.log('🔧 DIAGNÓSTICO DE CONFIGURAÇÃO:');
console.log('WHATSAPP_TOKEN existe:', !!WHATSAPP_TOKEN);
console.log('WHATSAPP_TOKEN tamanho:', WHATSAPP_TOKEN ? WHATSAPP_TOKEN.length : 0);
console.log('WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID);
console.log('NUMERO_RC:', CONFIG.numeroRC);
console.log('TELEGRAM configurado:', !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID));

const clientes = {};
const mensagensProcessadas = new Set();
const agendamentosPendentes = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // VERIFICAÇÃO WEBHOOK (GET)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      console.log('✅ Verificação webhook recebida:', req.query['hub.verify_token']);
      if (req.query['hub.verify_token'] === 'roboatendente') {
        console.log('✅ Verificação aceita');
        return res.status(200).send(req.query['hub.challenge']);
      }
      console.log('❌ Verificação falhou - token incorreto');
      return res.status(403).send('Forbidden');
    }
    
    // PROCESSAMENTO DE MENSAGENS (POST)
    if (req.method === 'POST') {
      return await receberMensagem(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('❌ ERRO GERAL:', erro.message, erro.stack);
    return res.status(200).send('OK');
  }
}

async function receberMensagem(req, res) {
  const body = req.body;
  
  console.log('\n📥 WEBHOOK RECEBIDO:', JSON.stringify(body, null, 2).substring(0, 500));
  
  // Validação básica
  if (!body) {
    console.log('❌ Body vazio');
    return res.status(200).send('OK');
  }
  
  if (body.object !== 'whatsapp_business_account') {
    console.log('❌ Não é whatsapp_business_account:', body.object);
    return res.status(200).send('OK');
  }
  
  const entry = body.entry?.[0];
  if (!entry) {
    console.log('❌ Sem entry no body');
    return res.status(200).send('OK');
  }
  
  const changes = entry?.changes?.[0]?.value;
  if (!changes) {
    console.log('❌ Sem changes no entry');
    return res.status(200).send('OK');
  }
  
  // IGNORAR: Status de mensagem (delivery, read, sent) - CAUSA DE LOOPS
  if (changes?.statuses) {
    console.log('📊 Status ignorado:', changes.statuses[0]?.status);
    return res.status(200).send('OK');
  }
  
  // IGNORAR: Mensagens de sistema
  if (changes?.messages?.length === 0) {
    console.log('ℹ️ Nenhuma mensagem no changes');
    return res.status(200).send('OK');
  }
  
  const message = changes?.messages?.[0];
  if (!message) {
    console.log('❌ Mensagem não encontrada');
    return res.status(200).send('OK');
  }
  
  if (!message.id) {
    console.log('❌ Mensagem sem ID');
    return res.status(200).send('OK');
  }
  
  // Anti-duplicata
  if (mensagensProcessadas.has(message.id)) {
    console.log('♻️ Mensagem duplicada:', message.id);
    return res.status(200).send('OK');
  }
  mensagensProcessadas.add(message.id);
  if (mensagensProcessadas.size > 1000) mensagensProcessadas.clear();
  
  const telefone = message.from;
  console.log('📞 Telefone:', telefone);
  
  // IGNORAR: Mensagens do próprio número da RC
  if (telefone === CONFIG.numeroRC || telefone === WHATSAPP_PHONE_ID) {
    console.log('🤖 Mensagem própria ignorada');
    return res.status(200).send('OK');
  }
  
  const numerosTecnicos = Object.values(CONFIG.tecnicos);
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // VERIFICA SE É RESPOSTA DE TÉCNICO
  if (numerosTecnicos.includes(telefone)) {
    console.log('🔧 Processando resposta de TÉCNICO');
    return await processarRespostaTecnico(telefone, message, res);
  }
  
  // PROCESSAMENTO DE CLIENTE
  console.log(`\n📨 CLIENTE ${nome} (${telefone}): ${message.text?.body || '[midia]'}`);
  
  // Áudio não suportado
  if (message.type === 'audio') {
    console.log('🎵 Áudio recebido - solicitando texto');
    await enviarWhatsApp(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // Foto sem texto no início
  if (message.type === 'image' && !message.caption) {
    const clienteExistente = clientes[telefone];
    if (!clienteExistente || clienteExistente.historico.length === 0) {
      await enviarWhatsApp(telefone, "Ola! Me informe o servico e bairro que deseja atendimento");
      return res.status(200).send('OK');
    }
  }
  
  if (message.type !== 'text') {
    console.log('📎 Tipo não-texto ignorado:', message.type);
    return res.status(200).send('OK');
  }
  
  const texto = message.text.body;
  console.log('📝 Texto:', texto);
  
  // Inicializa cliente se novo
  if (!clientes[telefone]) {
    console.log('👤 Novo cliente criado');
    clientes[telefone] = {
      nome,
      telefone,
      etapa: 'INICIO',
      historico: [],
      dados: {
        servico: null,
        bairro: null,
        valor: null,
        data: null,
        hora: null,
        endereco: null,
        tecnicoNotificado: false,
        profissionalNome: null,
        visitaConfirmada: false,
        urgente: false,
        multiploServico: false,
        tecnicosConfirmados: []
      },
      ultimoTimestamp: 0
    };
  }
  
  const cliente = clientes[telefone];
  
  // Anti-loop temporal (3 segundos)
  const agora = Date.now();
  if (cliente.ultimoTimestamp && (agora - cliente.ultimoTimestamp < 3000)) {
    console.log('⏱️ Mensagem muito rápida, ignorada');
    return res.status(200).send('OK');
  }
  cliente.ultimoTimestamp = agora;
  
  // Registra histórico
  cliente.historico.push({
    role: 'user',
    content: texto,
    timestamp: new Date().toISOString()
  });
  
  // PROCESSA MENSAGEM
  console.log('🔄 Etapa atual:', cliente.etapa);
  const resposta = await processarMensagem(cliente, texto);
  console.log('💬 Resposta gerada:', resposta);
  
  if (resposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      cliente.historico.push({
        role: 'assistant',
        content: resposta,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return res.status(200).send('OK');
}

async function processarMensagem(cliente, texto) {
  const t = texto.toLowerCase().trim();
  const dados = cliente.dados;
  
  // ========== RESPOSTAS DIRETAS ==========
  
  if (t.match(/(quem e voce|voce e robo|e humano|atendente)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  if (t.match(/(idiota|burro|inutil|merda|estupido)/)) {
    return "Se precisar de atendimento para o servico que precisa, me avise";
  }
  
  if (t.match(/(falar com quem vai fazer|falar com o profissional|contato do tecnico)/)) {
    return "Qual a sua duvida?";
  }
  
  if (t.match(/(sindico|condominio|empresa|predio|comercial)/)) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  if (t.match(/(so material|apenas material|comprar material)/)) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  if (t.match(/(depois eu te falo|so queria saber preco|depois eu entro em contato)/)) {
    return "Se precisar de atendimento, pode entrar em contato";
  }
  
  if (t.match(/(vou pensar|volto depois|depois eu decido)/)) {
    return "Sempre que precisar, entre em contato";
  }
  
  if (t.match(/(desisti|cancela|quero cancelar)/)) {
    return "Pode contar melhor o que houve?";
  }
  
  // ========== FLUXO POR ETAPA ==========
  
  switch (cliente.etapa) {
    case 'INICIO':
      return processarEtapaInicio(cliente, t, texto);
      
    case 'AGUARDANDO_BAIRRO':
      return processarEtapaAguardandoBairro(cliente, t, texto);
      
    case 'AGUARDANDO_SERVICO':
      return processarEtapaAguardandoServico(cliente, t, texto);
      
    case 'VALOR_APRESENTADO':
      return processarEtapaValorApresentado(cliente, t, texto);
      
    case 'AGUARDANDO_DATA':
      return processarEtapaAguardandoData(cliente, t, texto);
      
    case 'AGUARDANDO_HORARIO':
      return processarEtapaAguardandoHorario(cliente, t, texto);
      
    case 'AGUARDANDO_ENDERECO':
      return processarEtapaAguardandoEndereco(cliente, t, texto);
      
    case 'CONFIRMAR_AGENDAMENTO':
      return processarEtapaConfirmar(cliente, t, texto);
      
    case 'AGENDADO':
      return "Visita confirmada. Se precisar de algo mais, e so chamar.";
      
    case 'AGUARDANDO_TECNICO':
      return "Um momento que irei verificar com o profissional";
      
    default:
      return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
}

function processarEtapaInicio(cliente, t, texto) {
  const dados = cliente.dados;
  
  // Extrai serviço e bairro
  const extracao = extrairServicoEBairro(t, texto);
  
  // Serviço + bairro de uma vez
  if (extracao.servico && extracao.bairro) {
    dados.servico = extracao.servico;
    dados.bairro = extracao.bairro;
    calcularValor(dados);
    
    if (t.match(/(pintura.*eletrica|eletrica.*pintura|hidraulica.*eletrica)/)) {
      dados.multiploServico = true;
      return "Sera necessario o envio de dois profissionais independentes para a realizacao da visita. A taxa de cada visita e de R$180. Para quando gostaria de marcar?";
    }
    
    if (t.match(/(construcao|reforma completa|casa toda)/)) {
      return "E necessario que o profissional va ao local para que seja realizado um orcamento preciso. A taxa da visita e de R$" + dados.valor + ". Para quando gostaria de atendimento?";
    }
    
    cliente.etapa = 'VALOR_APRESENTADO';
    return "Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$" + dados.valor + ", mas e abatido do valor final se o orcamento for aprovado.";
  }
  
  // Só serviço
  if (extracao.servico && !extracao.bairro) {
    dados.servico = extracao.servico;
    cliente.etapa = 'AGUARDANDO_BAIRRO';
    return "Certo, qual o bairro que deseja atendimento?";
  }
  
  // Só bairro
  if (!extracao.servico && extracao.bairro) {
    dados.bairro = extracao.bairro;
    cliente.etapa = 'AGUARDANDO_SERVICO';
    return "Qual servico deseja?";
  }
  
  // "Quanto custa?"
  if (t.match(/(quanto custa|qual o preco|valor)/)) {
    return "A qual servico se refere? Nao posso dizer um valor exato, pois depende da visita tecnica de um profissional, mas posso enviar uma media de valores. Deseja?";
  }
  
  return "Ola! Me informe o servico e bairro que deseja atendimento";
}

function processarEtapaAguardandoBairro(cliente, t, texto) {
  const dados = cliente.dados;
  const bairro = extrairBairro(t, texto);
  
  if (bairro) {
    dados.bairro = bairro;
    calcularValor(dados);
    cliente.etapa = 'VALOR_APRESENTADO';
    
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    const valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
    
    return "Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$" + valor + ", mas e abatido do valor final caso o orcamento seja aprovado.";
  }
  
  return "Certo, qual o bairro que deseja atendimento?";
}

function processarEtapaAguardandoServico(cliente, t, texto) {
  const dados = cliente.dados;
  const servico = extrairServico(t);
  
  if (servico) {
    dados.servico = servico;
    calcularValor(dados);
    cliente.etapa = 'VALOR_APRESENTADO';
    
    return "Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$" + dados.valor + ", mas e abatido do valor final caso o orcamento seja aprovado.";
  }
  
  return "Qual servico deseja?";
}

function processarEtapaValorApresentado(cliente, t, texto) {
  const dados = cliente.dados;
  
  if (t.match(/(por que tem que pagar|por que pagar|para que serve)/)) {
    return "O valor se refere ao custo de deslocamento do profissional e analise tecnica. Caso o orcamento seja aprovado, o valor da visita e abatido do valor final. Assim, a vista sairia de graca";
  }
  
  if (t.match(/(nao vou pagar|orcamento gratis|visita gratis)/)) {
    const isBotafogo = dados.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      dados.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      dados.valor = 0;
      cliente.etapa = 'AGUARDANDO_DATA';
      return "Como uma excecao, a visita pode ser realizada sem cobranca. Para quando gostaria de agendar?";
    } else if (isZonaSul) {
      return "A visita pode ser realizada pela metade do valor. Deseja prosseguir?";
    } else {
      return "Entendo, mas infelizmente a taxa da visita precisa ser seguida";
    }
  }
  
  if (t.match(/(desconto|faz mais barato|tem desconto)/)) {
    const isBotafogo = dados.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      dados.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      return "Posso oferecer 50% de desconto na visita. Se nao aceitar, posso tentar a visita sem cobranca como excecao. O que prefere?";
    } else if (isZonaSul) {
      return "Posso oferecer ate 50% de desconto no valor da visita. Deseja prosseguir?";
    } else {
      return "Para este bairro, o valor da visita e fixo. Podemos agendar?";
    }
  }
  
  if (t.match(/(pode ser|quando|data|horario|hoje|amanha|agendar|marcar)/)) {
    cliente.etapa = 'AGUARDANDO_DATA';
    return processarEtapaAguardandoData(cliente, t, texto);
  }
  
  return "Deseja agendar a visita tecnica?";
}

function processarEtapaAguardandoData(cliente, t, texto) {
  const dados = cliente.dados;
  const horaAtual = new Date().getHours();
  
  // Urgência
  if (t.match(/(urgente|vazando|vazamento|quebrou|emergencia)/)) {
    dados.urgente = true;
    if (!dados.bairro) {
      return "Qual bairro deseja atendimento?";
    }
    return iniciarVerificacaoTecnico(cliente, 'hoje');
  }
  
  // Hoje
  if (t.match(/(hoje|hoje ainda)/)) {
    if (horaAtual >= 19) {
      return "Posso entrar em contato com o profissional amanha no primeiro horario. Deseja?";
    }
    return iniciarVerificacaoTecnico(cliente, 'hoje');
  }
  
  // Amanhã de manhã
  if (t.match(/(amanha de manha|amanhã de manhã|amanha cedo)/)) {
    cliente.etapa = 'AGUARDANDO_HORARIO';
    return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
  }
  
  // Amanhã
  if (t.match(/(amanha|amanhã)/)) {
    return iniciarVerificacaoTecnico(cliente, 'amanha');
  }
  
  // Qualquer dia
  if (t.match(/(qualquer dia|qualquer horario|tanto faz)/)) {
    return "Gostaria de atendimento para hoje?";
  }
  
  // Horário específico
  const horarioDetectado = extrairHorario(texto);
  const dataDetectada = extrairData(t, texto);
  
  if (horarioDetectado || dataDetectada) {
    if (horarioDetectado) dados.hora = horarioDetectado;
    if (dataDetectada) dados.data = dataDetectada;
    return iniciarVerificacaoTecnico(cliente, dados.data || 'sugerido', dados.hora);
  }
  
  // Indeciso
  if (t.match(/(nao sei|ainda nao sei|vou ver)/)) {
    return "Gostaria de atendimento para hoje?";
  }
  
  return "Para quando gostaria de agendar?";
}

function processarEtapaAguardandoHorario(cliente, t, texto) {
  const dados = cliente.dados;
  const horario = extrairHorario(texto);
  
  if (horario) {
    dados.hora = horario;
    return iniciarVerificacaoTecnico(cliente, dados.data || 'amanha', horario);
  }
  
  if (t.match(/(sim|pode ser|manha|tarde)/)) {
    if (t.match(/manha/)) dados.hora = '10:00';
    else if (t.match(/tarde/)) dados.hora = '14:00';
    else dados.hora = '10:00';
    
    return iniciarVerificacaoTecnico(cliente, dados.data || 'amanha', dados.hora);
  }
  
  return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
}

function processarEtapaAguardandoEndereco(cliente, t, texto) {
  const dados = cliente.dados;
  
  if (texto.length > 10 && (t.match(/(rua|av|avenida|estrada|travessa)/))) {
    dados.endereco = texto;
    cliente.etapa = 'CONFIRMAR_AGENDAMENTO';
    return `Pode marcar para ${dados.data} as ${dados.hora} com profissional ${dados.profissionalNome}?`;
  }
  
  if ((t.match(/(rua|av)/)) && !t.match(/\d+/)) {
    return "Qual o numero? E casa ou apartamento?";
  }
  
  if (t.match(/(nao vou passar|depois eu passo|confirmar primeiro)/)) {
    return "Um momento que irei verificar a disponibilidade do profissional";
  }
  
  return "Qual o endereco completo para a visita?";
}

function processarEtapaConfirmar(cliente, t, texto) {
  const dados = cliente.dados;
  
  if (t.match(/(sim|pode|confirmo|esta bom|ok|pode marcar)/)) {
    notificarTecnicoConfirmado(cliente);
    dados.tecnicoNotificado = true;
    cliente.etapa = 'AGENDADO';
    agendarLembretes(cliente);
    return "Perfeito, marcado!";
  }
  
  if (t.match(/(nao|mudar|alterar|outro dia|remarcar)/)) {
    cliente.etapa = 'AGUARDANDO_DATA';
    return "Qual seria o dia mais proximo que teria disponibilidade?";
  }
  
  return `Posso confirmar: ${dados.servico} em ${dados.bairro}, dia ${dados.data} as ${dados.hora}, no endereco ${dados.endereco}. Esta correto?`;
}

// ========== COMUNICAÇÃO COM TÉCNICOS ==========

function iniciarVerificacaoTecnico(cliente, data, hora = null) {
  const dados = cliente.dados;
  dados.data = data;
  if (hora) dados.hora = hora;
  
  cliente.etapa = 'AGUARDANDO_TECNICO';
  
  // Determina técnico
  let numeroTecnico;
  if (dados.servico?.match(/(marcenaria|movel|armario)/)) {
    numeroTecnico = CONFIG.tecnicos.marcenaria;
    dados.profissionalNome = "Tecnico de Marcenaria";
  } else if (dados.servico?.match(/(hidraulica|encanamento|vazamento)/)) {
    numeroTecnico = CONFIG.tecnicos.hidraulica;
    dados.profissionalNome = "Tecnico Hidraulico";
  } else if (dados.servico?.match(/(eletrica|eletricista)/)) {
    numeroTecnico = CONFIG.tecnicos.eletrica;
    dados.profissionalNome = "Tecnico Eletricista";
  } else {
    numeroTecnico = CONFIG.tecnicos.reforma;
    dados.profissionalNome = "Tecnico de Reformas";
  }
  
  const idAgendamento = `${cliente.telefone}_${Date.now()}`;
  agendamentosPendentes[idAgendamento] = {
    cliente: cliente,
    tecnico: numeroTecnico,
    timestamp: Date.now()
  };
  
  const msgTecnico = `Bom dia! Tem disponibilidade para visita de ${dados.servico} em ${dados.bairro} ${data}${hora ? ' as ' + hora : ''}? Cliente: ${cliente.nome}, Tel: ${cliente.telefone}.`;
  
  enviarWhatsApp(numeroTecnico, msgTecnico);
  
  // Timeout 5 minutos
  setTimeout(() => {
    verificarTimeoutTecnico(idAgendamento);
  }, CONFIG.timeoutTecnico);
  
  return "Um momento que irei verificar com o profissional";
}

async function processarRespostaTecnico(telefoneTecnico, message, res) {
  const texto = message.text?.body || '';
  const t = texto.toLowerCase();
  
  console.log(`🔧 TÉCNICO ${telefoneTecnico}: ${texto}`);
  
  // Encontra agendamento pendente
  let agendamento = null;
  let idAgendamento = null;
  
  for (const [id, ag] of Object.entries(agendamentosPendentes)) {
    if (ag.tecnico === telefoneTecnico && (Date.now() - ag.timestamp) < CONFIG.timeoutTecnico) {
      agendamento = ag;
      idAgendamento = id;
      break;
    }
  }
  
  if (!agendamento) {
    console.log('Nenhum agendamento pendente');
    return res.status(200).send('OK');
  }
  
  const cliente = agendamento.cliente;
  const dados = cliente.dados;
  delete agendamentosPendentes[idAgendamento];
  
  // Resposta positiva
  if (t.match(/(posso|sim|confirmo|to livre|tenho disponibilidade|ok|beleza|show)/)) {
    dados.visitaConfirmada = true;
    cliente.etapa = 'AGUARDANDO_ENDERECO';
    
    enviarWhatsApp(cliente.telefone, 
      `Visita confirmada para ${dados.data}${dados.hora ? ', as ' + dados.hora : ''}, com o profissional ${dados.profissionalNome}. Qual o endereco completo?`);
    
    return res.status(200).send('OK');
  }
  
  // Resposta negativa
  if (t.match(/(nao posso|nao consigo|to ocupado|nao to livre|impossivel)/)) {
    enviarWhatsApp(telefoneTecnico, "Qual o dia e horario mais proximo que voce teria disponibilidade?");
    
    const novoId = `${cliente.telefone}_alternativa_${Date.now()}`;
    agendamentosPendentes[novoId] = {
      cliente: cliente,
      tecnico: telefoneTecnico,
      timestamp: Date.now(),
      tipo: 'alternativa'
    };
    
    setTimeout(() => {
      verificarTimeoutTecnico(novoId);
    }, CONFIG.timeoutTecnico);
    
    return res.status(200).send('OK');
  }
  
  // Sugere alternativa
  const novaData = extrairData(t, texto);
  const novoHorario = extrairHorario(texto);
  
  if (novaData || novoHorario || t.match(/(posso|consigo)/)) {
    if (novaData) dados.data = novaData;
    if (novoHorario) dados.hora = novoHorario;
    
    dados.visitaConfirmada = true;
    cliente.etapa = 'AGUARDANDO_ENDERECO';
    
    enviarWhatsApp(cliente.telefone, 
      `O tecnico podera realizar a visita ${dados.data}${dados.hora ? ' as ' + dados.hora : ''}. Confirmo o agendamento?`);
    
    return res.status(200).send('OK');
  }
  
  // Não entendeu
  enviarTelegram(`❓ Resposta não reconhecida. Cliente: ${cliente.nome}, Técnico: ${telefoneTecnico}, Resposta: "${texto}"`);
  
  return res.status(200).send('OK');
}

async function verificarTimeoutTecnico(idAgendamento) {
  const ag = agendamentosPendentes[idAgendamento];
  if (!ag) return;
  
  const cliente = ag.cliente;
  const dados = cliente.dados;
  delete agendamentosPendentes[idAgendamento];
  
  // Tenta outro técnico
  const tecnicosTentados = [ag.tecnico];
  const todosTecnicos = Object.values(CONFIG.tecnicos);
  let outroTecnico = null;
  
  for (const tec of todosTecnicos) {
    if (!tecnicosTentados.includes(tec)) {
      outroTecnico = tec;
      break;
    }
  }
  
  if (outroTecnico && !dados.urgente) {
    console.log(`🔄 Tentando técnico alternativo: ${outroTecnico}`);
    
    const novoId = `${cliente.telefone}_tecnico2_${Date.now()}`;
    agendamentosPendentes[novoId] = {
      cliente: cliente,
      tecnico: outroTecnico,
      timestamp: Date.now()
    };
    
    const msgTecnico = `Bom dia! Tem disponibilidade para visita de ${dados.servico} em ${dados.bairro} ${dados.data}${dados.hora ? ' as ' + dados.hora : ''}? Cliente: ${cliente.nome}, Tel: ${cliente.telefone}.`;
    
    enviarWhatsApp(outroTecnico, msgTecnico);
    
    setTimeout(() => {
      verificarTimeoutTecnico(novoId);
    }, CONFIG.timeoutTecnico);
    
    return;
  }
  
  // Alerta Telegram
  enviarTelegram(`🚨 URGENTE: Nenhum técnico respondeu em 5 min.
Cliente: ${cliente.nome} (${cliente.telefone})
Serviço: ${dados.servico}
Bairro: ${dados.bairro}
Data: ${dados.data} ${dados.hora || ''}
Técnicos tentados: ${tecnicosTentados.join(', ')}

AÇÃO: Ligar para o cliente e confirmar manualmente.`);
}

function notificarTecnicoConfirmado(cliente) {
  const dados = cliente.dados;
  
  let numeroTecnico = dados.numeroTecnicoNotificado;
  if (!numeroTecnico) {
    if (dados.servico?.match(/(marcenaria|movel)/)) numeroTecnico = CONFIG.tecnicos.marcenaria;
    else if (dados.servico?.match(/(hidraulica|vazamento)/)) numeroTecnico = CONFIG.tecnicos.hidraulica;
    else if (dados.servico?.match(/(eletrica)/)) numeroTecnico = CONFIG.tecnicos.eletrica;
    else numeroTecnico = CONFIG.tecnicos.reforma;
  }
  
  const msg = `Visita de ${dados.servico} marcada. Endereco ${dados.endereco}, Cliente ${cliente.nome}, dia ${dados.data}, as ${dados.hora}.`;
  
  enviarWhatsApp(numeroTecnico, msg);
  console.log(`📤 NOTIFICADO TÉCNICO: ${numeroTecnico}`);
}

function agendarLembretes(cliente) {
  const dados = cliente.dados;
  
  // 2h antes para técnico
  setTimeout(() => {
    enviarLembreteTecnico(cliente);
  }, CONFIG.lembrete2h);
  
  // 24h antes para cliente
  const umDia = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    enviarLembreteCliente(cliente);
  }, umDia);
}

function enviarLembreteTecnico(cliente) {
  const dados = cliente.dados;
  const msg = `Ola, ${dados.profissionalNome} lembrando da visita hoje as ${dados.hora} na ${dados.endereco}`;
  
  let numeroTecnico;
  if (dados.servico?.match(/(marcenaria|movel)/)) numeroTecnico = CONFIG.tecnicos.marcenaria;
  else if (dados.servico?.match(/(hidraulica|vazamento)/)) numeroTecnico = CONFIG.tecnicos.hidraulica;
  else if (dados.servico?.match(/(eletrica)/)) numeroTecnico = CONFIG.tecnicos.eletrica;
  else numeroTecnico = CONFIG.tecnicos.reforma;
  
  enviarWhatsApp(numeroTecnico, msg);
}

function enviarLembreteCliente(cliente) {
  const dados = cliente.dados;
  const msg = `Ola, ${cliente.nome} lembrando da visita amanha as ${dados.hora} na ${dados.endereco}, posso confirmar?`;
  enviarWhatsApp(cliente.telefone, msg);
}

// ========== FUNÇÕES UTILITÁRIAS ==========

function extrairServicoEBairro(t, textoOriginal) {
  const servicos = [
    'pintura', 'marcenaria', 'hidraulica', 'eletrica', 'reforma', 
    'azulejo', 'pedreiro', 'serralheria', 'gesso', 'drywall', 
    'encanamento', 'vazamento', 'movel', 'armario', 'pia', 'banheiro'
  ];
  
  const bairros = [
    ...CONFIG.bairrosZonaSul,
    'tijuca', 'madureira', 'meier', 'vila isabel', 'engenho novo', 
    'cascadura', 'bens', 'jacarepagua', 'barra', 'recreio', 
    'santa cruz', 'campo grande', 'tanque', 'freguesia', 'pechincha'
  ];
  
  let servico = null;
  let bairro = null;
  
  for (const s of servicos) {
    if (t.includes(s)) {
      servico = s.charAt(0).toUpperCase() + s.slice(1);
      break;
    }
  }
  
  for (const b of bairros) {
    if (t.includes(b)) {
      bairro = b.charAt(0).toUpperCase() + b.slice(1);
      break;
    }
  }
  
  // Detecção especial: "pintura em Ipanema"
  const matchEm = textoOriginal.match(/(em|na|no)\s+([A-Za-z\s]+)/i);
  if (matchEm && !bairro) {
    const possivelBairro = matchEm[2].trim().toLowerCase();
    for (const b of bairros) {
      if (possivelBairro.includes(b) || b.includes(possivelBairro)) {
        bairro = b.charAt(0).toUpperCase() + b.slice(1);
        break;
      }
    }
  }
  
  return { servico, bairro };
}

function extrairServico(t) {
  return extrairServicoEBairro(t, '').servico;
}

function extrairBairro(t, texto) {
  return extrairServicoEBairro(t, texto).bairro;
}

function extrairHorario(texto) {
  const match = texto.match(/(\d{1,2})[:h]?(\d{2})?/);
  if (match) {
    const hora = match[1].padStart(2, '0');
    const minuto = match[2] || '00';
    return `${hora}:${minuto}`;
  }
  return null;
}

function extrairData(t, texto) {
  if (t.includes('hoje')) return 'hoje';
  if (t.includes('amanha') || t.includes('amanhã')) return 'amanha';
  
  const match = texto.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) return `${match[1]}/${match[2]}`;
  
  return null;
}

function calcularValor(dados) {
  if (!dados.bairro) return;
  
  const bairroNormalizado = dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isZonaSul = CONFIG.bairrosZonaSul.some(b => bairroNormalizado.includes(b));
  dados.valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
}

// ========== COMUNICAÇÃO EXTERNA ==========

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 ENVIANDO para ${numero}:\n${texto}\n---`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ ERRO: Variáveis WhatsApp não configuradas!');
    console.error('WHATSAPP_TOKEN existe:', !!WHATSAPP_TOKEN);
    console.error('WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID);
    return false;
  }
  
  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    console.log('🔗 URL:', url);
    
    const res = await fetch(url, {
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
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ ERRO WhatsApp API:', res.status, data);
      
      // Erros comuns
      if (data.error?.code === 190) {
        console.error('🚨 TOKEN EXPIRADO ou INVÁLIDO! Gere um novo System User Token no Meta Business.');
      }
      if (data.error?.code === 100) {
        console.error('🚨 PHONE_ID inválido ou sem permissão.');
      }
      if (data.error?.code === 10) {
        console.error('🚨 Número de destino não está no WhatsApp ou é inválido.');
      }
      
      return false;
    }
    
    console.log('✅ Mensagem enviada com sucesso. ID:', data.messages?.[0]?.id);
    return true;
    
  } catch (e) {
    console.error('❌ EXCEÇÃO ao enviar:', e.message);
    return false;
  }
}

async function enviarTelegram(mensagem) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram não configurado:', mensagem.substring(0, 100));
    return;
  }
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });
    
    if (!res.ok) {
      console.error('❌ Erro Telegram:', await res.text());
    } else {
      console.log('📱 Telegram enviado');
    }
  } catch (e) {
    console.error('❌ Exceção Telegram:', e.message);
  }
}
