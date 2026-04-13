
# Código atualizado com envio direto aos técnicos no WhatsApp

codigo_atualizado = '''// ============================================
// RC ATENDIMENTO DIGITAL - IA AUTÔNOMA V2
// Com envio direto aos técnicos no WhatsApp
// ============================================

const CONFIG = {
  saudacao: `Olá! Bem-vindo ao Atendimento Digital da RC. Sou seu consultor virtual especializado em reformas. Vou te ajudar a realizar seu projeto com excelência. Qual serviço você precisa e em qual bairro?`,
  
  // Preços por região
  precos: {
    zonaSul: 180,
    outrasRegioes: 220
  },
  
  // Bairros Zona Sul do Rio (expandir conforme necessário)
  bairrosZonaSul: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 'lagoa',
    'gávea', 'jardim botânico', 'humaitá', 'urca', 'vidigal', 'são conrado',
    'rocinha', 'catete', 'glória', 'laranjeiras', 'cosme velho', 'leme'
  ],
  
  // TÉCNICOS COM SEUS NÚMEROS DE WHATSAPP
  tecnicos: {
    marcenaria: {
      nome: 'Técnico Marcenaria',
      whatsapp: '5521978791765',
      especialidade: 'marcenaria'
    },
    reforma: {
      nome: 'Técnico Reformas',
      whatsapp: '5521968112176', 
      especialidade: 'reforma'
    },
    hidraulica: {
      nome: 'Técnico Hidráulica',
      whatsapp: '5521968112176', // Mesmo número para reformas gerais
      especialidade: 'hidraulica'
    }
  },
  
  horarioLimite: 19, // 19h limite para visitas no mesmo dia
  
  msgs: {
    intervencao: `🔄 Entendo que prefere falar com um humano. Transferindo você agora para um de nossos especialistas...`,
    valorVisita: (valor, regiao) => `Perfeito! Para o bairro informado (${regiao}), o valor da visita técnica é R$${valor}.\\n\\n✅ Este valor será *abatido do orçamento final* caso aprove o serviço.\\n💳 O pagamento deve ser realizado *no ato da visita* (Pix, cartão ou dinheiro).\\n\\nGostaria de agendar para quando?`,
    foraHorario: `Verificando disponibilidade... Como já passou das 19h, vou confirmar com nosso técnico a possibilidade de atendimento no primeiro horário amanhã. É urgente ou pode ser amanhã?`,
    agendamentoConfirmado: (data, hora) => `✅ *Visita agendada com sucesso!*\\n\\n📅 Data: ${data}\\n⏰ Horário: ${hora}\\n\\nPara finalizar, preciso do endereço completo (rua, número, complemento e ponto de referência).`
  }
};

// ============================================
// ENV
// ============================================

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';

// ============================================
// MEMÓRIA
// ============================================

const db = {
  conversas: new Map(),
  mensagens: new Map(),
  intervencao: new Map(),
  dados: new Map(),
  agendamentos: new Map()
};

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  
  console.log(`\\n🌐 ${req.method} ${url.pathname}`);
  
  try {
    // Webhook verification Meta
    if (req.method === 'GET' && query['hub.mode'] === 'subscribe') {
      if (query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    // Receber mensagem WhatsApp
    if (req.method === 'POST' && !query.acao) {
      return await receberMensagem(req, res);
    }
    
    // Ações do painel
    if (req.method === 'POST' && query.acao) {
      return await acaoPainel(req, res, query.acao);
    }
    
    // Listar conversas
    if (req.method === 'GET' && query.acao === 'listar') {
      const lista = Array.from(db.conversas.entries()).map(([tel, conv]) => ({
        telefone: tel,
        nome: conv.nome,
        intervencao: db.intervencao.get(tel),
        dados: db.dados.get(tel),
        ultimaAtividade: conv.ultimaAtividade
      }));
      return res.json(lista);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('💥 ERRO GERAL:', erro);
    return res.status(200).send('OK');
  }
}

// ============================================
// RECEBER MENSAGEM
// ============================================

async function receberMensagem(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (!message || message.type !== 'text') {
    return res.status(200).send('OK');
  }
  
  const telefone = message.from;
  const nome = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = message.text.body;
  
  console.log(`\\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Inicializar conversa
  if (!db.conversas.has(telefone)) {
    db.conversas.set(telefone, {
      nome, telefone, primeiraVez: true, ultimaAtividade: Date.now(), etapa: 'inicio'
    });
    db.mensagens.set(telefone, []);
    db.intervencao.set(telefone, false);
    db.dados.set(telefone, {
      servico: null, bairro: null, valorVisita: null, 
      endereco: null, dataVisita: null, horaVisita: null,
      tipoPintura: null, metragem: null, comodos: null,
      urgente: false
    });
  }
  
  const conversa = db.conversas.get(telefone);
  conversa.ultimaAtividade = Date.now();
  
  // Salvar mensagem
  db.mensagens.get(telefone).push({
    tipo: 'cliente', nome, texto, hora: new Date().toLocaleTimeString('pt-BR')
  });
  
  // Se em intervenção humana
  if (db.intervencao.get(telefone)) {
    await enviarTelegram(`💬 *Intervenção*\\n👤 ${nome}\\n📱 ${telefone}\\n📝 ${texto}`);
    return res.status(200).send('OK');
  }
  
  // Processar com IA
  const resposta = await processarComIA(telefone, nome, texto);
  
  if (resposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      db.mensagens.get(telefone).push({
        tipo: 'robo', nome: 'Consultor RC', texto: resposta, 
        hora: new Date().toLocaleTimeString('pt-BR')
      });
    }
  }
  
  return res.status(200).send('OK');
}

// ============================================
// PROCESSAR COM IA AUTÔNOMA
// ============================================

async function processarComIA(telefone, nome, texto) {
  const conversa = db.conversas.get(telefone);
  const dados = db.dados.get(telefone);
  const t = texto.toLowerCase();
  
  // Verificar intervenção
  if (['atendente', 'humano', 'pessoa', 'falar com', '4', 'gerente'].some(p => t.includes(p))) {
    db.intervencao.set(telefone, true);
    return CONFIG.msgs.intervencao;
  }
  
  // Primeira mensagem
  if (conversa.primeiraVez) {
    conversa.primeiraVez = false;
    conversa.etapa = 'coletando_info';
    return CONFIG.saudacao;
  }
  
  // Detectar urgência
  if (['urgente', 'emergencia', 'vazamento', 'quebrou', 'estourou', 'caiu', 'perigo'].some(u => t.includes(u))) {
    dados.urgente = true;
    await enviarTelegram(`🚨 *SERVIÇO URGENTE* 🚨\\n👤 ${nome}\\n📱 ${telefone}\\n📝 ${texto}\\n⚡ *VERIFICAR IMEDIATAMENTE*`);
  }
  
  // Análise com Groq
  const analise = await analisarComGroq(texto, dados, conversa.etapa);
  
  // Atualizar dados
  if (analise.servico && !dados.servico) dados.servico = analise.servico;
  if (analise.bairro && !dados.bairro) dados.bairro = analise.bairro;
  if (analise.data) dados.dataVisita = analise.data;
  if (analise.hora) dados.horaVisita = analise.hora;
  if (analise.endereco) dados.endereco = analise.endereco;
  if (analise.metragem) dados.metragem = analise.metragem;
  if (analise.comodos) dados.comodos = analise.comodos;
  if (analise.tipoPintura) dados.tipoPintura = analise.tipoPintura;
  
  console.log('📊 Dados atualizados:', dados);
  
  // LÓGICA DE NEGÓCIO
  
  // 1. Se temos serviço e bairro, calcular valor
  if (dados.servico && dados.bairro && !dados.valorVisita) {
    const isZonaSul = CONFIG.bairrosZonaSul.some(b => dados.bairro.toLowerCase().includes(b));
    dados.valorVisita = isZonaSul ? CONFIG.precos.zonaSul : CONFIG.precos.outrasRegioes;
    const regiao = isZonaSul ? 'Zona Sul' : 'outra região';
    
    conversa.etapa = 'aguardando_data';
    
    // Verificar horário
    const horaAtual = new Date().getHours();
    if (horaAtual >= CONFIG.horarioLimite) {
      return CONFIG.msgs.foraHorario;
    }
    
    return CONFIG.msgs.valorVisita(dados.valorVisita, regiao);
  }
  
  // 2. Se temos data/hora, pedir endereço
  if (dados.dataVisita && dados.horaVisita && !dados.endereco && conversa.etapa === 'aguardando_data') {
    conversa.etapa = 'aguardando_endereco';
    return CONFIG.msgs.agendamentoConfirmado(dados.dataVisita, dados.horaVisita);
  }
  
  // 3. Se temos endereço, finalizar e notificar técnico
  if (dados.endereco && conversa.etapa === 'aguardando_endereco') {
    conversa.etapa = 'agendamento_completo';
    
    // Enviar para técnico no WhatsApp
    await notificarTecnicoWhatsApp(dados, nome, telefone);
    
    return `✅ *Agendamento confirmado!*\\n\\n📋 Resumo do seu atendimento:\\n🔧 Serviço: ${dados.servico}\\n📍 Endereço: ${dados.endereco}\\n📅 Data: ${dados.dataVisita} às ${dados.horaVisita}\\n💰 Valor visita: R$${dados.valorVisita}\\n\\nNosso técnico entrará em contato para confirmar. Obrigado pela preferência! 🏠✨`;
  }
  
  // 4. Fluxo especial para pintura sem visita
  if (dados.servico === 'pintura' && dados.bairro && analise.querOrcamentoSemVisita) {
    if (!dados.metragem) {
      return `Para pintura, consigo passar um pré-orçamento sem visita. Qual a metragem quadrada aproximada do ambiente?`;
    }
    if (!dados.comodos) {
      return `Quantos cômodos serão pintados? E são áreas internas, externas ou ambas?`;
    }
    if (!dados.tipoPintura) {
      return `Qual tipo de tinta você prefere? (Padrão, Premium, Lavável, etc)`;
    }
    
    // Calcular orçamento de pintura
    const valorAproximado = calcularOrcamentoPintura(dados.metragem, dados.comodos, dados.tipoPintura);
    return `📊 *Pré-orçamento de Pintura*\\n\\nMetragem: ${dados.metragem}m²\\nCômodos: ${dados.comodos}\\nTipo: ${dados.tipoPintura}\\n\\n💰 *Valor aproximado: R$${valorAproximado}*\\n\\n⚠️ Este é um valor estimado. Para precisão exata, recomendo uma visita técnica gratuita. Deseja agendar?`;
  }
  
  // 5. Se falta serviço ou bairro
  if (!dados.servico && !dados.bairro) {
    return `Para te passar o melhor atendimento, preciso saber:\\n1️⃣ Qual serviço você precisa? (pintura, reforma, marcenaria, gesso, elétrica, hidráulica...)\\n2️⃣ Em qual bairro?`;
  }
  if (!dados.servico) {
    return `Qual serviço você precisa? Temos especialistas em pintura, reformas, marcenaria, gesso, elétrica e hidráulica.`;
  }
  if (!dados.bairro) {
    return `Em qual bairro precisa do serviço? Assim calculo o valor exato da visita técnica.`;
  }
  
  // Fallback
  return await gerarRespostaNaturalGroq(texto, dados, nome);
}

// ============================================
// ANALISAR COM GROQ
// ============================================

async function analisarComGroq(texto, dados, etapa) {
  if (!GROQ_API_KEY) {
    return analiseSimples(texto, dados);
  }
  
  const prompt = `Analise esta mensagem de cliente de reforma e extraia informações estruturadas.

ETAPA ATUAL: ${etapa}
DADOS JÁ COLETADOS: ${JSON.stringify(dados)}

Extraia:
- servico: tipo de serviço (pintura, reforma, marcenaria, gesso, elétrica, hidráulica, etc)
- bairro: nome do bairro
- data: data mencionada (ex: "amanhã", "segunda", "15/04")
- hora: horário mencionado
- endereco: endereço completo se mencionado
- metragem: número em m² se mencionado
- comodos: quantidade de cômodos
- tipoPintura: tipo de tinta
- querOrcamentoSemVisita: boolean (se quer orçamento sem visita para pintura)

Responda em JSON válido.

Mensagem: "${texto}"`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300
      })
    });
    
    if (!response.ok) throw new Error('Erro API');
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    const jsonMatch = content.match(/\\{[\\s\\S]*?\\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return analiseSimples(texto, dados);
    
  } catch (e) {
    console.error('Erro Groq:', e.message);
    return analiseSimples(texto, dados);
  }
}

function analiseSimples(texto, dados) {
  const t = texto.toLowerCase();
  const resultado = {};
  
  // Detectar serviço
  const servicos = ['pintura', 'reforma', 'marcenaria', 'gesso', 'piso', 'banheiro', 'cozinha', 'elétrica', 'hidraulica', 'construção', 'telhado', 'azulejo', 'armário'];
  const servicoDetectado = servicos.find(s => t.includes(s));
  if (servicoDetectado && !dados.servico) resultado.servico = servicoDetectado;
  
  // Detectar bairro
  if (t.includes('bairro')) {
    const match = texto.match(/bairro[\\s:]*([^,\\.\\n]+)/i);
    if (match) resultado.bairro = match[1].trim();
  } else {
    // Última palavra capitalizada
    const palavras = texto.split(/\\s+/);
    for (let i = palavras.length - 1; i >= 0; i--) {
      if (/^[A-Z][a-z]+$/.test(palavras[i])) {
        resultado.bairro = palavras[i];
        break;
      }
    }
  }
  
  // Detectar data
  if (t.includes('hoje')) resultado.data = new Date().toLocaleDateString('pt-BR');
  else if (t.includes('amanhã') || t.includes('amanha')) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    resultado.data = amanha.toLocaleDateString('pt-BR');
  }
  
  // Detectar hora
  const horaMatch = texto.match(/(\\d{1,2})[h:](\\d{2})?/);
  if (horaMatch) resultado.hora = `${horaMatch[1]}:${horaMatch[2] || '00'}`;
  
  // Detectar endereço
  if (t.includes('rua') || t.includes('av') || t.includes('avenida') || t.includes('nº') || t.includes('numero')) {
    resultado.endereco = texto;
  }
  
  return resultado;
}

// ============================================
// NOTIFICAR TÉCNICO VIA WHATSAPP
// ============================================

async function notificarTecnicoWhatsApp(dados, nomeCliente, telCliente) {
  // Determinar qual técnico
  let tecnico;
  if (dados.servico === 'marcenaria') {
    tecnico = CONFIG.tecnicos.marcenaria;
  } else if (['hidraulica', 'encanamento', 'vazamento'].includes(dados.servico)) {
    tecnico = CONFIG.tecnicos.hidraulica;
  } else {
    tecnico = CONFIG.tecnicos.reforma; // Serviços gerais
  }
  
  const mensagemTecnico = `🛠️ *NOVO AGENDAMENTO - RC REFORMAS*

👤 *Cliente:* ${nomeCliente}
📱 *Tel:* ${telCliente}
🔧 *Serviço:* ${dados.servico}
📍 *Bairro:* ${dados.bairro}
🏠 *Endereço:* ${dados.endereco}
📅 *Data:* ${dados.dataVisita}
⏰ *Horário:* ${dados.horaVisita}
💰 *Valor Visita:* R$${dados.valorVisita}
${dados.urgente ? '\\n🚨 *ATENÇÃO: SERVIÇO URGENTE*' : ''}

✅ *Confirmar disponibilidade respondendo neste chat*`;

  console.log(`\\n📤 ENVIANDO PARA TÉCNICO (${tecnico.nome}):`);
  console.log(mensagemTecnico);
  
  // Enviar mensagem para o técnico
  const enviado = await enviarWhatsApp(tecnico.whatsapp, mensagemTecnico);
  
  if (enviado) {
    console.log(`✅ Notificação enviada ao técnico ${tecnico.nome}`);
    await enviarTelegram(`✅ Técnico ${tecnico.nome} notificado\\n📱 ${tecnico.whatsapp}\\n👤 ${nomeCliente}`);
  } else {
    console.error(`❌ Falha ao notificar técnico`);
    await enviarTelegram(`⚠️ *FALHA AO NOTIFICAR TÉCNICO*\\n👤 ${nomeCliente}\\n📱 ${telCliente}\\n🔧 ${dados.servico}`);
  }
  
  return enviado;
}

// ============================================
// CALCULAR ORÇAMENTO PINTURA
// ============================================

function calcularOrcamentoPintura(metragem, comodos, tipoTinta) {
  const m = parseFloat(metragem) || 0;
  const c = parseInt(comodos) || 1;
  
  // Preços por m²
  let valorM2 = 25; // Padrão
  if (tipoTinta && tipoTinta.toLowerCase().includes('premium')) valorM2 = 45;
  if (tipoTinta && tipoTinta.toLowerCase().includes('lavavel')) valorM2 = 35;
  
  const total = (m * valorM2) + (c * 150); // Acréscimo por cômodo
  return Math.round(total);
}

// ============================================
// GERAR RESPOSTA NATURAL COM GROQ
// ============================================

async function gerarRespostaNaturalGroq(texto, dados, nome) {
  if (!GROQ_API_KEY) {
    return `Entendido, ${nome}! Estou processando sua solicitação. Poderia confirmar o dia e horário que prefere para a visita técnica?`;
  }
  
  const prompt = `Você é um consultor de vendas experiente da RC Reformas. Seja simpático, profissional e direto.

DADOS DO CLIENTE:
- Nome: ${nome}
- Serviço: ${dados.servico || 'Não definido'}
- Bairro: ${dados.bairro || 'Não definido'}
- Valor visita: ${dados.valorVisita ? 'R$' + dados.valorVisita : 'Não calculado'}

HISTÓRICO RECENTE:
${db.mensagens.get(dados.telefone)?.slice(-3).map(m => `${m.nome}: ${m.texto}`).join('\\n')}

Responda de forma natural e objetiva (máximo 2-3 frases). Não seja robótico.

Mensagem do cliente: "${texto}"`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
    
  } catch (e) {
    return `Perfeito, ${nome}! Só confirmar: você precisa de ${dados.servico || 'reforma'} no bairro ${dados.bairro || 'informado'}. Qual melhor dia e horário para nossa visita técnica?`;
  }
}

// ============================================
// ENVIAR WHATSAPP (FUNÇÃO PRINCIPAL)
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`\\n📤 ENVIANDO WHATSAPP:`);
  console.log(`   Para: ${numero}`);
  console.log(`   Mensagem: ${texto.substring(0, 100)}${texto.length > 100 ? '...' : ''}`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ ERRO CRÍTICO: Variáveis de ambiente não configuradas!');
    console.error('   WHATSAPP_TOKEN:', WHATSAPP_TOKEN ? 'OK' : 'FALTANDO');
    console.error('   WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID ? 'OK' : 'FALTANDO');
    return false;
  }
  
  // Limpar número (remover não-dígitos)
  const numeroLimpo = numero.toString().replace(/\\D/g, '');
  
  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numeroLimpo,
        type: 'text',
        text: { body: texto }
      })
    });
    
    const responseData = await response.json();
    
    console.log(`   Status HTTP: ${response.status}`);
    
    if (!response.ok) {
      console.error('❌ ERRO:', JSON.stringify(responseData));
      return false;
    }
    
    console.log('✅ Mensagem enviada com sucesso!');
    return true;
    
  } catch (e) {
    console.error('❌ EXCEÇÃO:', e.message);
    return false;
  }
}

// ============================================
// ENVIAR TELEGRAM
// ============================================

async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    console.log('⚠️ Telegram não configurado');
    return;
  }
  
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
// PAINEL ADMIN
// ============================================

async function acaoPainel(req, res, acao) {
  const body = req.body;
  const tel = body.telefone;
  
  if (!db.conversas.has(tel)) {
    return res.json({ erro: 'Telefone não encontrado' });
  }
  
  if (acao === 'intervir') {
    db.intervencao.set(tel, true);
    await enviarWhatsApp(tel, CONFIG.msgs.intervencao);
    await enviarTelegram(`🚨 *INTERVENÇÃO*\\n📱 ${tel}`);
    return res.json({ ok: true });
  }
  
  if (acao === 'liberar') {
    db.intervencao.set(tel, false);
    db.conversas.get(tel).primeiraVez = false;
    await enviarWhatsApp(tel, '🤖 Consultor RC retomou. Como posso ajudar?');
    return res.json({ ok: true });
  }
  
  if (acao === 'enviar') {
    if (!db.intervencao.get(tel)) {
      return res.json({ erro: 'Não está em intervenção' });
    }
    const ok = await enviarWhatsApp(tel, body.mensagem);
    return res.json({ ok });
  }
  
  res.json({ erro: 'Ação inválida' });
}'''

print(codigo_atualizado)
