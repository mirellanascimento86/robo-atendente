// ============================================
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
      telegram: process.env.TELEGRAM_CHAT_ID, // Ou ID específico
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
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192'; // ou 'mixtral-8x7b-32768', 'llama3-8b-8192'

// ============================================
// BANCO DE DADOS EM MEMÓRIA
// ============================================

const memoria = {
  conversas: {},
  mensagens: {},
  intervencao: {},
  estados: {},
  visitasHoje: [],
  tecnicosNotificados: {}, // Para rastrear quem já foi notificado
  contextoIA: {} // Histórico de contexto para IA
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
      // Importante: enviar timestamp para painel saber se precisa atualizar
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
          ultimaAtividade: Date.now()
        };
        memoria.mensagens[telefone] = [];
        memoria.estados[telefone] = 'inicio';
        memoria.intervencao[telefone] = false;
        memoria.contextoIA[telefone] = []; // Inicializar contexto da IA
      }
      
      // ATUALIZAR ATIVIDADE (timestamp para painel detectar mudança)
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
      
      // SE EM INTERVENÇÃO, NÃO RESPONDE (mas notifica Telegram)
      if (memoria.intervencao[telefone]) {
        enviarTelegram(`💬 *Mensagem cliente (em intervenção)*\n\n👤 ${nome}\n📱 ${telefone}\n📝 ${texto.substring(0, 100)}`);
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
        
        // Adicionar resposta ao contexto da IA
        memoria.contextoIA[telefone].push({
          role: 'assistant',
          content: resposta
        });
        
        // Limitar contexto para não estourar tokens (últimas 10 mensagens)
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
    
    // INTERVIR - Assumir controle
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
      
      enviarTelegram(`🚨 *INTERVENÇÃO*\n📱 ${tel}\n👤 ${memoria.conversas[tel].nome}`);
      
      return res.json({ ok: true, status: 'intervencao_ativada' });
    }
    
    // LIBERAR - Devolver ao robô
    if (acao === 'liberar') {
      console.log(`🤖 Liberando: ${tel}`);
      
      memoria.intervencao[tel] = false;
      memoria.estados[tel] = 'inicio';
      
      await enviarWhatsApp(tel, '🤖 Robô retomou. Como posso ajudar?');
      
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Robô retomou o atendimento]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true, status: 'robo_ativado' });
    }
    
    // ENVIAR - Mensagem humana
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
      
      // Atualizar timestamp para painel detectar
      memoria.conversas[tel].ultimaAtividade = Date.now();
      
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// PROCESSAR MENSAGEM COM IA (GROQ)
// ============================================

async function processarMensagemComIA(tel, nome, texto) {
  const t = texto.toLowerCase();
  const config = CONFIG_ROBO;
  
  // 1. VERIFICAR INTERVENÇÃO HUMANA (palavras-chave)
  for (const palavra of config.intervencao.palavras) {
    if (t.includes(palavra.toLowerCase())) {
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio';
      enviarTelegram(`🚨 *Cliente pediu humano*\n👤 ${nome}\n📱 ${tel}`);
      return config.intervencao.mensagem;
    }
  }
  
  // 2. VERIFICAR SE É PRIMEIRA MENSAGEM (saudação)
  if (memoria.contextoIA[tel].length === 1) {
    return config.saudacao;
  }
  
  // 3. PROCESSAR COM GROQ IA
  try {
    const respostaIA = await chamarGroqIA(tel, nome, texto);
    return respostaIA;
  } catch (erro) {
    console.error('❌ Erro na IA:', erro);
    // Fallback para resposta padrão se IA falhar
    return `Olá ${nome}! 👋\n\nComo posso ajudar com reforma, marcenaria ou construção?`;
  }
}

// ============================================
// CHAMAR API GROQ
// ============================================

async function chamarGroqIA(tel, nome, texto) {
  const systemPrompt = `Você é o assistente virtual da RC (Reforma e Construção), uma empresa de serviços de reforma, marcenaria e construção civil.

SUA MISSÃO:
- Atender clientes de forma natural, amigável e profissional
- Identificar o serviço que o cliente precisa (reforma, marcenaria, construção, pintura, gesso, piso, elétrica, hidráulica, etc.)
- Identificar o bairro onde o cliente precisa do serviço
- Coletar informações essenciais para agendar uma visita técnica

REGRAS IMPORTANTES:
1. SEMPRE que o cliente mencionar um serviço de reforma/construção (pintura, marcenaria, gesso, piso, banheiro, cozinha, elétrica, hidráulica, etc.) E um bairro, pergunte: "Gostaria de Atendimento ainda hoje?"

2. Se o cliente NÃO informar o serviço e NEM o bairro, diga: "Por favor, me informe o serviço que deseja e o bairro"

3. Se o cliente informar APENAS o bairro (sem o serviço), diga: "Por favor, me informe o serviço que deseja"

4. Se o cliente informar APENAS o serviço (sem o bairro), diga: "Por favor, me informe o bairro que deseja atendimento"

5. Seja sempre cordial, use emojis ocasionalmente, e mantenha respostas curtas e objetivas (máximo 2-3 frases)

6. Se o cliente perguntar sobre preços, informe que o orçamento é gratuito após visita técnica

7. Se o cliente perguntar sobre prazos, informe que depende do serviço e será passado na visita

8. Formas de pagamento: Pix (5% desconto), Cartão em até 12x, ou 50% + 50%

9. SEMPRE que possível, direcione para agendar uma visita técnica

10. Se não souber responder algo específico, transfira para atendente humano dizendo "Vou transferir você para um de nossos atendentes"

DADOS DO CLIENTE:
Nome: ${nome}
Telefone: ${tel}

HISTÓRICO DA CONVERSA:`;

  // Montar mensagens para a API
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    ...memoria.contextoIA[tel].slice(-10) // Últimas 10 mensagens do contexto
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
      top_p: 1,
      stream: false
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ============================================
// NOTIFICAR TÉCNICOS
// ============================================

function notificarTecnicos(visita) {
  // Encontrar técnico da especialidade
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
    
    // Salvar que notificou este técnico para esta visita
    memoria.tecnicosNotificados[visita.telefone] = {
      tecnico: tecnico.nome,
      hora: visita.hora,
      respondido: false
    };
  } else {
    // Notificar chat geral se não achou técnico específico
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
    enviarTelegram(`📊 *RELATÓRIO ${hoje}*\n\nNenhuma visita marcada.`);
    return res?.json({ mensagem: 'Sem visitas' });
  }
  
  let texto = `📊 *RELATÓRIO DIÁRIO - ${hoje}*\n\n`;
  texto += `*Total:* ${memoria.visitasHoje.length} visitas\n\n`;
  
  memoria.visitasHoje.forEach((v, i) => {
    texto += `*${i + 1}.* ${v.nome}\n`;
    texto += `   📱 ${v.telefone}\n`;
    texto += `   🏠 ${v.servico}`;
    if (v.comodo) texto += ` - ${v.comodo}`;
    if (v.movel) texto += ` - ${v.movel}`;
    texto += `\n`;
    if (v.bairro) texto += `   📍 ${v.bairro}\n`;
    texto += `   ⏰ ${v.hora}\n\n`;
  });
  
  // Resumo por tipo
  const reformas = memoria.visitasHoje.filter(v => v.servico === 'Reforma').length;
  const marcenarias = memoria.visitasHoje.filter(v => v.servico === 'Marcenaria').length;
  const construcoes = memoria.visitasHoje.filter(v => v.servico === 'Construção').length;
  
  texto += `\n*Resumo:*\n`;
  texto += `🔨 Reformas: ${reformas}\n`;
  texto += `🪚 Marcenarias: ${marcenarias}\n`;
  texto += `🏗️ Construções: ${construcoes}\n`;
  
  enviarTelegram(texto);
  
  // Limpar para amanhã
  memoria.visitasHoje = [];
  memoria.tecnicosNotificados = {};
  
  res?.json({ ok: true, enviados: memoria.visitasHoje.length });
}

// Exportar para possível cron externo
export { enviarRelatorioDiario };
