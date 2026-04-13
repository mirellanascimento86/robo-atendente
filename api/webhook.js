
codigo_completo = '''// ============================================
// CONFIGURAÇÃO DO ROBÔ
// ============================================

const CONFIG_ROBO = {
  saudacao: `Olá! Bem-vindo ao Atendimento Digital da RC. Qual serviço precisa e qual o bairro?`,

  intervencao: {
    palavras: ["atendente", "humano", "pessoa", "falar com", "4"],
    mensagem: `🔄 Transferindo para atendente humano...`
  },

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
// CONFIGS
// ============================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';

// ============================================
// MEMÓRIA
// ============================================

const memoria = {
  conversas: {},
  mensagens: {},
  intervencao: {},
  dadosColetados: {}
};

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  
  // GET: Verificação Meta
  if (req.method === 'GET' && query['hub.mode']) {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === 'roboatendente') {
      return res.status(200).send(query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }
  
  // GET: Listar conversas
  if (req.method === 'GET' && query.acao === 'listar') {
    const lista = Object.keys(memoria.conversas).map(tel => ({
      telefone: tel,
      nome: memoria.conversas[tel]?.nome || 'Cliente',
      intervencao: !!memoria.intervencao[tel],
      ultima: memoria.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 40) + '...' || '...',
      ultimaAtividade: memoria.conversas[tel]?.ultimaAtividade || 0
    }));
    return res.json(lista);
  }
  
  // GET: Buscar mensagens
  if (req.method === 'GET' && query.acao === 'mensagens') {
    return res.json(memoria.mensagens[query.telefone] || []);
  }
  
  // POST: Receber mensagem WhatsApp
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
      
      // Inicializar se novo
      if (!memoria.conversas[telefone]) {
        memoria.conversas[telefone] = { 
          nome, 
          inicio: new Date().toISOString(),
          ultimaAtividade: Date.now(),
          primeiraMensagem: true
        };
        memoria.mensagens[telefone] = [];
        memoria.intervencao[telefone] = false;
        memoria.dadosColetados[telefone] = { servico: null, bairro: null };
      }
      
      memoria.conversas[telefone].ultimaAtividade = Date.now();
      
      // Salvar mensagem do cliente
      memoria.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // Se em intervenção, só notifica Telegram
      if (memoria.intervencao[telefone]) {
        await enviarTelegram(`💬 *Intervenção*\\n👤 ${nome}\\n📱 ${telefone}\\n📝 ${texto}`);
        return res.status(200).send('OK');
      }
      
      // Processar e responder
      const resposta = await processarMensagem(tel, nome, texto);
      
      if (resposta) {
        await enviarWhatsApp(telefone, resposta);
        
        memoria.mensagens[telefone].push({
          tipo: 'robo',
          nome: 'Robô',
          texto: resposta,
          hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
        });
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('❌ Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  // POST: Ações do painel
  if (req.method === 'POST' && query.acao) {
    const body = req.body;
    const tel = body.telefone;
    
    if (!tel || !memoria.conversas[tel]) {
      return res.json({ erro: 'Telefone não encontrado' });
    }
    
    if (query.acao === 'intervir') {
      memoria.intervencao[tel] = true;
      await enviarWhatsApp(tel, CONFIG_ROBO.intervencao.mensagem);
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Atendente assumiu]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      await enviarTelegram(`🚨 *INTERVENÇÃO*\\n📱 ${tel}`);
      return res.json({ ok: true });
    }
    
    if (query.acao === 'liberar') {
      memoria.intervencao[tel] = false;
      memoria.conversas[tel].primeiraMensagem = false;
      await enviarWhatsApp(tel, '🤖 Robô retomou. Como posso ajudar?');
      return res.json({ ok: true });
    }
    
    if (query.acao === 'enviar') {
      if (!memoria.intervencao[tel]) {
        return res.json({ erro: 'Não está em intervenção' });
      }
      await enviarWhatsApp(tel, body.mensagem);
      memoria.mensagens[tel].push({
        tipo: 'humano',
        nome: 'Atendente',
        texto: body.mensagem,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// PROCESSAR MENSAGEM
// ============================================

async function processarMensagem(tel, nome, texto) {
  const t = texto.toLowerCase().trim();
  const conversa = memoria.conversas[tel];
  const dados = memoria.dadosColetados[tel];
  
  // Verificar intervenção
  for (const palavra of CONFIG_ROBO.intervencao.palavras) {
    if (t.includes(palavra.toLowerCase())) {
      memoria.intervencao[tel] = true;
      await enviarTelegram(`🚨 *Cliente pediu humano*\\n👤 ${nome}\\n📱 ${tel}`);
      return CONFIG_ROBO.intervencao.mensagem;
    }
  }
  
  // PRIMEIRA MENSAGEM - Saudação
  if (conversa.primeiraMensagem) {
    conversa.primeiraMensagem = false;
    return CONFIG_ROBO.saudacao;
  }
  
  // Analisar com IA
  try {
    const analise = await analisarComGroq(texto);
    
    // Atualizar dados
    if (analise.servico && !dados.servico) dados.servico = analise.servico;
    if (analise.bairro && !dados.bairro) dados.bairro = analise.bairro;
    
    console.log('📊 Dados coletados:', dados);
    
    // Responder baseado no que temos
    if (dados.servico && dados.bairro) {
      return `Gostaria de Atendimento ainda hoje?`;
    } else if (!dados.servico && !dados.bairro) {
      return `Por favor, me informe o serviço que deseja e o bairro`;
    } else if (!dados.servico && dados.bairro) {
      return `Por favor, me informe o serviço que deseja`;
    } else if (dados.servico && !dados.bairro) {
      return `Por favor, me informe o bairro que deseja atendimento`;
    }
    
  } catch (erro) {
    console.error('❌ Erro IA:', erro);
    return `Desculpe, não entendi. Pode repetir o serviço e bairro?`;
  }
}

// ============================================
// ANALISAR COM GROQ
// ============================================

async function analisarComGroq(texto) {
  if (!GROQ_API_KEY) {
    // Fallback se não tiver API key
    return { servico: null, bairro: null };
  }
  
  const prompt = `Analise esta mensagem de um cliente de reforma/construção e extraia:
1. O SERVIÇO mencionado (pintura, reforma, marcenaria, gesso, piso, banheiro, cozinha, elétrica, hidráulica, construção, etc.)
2. O BAIRRO mencionado

Responda APENAS em JSON:
{"servico": "nome do serviço ou null", "bairro": "nome do bairro ou null"}

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
        max_tokens: 150
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extrair JSON da resposta
    const jsonMatch = content.match(/\\{[^}]+\\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { servico: null, bairro: null };
    
  } catch (erro) {
    console.error('Erro Groq:', erro);
    return { servico: null, bairro: null };
  }
}

// ============================================
// ENVIAR WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Erro WhatsApp API:', error);
    } else {
      console.log('✅ Enviado para', numero);
    }
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
}'''

print(codigo_completo)
