// ============================================
// CONFIGURAÇÃO
// ============================================

const CONFIG = {
  saudacao: `Olá! Bem-vindo ao Atendimento Digital da RC. Qual serviço precisa e qual o bairro?`,
  palavrasIntervencao: ["atendente", "humano", "pessoa", "falar com", "4"],
  msgIntervencao: `🔄 Transferindo para atendente humano...`,
  msgs: {
    semServicoSemBairro: `Por favor, me informe o serviço que deseja e o bairro`,
    soBairro: `Por favor, me informe o serviço que deseja`,
    soServico: `Por favor, me informe o bairro que deseja atendimento`,
    completo: `Gostaria de Atendimento ainda hoje?`
  }
};

// ============================================
// ENV
// ============================================

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';

// ============================================
// MEMÓRIA
// ============================================

const db = {
  conversas: new Map(),
  mensagens: new Map(),
  intervencao: new Map(),
  dados: new Map()
};

// ============================================
// HANDLER
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  
  console.log(`\n🌐 ${req.method} ${url.pathname}`);
  
  try {
    // Webhook verification
    if (req.method === 'GET' && query['hub.mode'] === 'subscribe') {
      if (query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    // Receber mensagem
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
        ultimaAtividade: conv.ultimaAtividade
      }));
      return res.json(lista);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('💥 ERRO:', erro);
    return res.status(200).send('OK');
  }
}

// ============================================
// RECEBER MENSAGEM
// ============================================

async function receberMensagem(req, res) {
  const body = req.body;
  
  console.log('\n📥 WEBHOOK:', JSON.stringify(body, null, 2));
  
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
  
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Inicializar
  if (!db.conversas.has(telefone)) {
    db.conversas.set(telefone, {
      nome, telefone, primeiraVez: true, ultimaAtividade: Date.now()
    });
    db.mensagens.set(telefone, []);
    db.intervencao.set(telefone, false);
    db.dados.set(telefone, { servico: null, bairro: null });
  }
  
  const conversa = db.conversas.get(telefone);
  conversa.ultimaAtividade = Date.now();
  
  // Salvar mensagem
  db.mensagens.get(telefone).push({
    tipo: 'cliente', nome, texto, hora: new Date().toLocaleTimeString('pt-BR')
  });
  
  // Se em intervenção
  if (db.intervencao.get(telefone)) {
    return res.status(200).send('OK');
  }
  
  // Processar
  const resposta = await processarMensagem(telefone, nome, texto);
  
  if (resposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      db.mensagens.get(telefone).push({
        tipo: 'robo', nome: 'RC', texto: resposta, hora: new Date().toLocaleTimeString('pt-BR')
      });
    }
  }
  
  return res.status(200).send('OK');
}

// ============================================
// PROCESSAR
// ============================================

async function processarMensagem(telefone, nome, texto) {
  const t = texto.toLowerCase().trim();
  const conversa = db.conversas.get(telefone);
  const dados = db.dados.get(telefone);
  
  // Intervenção
  for (const palavra of CONFIG.palavrasIntervencao) {
    if (t.includes(palavra)) {
      db.intervencao.set(telefone, true);
      return CONFIG.msgIntervencao;
    }
  }
  
  // Primeira mensagem
  if (conversa.primeiraVez) {
    conversa.primeiraVez = false;
    return CONFIG.saudacao;
  }
  
  // Analisar com IA
  const analise = await analisarGroq(texto);
  
  if (analise.servico && !dados.servico) dados.servico = analise.servico;
  if (analise.bairro && !dados.bairro) dados.bairro = analise.bairro;
  
  console.log('📊 Dados:', dados);
  
  // Responder
  if (dados.servico && dados.bairro) return CONFIG.msgs.completo;
  if (!dados.servico && !dados.bairro) return CONFIG.msgs.semServicoSemBairro;
  if (dados.servico && !dados.bairro) return CONFIG.msgs.soServico;
  if (!dados.servico && dados.bairro) return CONFIG.msgs.soBairro;
}

// ============================================
// GROQ
// ============================================

async function analisarGroq(texto) {
  if (!GROQ_API_KEY) return analiseSimples(texto);
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{
          role: 'user',
          content: `Extraia serviço e bairro da mensagem. Responda em JSON: {"servico": "...", "bairro": "..."}\n\nMensagem: "${texto}"`
        }],
        temperature: 0.1,
        max_tokens: 150
      })
    });
    
    if (!response.ok) throw new Error('Erro API');
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    const json = content.match(/\{[^}]+\}/);
    
    if (json) return JSON.parse(json[0]);
    return analiseSimples(texto);
    
  } catch (e) {
    console.error('Erro Groq:', e.message);
    return analiseSimples(texto);
  }
}

function analiseSimples(texto) {
  const t = texto.toLowerCase();
  const servicos = ['pintura', 'reforma', 'marcenaria', 'gesso', 'piso', 'banheiro', 'cozinha', 'elétrica', 'hidraulica', 'construção'];
  const servico = servicos.find(s => t.includes(s)) || null;
  
  // Detectar bairro (última palavra capitalizada ou após "bairro")
  let bairro = null;
  const match = texto.match(/bairro[\\s:]*([^,\\.\\n]+)/i);
  if (match) {
    bairro = match[1].trim();
  } else {
    const palavras = texto.split(/\\s+/);
    for (let i = palavras.length - 1; i >= 0; i--) {
      if (/^[A-Z][a-z]+$/.test(palavras[i])) {
        bairro = palavras[i];
        break;
      }
    }
  }
  
  return { servico, bairro };
}

// ============================================
// ENVIAR WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 ENVIANDO para ${numero}: ${texto}`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ ERRO: Variáveis não configuradas!');
    console.error('   WHATSAPP_TOKEN:', WHATSAPP_TOKEN ? 'OK' : 'FALTANDO');
    console.error('   WHATSAPP_PHONE_ID:', WHATSAPP_PHONE_ID ? 'OK' : 'FALTANDO');
    return false;
  }
  
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
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
    
    const data = await response.json();
    console.log('📥 Resposta WhatsApp:', response.status, JSON.stringify(data));
    
    if (!response.ok) {
      console.error('❌ ERRO ao enviar:', data);
      return false;
    }
    
    console.log('✅ Enviado com sucesso!');
    return true;
    
  } catch (e) {
    console.error('❌ EXCEÇÃO:', e.message);
    return false;
  }
}

// ============================================
// PAINEL
// ============================================

async function acaoPainel(req, res, acao) {
  const body = req.body;
  const tel = body.telefone;
  
  if (!db.conversas.has(tel)) {
    return res.json({ erro: 'Não encontrado' });
  }
  
  if (acao === 'intervir') {
    db.intervencao.set(tel, true);
    await enviarWhatsApp(tel, CONFIG.msgIntervencao);
    return res.json({ ok: true });
  }
  
  if (acao === 'liberar') {
    db.intervencao.set(tel, false);
    db.conversas.get(tel).primeiraVez = false;
    await enviarWhatsApp(tel, '🤖 Robô retomou. Como posso ajudar?');
    return res.json({ ok: true });
  }
  
  if (acao === 'enviar') {
    if (!db.intervencao.get(tel)) {
      return res.json({ erro: 'Não em intervenção' });
    }
    const ok = await enviarWhatsApp(tel, body.mensagem);
    return res.json({ ok });
  }
  
  res.json({ erro: 'Ação inválida' });
}
