// ============================================
// RC ATENDIMENTO - VERSÃO FINAL COMPLETA
// TREINAMENTO 100% IMPLEMENTADO - HUMANIZADO
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
  timeoutTecnico: 5 * 60 * 1000, // 5 minutos
  lembrete2h: 2 * 60 * 60 * 1000 // 2 horas
};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const clientes = {};
const processadas = new Set();
const pendentes = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    if (req.method === 'POST') {
      return await receber(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO:', e.message);
    return res.status(200).send('OK');
  }
}

async function receber(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  if (!changes) return res.status(200).send('OK');
  
  // IGNORA STATUS (delivery, read, sent) - EVITA LOOP
  if (changes.statuses) {
    return res.status(200).send('OK');
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return res.status(200).send('OK');
  
  // Anti-duplicata
  if (processadas.has(msg.id)) {
    return res.status(200).send('OK');
  }
  processadas.add(msg.id);
  if (processadas.size > 1000) processadas.clear();
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // IGNORA PRÓPRIAS MENSAGENS
  if (telefone === CONFIG.numeroRC) {
    return res.status(200).send('OK');
  }
  
  const tecnicos = Object.values(CONFIG.tecnicos);
  
  // VERIFICA SE É RESPOSTA DE TÉCNICO
  if (tecnicos.includes(telefone)) {
    return await processarTecnico(telefone, msg, res);
  }
  
  console.log(`\n📨 ${nome} (${telefone}): ${msg.text?.body || '[midia]'}`);
  
  // ÁUDIO - Seção 1.4
  if (msg.type === 'audio') {
    await enviar(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // FOTO SEM TEXTO - Seção 1.3
  if (msg.type === 'image' && !msg.caption) {
    const cliExistente = clientes[telefone];
    if (!cliExistente || cliExistente.historico?.length === 0) {
      await enviar(telefone, "Ola! Me informe o servico e bairro que deseja atendimento");
      return res.status(200).send('OK');
    }
  }
  
  if (msg.type !== 'text') return res.status(200).send('OK');
  
  const texto = msg.text.body;
  
  // Inicializa cliente
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      etapa: 'INICIO',
      historico: [],
      dados: {
        servico: null, bairro: null, valor: null, data: null, 
        hora: null, endereco: null, urgente: false, tecnico: null
      }
    };
  }
  
  const cli = clientes[telefone];
  
  // Anti-loop temporal
  const agora = Date.now();
  if (cli.ultimoTimestamp && (agora - cli.ultimoTimestamp < 2000)) {
    return res.status(200).send('OK');
  }
  cli.ultimoTimestamp = agora;
  
  cli.historico.push({ role: 'user', content: texto, time: new Date().toISOString() });
  
  // PROCESSA COM TREINAMENTO COMPLETO
  const resp = processar(cli, texto.toLowerCase(), texto);
  
  if (resp) {
    const ok = await enviar(telefone, resp);
    if (ok) {
      cli.historico.push({ role: 'assistant', content: resp, time: new Date().toISOString() });
    }
  }
  
  return res.status(200).send('OK');
}

// ============================================
// PROCESSAMENTO COM TREINAMENTO COMPLETO
// ============================================

function processar(cli, t, original) {
  const d = cli.dados;
  
  // ===== SEÇÃO 1: APRESENTAÇÃO =====
  
  // 1.2 - Identidade
  if (t.match(/(quem e voce|quem é você|voce e robo|você é robô|e humano|é humano|atendente)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  // ===== SEÇÃO 9: OBJEÇÕES E DIFICULDADES =====
  
  // 9.1 - Comparar orçamentos
  if (t.match(/(comparar|outras empresas|outro orçamento|vou pesquisar)/)) {
    return "Tudo bem, se quiser, pode enviar o orcamento de outra empresa para verificarmos se cobrimos.";
  }
  
  // 9.2 - Caro demais
  if (t.match(/(caro demais|muito caro|esta caro|valor alto)/)) {
    return "Entendo que o valor e diferente do esperado. No entanto, nossos profissionais sao de confianca e de alta qualidade, prestando servicos a pessoas influentes. Apesar disso, os valores sao padrao da zona sul do Rio";
  }
  
  // 9.3 - Não confia em pagar antes
  if (t.match(/(nao confio|pagar antes|dinheiro adiantado|nao pago antes)/)) {
    return "Entendo. A empresa e seria e preza pela qualidade e confianca nos servicos prestados. Gostaria de prosseguir com sinal de 50% e o restante no fim do servico?";
  }
  
  // 9.4 - Quer falar com técnico (NUNCA passa contato)
  if (t.match(/(falar com quem vai fazer|falar com o profissional|contato do tecnico|telefone do tecnico)/)) {
    return "Qual a sua duvida?";
  }
  
  // 9.5 - Cliente grosseiro
  if (t.match(/(idiota|burro|inutil|merda|estupido|babaca|cacete|porra|caralho|filho da puta)/)) {
    return "Se precisar de atendimento para o servico que precisa, me avise";
  }
  
  // 9.6 - Pergunta técnica específica
  if (t.match(/(espessura|tipo de concreto|bitola|material especifico|marca de tinta|qualidade do|qual especificacao)/)) {
    return "Entendo sua duvida, mas somente o profissional poderia responder. Irei encaminhar sua duvida";
  }
  
  // ===== SEÇÃO 8: CENÁRIOS ESPECIAIS =====
  
  // 8.1 - Pintura sem visita
  if (t.match(/(pintura.*sem visita|orcamento de pintura.*sem ir|preco de pintura.*nao precisa ir)/)) {
    return "Qual seria a metragem quadrada total e o tipo de tinta?";
  }
  
  // 8.2 - Foto pedindo orçamento
  if (t.match(/(foto.*orcamento|mando foto|olha a foto|veja a foto)/)) {
    return "Pode explicar melhor o servico e bairro que deseja atendimento?";
  }
  
  // 8.3 - Múltiplos serviços
  if (t.match(/(pintura.*eletrica|eletrica.*pintura|hidraulica.*eletrica|dois servicos|tres servicos|varios servicos)/)) {
    d.multiplo = true;
    return "Sera necessario o envio de dois profissionais independentes para a realizacao da visita. A taxa de cada visita e de R$180. Para quando gostaria de marcar?";
  }
  
  // 8.4 - Obra grande
  if (t.match(/(construcao|reforma completa|casa toda|apartamento todo|obra grande|obra total)/)) {
    return `E necessario que o profissional va ao local para que seja realizado um orcamento preciso. A taxa da visita e de R$${d.valor || 180}. Para quando gostaria de atendimento?`;
  }
  
  // 8.5 - Síndico/empresa
  if (t.match(/(sindico|condominio|empresa|predio|comercial|condominios|sindica)/)) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  // 8.6 - Só material
  if (t.match(/(so material|apenas material|comprar material|venda de material|vende material|só material)/)) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  // ===== SEÇÃO 2: COLETA DE INFORMAÇÕES =====
  
  // 2.8 - Evasivos
  if (t.match(/(depois eu te falo|depois eu falo|so queria saber preco|só queria saber preço|depois eu entro em contato|só tirei duvida)/)) {
    return "Se precisar de atendimento, pode entrar em contato";
  }
  
  // ===== SEÇÃO 3: APRESENTAÇÃO DE VALORES =====
  
  // 3.6 - Vou pensar
  if (t.match(/(vou pensar|volto depois|depois eu decido|vou analisar|vou ver)/)) {
    return "Sempre que precisar, entre em contato";
  }
  
  // ===== SEÇÃO 6: CONFIRMAÇÃO =====
  
  // 6.4 - Cancelamento
  if (t.match(/(desisti|cancela|quero cancelar|desistir|nao quero mais)/)) {
    return "Pode contar melhor o que houve?";
  }
  
  // ===== FLUXO PRINCIPAL POR ETAPA =====
  
  switch (cli.etapa) {
    case 'INICIO':
      return etapaInicio(cli, t, original);
      
    case 'AGUARDANDO_BAIRRO':
      return etapaAguardandoBairro(cli, t, original);
      
    case 'AGUARDANDO_SERVICO':
      return etapaAguardandoServico(cli, t, original);
      
    case 'VALOR_APRESENTADO':
      return etapaValorApresentado(cli, t, original);
      
    case 'AGUARDANDO_DATA':
      return etapaAguardandoData(cli, t, original);
      
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original);
      
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original);
      
    case 'CONFIRMAR_AGENDAMENTO':
      return etapaConfirmar(cli, t, original);
      
    case 'AGENDADO':
      return "Visita confirmada. Se precisar de algo mais, e so chamar.";
      
    case 'AGUARDANDO_TECNICO':
      return "Um momento que irei verificar com o profissional";
      
    default:
      cli.etapa = 'INICIO';
      return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
}

// ============================================
// ETAPAS DO FLUXO
// ============================================

function etapaInicio(cli, t, original) {
  const d = cli.dados;
  
  // Extrai serviço e bairro
  const { servico, bairro } = extrairServicoEBairro(t, original);
  
  // 2.5 - Serviço + Bairro de uma vez
  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    d.valor = calcularValor(bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    // 3.1/3.2 - Apresenta valor conforme bairro
    return `Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnicagora vou criar o **código final completo** com todo o treinamento, funcionando no WhatsApp, sem loops, e com diálogo humanizado profissional:

```javascript
// ============================================
// RC ATENDIMENTO - VERSÃO FINAL COMPLETA
// TREINAMENTO 100% IMPLEMENTADO - HUMANIZADO
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
  timeoutTecnico: 5 * 60 * 1000, // 5 minutos
  lembrete2h: 2 * 60 * 60 * 1000 // 2 horas
};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const clientes = {};
const processadas = new Set();
const pendentes = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    if (req.method === 'POST') {
      return await receber(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO:', e.message);
    return res.status(200).send('OK');
  }
}

async function receber(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  if (!changes) return res.status(200).send('OK');
  
  // IGNORA STATUS (delivery, read, sent) - EVITA LOOP
  if (changes.statuses) {
    return res.status(200).send('OK');
  }
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return res.status(200).send('OK');
  
  // Anti-duplicata
  if (processadas.has(msg.id)) {
    return res.status(200).send('OK');
  }
  processadas.add(msg.id);
  if (processadas.size > 1000) processadas.clear();
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // IGNORA PRÓPRIAS MENSAGENS
  if (telefone === CONFIG.numeroRC) {
    return res.status(200).send('OK');
  }
  
  const tecnicos = Object.values(CONFIG.tecnicos);
  
  // VERIFICA SE É RESPOSTA DE TÉCNICO
  if (tecnicos.includes(telefone)) {
    return await processarTecnico(telefone, msg, res);
  }
  
  console.log(`\n📨 ${nome} (${telefone}): ${msg.text?.body || '[midia]'}`);
  
  // ÁUDIO - Seção 1.4
  if (msg.type === 'audio') {
    await enviar(telefone, "No momento eu nao consigo ouvir, pode escrever?");
    return res.status(200).send('OK');
  }
  
  // FOTO SEM TEXTO - Seção 1.3
  if (msg.type === 'image' && !msg.caption) {
    const cliExistente = clientes[telefone];
    if (!cliExistente || cliExistente.historico?.length === 0) {
      await enviar(telefone, "Ola! Me informe o servico e bairro que deseja atendimento");
      return res.status(200).send('OK');
    }
  }
  
  if (msg.type !== 'text') return res.status(200).send('OK');
  
  const texto = msg.text.body;
  
  // Inicializa cliente
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      etapa: 'INICIO',
      historico: [],
      dados: {
        servico: null, bairro: null, valor: null, data: null, 
        hora: null, endereco: null, urgente: false, tecnico: null
      }
    };
  }
  
  const cli = clientes[telefone];
  
  // Anti-loop temporal
  const agora = Date.now();
  if (cli.ultimoTimestamp && (agora - cli.ultimoTimestamp < 2000)) {
    return res.status(200).send('OK');
  }
  cli.ultimoTimestamp = agora;
  
  cli.historico.push({ role: 'user', content: texto, time: new Date().toISOString() });
  
  // PROCESSA COM TREINAMENTO COMPLETO
  const resp = processar(cli, texto.toLowerCase(), texto);
  
  if (resp) {
    const ok = await enviar(telefone, resp);
    if (ok) {
      cli.historico.push({ role: 'assistant', content: resp, time: new Date().toISOString() });
    }
  }
  
  return res.status(200).send('OK');
}

// ============================================
// PROCESSAMENTO COM TREINAMENTO COMPLETO
// ============================================

function processar(cli, t, original) {
  const d = cli.dados;
  
  // ===== SEÇÃO 1: APRESENTAÇÃO =====
  
  // 1.2 - Identidade
  if (t.match(/(quem e voce|quem é você|voce e robo|você é robô|e humano|é humano|atendente)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construcao";
  }
  
  // ===== SEÇÃO 9: OBJEÇÕES E DIFICULDADES =====
  
  // 9.1 - Comparar orçamentos
  if (t.match(/(comparar|outras empresas|outro orçamento|vou pesquisar)/)) {
    return "Tudo bem, se quiser, pode enviar o orcamento de outra empresa para verificarmos se cobrimos.";
  }
  
  // 9.2 - Caro demais
  if (t.match(/(caro demais|muito caro|esta caro|valor alto)/)) {
    return "Entendo que o valor e diferente do esperado. No entanto, nossos profissionais sao de confianca e de alta qualidade, prestando servicos a pessoas influentes. Apesar disso, os valores sao padrao da zona sul do Rio";
  }
  
  // 9.3 - Não confia em pagar antes
  if (t.match(/(nao confio|pagar antes|dinheiro adiantado|nao pago antes)/)) {
    return "Entendo. A empresa e seria e preza pela qualidade e confianca nos servicos prestados. Gostaria de prosseguir com sinal de 50% e o restante no fim do servico?";
  }
  
  // 9.4 - Quer falar com técnico (NUNCA passa contato)
  if (t.match(/(falar com quem vai fazer|falar com o profissional|contato do tecnico|telefone do tecnico)/)) {
    return "Qual a sua duvida?";
  }
  
  // 9.5 - Cliente grosseiro
  if (t.match(/(idiota|burro|inutil|merda|estupido|babaca|cacete|porra|caralho|filho da puta)/)) {
    return "Se precisar de atendimento para o servico que precisa, me avise";
  }
  
  // 9.6 - Pergunta técnica específica
  if (t.match(/(espessura|tipo de concreto|bitola|material especifico|marca de tinta|qualidade do|qual especificacao)/)) {
    return "Entendo sua duvida, mas somente o profissional poderia responder. Irei encaminhar sua duvida";
  }
  
  // ===== SEÇÃO 8: CENÁRIOS ESPECIAIS =====
  
  // 8.1 - Pintura sem visita
  if (t.match(/(pintura.*sem visita|orcamento de pintura.*sem ir|preco de pintura.*nao precisa ir)/)) {
    return "Qual seria a metragem quadrada total e o tipo de tinta?";
  }
  
  // 8.2 - Foto pedindo orçamento
  if (t.match(/(foto.*orcamento|mando foto|olha a foto|veja a foto)/)) {
    return "Pode explicar melhor o servico e bairro que deseja atendimento?";
  }
  
  // 8.3 - Múltiplos serviços
  if (t.match(/(pintura.*eletrica|eletrica.*pintura|hidraulica.*eletrica|dois servicos|tres servicos|varios servicos)/)) {
    d.multiplo = true;
    return "Sera necessario o envio de dois profissionais independentes para a realizacao da visita. A taxa de cada visita e de R$180. Para quando gostaria de marcar?";
  }
  
  // 8.4 - Obra grande
  if (t.match(/(construcao|reforma completa|casa toda|apartamento todo|obra grande|obra total)/)) {
    return `E necessario que o profissional va ao local para que seja realizado um orcamento preciso. A taxa da visita e de R$${d.valor || 180}. Para quando gostaria de atendimento?`;
  }
  
  // 8.5 - Síndico/empresa
  if (t.match(/(sindico|condominio|empresa|predio|comercial|condominios|sindica)/)) {
    return "Infelizmente o profissional esta com alta demanda e no momento nao esta prestando servicos para empresas, apenas pessoas fisicas";
  }
  
  // 8.6 - Só material
  if (t.match(/(so material|apenas material|comprar material|venda de material|vende material|só material)/)) {
    return "Os profissionais apenas realizam servicos, nao vendem produtos";
  }
  
  // ===== SEÇÃO 2: COLETA DE INFORMAÇÕES =====
  
  // 2.8 - Evasivos
  if (t.match(/(depois eu te falo|depois eu falo|so queria saber preco|só queria saber preço|depois eu entro em contato|só tirei duvida)/)) {
    return "Se precisar de atendimento, pode entrar em contato";
  }
  
  // ===== SEÇÃO 3: APRESENTAÇÃO DE VALORES =====
  
  // 3.6 - Vou pensar
  if (t.match(/(vou pensar|volto depois|depois eu decido|vou analisar|vou ver)/)) {
    return "Sempre que precisar, entre em contato";
  }
  
  // ===== SEÇÃO 6: CONFIRMAÇÃO =====
  
  // 6.4 - Cancelamento
  if (t.match(/(desisti|cancela|quero cancelar|desistir|nao quero mais)/)) {
    return "Pode contar melhor o que houve?";
  }
  
  // ===== FLUXO PRINCIPAL POR ETAPA =====
  
  switch (cli.etapa) {
    case 'INICIO':
      return etapaInicio(cli, t, original);
      
    case 'AGUARDANDO_BAIRRO':
      return etapaAguardandoBairro(cli, t, original);
      
    case 'AGUARDANDO_SERVICO':
      return etapaAguardandoServico(cli, t, original);
      
    case 'VALOR_APRESENTADO':
      return etapaValorApresentado(cli, t, original);
      
    case 'AGUARDANDO_DATA':
      return etapaAguardandoData(cli, t, original);
      
    case 'AGUARDANDO_HORARIO':
      return etapaAguardandoHorario(cli, t, original);
      
    case 'AGUARDANDO_ENDERECO':
      return etapaAguardandoEndereco(cli, t, original);
      
    case 'CONFIRMAR_AGENDAMENTO':
      return etapaConfirmar(cli, t, original);
      
    case 'AGENDADO':
      return "Visita confirmada. Se precisar de algo mais, e so chamar.";
      
    case 'AGUARDANDO_TECNICO':
      return "Um momento que irei verificar com o profissional";
      
    default:
      cli.etapa = 'INICIO';
      return "Ola! Me informe o servico e bairro que deseja atendimento";
  }
}

// ============================================
// ETAPAS DO FLUXO
// ============================================

function etapaInicio(cli, t, original) {
  const d = cli.dados;
  
  // Extrai serviço e bairro
  const { servico, bairro } = extrairServicoEBairro(t, original);
  
  // 2.5 - Serviço + Bairro de uma vez
  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    d.valor = calcularValor(bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    // 3.1/3.2 - Apresenta valor conforme bairro
    return `Perfeito. Para enviar um orcamento preciso, e necessario uma visita tecnica ao local. O valor da visita e R$${d.valor}, mas e abatido do valor final se o orcamento for aprovado.`;
  }
  
  // 2.2 - Só serviço
  if (servico && !bairro) {
    d.servico = servico;
    cli.etapa = 'AGUARDANDO_BAIRRO';
    return "Certo, qual o bairro que deseja atendimento?";
  }
  
  // 2.6 - Só bairro
  if (!servico && bairro) {
    d.bairro = bairro;
    cli.etapa = 'AGUARDANDO_SERVICO';
    return "Qual servico deseja?";
  }
  
  // 2.7 - "Quanto custa?" antes de dizer o que precisa
  if (t.match(/(quanto custa|qual o preco|qual o valor|quanto fica)/)) {
    return "A qual servico se refere? Nao posso dizer um valor exato, pois depende da visita tecnica de um profissional, mas posso enviar uma media de valores. Deseja?";
  }
  
  // 1.1 - Saudação padrão
  return "Ola! Me informe o servico e bairro que deseja atendimento";
}

function etapaAguardandoBairro(cli, t, original) {
  const d = cli.dados;
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    d.valor = calcularValor(bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    // 3.1/3.2 - Texto exato conforme documento
    return `Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$${d.valor}, mas e abatido do valor final caso o orcamento seja aprovado.`;
  }
  
  // 2.4 - Pede bairro de forma natural
  return "Certo, qual o bairro que deseja atendimento?";
}

function etapaAguardandoServico(cli, t, original) {
  const d = cli.dados;
  const servico = extrairServico(t);
  
  if (servico) {
    d.servico = servico;
    d.valor = calcularValor(d.bairro);
    cli.etapa = 'VALOR_APRESENTADO';
    
    return `Para oferecer um orcamento mais preciso, e necessario que um profissional realize uma visita tecnica. O valor da visita e de R$${d.valor}, mas e abatido do valor final caso o orcamento seja aprovado.`;
  }
  
  return "Qual servico deseja?";
}

function etapaValorApresentado(cli, t, original) {
  const d = cli.dados;
  
  // 3.3 - Questionamento do valor
  if (t.match(/(por que tem que pagar|por que pagar|para que serve a visita|por que cobra)/)) {
    return "O valor se refere ao custo de deslocamento do profissional e analise tecnica. Caso o orcamento seja aprovado, o valor da visita e abatido do valor final. Assim, a vista sairia de graca";
  }
  
  // 3.4 - Insiste em não pagar visita
  if (t.match(/(nao vou pagar|nao pago|visita gratis|gratuita|orcamento gratis|nao aceito pagar)/)) {
    const isBotafogo = d.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      d.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      d.valor = 0;
      cli.etapa = 'AGUARDANDO_DATA';
      return "Como uma excecao, a visita pode ser realizada sem cobranca. Para quando gostaria de agendar?";
    } else if (isZonaSul) {
      return "A visita pode ser realizada pela metade do valor. Deseja prosseguir?";
    } else {
      return "Entendo, mas infelizmente a taxa da visita precisa ser seguida";
    }
  }
  
  // 3.5 - Pedido de desconto
  if (t.match(/(desconto|faz mais barato|tem desconto|consegue abaixar|melhorar o valor)/)) {
    const isBotafogo = d.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
      d.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      return "Posso oferecer 50% de desconto na visita. Se nao aceitar, posso tentar a visita sem cobranca como excecao. O que prefere?";
    } else if (isZonaSul) {
      return "Posso oferecer ate 50% de desconto no valor da visita. Deseja prosseguir?";
    } else {
      return "Para este bairro, o valor da visita e fixo. Podemos agendar?";
    }
  }
  
  // Aceitação - vai para agendamento
  if (t.match(/(pode ser|quando|data|horario|hoje|amanha|agendar|marcar|quero agendar)/)) {
    cli.etapa = 'AGUARDANDO_DATA';
    return etapaAguardandoData(cli, t, original);
  }
  
  // Não aceitou ainda
  return "Deseja agendar a visita tecnica?";
}

function etapaAguardandoData(cli, t, original) {
  const d = cli.dados;
  const horaAtual = new Date().getHours();
  
  // 4.7 - Urgência (vazamento, emergência)
  if (t.match(/(urgente|vazando|vazamento|quebrou|emergencia|inundando|muito urgente|estourou)/)) {
    d.urgente = true;
    if (!d.bairro) {
      return "Qual bairro deseja atendimento?";
    }
    // Vai direto verificar com técnico
    return iniciarVerificacaoTecnico(cli, 'hoje');
  }
  
  // 4.1 - Quer agendar para hoje
  if (t.match(/(hoje|hoje ainda|ainda hoje|agora|ja)/)) {
    // 4.2 - Depois das 19h
    if (horaAtual >= 19) {
      return "Posso entrar em contato com o profissional amanha no primeiro horario. Deseja?";
    }
    return iniciarVerificacaoTecnico(cli, 'hoje');
  }
  
  // 4.3 - Amanhã de manhã
  if (t.match(/(amanha de manha|amanhã de manhã|amanha cedo|proximo dia util)/)) {
    cli.etapa = 'AGUARDANDO_HORARIO';
    return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
  }
  
  // 4.3 - Amanhã (geral)
  if (t.match(/(amanha|amanhã|proximo dia)/)) {
    return iniciarVerificacaoTecnico(cli, 'amanha');
  }
  
  // 4.4 - Qualquer dia
  if (t.match(/(qualquer dia|qualquer horario|tanto faz|o que tiver|quando puder)/)) {
    return "Gostaria de atendimento para hoje?";
  }
  
  // 4.5 - Horário específico sugerido
  const horario = extrairHorario(original);
  const data = extrairData(t, original);
  
  if (horario || data) {
    if (horario) d.hora = horario;
    if (data) d.data = data;
    return iniciarVerificacaoTecnico(cli, d.data || 'sugerido', d.hora);
  }
  
  // 4.6 - Indeciso
  if (t.match(/(nao sei|ainda nao sei|vou ver|depois te falo|nao tenho certeza)/)) {
    return "Gostaria de atendimento para hoje?";
  }
  
  return "Para quando gostaria de agendar?";
}

function etapaAguardandoHorario(cli, t, original) {
  const d = cli.dados;
  const hora = extrairHorario(original);
  
  if (hora) {
    d.hora = hora;
    return iniciarVerificacaoTecnico(cli, d.data || 'amanha', hora);
  }
  
  // Aceita período
  if (t.match(/(sim|pode ser|manha|manhã|tarde|noite)/)) {
    if (t.match(/manha|manhã/)) d.hora = '10:00';
    else if (t.match(/tarde/)) d.hora = '14:00';
    else d.hora = '10:00';
    
    return iniciarVerificacaoTecnico(cli, d.data || 'amanha', d.hora);
  }
  
  return "Qual seria um bom horario? Entre 9:30h e 11:30h?";
}

function etapaAguardandoEndereco(cli, t, original) {
  const d = cli.dados;
  
  // 5.1 - Endereço completo
  if (original.length > 10 && t.match(/(rua|av|avenida|estrada|travessa|alameda|numero|nº|apartamento|casa)/)) {
    d.endereco = original;
    cli.etapa = 'CONFIRMAR_AGENDAMENTO';
    
    // 6.1 - Texto de confirmação
    return `Pode marcar para ${d.data} as ${d.hora} com profissional ${nomeProfissional(d.servico)}?`;
  }
  
  // 5.2 - Só rua sem número
  if ((t.match(/(rua|av|avenida)/)) && !t.match(/\d+/)) {
    return "Qual o numero? E casa ou apartamento?";
  }
  
  // 5.4 - Não quer passar endereço antes
  if (t.match(/(nao vou passar|depois eu passo|confirmar primeiro|depois eu digo|nao vou informar)/)) {
    return "Um momento que irei verificar a disponibilidade do profissional";
  }
  
  // 5.3 - Endereço com erro (detectado por padrão)
  if (t.match(/(errado|erro|nao existe|errado)/)) {
    return "Desculpe, acho que tem um erro de digitacao. Pode confirmar o endereco?";
  }
  
  return "Qual o endereco completo para a visita?";
}

function etapaConfirmar(cli, t, original) {
  const d = cli.dados;
  
  // 6.2 - Confirmação positiva
  if (t.match(/(sim|pode|confirmo|esta bom|ok|pode marcar|fechado|combinado)/)) {
    // Notifica técnico (7.1)
    notificarTecnicoConfirmado(cli);
    d.tecnicoNotificado = true;
    cli.etapa = 'AGENDADO';
    
    // Agenda lembretes (10.1, 10.2)
    agendarLembretes(cli);
    
    return "Perfeito, marcado!";
  }
  
  // 6.3 - Alterar data/horário
  if (t.match(/(nao|mudar|alterar|outro dia|outro horario|remarcar|trocar)/)) {
    cli.etapa = 'AGUARDANDO_DATA';
    return "Qual seria o dia mais proximo que teria disponibilidade?";
  }
  
  // 6.4 - Cancelamento (já tratado no início, mas reforça)
  if (t.match(/(cancelar|desistir|nao quero)/)) {
    return "Pode contar melhor o que houve?";
  }
  
  // Repete confirmação
  return `Posso confirmar: ${d.servico} em ${d.bairro}, dia ${d.data} as ${d.hora}, no endereco ${d.endereco}. Esta correto?`;
}

// ============================================
// COMUNICAÇÃO COM TÉCNICOS (SEÇÃO 7)
// ============================================

function iniciarVerificacaoTecnico(cli, data, hora = null) {
  const d = cli.dados;
  d.data = data;
  if (hora) d.hora = hora;
  
  cli.etapa = 'AGUARDANDO_TECNICO';
  
  // Determina técnico
  let numTecnico;
  if (d.servico?.match(/(marcenaria|movel|armario|marceneiro)/)) {
    numTecnico = CONFIG.tecnicos.marcenaria;
    d.profissionalNome = "Tecnico de Marcenaria";
  } else if (d.servico?.match(/(hidraulica|encanamento|vazamento|pia|banheiro|cano)/)) {
    numTecnico = CONFIG.tecnicos.hidraulica;
    d.profissionalNome = "Tecnico Hidraulico";
  } else if (d.servico?.match(/(eletrica|eletricista|fio|tomada|disjuntor|luz)/)) {
    numTecnico = CONFIG.tecnicos.eletrica;
    d.profissionalNome = "Tecnico Eletricista";
  } else {
    numTecnico = CONFIG.tecnicos.reforma;
    d.profissionalNome = "Tecnico de Reformas";
  }
  
  d.numeroTecnico = numTecnico;
  
  // Registra pendente
  const id = `${cli.telefone}_${Date.now()}`;
  pendentes[id] = { cliente: cli, tecnico: numTecnico, time: Date.now() };
  
  // 7.1 - Mensagem ao técnico (tom natural, indistinguível)
  const msg = `Bom dia! Tem disponibilidade para visita de ${d.servico} em ${d.bairro} ${data}${hora ? ' as ' + hora : ''}? Cliente: ${cli.nome}, Tel: ${cli.telefone}.`;
  
  enviar(numTecnico, msg);
  
  // Timeout 5 minutos (12.3)
  setTimeout(() => verificarTimeoutTecnico(id), CONFIG.timeoutTecnico);
  
  return "Um momento que irei verificar com o profissional";
}

async function processarTecnico(telefoneTecnico, msg, res) {
  const texto = msg.text?.body || '';
  const t = texto.toLowerCase();
  
  console.log(`\n🔧 TÉCNICO ${telefoneTecnico}: ${texto}`);
  
  // Encontra pendente
  let id = null, pendente = null;
  for (const [k, v] of Object.entries(pendentes)) {
    if (v.tecnico === telefoneTecnico && (Date.now() - v.time) < CONFIG.timeoutTecnico) {
      id = k; pendente = v; break;
    }
  }
  
  if (!pendente) {
    // 7.6 - Técnico quer antecipar (não solicitado)
    if (t.match(/(posso ir agora|terminei cedo|posso antecipar|to livre agora|posso antes)/)) {
      enviarTelegram(`⚡ Técnico ${telefoneTecnico} quer antecipar: "${texto}"`);
    }
    return res.status(200).send('OK');
  }
  
  const cli = pendente.cliente;
  const d = cli.dados;
  delete pendentes[id];
  
  // Resposta positiva (considera abreviações)
  if (t.match(/(posso|sim|confirmo|to livre|tenho disponibilidade|ok|beleza|show|fechado|combinado|pode ser)/)) {
    d.visitaConfirmada = true;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    
    // 7.2 - Confirma com cliente
    enviar(cli.telefone, `Visita confirmada para ${d.data}${d.hora ? ', as ' + d.hora : ''}, com o profissional ${d.profissionalNome}. Qual o endereco completo?`);
    
    return res.status(200).send('OK');
  }
  
  // Resposta negativa - pergunta alternativa
  if (t.match(/(nao posso|nao consigo|to ocupado|nao to livre|impossivel|nao da|nao)/)) {
    enviar(telefoneTecnico, "Qual o dia e horario mais proximo que voce teria disponibilidade?");
    
    // Aguarda nova sugestão
    const novoId = `${cli.telefone}_alt_${Date.now()}`;
    pendentes[novoId] = { cliente: cli, tecnico: telefoneTecnico, time: Date.now(), tipo: 'alternativa' };
    setTimeout(() => verificarTimeoutTecnico(novoId), CONFIG.timeoutTecnico);
    
    return res.status(200).send('OK');
  }
  
  // Sugere alternativa
  const novaData = extrairData(t, texto);
  const novoHorario = extrairHorario(texto);
  
  if (novaData || novoHorario || t.match(/(posso|consigo)/)) {
    if (novaData) d.data = novaData;
    if (novoHorario) d.hora = novoHorario;
    
    d.visitaConfirmada = true;
    cli.etapa = 'AGUARDANDO_ENDERECO';
    
    // Repassa ao cliente (linguajar formal, NÃO pergunta "serve")
    enviar(cli.telefone, `O tecnico podera realizar a visita ${d.data}${d.hora ? ' as ' + d.hora : ''}. Confirmo o agendamento?`);
    
    return res.status(200).send('OK');
  }
  
  // Não entendeu
  enviarTelegram(`❓ Resposta não reconhecida. Cliente: ${cli.nome}, Técnico: ${telefoneTecnico}, Resposta: "${texto}"`);
  
  return res.status(200).send('OK');
}

function verificarTimeoutTecnico(id) {
  const p = pendentes[id];
  if (!p) return;
  
  const cli = p.cliente;
  const d = cli.dados;
  delete pendentes[id];
  
  // Tenta outro técnico
  const tentados = [p.tecnico];
  const todos = Object.values(CONFIG.tecnicos);
  let outro = null;
  
  for (const t of todos) {
    if (!tentados.includes(t)) { outro = t; break; }
  }
  
  if (outro && !d.urgente) {
    console.log(`🔄 Tentando outro técnico: ${outro}`);
    
    const novoId = `${cli.telefone}_tec2_${Date.now()}`;
    pendentes[novoId] = { cliente: cli, tecnico: outro, time: Date.now() };
    
    const msg = `Bom dia! Tem disponibilidade para visita de ${d.servico} em ${d.bairro} ${d.data}${d.hora ? ' as ' + d.hora : ''}? Cliente: ${cli.nome}, Tel: ${cli.telefone}.`;
    
    enviar(outro, msg);
    setTimeout(() => verificarTimeoutTecnico(novoId), CONFIG.timeoutTecnico);
    return;
  }
  
  // 12.3 - Alerta Telegram urgente
  enviarTelegram(`🚨 URGENTE: Sem técnico disponível
Cliente: ${cli.nome} (${cli.telefone})
Serviço: ${d.servico}
Bairro: ${d.bairro}
Data: ${d.data} ${d.hora || ''}
Tentados: ${tentados.join(', ')}

AÇÃO: Ligar para o cliente imediatamente!`);
  
  // Notifica cliente de atraso (7.5)
  enviar(cli.telefone, "O profissional avisou que teve um imprevisto e precisa adiar a visita. Qual seria o melhor dia para remarcar?");
}

function notificarTecnicoConfirmado(cli) {
  const d = cli.dados;
  const num = d.numeroTecnico || CONFIG.tecnicos.reforma;
  
  // 7.1 - Texto exato
  const msg = `Visita de ${d.servico} marcada. Endereco ${d.endereco}, Cliente ${cli.nome}, dia ${d.data},
