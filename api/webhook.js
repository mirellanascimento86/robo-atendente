// ============================================
// CONFIGURAÇÃO DO ROBÔ - EDITE AQUI
// ============================================

const CONFIG_ROBO = {
  saudacao: `Olá! 👋 Sou o assistente de *Reforma e Construção*.

Como posso ajudar?

1️⃣ Orçamento de reforma
2️⃣ Marcenaria sob medida  
3️⃣ Construção civil
4️⃣ Falar com atendente`,

  respostas: {
    "preço|valor|custo|quanto": `💰 Orçamento gratuito! Envie fotos do local.`,
    "prazo|tempo": `⏱️ Reformas: 3-7 dias | Marcenaria: 15-30 dias`,
    "pagamento": `💳 Pix (5% off), Cartão 12x, ou 50% + 50%`,
    "marcenaria": `🪚 Marcenaria: cozinhas, guarda-roupas, escritórios`,
    "reforma": `🔨 Reformas: banheiro, cozinha, pintura, elétrica`,
    "construção": `🏗️ Construção civil completa`,
    "visita": `📍 Visita técnica: R$150 (deduzido do orçamento)`
  },

  fluxo_reforma: {
    p1: "Qual cômodo? (banheiro, cozinha, quarto, sala)",
    p2: "Qual bairro?",
    p3: "Descreva o que precisa:",
    p4: "Seu nome e melhor horário?",
    final: `✅ Visita agendada! Técnico entra em contato em 24h.`
  },

  intervencao: {
    palavras: ["atendente", "humano", "pessoa", "falar com", "4"],
    mensagem: `🔄 Transferindo para atendente humano...`
  }
};

// ============================================
// BANCO DE DADOS (memória)
// ============================================

const banco = {
  conversas: {},
  mensagens: {},
  intervencao: {},
  estados: {}
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
  
  // --- GET: Listar conversas (para o painel) ---
  if (req.method === 'GET' && query.acao === 'listar') {
    const lista = Object.keys(banco.conversas).map(tel => ({
      telefone: tel,
      nome: banco.conversas[tel].nome || 'Cliente',
      intervencao: !!banco.intervencao[tel],
      ultima: banco.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 40) + '...' || '...'
    }));
    return res.json(lista);
  }
  
  // --- GET: Buscar mensagens (para o painel) ---
  if (req.method === 'GET' && query.acao === 'mensagens') {
    const tel = query.telefone;
    return res.json(banco.mensagens[tel] || []);
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
      
      console.log(`📩 ${nome}: ${texto}`);
      
      // Inicializar
      if (!banco.conversas[telefone]) {
        banco.conversas[telefone] = { nome };
        banco.mensagens[telefone] = [];
        banco.estados[telefone] = 'inicio';
      }
      
      // Salvar mensagem cliente
      banco.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // Se em intervenção, não responde
      if (banco.intervencao[telefone]) {
        return res.status(200).send('OK');
      }
      
      // Gerar resposta
      const resp = processar(telefone, nome, texto);
      
      if (resp) {
        await enviarWhatsApp(telefone, resp);
        banco.mensagens[telefone].push({
          tipo: 'robo',
          nome: 'Robô',
          texto: resp,
          hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
        });
      }
      
      return res.status(200).send('OK');
      
    } catch (e) {
      console.error('Erro:', e);
      return res.status(200).send('OK');
    }
  }
  
  // --- POST: Ações do painel ---
  if (req.method === 'POST') {
    const { acao } = query;
    const body = req.body;
    
    if (acao === 'intervir') {
      banco.intervencao[body.telefone] = true;
      banco.estados[body.telefone] = 'inicio';
      await enviarWhatsApp(body.telefone, CONFIG_ROBO.intervencao.mensagem);
      return res.json({ ok: true });
    }
    
    if (acao === 'liberar') {
      banco.intervencao[body.telefone] = false;
      banco.estados[body.telefone] = 'inicio';
      await enviarWhatsApp(body.telefone, '🤖 Robô retomou. Como posso ajudar?');
      return res.json({ ok: true });
    }
    
    if (acao === 'enviar') {
      if (!banco.intervencao[body.telefone]) {
        return res.json({ erro: 'Não está em intervenção' });
      }
      
      await enviarWhatsApp(body.telefone, body.mensagem);
      
      banco.mensagens[body.telefone].push({
        tipo: 'humano',
        nome: 'Você',
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

function processar(tel, nome, texto) {
  const t = texto.toLowerCase();
  const estado = banco.estados[tel];
  
  // Verificar intervenção
  for (const p of CONFIG_ROBO.intervencao.palavras) {
    if (t.includes(p)) {
      banco.intervencao[tel] = true;
      return CONFIG_ROBO.intervencao.mensagem;
    }
  }
  
  // Respostas rápidas
  for (const [chaves, resp] of Object.entries(CONFIG_ROBO.respostas)) {
    if (chaves.split('|').some(c => t.includes(c))) return resp;
  }
  
  // Fluxo reforma
  if (t.includes('1') || t.includes('reforma')) {
    banco.estados[tel] = 'ref1';
    return CONFIG_ROBO.fluxo_reforma.p1;
  }
  
  if (estado === 'ref1') { banco.estados[tel] = 'ref2'; return CONFIG_ROBO.fluxo_reforma.p2; }
  if (estado === 'ref2') { banco.estados[tel] = 'ref3'; return CONFIG_ROBO.fluxo_reforma.p3; }
  if (estado === 'ref3') { banco.estados[tel] = 'ref4'; return CONFIG_ROBO.fluxo_reforma.p4; }
  if (estado === 'ref4') { banco.estados[tel] = 'inicio'; return CONFIG_ROBO.fluxo_reforma.final; }
  
  // Saudação
  if (t.includes('oi') || t.includes('olá') || t.includes('ola')) {
    return CONFIG_ROBO.saudacao;
  }
  
  return `Olá ${nome}! Posso ajudar com:\n\n1️⃣ Reforma\n2️⃣ Marcenaria\n3️⃣ Construção\n4️⃣ Atendente`;
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
    console.error('Erro enviar:', e);
  }
}
