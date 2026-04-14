// ============================================
// RC ATENDIMENTO - IA HUMANIZADA SEM LOOPS
// ============================================

const CONFIG = {
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176'
  },
  
  precoZonaSul: 180,
  precoOutros: 220,
  
  bairrosZonaSul: ['ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 'sao conrado', 'vidigal', 'rocinha'],
  
  // Número da RC Reformas (para ignorar mensagens próprias)
  numeroRC: process.env.NUMERO_RC || '5521XXXXXXXX', // Coloque o número completo aqui
};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';

// Armazenamento em memória (em produção, usar Redis/DB)
const clientes = {};
const mensagensProcessadas = new Set(); // Evita processar mesmo ID 2x

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Verificação do webhook (Meta)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    // Processamento de mensagens recebidas
    if (req.method === 'POST') {
      return await receberMensagem(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('ERRO GERAL:', erro);
    return res.status(200).send('OK'); // Sempre retorna 200 para WhatsApp
  }
}

async function receberMensagem(req, res) {
  const body = req.body;
  
  // Validação básica
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  
  // IGNORAR: Status de mensagem (delivery, read, sent) - causa de loops
  if (changes?.statuses) {
    console.log('📊 Status recebido (ignorado):', changes.statuses[0]?.status);
    return res.status(200).send('OK');
  }
  
  // IGNORAR: Mensagens de sistema ou próprias
  const message = changes?.messages?.[0];
  if (!message) {
    return res.status(200).send('OK');
  }
  
  // PROTEÇÃO 1: Ignorar se não tiver ID único
  if (!message.id) {
    return res.status(200).send('OK');
  }
  
  // PROTEÇÃO 2: Nunca processar mesmo ID 2x (duplicatas do Meta)
  if (mensagensProcessadas.has(message.id)) {
    console.log('♻️ Mensagem duplicada ignorada:', message.id);
    return res.status(200).send('OK');
  }
  mensagensProcessadas.add(message.id);
  
  // Limite de memória (evita crescimento infinito)
  if (mensagensProcessadas.size > 1000) {
    mensagensProcessadas.clear();
  }
  
  const telefone = message.from;
  
  // PROTEÇÃO 3: Ignorar mensagens do próprio número da RC Reformas
  if (telefone === CONFIG.numeroRC || telefone === WHATSAPP_PHONE_ID) {
    console.log('🤖 Mensagem própria ignorada');
    return res.status(200).send('OK');
  }
  
  // PROTEÇÃO 4: Ignorar números dos técnicos (eles só recebem, não iniciam)
  const numerosTecnicos = Object.values(CONFIG.tecnicos);
  if (numerosTecnicos.includes(telefone)) {
    console.log('🔧 Mensagem de técnico recebida - processar como resposta');
    return await processarRespostaTecnico(message, res);
  }
  
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // SEÇÃO 1.4 - Áudio não suportado
  if (message.type === 'audio') {
    await enviarWhatsApp(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // SEÇÃO 1.3 - Foto sem texto (início de conversa)
  if (message.type === 'image' && !message.caption) {
    const clienteExistente = clientes[telefone];
    if (!clienteExistente || clienteExistente.historico.length === 0) {
      await enviarWhatsApp(telefone, "Ola! Me informe o servico e bairro que deseja atendimento");
      return res.status(200).send('OK');
    }
    // Se já tem conversa, segue fluxo normal (foto será encaminhada ao técnico depois)
  }
  
  // Só processa texto a partir daqui
  if (message.type !== 'text') {
    return res.status(200).send('OK');
  }
  
  const texto = message.text.body;
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Inicializa ou recupera cliente
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      etapa: 'inicio', // inicio, servico_coletado, bairro_coletado, valor_apresentado, aguardando_data, aguardando_endereco, confirmado
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
        aguardandoRespostaTecnico: false
      },
      ultimaResposta: null,
      timestampUltimaMensagem: Date.now()
    };
  }
  
  const cliente = clientes[telefone];
  
  // PROTEÇÃO 5: Anti-loop - se última mensagem foi há menos de 2 segundos e é igual, ignorar
  if (Date.now() - cliente.timestampUltimaMensagem < 2000 && 
      cliente.historico[cliente.historico.length - 1]?.content === texto) {
    console.log('⏱️ Mensagem repetida muito rápido, ignorada');
    return res.status(200).send('OK');
  }
  
  cliente.timestampUltimaMensagem = Date.now();
  cliente.historico.push({
    role: 'user',
    content: texto,
    timestamp: new Date().toISOString()
  });
  
  // Processa com IA (agora com controle de fluxo mais rigoroso)
  const resposta = await processarComIA(cliente, texto);
  
  if (resposta && resposta !== cliente.ultimaResposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      cliente.ultimaResposta = resposta;
      cliente.historico.push({
        role: 'assistant',
        content: resposta,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return res.status(200).send('OK');
}

async function processarComIA(cliente, texto) {
  const t = texto.toLowerCase().trim();
  const horaAtual = new Date().getHours();
  const dados = cliente.dados;
  
  // ========== RESPOSTAS IMEDIATAS (FLUXO DIRETO) ==========
  
  // SEÇÃO 1.2 - Identidade
  if (t.includes('quem e voce') || t.includes('voce e robo') || t.includes('e humano') || t.includes('atendente') || t.includes('pessoa')) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  // SEÇÃO 9.5 - Cliente grosseiro
  if (t.match(/(idiota|burro|inutil|merda|odio|raiva|estupido|babaca)/)) {
    return "Se precisar de atendimento para o servico que precisa, me avise";
  }
  
  // SEÇÃO 9.4 - Quer falar com técnico (nunca passa contato)
  if (t.includes('falar com quem vai fazer') || t.includes('falar com o profissional') || t.includes('contato do tecnico') || t.includes('telefone do tecnico')) {
    return "Qual a sua duvida?";
  }
  
  // SEÇÃO 8.5 - Síndico/empresa
  if (t.includes('sindico') || t.includes('condominio') || t.includes('empresa') || t.includes('predio') || t.includes('comercial')) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  // SEÇÃO 8.6 - Só material
  if (t.includes('so material') || t.includes('apenas material') || t.includes('comprar material') || t.includes('venda de material')) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  // SEÇÃO 2.8 - Evasivo
  if (t.includes('depois eu te falo') || t.includes('so queria saber preco') || t.includes('depois eu entro em contato')) {
    return "Se precisar de atendimento, pode entrar em contato";
  }
  
  // SEÇÃO 3.6 - Vou pensar
  if (t.includes('vou pensar') || t.includes('volto depois') || t.includes('depois eu decido')) {
    return "Sempre que precisar, entre em contato";
  }
  
  // SEÇÃO 6.4 - Cancelamento
  if (t.includes('desisti') || t.includes('cancela') || t.includes('quero cancelar')) {
    return "Pode contar melhor o que houve?";
  }
  
  // ========== FLUXO DE COLETA DE DADOS ==========
  
  // ETAPA 1: INÍCIO - Coletar saudação e identificar serviço+bairro
  if (cliente.etapa === 'inicio') {
    // Se já disse serviço E bairro de uma vez (ex: "pintura em Ipanema")
    const servicoBairro = extrairServicoEBairro(texto);
    
    if (servicoBairro.servico && servicoBairro.bairro) {
      dados.servico = servicoBairro.servico;
      dados.bairro = servicoBairro.bairro;
      calcularValor(dados);
      cliente.etapa = 'valor_apresentado';
      
      // SEÇÃO 2.5 e 3.1/3.2 - Resposta completa com valor
      const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
        dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
      );
      const valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
      
      return `Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$${valor}, mas e abatido do valor final se o orcamento for aprovado.`;
    }
    
    // Se só disse serviço
    if (servicoBairro.servico && !dados.servico) {
      dados.servico = servicoBairro.servico;
      cliente.etapa = 'servico_coletado';
      return "Certo, qual o bairro que deseja atendimento?";
    }
    
    // Se só disde bairro
    if (servicoBairro.bairro && !dados.bairro) {
      dados.bairro = servicoBairro.bairro;
      cliente.etapa = 'bairro_coletado';
      return "Qual servico deseja?";
    }
    
    // Saudação inicial (primeira mensagem não identificada)
    return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
  
  // ETAPA 2: Já tem serviço, precisa do bairro
  if (cliente.etapa === 'servico_coletado' && !dados.bairro) {
    const bairro = extrairBairro(texto);
    if (bairro) {
      dados.bairro = bairro;
      calcularValor(dados);
      cliente.etapa = 'valor_apresentado';
      
      const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
        bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
      );
      const valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
      
      return `Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$${valor}, mas e abatido do valor final caso o orcamento seja aprovado.`;
    }
    return "Certo, qual o bairro que deseja atendimento?";
  }
  
  // ETAPA 3: Já tem bairro, precisa do serviço
  if (cliente.etapa === 'bairro_coletado' && !dados.servico) {
    const servico = extrairServico(texto);
    if (servico) {
      dados.servico = servico;
      calcularValor(dados);
      cliente.etapa = 'valor_apresentado';
      
      const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
        dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
      );
      const valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
      
      return `Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$${valor}, mas e abatido do valor final caso o orcamento seja aprovado.`;
    }
    return "Qual servico deseja?";
  }
  
  // ETAPA 4: Valor apresentado, aguardando aceitação ou data
  if (cliente.etapa === 'valor_apresentado') {
    // SEÇÃO 3.3 - Questionamento do valor da visita
    if (t.includes('por que tem que pagar') || t.includes('por que pagar') || t.includes('para que serve a visita')) {
      return "O valor se refere ao custo de deslocamento do profissional e analise tecnica. Caso o orcamento seja aprovado, o valor da visita e abatido do valor final. Assim, a vista sairia de graca";
    }
    
    // SEÇÃO 3.4 - Insiste em visita grátis
    if (t.includes('nao vou pagar') || t.includes('orçamento gratis') || t.includes('orcamento gratis') || t.includes('visita gratis') || t.includes('visita gratuita')) {
      const isBotafogo = dados.bairro?.toLowerCase().includes('botafogo');
      const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
        dados.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
      );
      
      if (isBotafogo) {
        dados.valor = 0;
        cliente.etapa = 'aguardando_data';
        return "Como uma excecao, a visita pode ser realizada sem cobranca. Para quando gostaria de agendar?";
      } else if (isZonaSul) {
        return "A visita pode ser realizada pela metade do valor. Deseja prosseguir?";
      } else {
        return "Entendo, mas infelizmente a taxa da visita precisa ser seguida";
      }
    }
    
    // SEÇÃO 3.5 - Pedido de desconto
    if (t.includes('desconto') || t.includes('tem desconto') || t.includes('faz mais barato')) {
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
    
    // Aceitação implícita (perguntando data)
    if (t.includes('pode ser') || t.includes('quando') || t.includes('data') || t.includes('horario') || t.includes('hoje') || t.includes('amanha') || t.includes('esta semana')) {
      cliente.etapa = 'aguardando_data';
      // Segue para lógica de data abaixo
    } else {
      // Ainda não aceitou, pergunta se quer agendar
      return "Deseja agendar a visita tecnica?";
    }
  }
  
  // ETAPA 5: Aguardando data e horário
  if (cliente.etapa === 'aguardando_data') {
    // SEÇÃO 4.7 - Urgência
    if (t.includes('urgente') || t.includes('vazando') || t.includes('vazamento') || t.includes('quebrou') || t.includes('emergencia')) {
      dados.urgente = true;
      // Não pergunta bairro de novo se já tem
      if (!dados.bairro) {
        return "Qual bairro deseja atendimento?";
      }
    }
    
    // SEÇÃO 4.1 - Quer agendar para hoje
    if (t.includes('hoje')) {
      const horaAtual = new Date().getHours();
      
      // SEÇÃO 4.2 - Depois das 19h
      if (horaAtual >= 19) {
        return "Posso entrar em contato com o profissional amanha no primeiro horario. Deseja?";
      }
      
      // Verifica disponibilidade com técnico
      return await verificarDisponibilidadeTecnico(cliente, 'hoje');
    }
    
    // SEÇÃO 4.3 - Amanhã de manhã
    if (t.includes('amanha') || t.includes('amanhã')) {
      if (t.includes('manha') || t.includes('manhã')) {
        return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
      }
      return await verificarDisponibilidadeTecnico(cliente, 'amanha');
    }
    
    // SEÇÃO 4.4 - Qualquer dia
    if (t.includes('qualquer dia') || t.includes('qualquer horario') || t.includes('tanto faz')) {
      return "Gostaria de atendimento para hoje?";
    }
    
    // SEÇÃO 4.5 - Horário específico sugerido
    const horarioDetectado = extrairHorario(texto);
    if (horarioDetectado) {
      dados.hora = horarioDetectado;
      // Extrair data se tiver
      const dataDetectada = extrairData(texto);
      if (dataDetectada) {
        dados.data = dataDetectada;
      }
      return await verificarDisponibilidadeTecnico(cliente, dados.data || 'sugerido', dados.hora);
    }
    
    // SEÇÃO 4.6 - Indeciso
    if (t.includes('nao sei') || t.includes('ainda nao sei') || t.includes('vou ver')) {
      return "Gostaria de atendimento para hoje?";
    }
    
    return "Para quando gostaria de agendar?";
  }
  
  // ETAPA 6: Aguardando endereço
  if (cliente.etapa === 'aguardando_endereco') {
    // SEÇÃO 5.1 - Endereço completo
    if (texto.length > 10 && (t.includes('rua') || t.includes('av') || t.includes('avenida') || t.includes('r.'))) {
      dados.endereco = texto;
      
      // SEÇÃO 6.1 - Confirmação antes de notificar técnico
      cliente.etapa = 'confirmar_agendamento';
      return `Pode marcar para ${dados.data} as ${dados.hora} com profissional ${dados.profissionalNome}?`;
    }
    
    // SEÇÃO 5.2 - Só rua sem número
    if ((t.includes('rua') || t.includes('av')) && !t.match(/\d+/)) {
      return "Qual o numero? E casa ou apartamento?";
    }
    
    // SEÇÃO 5.4 - Não quer passar endereço antes
    if (t.includes('nao vou passar') || t.includes('depois eu passo') || t.includes('confirmar primeiro')) {
      return "Um momento que irei verificar a disponibilidade do profissional";
    }
    
    return "Qual o endereco completo para a visita?";
  }
  
  // ETAPA 7: Confirmar agendamento
  if (cliente.etapa === 'confirmar_agendamento') {
    if (t.includes('sim') || t.includes('pode') || t.includes('confirmo') || t.includes('esta bom') || t.includes('ok')) {
      // SEÇÃO 6.2 - Confirmado
      await notificarTecnico(cliente);
      dados.tecnicoNotificado = true;
      cliente.etapa = 'agendado';
      return "Perfeito, marcado!";
    }
    
    if (t.includes('nao') || t.includes('mudar') || t.includes('alterar') || t.includes('outro dia')) {
      // SEÇÃO 6.3 - Alterar data
      cliente.etapa = 'aguardando_data';
      return "Qual seria o dia mais proximo que teria disponibilidade?";
    }
    
    return `Posso confirmar: ${dados.servico} em ${dados.bairro}, dia ${dados.data} as ${dados.hora}, no endereco ${dados.endereco}. Esta correto?`;
  }
  
  // ETAPA 8: Já agendado - pós confirmação
  if (cliente.etapa === 'agendado') {
    // SEÇÃO 6.3 - Alterar depois de confirmado
    if (t.includes('mudar') || t.includes('alterar') || t.includes('remarcar')) {
      return "Qual seria o dia mais proximo que teria disponibilidade?";
    }
    
    // SEÇÃO 10.4 - Feedback pós-visita (se cliente mencionar que visita já ocorreu)
    if (t.includes('ja foi') || t.includes('tecnico veio') || t.includes('profissional veio') || t.includes('visitou')) {
      return "Ocorreu tudo bem na visita? O profissional entendeu o que precisa?";
    }
    
    return "Visita ja confirmada. Se precisar de algo mais, e so chamar.";
  }
  
  // Fallback para IA Groq se não encaixou em nenhuma regra específica
  return await processarComGroq(cliente, texto);
}

// ========== FUNÇÕES AUXILIARES DE EXTRAÇÃO ==========

function extrairServicoEBairro(texto) {
  const t = texto.toLowerCase();
  const servicos = ['pintura', 'marcenaria', 'hidraulica', 'eletrica', 'reforma', 'azulejo', 'pedreiro', 'serralheria', 'gesso', 'drywall'];
  const bairros = [...CONFIG.bairrosZonaSul, 'tijuca', 'madureira', 'meier', 'vila isabel', 'engenho novo', 'cascadura', 'bens', 'jacarepagua', 'barra', 'recreio', 'santa cruz', 'campo grande', 'tanque'];
  
  let servicoEncontrado = null;
  let bairroEncontrado = null;
  
  for (let s of servicos) {
    if (t.includes(s)) {
      servicoEncontrado = s;
      break;
    }
  }
  
  for (let b of bairros) {
    if (t.includes(b)) {
      bairroEncontrado = b.charAt(0).toUpperCase() + b.slice(1);
      break;
    }
  }
  
  return { servico: servicoEncontrado, bairro: bairroEncontrado };
}

function extrairServico(texto) {
  return extrairServicoEBairro(texto).servico;
}

function extrairBairro(texto) {
  return extrairServicoEBairro(texto).bairro;
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

function extrairData(texto) {
  const t = texto.toLowerCase();
  if (t.includes('hoje')) return 'hoje';
  if (t.includes('amanha') || t.includes('amanhã')) return 'amanha';
  
  const match = texto.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return null;
}

function calcularValor(dados) {
  if (!dados.bairro) return;
  
  const bairroNormalizado = dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isZonaSul = CONFIG.bairrosZonaSul.some(b => bairroNormalizado.includes(b));
  dados.valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
  
  // Define nome do profissional baseado no serviço
  if (dados.servico) {
    if (dados.servico.includes('marcenaria') || dados.servico.includes('movel') || dados.servico.includes('armario')) {
      dados.profissionalNome = "Tecnico de Marcenaria";
    } else if (dados.servico.includes('hidraulica') || dados.servico.includes('encanamento') || dados.servico.includes('vazamento')) {
      dados.profissionalNome = "Tecnico Hidraulico";
    } else {
      dados.profissionalNome = "Tecnico de Reformas";
    }
  }
}

// ========== COMUNICAÇÃO COM TÉCNICO ==========

async function verificarDisponibilidadeTecnico(cliente, data, hora = null) {
  const dados = cliente.dados;
  dados.data = data;
  if (hora) dados.hora = hora;
  
  // Define qual técnico
  let numeroTecnico;
  if (dados.servico?.includes('marcenaria')) {
    numeroTecnico = CONFIG.tecnicos.marcenaria;
  } else if (dados.servico?.includes('hidraulica')) {
    numeroTecnico = CONFIG.tecnicos.hidraulica;
  } else {
    numeroTecnico = CONFIG.tecnicos.reforma;
  }
  
  // Marca que está aguardando resposta do técnico
  cliente.dados.aguardandoRespostaTecnico = true;
  cliente.dados.numeroTecnico = numeroTecnico;
  
  // Mensagem natural para o técnico (indistinguível de humano)
  const msgTecnico = `Bom dia! Tem disponibilidade para visita de ${dados.servico} em ${dados.bairro} ${data}${hora ? ' as ' + hora : ''}? Cliente: ${cliente.nome}, Tel: ${cliente.telefone}.`;
  
  await enviarWhatsApp(numeroTecnico, msgTecnico);
  
  // Resposta para cliente enquanto aguarda
  return "Um momento que irei verificar com o profissional";
}

async function processarRespostaTecnico(message, res) {
  const telefoneTecnico = message.from;
  const texto = message.text?.body || '';
  const t = texto.toLowerCase();
  
  console.log(`🔧 Resposta do técnico ${telefoneTecnico}: ${texto}`);
  
  // Encontra qual cliente está aguardando este técnico
  let clienteAguardando = null;
  for (let tel in clientes) {
    if (clientes[tel].dados.aguardandoRespostaTecnico && 
        clientes[tel].dados.numeroTecnico === telefoneTecnico) {
      clienteAguardando = clientes[tel];
      break;
    }
  }
  
  if (!clienteAguardando) {
    console.log('Nenhum cliente aguardando este técnico');
    return res.status(200).send('OK');
  }
  
  const dados = clienteAguardando.dados;
  
  // Interpreta resposta do técnico
  if (t.includes('posso') || t.includes('sim') || t.includes('tenho disponibilidade') || t.includes('confirmo')) {
    // Técnico confirmou
    dados.visitaConfirmada = true;
    dados.aguardandoRespostaTecnico = false;
    clienteAguardando.etapa = 'aguardando_endereco';
    
    // SEÇÃO 7.2 - Confirma com cliente
    await enviarWhatsApp(clienteAguardando.telefone, 
      `Visita confirmada para ${dados.data}${dados.hora ? ', as ' + dados.hora : ''}, com o profissional ${dados.profissionalNome}. Qual o endereco completo?`);
    
  } else if (t.includes('nao posso') || t.includes('nao tenho') || t.includes('ocupado') || t.includes('impossivel')) {
    // Técnico não pode - pergunta alternativa
    await enviarWhatsApp(telefoneTecnico, 
      `Qual o dia e horario mais proximo que voce teria disponibilidade?`);
    
    // Não notifica cliente ainda, aguarda técnico sugerir alternativa
    
  } else if (t.match(/\d{1,2}\/\d{1,2}/) || t.match(/\d{1,2}h/) || t.includes('posso')) {
    // Técnico sugeriu data/hora alternativa
    const novaData = extrairData(texto) || dados.data;
    const novoHorario = extrairHorario(texto);
    
    dados.data = novaData;
    if (novoHorario) dados.hora = novoHorario;
    dados.visitaConfirmada = true;
    dados.aguardandoRespostaTecnico = false;
    clienteAguardando.etapa = 'aguardando_endereco';
    
    // Repassa ao cliente
    await enviarWhatsApp(clienteAguardando.telefone, 
      `O tecnico pode ${novaData}${novoHorario ? ' as ' + novoHorario : ''}. Serve para voce?`);
  }
  
  return res.status(200).send('OK');
}

async function notificarTecnico(cliente) {
  const dados = cliente.dados;
  const numeroTecnico = dados.numeroTecnico || CONFIG.tecnicos.reforma;
  
  // SEÇÃO 7.1 - Texto exato
  const msg = `Visita de ${dados.servico} marcada. Endereco ${dados.endereco}, Cliente ${cliente.nome}, dia ${dados.data}, as ${dados.hora}.`;
  
  console.log(`📤 Notificando técnico ${numeroTecnico}: ${msg}`);
  await enviarWhatsApp(numeroTecnico, msg);
}

// ========== FUNÇÕES GROQ (FALLBACK INTELIGENTE) ==========

async function processarComGroq(cliente, texto) {
  const historicoFormatado = cliente.historico.slice(-4).map(h => {
    return `${h.role === 'user' ? 'Cliente' : 'Atendimento'}: ${h.content}`;
  }).join('\n');
  
  const systemPrompt = `Voce e o Atendimento Digital da RC Reforma e Construcao. 
Tom: Profissional empatico, sem emojis, sem girias, linguagem natural.
Dados atuais: ${JSON.stringify(cliente.dados)}
Etapa: ${cliente.etapa}

Responda como atendente humano da RC Reformas. Seja natural, direto, sem repetições.`;
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texto }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });
    
    if (!response.ok) throw new Error('Erro Groq');
    
    const data = await response.json();
    return data.choices[0].message.content;
    
  } catch (e) {
    console.error('Erro Groq:', e);
    return "Entendi. Me confirme o servico e bairro para prosseguirmos?";
  }
}

// ========== UTILIDADES WHATSAPP ==========

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
      console.error('❌ Erro WhatsApp API:', data);
      return false;
    }
    
    return true;
    
  } catch (e) {
    console.error('❌ Exceção WhatsApp:', e.message);
    return false;
  }
}
