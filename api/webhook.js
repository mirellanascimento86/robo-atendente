
# Vou criar o código corrigido para você

codigo_corrigido = '''// ============================================
// CONFIGURAÇÃO DO ROBÔ - EDITE AQUI
// ============================================

const CONFIG_ROBO = {
  saudacao: `Olá! Bem-vindo ao Atendimento Digital da RC. Qual serviço precisa e qual o bairro?`,

  respostas: {
    "preço|valor|custo|quanto": `💰 Orçamento gratuito! Envie fotos do local.`,
    "prazo|tempo|demora": `⏱️ Reformas: 3-7 dias | Marcenaria: 15-30 dias`,
    "pagamento|paga": `💳 Pix (5% off), Cartão 12x, ou 50% + 50%`,
    "marcenaria|móvel|armário": `Gostaria de Atendimento ainda hoje?`,
    "reforma|banheiro|pintura": `Gostaria de Atendimento ainda hoje?`,
    "construção|casa|obra": `Gostaria de Atendimento ainda hoje?`,
    "visita|técnico": `📍 Visita: R$150 (deduzido do orçamento)`
  },

  fluxo_reforma: {
    p1: "Qual cômodo? (banheiro, cozinha, quarto, sala)",
    p2: "Qual bairro?",
    p3: "Descreva o que precisa:",
    p4: "Seu nome e melhor horário?",
    final: `✅ Visita agendada! Técnico entra em contato em 24h.`
  },

  fluxo_marcenaria: {
    p1: "Qual móvel? (cozinha, guarda-roupa, escritório)",
    p2: "Tem as medidas? (C x A x P)",
    final: `✅ Pedido registrado! Marceneiro visita para medição.`
  },

  fluxo_construcao: {
    p1: "Qual obra? (casa, ampliação, regularização)",
    final: `🏗️ Projeto anotado! Engenheiro visita em 48h.`
  },

  intervencao: {
    palavras: ["atendente", "humano", "pessoa", "falar com", "4"],
    mensagem: `🔄 Transferindo para atendente humano...`
  },

  // 👨‍🔧 TÉCNICOS CADASTRADOS (adicione aqui)
  tecnicos: [
    {
      nome: "João - Reformas",
      telegram: process.env.TELEGRAM_CHAT_ID,
      especialidade: "reforma",
      disponivel: true
    },
    {
      nome: "Maria - Marcenaria", 
      telegram: process.env.TELEGRAM_CHAT_ID,
      especialidade: "marcenaria",
      disponivel: true
    }
  ]
};

// ============================================
// TELEGRAM CONFIG
// ============================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

// ============================================
// GROQ AI CONFIG
// ============================================

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';

// ============================================
// BANCO DE DADOS EM MEMÓRIA
// ============================================

const memoria = {
  conversas: {},
  mensagens: {},
  intervencao: {},
  estados: {},
  visitasHoje: [],
  tecnicosNotificados: {},
  contextoIA: {},
  dadosColetados: {} // NOVO: Armazena serviço e bairro detectados
};

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  
  // --- GET: Verificação Meta ---
  if (req.method === 'GET' && query['hub.mode']) {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === 'roboatendente') {
      return res.status(200).send(query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }
  
  // --- GET: Listar conversas (para painel) ---
  if (req.method === 'GET' && query.acao === 'listar') {
    const lista = Object.keys(memoria.conversas).map(tel => ({
      telefone: tel,
      nome: memoria.conversas[tel].nome || 'Cliente',
      intervencao: !!memoria.intervencao[tel],
      ultima: memoria.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 40) + '...' || '...',
      ultimaAtividade: memoria.conversas[tel].ultimaAtividade || 0
    }));
    return res.json(lista);
  }
  
  // --- GET: Buscar mensagens ---
  if (req.method === 'GET' && query.acao === 'mensagens') {
    return res.json(memoria.mensagens[query.telefone] || []);
  }
  
  // --- GET: Relatório diário ---
  if (req.method === 'GET' && query.acao === 'relatorio') {
    return enviarRelatorioDiario(res);
  }
  
  // --- POST: Receber mensagem WhatsApp ---
  if (req.method === 'POST' && !query.acao) {
    try {
      const body = req.body;
      
      if (body.object !== 'whatsapp_business_account') {
        return res.status(200).send('OK');
      }
      
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      
      if (!message || message.type !== 'text') {
        return res.status(200).send('OK');
      }
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      const texto = message.text.body;
      
      console.log(`📩 ${nome} (${telefone}): ${texto}`);
      
      // INICIALIZAR SE NOVO
      if (!memoria.conversas[telefone]) {
        memoria.conversas[telefone] = { 
          nome, 
          inicio: new Date().toISOString(),
          ultimaAtividade: Date.now(),
          etapa: 'inicio' // NOVO: Controla etapa do atendimento
        };
        memoria.mensagens[telefone] = [];
        memoria.estados[telefone] = 'inicio';
        memoria.intervencao[telefone] = false;
        memoria.contextoIA[telefone] = [];
        memoria.dadosColetados[telefone] = { servico: null, bairro: null };
      }
      
      // ATUALIZAR ATIVIDADE
      memoria.conversas[telefone].ultimaAtividade = Date.now();
      
      // SALVAR MENSAGEM DO CLIENTE
      memoria.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // Adicionar ao contexto da IA
      memoria.contextoIA[telefone].push({
        role: 'user',
        content: texto
      });
      
      // SE EM INTERVENÇÃO, NÃO RESPONDE
      if (memoria.intervencao[telefone]) {
        enviarTelegram(`💬 *Mensagem cliente (em intervenção)*\\n\\n👤 ${nome}\\n📱 ${telefone}\\n📝 ${texto.substring(0, 100)}`);
        return res.status(200).send('OK');
      }
      
      // PROCESSAR E RESPONDER COM IA
      const resposta = await processarMensagemComIA(telefone, nome, texto);
      
      if (resposta) {
        await enviarWhatsApp(telefone, resposta);
        
        memoria.mensagens[telefone].push({
          tipo: 'robo',
          nome: 'Robô',
          texto: resposta,
          hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
        });
        
        memoria.contextoIA[telefone].push({
          role: 'assistant',
          content: resposta
        });
        
        // Limitar contexto
        if (memoria.contextoIA[telefone].length > 20) {
          memoria.contextoIA[telefone] = memoria.contextoIA[telefone].slice(-20);
        }
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('❌ Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  // --- POST: Ações do painel ---
  if (req.method === 'POST') {
    const { acao } = query;
    const body = req.body;
    const tel = body.telefone;
    
    if (!tel || !memoria.conversas[tel]) {
      return res.json({ erro: 'Telefone não encontrado' });
    }
    
    if (acao === 'intervir') {
      console.log(`🚨 Intervindo: ${tel}`);
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio';
      await enviarWhatsApp(tel, CONFIG_ROBO.intervencao.mensagem);
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Você assumiu o controle]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      enviarTelegram(`🚨 *INTERVENÇÃO*\\n📱 ${tel}\\n👤 ${memoria.conversas[tel].nome}`);
      return res.json({ ok: true, status: 'intervencao_ativada' });
    }
    
    if (acao === 'liberar') {
      console.log(`🤖 Liberando: ${tel}`);
      memoria.intervencao[tel] = false;
      memoria.estados[tel] = 'inicio';
      memoria.conversas[tel].etapa = 'inicio';
      await enviarWhatsApp(tel, '🤖 Robô retomou. Como posso ajudar?');
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Robô retomou o atendimento]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      return res.json({ ok: true, status: 'robo_ativado' });
    }
    
    if (acao === 'enviar') {
      if (!memoria.intervencao[tel]) {
        return res.json({ erro: 'Não está em intervenção' });
      }
      const mensagem = body.mensagem;
      if (!mensagem?.trim()) {
        return res.json({ erro: 'Mensagem vazia' });
      }
      await enviarWhatsApp(tel, mensagem);
      memoria.mensagens[tel].push({
        tipo: 'humano',
        nome: 'Você',
        texto: mensagem,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      memoria.conversas[tel].ultimaAtividade = Date.now();
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// PROCESSAR MENSAGEM COM IA (GROQ) - CORRIGIDO
// ============================================

async function processarMensagemComIA(tel, nome, texto) {
  const t = texto.toLowerCase().trim();
  const config = CONFIG_ROBO;
  const etapa = memoria.conversas[tel].etapa;
  const dados = memoria.dadosColetados[tel];
  
  // 1. VERIFICAR INTERVENÇÃO HUMANA
  for (const palavra of config.intervencao.palavras) {
    if (t.includes(palavra.toLowerCase())) {
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio';
      enviarTelegram(`🚨 *Cliente pediu humano*\\n👤 ${nome}\\n📱 ${tel}`);
      return config.intervencao.mensagem;
    }
  }
  
  // 2. PRIMEIRA MENSAGEM - Enviar saudação
  if (etapa === 'inicio' && memoria.mensagens[tel].filter(m => m.tipo === 'cliente').length === 1) {
    memoria.conversas[tel].etapa = 'aguardando_servico_bairro';
    return config.saudacao;
  }
  
  // 3. ANÁLISE INTELIGENTE COM IA
  try {
    const analise = await analisarMensagemComIA(tel, nome, texto);
    
    // Atualizar dados coletados se a IA encontrou
    if (analise.servicoDetectado) {
      dados.servico = analise.servico;
    }
    if (analise.bairroDetectado) {
      dados.bairro = analise.bairro;
    }
    
    // LÓGICA DE RESPOSTA BASEADA NO QUE FOI DETECTADO
    
    // Caso 1: Tem serviço E bairro
    if (dados.servico && dados.bairro) {
      memoria.conversas[tel].etapa = 'confirmar_atendimento';
      return `Gostaria de Atendimento ainda hoje?`;
    }
    
    // Caso 2: Não tem serviço e NÃO tem bairro
    if (!dados.servico && !dados.bairro) {
      return `Por favor, me informe o serviço que deseja e o bairro`;
    }
    
    // Caso 3: Tem bairro mas NÃO tem serviço
    if (!dados.servico && dados.bairro) {
      return `Por favor, me informe o serviço que deseja`;
    }
    
    // Caso 4: Tem serviço mas NÃO tem bairro
    if (dados.servico && !dados.bairro) {
      return `Por favor, me informe o bairro que deseja atendimento`;
    }
    
  } catch (erro) {
    console.error('❌ Erro na análise da IA:', erro);
    // Fallback simples
    return `Desculpe, não entendi. Pode me informar o serviço que precisa e o bairro?`;
  }
}

// ============================================
// ANALISAR MENSAGEM COM IA (GROQ)
// ============================================

async function analisarMensagemComIA(tel, nome, texto) {
  const promptAnalise = `Você é um analisador de intenções para uma empresa de reforma e construção.

Analise a mensagem do cliente e extraia:
1. Se foi mencionado algum SERVIÇO de reforma/construção
2. Se foi mencionado algum BAIRRO

Serviços válidos: reforma, pintura, marcenaria, gesso, piso, banheiro, cozinha, elétrica, hidráulica, construção, obra, telhado, azulejo, porcelanato, armário, móvel, etc.

Responda APENAS em formato JSON:
{
  "servicoDetectado": true/false,
  "servico": "nome do serviço ou null",
  "bairroDetectado": true/false,
  "bairro": "nome do bairro ou null"
}

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
        messages: [
          { role: 'system', content: promptAnalise }
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const resultado = JSON.parse(data.choices[0].message.content);
    
    console.log('🔍 Análise IA:', resultado);
    return resultado;
    
  } catch (erro) {
    console.error('❌ Erro ao analisar:', erro);
    // Fallback: análise simples
    return {
      servicoDetectado: false,
      servico: null,
      bairroDetectado: false,
      bairro: null
    };
  }
}

// ============================================
// NOTIFICAR TÉCNICOS
// ============================================

function notificarTecnicos(visita) {
  const tecnico = CONFIG_ROBO.tecnicos.find(t => 
    t.especialidade === visita.servico.toLowerCase() && t.disponivel
  );
  
  if (tecnico) {
    const msg = `👨‍🔧 *NOVO AGENDAMENTO - ${visita.servico}*

👤 Cliente: ${visita.nome}
📱 ${visita.telefone}
📍 ${visita.bairro || visita.tipo || 'Não informado'}
🏠 ${visita.comodo || visita.movel || ''}
📝 ${visita.descricao?.substring(0, 50) || ''}
⏰ ${visita.hora}

*Responda aqui se puder atender.*`;
    
    enviarTelegram(msg);
    
    memoria.tecnicosNotificados[visita.telefone] = {
      tecnico: tecnico.nome,
      hora: visita.hora,
      respondido: false
    };
  } else {
    enviarTelegram(`⚠️ *AGENDAMENTO SEM TÉCNICO ESPECÍFICO*

${visita.servico} - ${visita.nome}
📱 ${visita.telefone}
📍 ${visita.bairro || 'Não informado'}

*Cadastre um técnico para esta especialidade.*`);
  }
}

// ============================================
// ENVIAR WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: texto }
      })
    });
  } catch (e) {
    console.error('❌ Erro WhatsApp:', e);
  }
}

// ============================================
// ENVIAR TELEGRAM
// ============================================

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
    console.error('❌ Erro Telegram:', e);
  }
}

// ============================================
// RELATÓRIO DIÁRIO 19H
// ============================================

async function enviarRelatorioDiario(res) {
  const hoje = new Date().toLocaleDateString('pt-BR');
  
  if (memoria.visitasHoje.length === 0) {
    enviarTelegram(`📊 *RELATÓRIO ${hoje}*\\n\\nNenhuma visita marcada.`);
    return res?.json({ mensagem: 'Sem visitas' });
  }
  
  let texto = `📊 *RELATÓRIO DIÁRIO - ${hoje}*\\n\\n`;
  texto += `*Total:* ${memoria.visitasHoje.length} visitas\\n\\n`;
  
  memoria.visitasHoje.forEach((v, i) => {
    texto += `*${i + 1}.* ${v.nome}\\n`;
    texto += `   📱 ${v.telefone}\\n`;
    texto += `   🏠 ${v.servico}`;
    if (v.comodo) texto += ` - ${v.comodo}`;
    if (v.movel) texto += ` - ${v.movel}`;
    texto += `\\n`;
    if (v.bairro) texto += `   📍 ${v.bairro}\\n`;
    texto += `   ⏰ ${v.hora}\\n\\n`;
  });
  
  const reformas = memoria.visitasHoje.filter(v => v.servico === 'Reforma').length;
  const marcenarias = memoria.visitasHoje.filter(v => v.servico === 'Marcenaria').length;
  const construcoes = memoria.visitasHoje.filter(v => v.servico === 'Construção').length;
  
  texto += `\\n*Resumo:*\\n`;
  texto += `🔨 Reformas: ${reformas}\\n`;
  texto += `🪚 Marcenarias: ${marcenarias}\\n`;
  texto += `🏗️ Construções: ${construcoes}\\n`;
  
  enviarTelegram(texto);
  
  memoria.visitasHoje = [];
  memoria.tecnicosNotificados = {};
  
  res?.json({ ok: true, enviados: memoria.visitasHoje.length });
}

export { enviarRelatorioDiario };'''

print(codigo_corrigido)
