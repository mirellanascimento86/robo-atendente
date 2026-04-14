// ============================================
// RC ATENDIMENTO - SISTEMA 100% DETERMINISTICO
// SEM IA - BASEADO ESTRITAMENTE NAS RESPOSTAS DO CLIENTE
// ============================================

const CONFIG = {
  // Números dos técnicos
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176',
    eletrica: '5521968112176' // Mesmo número se for o mesmo técnico
  },
  
  // Valores
  precoZonaSul: 180,
  precoOutros: 220,
  
  // Bairros Zona Sul (R$180)
  bairrosZonaSul: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha'
  ],
  
  // Número da RC Reformas (para ignorar mensagens próprias)
  numeroRC: process.env.NUMERO_RC || '',
  
  // Timeout para resposta do técnico (5 minutos em ms)
  timeoutTecnico: 5 * 60 * 1000,
  
  // Timeout para lembrete de visita (2h antes em ms)
  lembrete2h: 2 * 60 * 60 * 1000
};

// Variáveis de ambiente
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Armazenamento em memória
const clientes = {};
const mensagensProcessadas = new Set();
const agendamentosPendentes = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Verificação webhook Meta
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    if (req.method === 'POST') {
      return await receberMensagem(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('ERRO GERAL:', erro);
    return res.status(200).send('OK');
  }
}

async function receberMensagem(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  
  // IGNORAR: Status de mensagem (delivery, read, sent)
  if (changes?.statuses) {
    return res.status(200).send('OK');
  }
  
  const message = changes?.messages?.[0];
  if (!message || !message.id) {
    return res.status(200).send('OK');
  }
  
  // Anti-duplicata
  if (mensagensProcessadas.has(message.id)) {
    return res.status(200).send('OK');
  }
  mensagensProcessadas.add(message.id);
  if (mensagensProcessadas.size > 1000) mensagensProcessadas.clear();
  
  const telefone = message.from;
  
  // IGNORAR: Mensagens do próprio número da RC
  if (telefone === CONFIG.numeroRC || telefone === WHATSAPP_PHONE_ID) {
    return res.status(200).send('OK');
  }
  
  const numerosTecnicos = Object.values(CONFIG.tecnicos);
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // VERIFICA SE É RESPOSTA DE TÉCNICO
  if (numerosTecnicos.includes(telefone)) {
    return await processarRespostaTecnico(telefone, message, res);
  }
  
  // PROCESSAMENTO DE CLIENTE
  console.log(`\n📨 CLIENTE ${nome} (${telefone}): ${message.text?.body || '[midia]'}`);
  
  // Áudio não suportado (Secao 1.4)
  if (message.type === 'audio') {
    await enviarWhatsApp(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // Foto sem texto no início (Secao 1.3)
  if (message.type === 'image' && !message.caption) {
    const clienteExistente = clientes[telefone];
    if (!clienteExistente || clienteExistente.historico.length === 0) {
      await enviarWhatsApp(telefone, "Ola! Me informe o servico e bairro que deseja atendimento");
      return res.status(200).send('OK');
    }
  }
  
  if (message.type !== 'text') {
    return res.status(200).send('OK');
  }
  
  const texto = message.text.body;
  
  // Inicializa cliente se novo
  if (!clientes[telefone]) {
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
      }
    };
  }
  
  const cliente = clientes[telefone];
  
  // Anti-loop temporal
  const agora = Date.now();
  if (cliente.ultimoTimestamp && (agora - cliente.ultimoTimestamp < 1500)) {
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
  const resposta = await processarMensagem(cliente, texto);
  
  if (resposta) {
    await enviarWhatsApp(telefone, resposta);
    cliente.historico.push({
      role: 'assistant',
      content: resposta,
      timestamp: new Date().toISOString()
    });
  }
  
  return res.status(200).send('OK');
}

// ============================================
// PROCESSAMENTO PRINCIPAL (FLUXO DETERMINISTICO)
// ============================================

async function processarMensagem(cliente, texto) {
  const t = texto.toLowerCase().trim();
  const dados = cliente.dados;
  
  // ========== RESPOSTAS DIRETAS (INDEPENDENTE DE ETAPA) ==========
  
  // Secao 1.2 - Identidade
  if (t.match(/(quem e voce|voce e robo|e humano|atendente|pessoa real|quem fala)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  // Secao 9.5 - Cliente grosseiro
  if (t.match(/(idiota|burro|inutil|merda|estupido|babaca|cacete|porra|caralho)/)) {
    return "Se precisar de atendimento para o servico que precisa, me avise";
  }
  
  // Secao 9.4 - Quer falar com técnico (nunca passa contato)
  if (t.match(/(falar com quem vai fazer|falar com o profissional|contato do tecnico|telefone do tecnico|falar direto com ele)/)) {
    return "Qual a sua duvida?";
  }
  
  // Secao 8.5 - Síndico/empresa
  if (t.match(/(sindico|condominio|empresa|predio|comercial|condominios)/)) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  // Secao 8.6 - Só material
  if (t.match(/(so material|apenas material|comprar material|venda de material|vende material)/)) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  // Secao 2.8 - Evasivo
  if (t.match(/(depois eu te falo|so queria saber preco|depois eu entro em contato|so tirei duvida)/)) {
    return "Se precisar de atendimento, pode entrar em contato";
  }
  
  // Secao 3.6 - Vou pensar
  if (t.match(/(vou pensar|volto depois|depois eu decido|vou analisar)/)) {
    return "Sempre que precisar, entre em contato";
  }
  
  // Secao 6.4 - Cancelamento
  if (t.match(/(desisti|cancela|quero cancelar|nao quero mais|desistir)/)) {
    return "Pode contar melhor o que houve?";
  }
  
  // Secao 9.1 - Comparar orçamentos
  if (t.match(/(comparar orcamentos|outras empresas|vou pesquisar|vou ver outro)/)) {
    return "Tudo bem, se quiser, pode enviar o orcamento de outra empresa para verificarmos se cobrimos.";
  }
  
  // Secao 9.2 - Caro demais
  if (t.match(/(caro demais|muito caro|nao tenho dinheiro|esta caro)/)) {
    return "Entendo que o valor e diferente do esperado. No entanto, nossos profissionais sao de confianca e de alta qualidade, prestando servicos a pessoas influentes. Apesar disso, os valores sao padrao da zona sul do Rio";
  }
  
  // Secao 9.3 - Não confia em pagar antes
  if (t.match(/(nao confio|pagar antes|dinheiro adiantado|nao pago antes)/)) {
    return "Entendo. A empresa e seria e preza pela qualidade e confianca nos servicos prestados. Gostaria de prosseguir com sinal de 50% e o restante no fim do servico?";
  }
  
  // Secao 9.6 - Pergunta técnica específica
  if (t.match(/(espessura|tipo de concreto|bitola|material especifico|marca de tinta|qualidade do)/)) {
    return "Entendo sua duvida, mas somente o profissional poderia responder. Irei encaminhar sua duvida";
  }
  
  // Secao 10.4 - Feedback pós-visita (se cliente mencionar)
  if (t.match(/(tecnico ja veio|profissional veio|ja foi a visita|visitou ontem)/)) {
    return "Ocorreu tudo bem na visita? O profissional entendeu o que precisa?";
  }
  
  // Secao 10.5 - Aprovação orçamento
  if (t.match(/(aprovo o orcamento|quero fazer o servico|vamos em frente|pode executar)/)) {
    return "Vou marcar o dia para realizacao do servico com o profissional e informar os dias e horarios disponiveis para marcar a realizacao do servico";
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
      return processarEtapaAgendado(cliente, t, texto);
      
    case 'AGUARDANDO_TECNICO':
      return "Um momento que irei verificar com o profissional";
      
    default:
      return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
}

// ============================================
// ETAPAS DO FLUXO
// ============================================

function processarEtapaInicio(cliente, t, texto) {
  const dados = cliente.dados;
  
  // Extrai serviço e bairro simultaneamente
  const extracao = extrairServicoEBairro(t, texto);
  
  // Se disse serviço + bairro de uma vez (Secao 2.5)
  if (extracao.servico && extracao.bairro) {
    dados.servico = extracao.servico;
    dados.bairro = extracao.bairro;
    calcularValor(dados);
    
    // Verifica se é múltiplo serviço (Secao 8.3)
    if (t.match(/(pintura.*eletrica|eletrica.*pintura|hidraulica.*eletrica|dois servicos|tres servicos)/)) {
      dados.multiploServico = true;
      return "Sera necessario o envio de dois profissionais independentes para a realizacao da visita. A taxa de cada visita e de R$180. Para quando gostaria de marcar?";
    }
    
    // Secao 8.4 - Obra grande
    if (t.match(/(construcao|reforma completa|casa toda|apartamento todo|obra grande)/)) {
      return "E necessario que o profissional va ao local para que seja realizado um orcamento preciso. A taxa da visita e de R$" + dados.valor + ". Para quando gostaria de atendimento?";
    }
    
    cliente.etapa = 'VALOR_APRESENTADO';
    return "Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$" + dados.valor + ", mas e abatido do valor final se o orcamento for aprovado.";
  }
  
  // Se só disse serviço (Secao 2.2, 2.3)
  if (extracao.servico && !extracao.bairro) {
    dados.servico = extracao.servico;
    cliente.etapa = 'AGUARDANDO_BAIRRO';
    return "Certo, qual o bairro que deseja atendimento?";
  }
  
  // Se só disse bairro (Secao 2.6)
  if (!extracao.servico && extracao.bairro) {
    dados.bairro = extracao.bairro;
    cliente.etapa = 'AGUARDANDO_SERVICO';
    return "Qual servico deseja?";
  }
  
  // Secao 2.7 - "Quanto custa?" antes de dizer o que precisa
  if (t.match(/(quanto custa|qual o preco|valor|quanto fica)/)) {
    return "A qual servico se refere? Nao posso dizer um valor exato, pois depende da visita tecnica de um profissional, mas posso enviar uma media de valores. Deseja?";
  }
  
  // Saudação inicial padrão (Secao 1.1)
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
  
  // Secao 3.3 - Questionamento do valor
  if (t.match(/(por que tem que pagar|por que pagar|para que serve|por que cobra)/)) {
    return "O valor se refere ao custo de deslocamento do profissional e analise tecnica. Caso o orcamento seja aprovado, o valor da visita e abatido do valor final. Assim, a vista sairia de graca";
  }
  
  // Secao 3.4 - Insiste em visita grátis
  if (t.match(/(nao vou pagar|orcamento gratis|visita gratis|gratuita|nao pago)/)) {
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
  
  // Secao 3.5 - Pedido de desconto
  if (t.match(/(desconto|faz mais barato|tem desconto|consegue abaixar)/)) {
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
  
  // Aceitação - vai para data
  if (t.match(/(pode ser|quando|data|horario|hoje|amanha|dias|esta semana|proxima semana|agendar|marcar)/)) {
    cliente.etapa = 'AGUARDANDO_DATA';
    return processarEtapaAguardandoData(cliente, t, texto);
  }
  
  // Não aceitou ainda
  return "Deseja agendar a visita tecnica?";
}

function processarEtapaAguardandoData(cliente, t, texto) {
  const dados = cliente.dados;
  const horaAtual = new Date().getHours();
  
  // Secao 4.7 - Urgência (prioridade máxima)
  if (t.match(/(urgente|vazando|vazamento|quebrou|emergencia|inundando|muito urgente)/)) {
    dados.urgente = true;
    
    // Se não tem bairro ainda, pergunta (mas deve ter)
    if (!dados.bairro) {
      return "Qual bairro deseja atendimento?";
    }
    
    // Vai direto verificar com técnico
    return iniciarVerificacaoTecnico(cliente, 'hoje');
  }
  
  // Secao 4.1 - Quer agendar para hoje
  if (t.match(/(hoje|hoje ainda|ainda hoje)/)) {
    // Secao 4.2 - Depois das 19h
    if (horaAtual >= 19) {
      return "Posso entrar em contato com o profissional amanha no primeiro horario. Deseja?";
    }
    return iniciarVerificacaoTecnico(cliente, 'hoje');
  }
  
  // Secao 4.3 - Amanhã de manhã
  if (t.match(/(amanha de manha|amanhã de manhã|amanha cedo|proximo dia util)/)) {
    cliente.etapa = 'AGUARDANDO_HORARIO';
    return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
  }
  
  // Secao 4.3 - Amanhã (sem especificar período)
  if (t.match(/(amanha|amanhã|proximo dia)/)) {
    return iniciarVerificacaoTecnico(cliente, 'amanha');
  }
  
  // Secao 4.4 - Qualquer dia
  if (t.match(/(qualquer dia|qualquer horario|tanto faz|o que tiver)/)) {
    return "Gostaria de atendimento para hoje?";
  }
  
  // Secao 4.5 - Horário específico sugerido
  const horarioDetectado = extrairHorario(texto);
  const dataDetectada = extrairData(t, texto);
  
  if (horarioDetectado || dataDetectada) {
    if (horarioDetectado) dados.hora = horarioDetectado;
    if (dataDetectada) dados.data = dataDetectada;
    
    return iniciarVerificacaoTecnico(cliente, dados.data || 'sugerido', dados.hora);
  }
  
  // Secao 4.6 - Indeciso
  if (t.match(/(nao sei|ainda nao sei|vou ver|depois te falo)/)) {
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
  
  // Se disse só "sim" ou período
  if (t.match(/(sim|pode ser|manha|tarde|noite)/)) {
    if (t.match(/manha/)) dados.hora = '10:00';
    else if (t.match(/tarde/)) dados.hora = '14:00';
    else dados.hora = '10:00';
    
    return iniciarVerificacaoTecnico(cliente, dados.data || 'amanha', dados.hora);
  }
  
  return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
}

function processarEtapaAguardandoEndereco(cliente, t, texto) {
  const dados = cliente.dados;
  
  // Secao 5.1 - Endereço completo detectado
  if (texto.length > 10 && (t.match(/(rua|av|avenida|estrada|travessa|r\.|alameda)/))) {
    dados.endereco = texto;
    cliente.etapa = 'CONFIRMAR_AGENDAMENTO';
    return `Pode marcar para ${dados.data} as ${dados.hora} com profissional ${dados.profissionalNome}?`;
  }
  
  // Secao 5.2 - Só rua sem número
  if ((t.match(/(rua|av|avenida)/)) && !t.match(/\d+/)) {
    return "Qual o numero? E casa ou apartamento?";
  }
  
  // Secao 5.4 - Não quer passar endereço antes
  if (t.match(/(nao vou passar|depois eu passo|confirmar primeiro|depois eu digo)/)) {
    return "Um momento que irei verificar a disponibilidade do profissional";
  }
  
  // Secao 5.3 - Endereço com erro (detectado por padrão simples)
  if (t.match(/(nao existe|errado|erro)/)) {
    return "Desculpe, acho que tem um erro de digitacao. Pode confirmar o endereco?";
  }
  
  return "Qual o endereco completo para a visita?";
}

function processarEtapaConfirmar(cliente, t, texto) {
  const dados = cliente.dados;
  
  // Confirmação positiva (Secao 6.2)
  if (t.match(/(sim|pode|confirmo|esta bom|ok|pode marcar|fechado)/)) {
    // Notifica técnico (Secao 7.1)
    notificarTecnicoConfirmado(cliente);
    dados.tecnicoNotificado = true;
    cliente.etapa = 'AGENDADO';
    
    // Agenda lembretes
    agendarLembretes(cliente);
    
    return "Perfeito, marcado!";
  }
  
  // Quer alterar (Secao 6.3)
  if (t.match(/(nao|mudar|alterar|outro dia|outro horario|remarcar)/)) {
    cliente.etapa = 'AGUARDANDO_DATA';
    return "Qual seria o dia mais proximo que teria disponibilidade?";
  }
  
  return `Posso confirmar: ${dados.servico} em ${dados.bairro}, dia ${dados.data} as ${dados.hora}, no endereco ${dados.endereco}. Esta correto?`;
}

function processarEtapaAgendado(cliente, t, texto) {
  const dados = cliente.dados;
  
  // Secao 6.3 - Alterar depois de confirmado
  if (t.match(/(mudar|alterar|remarcar|outro dia)/)) {
    cliente.etapa = 'AGUARDANDO_DATA';
    // Cancela lembretes anteriores
    cancelarLembretes(cliente);
    return "Qual seria o dia mais proximo que teria disponibilidade?";
  }
  
  // Secao 7.6 - Técnico quer antecipar (simulado se cliente menciona)
  if (t.match(/(pode ser mais cedo|pode antecipar|tem horario antes)/)) {
    return `O tecnico poderia ir ao local mais cedo. Gostaria de antecipar?`;
  }
  
  return "Visita confirmada. Se precisar de algo mais, e so chamar.";
}

// ============================================
// COMUNICAÇÃO COM TÉCNICOS
// ============================================

function iniciarVerificacaoTecnico(cliente, data, hora = null) {
  const dados = cliente.dados;
  dados.data = data;
  if (hora) dados.hora = hora;
  
  cliente.etapa = 'AGUARDANDO_TECNICO';
  
  // Determina técnico baseado no serviço
  let numeroTecnico;
  if (dados.servico?.match(/(marcenaria|movel|armario|marceneiro)/)) {
    numeroTecnico = CONFIG.tecnicos.marcenaria;
    dados.profissionalNome = "Tecnico de Marcenaria";
  } else if (dados.servico?.match(/(hidraulica|encanamento|vazamento|pia|banheiro|cano)/)) {
    numeroTecnico = CONFIG.tecnicos.hidraulica;
    dados.profissionalNome = "Tecnico Hidraulico";
  } else if (dados.servico?.match(/(eletrica|eletricista|fio|tomada|disjuntor|luz)/)) {
    numeroTecnico = CONFIG.tecnicos.eletrica;
    dados.profissionalNome = "Tecnico Eletricista";
  } else {
    numeroTecnico = CONFIG.tecnicos.reforma;
    dados.profissionalNome = "Tecnico de Reformas";
  }
  
  // Salva referência para aguardar resposta
  const idAgendamento = `${cliente.telefone}_${Date.now()}`;
  agendamentosPendentes[idAgendamento] = {
    cliente: cliente,
    tecnico: numeroTecnico,
    timestamp: Date.now()
  };
  
  // Envia mensagem ao técnico (tom natural, indistinguível)
  const msgTecnico = `Bom dia! Tem disponibilidade para visita de ${dados.servico} em ${dados.bairro} ${data}${hora ? ' as ' + hora : ''}? Cliente: ${cliente.nome}, Tel: ${cliente.telefone}.`;
  
  enviarWhatsApp(numeroTecnico, msgTecnico);
  
  // Configura timeout de 5 minutos (Secao 12.3)
  setTimeout(() => {
    verificarTimeoutTecnico(idAgendamento);
  }, CONFIG.timeoutTecnico);
  
  return "Um momento que irei verificar com o profissional";
}

async function processarRespostaTecnico(telefoneTecnico, message, res) {
  const texto = message.text?.body || '';
  const t = texto.toLowerCase();
  
  console.log(`🔧 TÉCNICO ${telefoneTecnico}: ${texto}`);
  
  // Encontra agendamento pendente para este técnico
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
    console.log('Nenhum agendamento pendente para este técnico');
    
    // Secao 7.6 - Técnico quer antecipar visita (não solicitado)
    if (t.match(/(posso ir agora|terminei cedo|posso antecipar|to livre agora)/)) {
      // Notifica no Telegram para humano decidir
      enviarTelegram(`⚡ Técnico ${telefoneTecnico} quer antecipar visita: "${texto}"`);
    }
    
    return res.status(200).send('OK');
  }
  
  const cliente = agendamento.cliente;
  const dados = cliente.dados;
  
  // Remove dos pendentes
  delete agendamentosPendentes[idAgendamento];
  
  // INTERPRETAÇÃO FLEXÍVEL DAS RESPOSTAS (considerando abreviações)
  
  // Resposta positiva
  if (t.match(/(posso|sim|confirmo|to livre|tenho disponibilidade|ok|beleza|show|fechado)/)) {
    dados.visitaConfirmada = true;
    cliente.etapa = 'AGUARDANDO_ENDERECO';
    
    // Secao 7.2 - Confirma com cliente
    enviarWhatsApp(cliente.telefone, 
      `Visita confirmada para ${dados.data}${dados.hora ? ', as ' + dados.hora : ''}, com o profissional ${dados.profissionalNome}. Qual o endereco completo?`);
    
    return res.status(200).send('OK');
  }
  
  // Resposta negativa - pergunta alternativa
  if (t.match(/(nao posso|nao consigo|to ocupado|nao to livre|impossivel|nao)/)) {
    // Pergunta ao técnico quando pode
    enviarWhatsApp(telefoneTecnico, "Qual o dia e horario mais proximo que voce teria disponibilidade?");
    
    // Mantém em espera, aguardando nova sugestão do técnico
    // Cria novo agendamento pendente para a resposta
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
  
  // Técnico sugere data/hora alternativa
  const novaData = extrairData(t, texto);
  const novoHorario = extrairHorario(texto);
  
  if (novaData || novoHorario || t.match(/(posso|consigo)/)) {
    if (novaData) dados.data = novaData;
    if (novoHorario) dados.hora = novoHorario;
    
    dados.visitaConfirmada = true;
    cliente.etapa = 'AGUARDANDO_ENDERECO';
    
    // Repassa ao cliente (linguajar formal, não pergunta "serve")
    enviarWhatsApp(cliente.telefone, 
      `O tecnico podera realizar a visita ${dados.data}${dados.hora ? ' as ' + dados.hora : ''}. Confirmo o agendamento?`);
    
    return res.status(200).send('OK');
  }
  
  // Não entendeu a resposta - notifica humano
  enviarTelegram(`❓ Resposta do técnico não reconhecida. Cliente: ${cliente.nome}, Técnico: ${telefoneTecnico}, Resposta: "${texto}"`);
  
  return res.status(200).send('OK');
}

async function verificarTimeoutTecnico(idAgendamento) {
  const ag = agendamentosPendentes[idAgendamento];
  if (!ag) return; // Já foi processado
  
  const cliente = ag.cliente;
  const dados = cliente.dados;
  
  // Remove dos pendentes
  delete agendamentosPendentes[idAgendamento];
  
  // Tenta outro técnico se disponível
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
    // Tenta com outro técnico
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
  
  // Sem técnicos disponíveis - ALERTA TELEGRAM (Secao 12.3)
  enviarTelegram(`🚨 URGENTE: Nenhum técnico respondeu em 5 min.
Cliente: ${cliente.nome} (${cliente.telefone})
Serviço: ${dados.servico}
Bairro: ${dados.bairro}
Data solicitada: ${dados.data} ${dados.hora || ''}
Técnicos tentados: ${tecnicosTentados.join(', ')}

AÇÃO NECESSÁRIA: Ligar para o cliente e confirmar manualmente.`);
  
  // Notifica cliente de delay (opcional, aguarda humano agir primeiro)
  // enviarWhatsApp(cliente.telefone, "Estamos verificando a melhor disponibilidade com nossos profissionais. Retornaremos em breve.");
}

function notificarTecnicoConfirmado(cliente) {
  const dados = cliente.dados;
  
  // Determina técnico correto
  let numeroTecnico = dados.numeroTecnicoNotificado;
  if (!numeroTecnico) {
    if (dados.servico?.match(/(marcenaria|movel|armario)/)) {
      numeroTecnico = CONFIG.tecnicos.marcenaria;
    } else if (dados.servico?.match(/(hidraulica|encanamento|vazamento)/)) {
      numeroTecnico = CONFIG.tecnicos.hidraulica;
    } else if (dados.servico?.match(/(eletrica|eletricista)/)) {
      numeroTecnico = CONFIG.tecnicos.eletrica;
    } else {
      numeroTecnico = CONFIG.tecnicos.reforma;
    }
  }
  
  // Secao 7.1 - Texto exato
  const msg = `Visita de ${dados.servico} marcada. Endereco ${dados.endereco}, Cliente ${cliente.nome}, dia ${dados.data}, as ${dados.hora}.`;
  
  enviarWhatsApp(numeroTecnico, msg);
  
  // Envia foto se tiver (Secao 7.1)
  // if (dados.foto) enviarWhatsAppMedia(numeroTecnico, dados.foto);
  
  console.log(`📤 NOTIFICADO TÉCNICO ${numeroTecnico}: ${msg}`);
}

// ============================================
// LEMBRETES AUTOMÁTICOS (Secao 10)
// ============================================

function agendarLembretes(cliente) {
  const dados = cliente.dados;
  
  // Parse data/hora para timestamp (simplificado)
  // Na prática, usar biblioteca como date-fns ou moment
  
  // Lembrete 24h antes (Secao 10.1) - simulado
  // Implementar com agendamento externo (Vercel Cron ou similar)
  
  // Lembrete 2h antes para técnico (Secao 10.2)
  setTimeout(() => {
    enviarLembreteTecnico(cliente);
  }, CONFIG.lembrete2h);
  
  // Lembrete 24h antes para cliente
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
  console.log(`⏰ LEMBRETE 2h TÉCNICO: ${msg}`);
}

function enviarLembreteCliente(cliente) {
  const dados = cliente.dados;
  const msg = `Ola, ${cliente.nome} lembrando da visita amanha as ${dados.hora} na ${dados.endereco}, posso confirmar?`;
  
  enviarWhatsApp(cliente.telefone, msg);
  console.log(`⏰ LEMBRETE 24h CLIENTE: ${msg}`);
}

function cancelarLembretes(cliente) {
  // Limpa timeouts (simplificado - na prática usar IDs de timeout)
  console.log(`❌ Lembretes cancelados para ${cliente.telefone}`);
}

// ============================================
// FUNÇÕES UTILITÁRIAS
// ============================================

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
  
  // Detecção especial: "pintura em Ipanema", "reforma na Tijuca"
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
  // Padrões: 14h, 14:00, 14h30, 14:30
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
  
  // Padrão DD/MM
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

// ============================================
// COMUNICAÇÃO EXTERNA
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 ENVIANDO para ${numero}:\n${texto}\n---`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ Variáveis WhatsApp não configuradas');
    return false;
  }
  
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
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
      console.error('❌ Erro WhatsApp:', data);
      return false;
    }
    
    return true;
    
  } catch (e) {
    console.error('❌ Exceção:', e.message);
    return false;
  }
}

async function enviarTelegram(mensagem) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram não configurado:', mensagem);
    return;
  }
  
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'HTML'
      })
    });
    console.log('📱 Telegram enviado');
  } catch (e) {
    console.error('❌ Erro Telegram:', e);
  }
}

// Relatório diário (Secao 12.5)
function enviarRelatorioDiario() {
  const hoje = new Date().toLocaleDateString('pt-BR');
  const stats = Object.values(clientes).filter(c => {
    const ultimo = new Date(c.ultimoTimestamp || 0);
    return ultimo.toLocaleDateString('pt-BR') === hoje;
  });
  
  const msg = `📊 RELATÓRIO RC REFORMAS - ${hoje}
Atendimentos hoje: ${stats.length}
Visitas agendadas: ${stats.filter(c => c.dados.tecnicoNotificado).length}
Pendentes: ${stats.filter(c => !c.dados.tecnicoNotificado && c.historico.length > 1).length}`;
  
  enviarTelegram(msg);
}

// Agenda relatório para 21h
const agora = new Date();
const horaRelatorio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 21, 0, 0);
const delayRelatorio = horaRelatorio - agora;
if (delayRelatorio > 0) {
  setTimeout(() => {
    enviarRelatorioDiario();
    // Repete a cada 24h
    setInterval(enviarRelatorioDiario, 24 * 60 * 60 * 1000);
  }, delayRelatorio);
}
