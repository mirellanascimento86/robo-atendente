// ============================================
// ATENDIMENTO DIGITAL RC - VERSÃO HUMANA 1.0
// Sem IA - Todas respostas predefinidas baseadas nas suas instruções
// ============================================

const CONFIG = {
  // Técnicos
  tecnicos: {
    marcenaria: {
      nome: 'Técnico Marcenaria',
      whatsapp: '5521978791765'
    },
    reforma: {
      nome: 'Técnico Reformas',
      whatsapp: '5521968112176'
    },
    hidraulica: {
      nome: 'Técnico Hidráulica',
      whatsapp: '5521968112176'
    }
  },
  
  // Preços
  precoZonaSul: 180,
  precoOutros: 220,
  precoDescontoZonaSul: 90, // 50%
  
  // Bairros Zona Sul
  bairrosZonaSul: ['ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 'sao conrado', 'vidigal', 'rocinha'],
  
  // Botafogo tem tratamento especial
  bairroEspecial: 'botafogo'
};

// Variáveis de ambiente
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

// Memória de clientes
const clientes = {};
const agendamentosPendentes = {}; // Aguardando confirmação do técnico
const visitasConfirmadas = {}; // Já confirmadas

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Webhook verification
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    // Receber mensagem
    if (req.method === 'POST' && !req.query.acao) {
      return await receberMensagem(req, res);
    }
    
    // Ações do painel admin
    if (req.method === 'POST' && req.query.acao) {
      return await acaoPainel(req, res, req.query.acao);
    }
    
    // Listar conversas
    if (req.method === 'GET' && req.query.acao === 'listar') {
      const lista = Object.keys(clientes).map(tel => ({
        telefone: tel,
        nome: clientes[tel].nome,
        etapa: clientes[tel].etapa,
        ultimaAtividade: clientes[tel].ultimaAtividade
      }));
      return res.json(lista);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('ERRO:', erro);
    return res.status(200).send('OK');
  }
}

// ============================================
// RECEBER MENSAGEM DO CLIENTE
// ============================================

async function receberMensagem(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') {
    // Se for imagem no momento certo, encaminha ao técnico
    if (message && message.type === 'image' && message.image) {
      const telefone = message.from;
      if (clientes[telefone] && clientes[telefone].etapa === 'aguardando_tecnico') {
        await encaminharFotoAoTecnico(telefone, message.image.id, message.image.caption);
      }
    }
    return res.status(200).send('OK');
  }
  
  const telefone = message.from;
  const nome = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = message.text.body;
  
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Inicializa cliente se novo
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      etapa: 'inicio',
      dados: {
        servico: null,
        bairro: null,
        valor: null,
        data: null,
        hora: null,
        endereco: null,
        tecnico: null
      },
      ultimaAtividade: Date.now()
    };
  }
  
  const cliente = clientes[telefone];
  cliente.ultimaAtividade = Date.now();
  
  // Processa mensagem
  const resposta = await processarMensagem(cliente, texto);
  
  if (resposta) {
    await enviarWhatsApp(telefone, resposta);
  }
  
  return res.status(200).send('OK');
}

// ============================================
// PROCESSAR MENSAGEM (CÉREBRO DO ROBÔ)
// ============================================

async function processarMensagem(cliente, texto) {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  // ===== ETAPA 1: INÍCIO =====
  if (cliente.etapa === 'inicio') {
    // Saudação inicial
    if (['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'ei', 'hey', 'hi'].some(s => t.includes(s))) {
      return 'Olá! Me informe o serviço e bairro que deseja atendimento';
    }
    
    // Quem é você?
    if (['quem e', 'quem é', 'voce e', 'você é', 'é robo', 'é robô', 'humano', 'pessoa'].some(s => t.includes(s))) {
      return 'Sou o Atendimento Digital da RC Reforma e Construção';
    }
    
    // Áudio não suportado
    if (['audio', 'áudio', 'mensagem de voz', 'gravacao', 'gravação'].some(s => t.includes(s))) {
      return 'No momento eu não consigo ouvir, pode escrever?';
    }
    
    // Se já mandou serviço direto, vai para coleta
    const servicoDetectado = detectarServico(t);
    if (servicoDetectado) {
      cliente.dados.servico = servicoDetectado;
      cliente.etapa = 'coletando_bairro';
      
      // Se já mandou bairro junto
      const bairroDetectado = detectarBairro(texto);
      if (bairroDetectado) {
        cliente.dados.bairro = bairroDetectado;
        return apresentarValorVisita(cliente);
      }
      
      return 'Certo, qual o bairro que deseja atendimento?';
    }
    
    // Padrão: pede serviço e bairro
    return 'Olá! Me informe o serviço e bairro que deseja atendimento';
  }
  
  // ===== ETAPA 2: COLETANDO BAIRRO =====
  if (cliente.etapa === 'coletando_bairro') {
    const bairro = detectarBairro(texto) || extrairBairroDoTexto(texto);
    
    if (bairro) {
      cliente.dados.bairro = bairro;
      return apresentarValorVisita(cliente);
    }
    
    // Se ainda não detectou, pergunta de novo
    return 'Qual o bairro que deseja atendimento?';
  }
  
  // ===== ETAPA 3: APRESENTANDO VALOR =====
  if (cliente.etapa === 'apresentando_valor') {
    // Cliente aceita
    if (['ok', 'beleza', 'pode ser', 'vamos', 'marca', 'agenda', 'sim', 'quero', 'top', 'fechado'].some(s => t.includes(s))) {
      cliente.etapa = 'agendando_data';
      return 'Para quando gostaria de atendimento?';
    }
    
    // Cliente pergunta desconto
    if (['desconto', 'abaixa', 'diminui', 'faz por', 'melhor preco', 'melhor preço'].some(s => t.includes(s))) {
      return negociarDesconto(cliente);
    }
    
    // Cliente questiona valor da visita
    if (['por que', 'porque', 'tem que pagar', 'visit', 'custo', 'deslocamento'].some(s => t.includes(s))) {
      return 'O valor se refere ao custo de deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, o valor da visita é abatido do valor final. Assim, a visita sairia de graça';
    }
    
    // Cliente insiste em não pagar visita
    if (['nao vou pagar', 'não vou pagar', 'gratis', 'grátis', 'nao pago', 'não pago', 'orcamento gratuito', 'orçamento gratuito'].some(s => t.includes(s))) {
      return negociarGratis(cliente);
    }
    
    // Cliente quer orçamento sem visita (pintura)
    if (cliente.dados.servico === 'pintura' && ['sem visita', 'sem ir', 'por foto', 'online', 'remoto'].some(s => t.includes(s))) {
      cliente.etapa = 'orcamento_pintura_remoto';
      return 'Qual seria a metragem quadrada total e o tipo de tinta?';
    }
    
    // Cliente vai pensar
    if (['pensar', 'depois', 'volto', 'mais tarde', 'considerar'].some(s => t.includes(s))) {
      return 'Sempre que precisar, entre em contato';
    }
    
    // Pergunta valor do serviço (sem visita)
    if (['quanto custa', 'qual valor', 'preco do servico', 'preço do serviço'].some(s => t.includes(s))) {
      return 'A qual serviço se refere? Não posso dizer um valor exato, pois depende da visita técnica de um profissional, mas posso enviar uma média de valores. Deseja?';
    }
    
    // Padrão: reforça valor
    return apresentarValorVisita(cliente);
  }
  
  // ===== ETAPA 4: AGENDANDO DATA =====
  if (cliente.etapa === 'agendando_data') {
    // Detecta data
    const dataDetectada = detectarData(t);
    if (dataDetectada) {
      cliente.dados.data = dataDetectada;
      
      // Se já mandou hora junto
      const horaDetectada = detectarHora(t);
      if (horaDetectada) {
        cliente.dados.hora = horaDetectada;
        cliente.etapa = 'aguardando_tecnico';
        
        // Notifica técnico e vai para aguardar confirmação
        await notificarTecnicoDisponibilidade(cliente);
        return 'Um momento que irei verificar com o técnico';
      }
      
      cliente.etapa = 'agendando_hora';
      return 'Qual seria um bom horário? Entre 9:30h e 11:30h?';
    }
    
    // Cliente diz "hoje"
    if (t.includes('hoje')) {
      const horaAtual = new Date().getHours();
      if (horaAtual >= 19) {
        return 'Posso entrar em contato com o profissional amanhã no primeiro horário. Deseja?';
      }
      cliente.dados.data = 'hoje';
      return 'Qual seria um bom horário? Entre 9:30h e 11:30h?';
    }
    
    // Cliente diz "amanhã"
    if (t.includes('amanha') || t.includes('amanhã')) {
      cliente.dados.data = 'amanhã';
      return 'Qual seria um bom horário? Entre 9:30h e 11:30h?';
    }
    
    // Cliente é indeciso
    if (['qualquer dia', 'nao sei', 'não sei', 'depois eu vejo'].some(s => t.includes(s))) {
      return 'Gostaria de atendimento para hoje?';
    }
    
    return 'Para quando gostaria de atendimento?';
  }
  
  // ===== ETAPA 5: AGENDANDO HORA =====
  if (cliente.etapa === 'agendando_hora') {
    const hora = detectarHora(t);
    
    if (hora) {
      cliente.dados.hora = hora;
      cliente.etapa = 'aguardando_tecnico';
      
      // Notifica técnico
      await notificarTecnicoDisponibilidade(cliente);
      return 'Um momento que irei verificar com o profissional';
    }
    
    return 'Qual seria um bom horário? Entre 9:30h e 11:30h?';
  }
  
  // ===== ETAPA 6: AGUARDANDO CONFIRMAÇÃO DO TÉCNICO =====
  if (cliente.etapa === 'aguardando_tecnico') {
    // Cliente manda foto durante esta etapa
    if (['foto', 'imagem', 'mandei foto', 'enviei'].some(s => t.includes(s))) {
      return 'Perfeito, vou encaminhar ao técnico';
    }
    
    // Cliente pergunta algo enquanto aguarda
    return 'Um momento que irei contactar o profissional';
  }
  
  // ===== ETAPA 7: COLETANDO ENDEREÇO =====
  if (cliente.etapa === 'coletando_endereco') {
    // Detecta se é endereço completo
    if (t.includes('rua') || t.includes('av') || t.includes('avenida') || t.includes('numero') || t.includes('nº') || t.includes('apartamento') || t.includes('casa')) {
      cliente.dados.endereco = texto;
      cliente.etapa = 'confirmacao_final';
      return `Pode marcar para ${cliente.dados.data} às ${cliente.dados.hora} com o profissional?`;
    }
    
    // Só rua sem número
    if (!t.match(/\d+/)) {
      return 'Qual o número? É casa ou apartamento?';
    }
    
    return 'Pode me passar o endereço completo?';
  }
  
  // ===== ETAPA 8: CONFIRMAÇÃO FINAL =====
  if (cliente.etapa === 'confirmacao_final') {
    if (['sim', 'pode', 'marca', 'agenda', 'ok', 'fechado', 'confirmo'].some(s => t.includes(s))) {
      cliente.etapa = 'agendado';
      
      // Notifica técnico final
      await notificarTecnicoFinal(cliente);
      
      return 'Perfeito, marcado!';
    }
    
    if (['nao', 'não', 'cancela', 'desisti', 'mudei'].some(s => t.includes(s))) {
      return 'Pode contar melhor o que houve?';
    }
    
    return 'Pode marcar?';
  }
  
  // ===== ETAPA 9: AGENDADO =====
  if (cliente.etapa === 'agendado') {
    // Cliente quer alterar
    if (['alterar', 'mudar', 'mudanca', 'mudança', 'outro dia', 'outro horario'].some(s => t.includes(s))) {
      return 'Qual seria o dia mais próximo que teria disponibilidade?';
    }
    
    // Cliente cancela
    if (['cancela', 'desisti', 'nao quero', 'não quero'].some(s => t.includes(s))) {
      return 'Pode contar melhor o que houve?';
    }
    
    // Padrão
    return 'Se precisar de algo, só chamar';
  }
  
  // ===== ORÇAMENTO PINTURA REMOTO =====
  if (cliente.etapa === 'orcamento_pintura_remoto') {
    // Extrai metragem e tipo de tinta
    const metragem = texto.match(/(\d+)\s*m²?/i) || texto.match(/(\d+)\s*metros?/i);
    const tipoTinta = detectarTipoTinta(t);
    
    if (metragem) {
      cliente.dados.metragem = metragem[1];
    }
    if (tipoTinta) {
      cliente.dados.tipoTinta = tipoTinta;
    }
    
    if (cliente.dados.metragem && cliente.dados.tipoTinta) {
      const valor = calcularOrcamentoPintura(cliente.dados.metragem, cliente.dados.tipoTinta);
      return `Com base na metragem de ${cliente.dados.metragem}m² e tinta ${cliente.dados.tipoTinta}, o valor aproximado seria R$${valor}. Para precisão exata, recomendo uma visita técnica. Deseja agendar?`;
    }
    
    return 'Qual seria a metragem quadrada total e o tipo de tinta?';
  }
  
  // ===== URGÊNCIA =====
  if (['urgente', 'emergencia', 'emergência', 'vazamento', 'quebrou', 'estourou', 'caiu', 'perigo'].some(s => t.includes(s))) {
    const bairro = detectarBairro(t) || cliente.dados.bairro;
    if (bairro) {
      cliente.dados.bairro = bairro;
      return apresentarValorUrgencia(cliente);
    }
    return 'Qual bairro deseja atendimento?';
  }
  
  // ===== PAINEL ADMIN =====
  // Se for comando do admin (inicia com /)
  if (texto.startsWith('/')) {
    return processarComandoAdmin(cliente, texto);
  }
  
  // ===== DEFAULT =====
  return 'Olá! Me informe o serviço e bairro que deseja atendimento';
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function detectarServico(texto) {
  const servicos = {
    'pintura': ['pintura', 'pintar', 'tinta'],
    'reforma': ['reforma', 'reformar', 'construcao', 'construção'],
    'marcenaria': ['marcenaria', 'marceneiro', 'moveis', 'móveis', 'armario', 'armário', 'cozinha planejada', 'closet'],
    'gesso': ['gesso', 'forro', 'drywall', 'sanca'],
    'eletrica': ['eletrica', 'elétrica', 'eletricista', 'fiação', 'fiacao', 'tomada', 'disjuntor'],
    'hidraulica': ['hidraulica', 'hidráulica', 'encanamento', 'vazamento', 'cano', 'pia', 'banheiro', 'box'],
    'piso': ['piso', 'revestimento', 'porcelanato', 'azulejo', 'ceramica', 'cerâmica']
  };
  
  for (const [servico, palavras] of Object.entries(servicos)) {
    if (palavras.some(p => texto.includes(p))) {
      return servico;
    }
  }
  return null;
}

function detectarBairro(texto) {
  // Primeiro verifica se mencionou "bairro X"
  const match = texto.match(/bairro\s+([a-záàâãéêíóôõúç\s]+)/i);
  if (match) {
    return match[1].trim().toLowerCase();
  }
  
  // Depois verifica bairros conhecidos
  const bairros = [...CONFIG.bairrosZonaSul, 'tijuca', 'madureira', 'meier', 'méier', 'vila isabel', 'grajau', 'grajaú', 'jacarepagua', 'jacarepaguá', 'barra', 'recreio', 'campo grande', 'santa cruz'];
  
  for (const bairro of bairros) {
    if (texto.includes(bairro)) {
      return bairro;
    }
  }
  
  return null;
}

function extrairBairroDoTexto(texto) {
  // Procura palavra capitalizada que pode ser bairro
  const palavras = texto.split(/\s+/);
  for (const p of palavras) {
    if (/^[A-Z][a-z]{3,}$/.test(p)) {
      return p.toLowerCase();
    }
  }
  return null;
}

function apresentarValorVisita(cliente) {
  const bairro = cliente.dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isZonaSul = CONFIG.bairrosZonaSul.some(zs => bairro.includes(zs) || zs.includes(bairro));
  const isBotafogo = bairro.includes(CONFIG.bairroEspecial);
  
  let valor;
  if (isBotafogo) {
    valor = 0; // Especial: pode ser grátis
  } else if (isZonaSul) {
    valor = CONFIG.precoZonaSul;
  } else {
    valor = CONFIG.precoOutros;
  }
  
  cliente.dados.valor = valor;
  cliente.etapa = 'apresentando_valor';
  
  if (isBotafogo) {
    return 'Para oferecer um orçamento mais preciso, é necessário que um profissional realize uma visita técnica. Como uma exceção para o bairro Botafogo, a visita pode ser realizada sem cobrança. Deseja agendar?';
  }
  
  const regiao = isZonaSul ? 'Zona Sul' : 'sua região';
  return `Para oferecer um orçamento mais preciso, é necessário que um profissional realize uma visita técnica. O valor da visita é de R$${valor}, mas é abatido do valor final caso o orçamento seja aprovado. Deseja agendar?`;
}

function apresentarValorUrgencia(cliente) {
  // Urgência segue o mesmo valor, mas com prioridade
  return apresentarValorVisita(cliente);
}

function negociarDesconto(cliente) {
  const bairro = cliente.dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isBotafogo = bairro.includes(CONFIG.bairroEspecial);
  const isZonaSul = CONFIG.bairrosZonaSul.some(zs => bairro.includes(zs) || zs.includes(bairro));
  
  // Se já é Botafogo e grátis, não tem mais desconto
  if (isBotafogo && cliente.dados.valor === 0) {
    return 'Para o bairro Botafogo já estamos oferecendo a visita sem cobrança. Podemos agendar?';
  }
  
  if (isBotafogo) {
    cliente.dados.valor = 0;
    return 'Como uma exceção, posso oferecer a visita sem cobrança para o bairro Botafogo. Deseja agendar?';
  }
  
  if (isZonaSul) {
    cliente.dados.valor = CONFIG.precoDescontoZonaSul;
    return `Posso oferecer 50% de desconto na visita. Fica R$${cliente.dados.valor}. Podemos agendar?`;
  }
  
  return 'Entendo que o valor é diferente do esperado. No entanto, nossos profissionais são de confiança e de alta qualidade, prestando serviços a pessoas influentes. Apesar disso, os valores são padrão da zona sul do Rio. Deseja prosseguir?';
}

function negociarGratis(cliente) {
  const bairro = cliente.dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isBotafogo = bairro.includes(CONFIG.bairroEspecial);
  const isZonaSul = CONFIG.bairrosZonaSul.some(zs => bairro.includes(zs) || zs.includes(bairro));
  
  if (isBotafogo) {
    cliente.dados.valor = 0;
    return 'Como uma exceção, a visita pode ser realizada sem cobrança. Deseja agendar?';
  }
  
  if (isZonaSul) {
    cliente.dados.valor = CONFIG.precoDescontoZonaSul;
    return 'A visita pode ser realizada pela metade do valor. Podemos agendar?';
  }
  
  return 'Entendo, mas infelizmente a taxa da visita precisa ser seguida para outros bairros. Posso verificar disponibilidade para o próximo dia?';
}

function detectarData(texto) {
  if (texto.includes('hoje')) return 'hoje';
  if (texto.includes('amanha') || texto.includes('amanhã')) return 'amanhã';
  if (texto.includes('segunda')) return 'segunda-feira';
  if (texto.includes('terca') || texto.includes('terça')) return 'terça-feira';
  if (texto.includes('quarta')) return 'quarta-feira';
  if (texto.includes('quinta')) return 'quinta-feira';
  if (texto.includes('sexta')) return 'sexta-feira';
  if (texto.includes('sabado') || texto.includes('sábado')) return 'sábado';
  
  // Detecta data no formato DD/MM ou DD/MM/AA
  const match = texto.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (match) {
    return `${match[1]}/${match[2]}${match[3] ? '/' + match[3] : ''}`;
  }
  
  return null;
}

function detectarHora(texto) {
  const match = texto.match(/(\d{1,2})[h:](\d{2})?/);
  if (match) {
    return `${match[1]}:${match[2] || '00'}`;
  }
  return null;
}

function detectarTipoTinta(texto) {
  if (texto.includes('premium')) return 'premium';
  if (texto.includes('lavavel') || texto.includes('lavável')) return 'lavável';
  if (texto.includes('padrão') || texto.includes('padrao')) return 'padrão';
  if (texto.includes('externa') || texto.includes('externo')) return 'externa';
  if (texto.includes('interna') || texto.includes('interno')) return 'interna';
  return 'padrão';
}

function calcularOrcamentoPintura(metragem, tipo) {
  const m = parseInt(metragem) || 0;
  let valorM2 = 25; // Padrão
  
  if (tipo === 'premium') valorM2 = 45;
  if (tipo === 'lavável' || tipo === 'lavavel') valorM2 = 35;
  
  return m * valorM2;
}

// ============================================
// NOTIFICAÇÕES AOS TÉCNICOS
// ============================================

async function notificarTecnicoDisponibilidade(cliente) {
  const tecnico = escolherTecnico(cliente.dados.servico);
  cliente.dados.tecnico = tecnico;
  
  const mensagem = `Verificar disponibilidade:
  
Serviço: ${cliente.dados.servico}
Bairro: ${cliente.dados.bairro}
Data: ${cliente.dados.data}
Horário: ${cliente.dados.hora}
Cliente: ${cliente.nome}
Tel: ${cliente.telefone}

Responda:
- "Posso" para confirmar
- "Não posso, mas posso às XXh" para alternativa
- Ou outro horário disponível`;

  await enviarWhatsApp(tecnico.whatsapp, mensagem);
  await enviarTelegram(`🔄 Aguardando confirmação do técnico ${tecnico.nome} para ${cliente.nome} (${cliente.telefone})`);
  
  // Agenda lembrete em 5 minutos
  setTimeout(() => {
    verificarConfirmacaoTecnico(cliente);
  }, 5 * 60 * 1000);
}

async function notificarTecnicoFinal(cliente) {
  const tecnico = cliente.dados.tecnico || escolherTecnico(cliente.dados.servico);
  
  const mensagem = `Visita de ${cliente.dados.servico} marcada.
  
Endereço: ${cliente.dados.endereco}
Cliente: ${cliente.nome}
Tel: ${cliente.telefone}
Dia: ${cliente.dados.data}
Horário: ${cliente.dados.hora}
Valor: R$${cliente.dados.valor}`;

  await enviarWhatsApp(tecnico.whatsapp, mensagem);
  await enviarTelegram(`✅ Visita confirmada: ${cliente.nome} - ${cliente.dados.servico} - ${cliente.dados.data} ${cliente.dados.hora}`);
  
  // Salva na lista de confirmadas
  visitasConfirmadas[cliente.telefone] = {
    ...cliente.dados,
    nome: cliente.nome,
    telefone: cliente.telefone
  };
}

async function verificarConfirmacaoTecnico(cliente) {
  // Se ainda não foi confirmada (você precisará implementar webhook de resposta do técnico)
  await enviarTelegram(`⏰ ALERTA: Técnico ${cliente.dados.tecnico?.nome} não respondeu em 5min sobre ${cliente.nome}`);
}

function escolherTecnico(servico) {
  if (servico === 'marcenaria' || servico === 'moveis' || servico === 'armario') {
    return CONFIG.tecnicos.marcenaria;
  }
  if (servico === 'hidraulica' || servico === 'encanamento' || servico === 'vazamento') {
    return CONFIG.tecnicos.hidraulica;
  }
  return CONFIG.tecnicos.reforma;
}

async function encaminharFotoAoTecnico(telefone, imageId, caption) {
  const cliente = clientes[telefone];
  if (!cliente || !cliente.dados.tecnico) return;
  
  // Download da foto (simplificado - na prática precisa implementar)
  await enviarWhatsApp(cliente.dados.tecnico.whatsapp, `Foto do cliente ${cliente.nome}: [Imagem ID: ${imageId}] ${caption || ''}`);
}

// ============================================
// COMANDOS DO PAINEL ADMIN
// ============================================

async function processarComandoAdmin(cliente, texto) {
  const partes = texto.split(' ');
  const comando = partes[0];
  
  // /confirmar [telefone] - Técnico confirmou
  if (comando === '/confirmar' && partes[1]) {
    const tel = partes[1];
    const c = clientes[tel];
    if (c) {
      c.etapa = 'coletando_endereco';
      await enviarWhatsApp(tel, `Visita confirmada para ${c.dados.data} às ${c.dados.hora} com o profissional ${c.dados.tecnico.nome}.`);
      return 'Confirmado e cliente notificado';
    }
  }
  
  // /alterar [telefone] [nova_data] [nova_hora]
  if (comando === '/alterar' && partes[1]) {
    const tel = partes[1];
    const c = clientes[tel];
    if (c && partes[2] && partes[3]) {
      c.dados.data = partes[2];
      c.dados.hora = partes[3];
      await enviarWhatsApp(tel, `Visita alterada para ${c.dados.data} às ${c.dados.hora}.`);
      return 'Alterado e cliente notificado';
    }
  }
  
  // /antecipar [telefone] [novo_horario]
  if (comando === '/antecipar' && partes[1]) {
    const tel = partes[1];
    const c = clientes[tel];
    if (c && partes[2]) {
      await enviarWhatsApp(tel, `Olá, ${c.nome}! O profissional informou que poderia antecipar sua visita para ${c.dados.data}, às ${partes[2]}. Gostaria de antecipar?`);
      return 'Proposta de antecipação enviada';
    }
  }
  
  // /atrasar [telefone] [motivo]
  if (comando === '/atrasar' && partes[1]) {
    const tel = partes[1];
    const c = clientes[tel];
    if (c) {
      await enviarWhatsApp(tel, `Olá ${c.nome}! O profissional avisou que teve um imprevisto e precisa adiar a visita. Qual seria outro dia e horário que você teria disponibilidade?`);
      c.etapa = 'agendando_data';
      return 'Cliente notificado do atraso';
    }
  }
  
  return 'Comando não reconhecido';
}

// ============================================
// AÇÕES DO PAINEL (HTTP)
// ============================================

async function acaoPainel(req, res, acao) {
  const body = req.body;
  
  // Listar agendamentos pendentes
  if (acao === 'pendentes') {
    const pendentes = Object.values(clientes).filter(c => c.etapa === 'aguardando_tecnico');
    return res.json(pendentes);
  }
  
  // Listar confirmados
  if (acao === 'confirmados') {
    return res.json(Object.values(visitasConfirmadas));
  }
  
  // Forçar confirmação manual
  if (acao === 'confirmar_manual') {
    const tel = body.telefone;
    const c = clientes[tel];
    if (c) {
      c.etapa = 'coletando_endereco';
      await enviarWhatsApp(tel, `Visita confirmada para ${c.dados.data} às ${c.dados.hora} com o profissional ${escolherTecnico(c.dados.servico).nome}.`);
      return res.json({ ok: true });
    }
  }
  
  // Enviar mensagem como humano
  if (acao === 'enviar') {
    await enviarWhatsApp(body.telefone, body.mensagem);
    return res.json({ ok: true });
  }
  
  res.json({ erro: 'Ação inválida' });
}

// ============================================
// FUNÇÕES DE ENVIO
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`📤 Para ${numero}: ${texto.substring(0, 60)}...`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ Variáveis não configuradas');
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
    return res.ok;
    
  } catch (e) {
    console.error('Erro:', e.message);
    return false;
  }
}

async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT,
        text: texto,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Erro Telegram:', e.message);
  }
}

// ============================================
// RELATÓRIO DIÁRIO (CRON - implementar depois)
// ============================================

async function enviarRelatorioDiario() {
  const hoje = new Date().toLocaleDateString('pt-BR');
  const totalAtendimentos = Object.keys(clientes).length;
  const agendados = Object.keys(visitasConfirmadas).length;
  
  await enviarTelegram(`📊 Relatório ${hoje}
  
Atendimentos: ${totalAtendimentos}
Agendamentos confirmados: ${agendados}
Pendentes: ${totalAtendimentos - agendados}`);
}
