// ============================================
// CONFIGURAÇÃO DO ROBÔ - EDITE AQUI DIRETO
// ============================================

const CONFIG_ROBO = {
  // 👋 SAUDAÇÃO INICIAL
  saudacao: `Olá! 👋 Sou o assistente de *Reforma e Construção*.

Como posso ajudar?

1️⃣ Orçamento de reforma
2️⃣ Marcenaria sob medida  
3️⃣ Construção civil
4️⃣ Falar com atendente`,

  // 💬 RESPOSTAS RÁPIDAS (palavra → resposta)
  // Use | para separar sinônimos: "preço|valor|custo"
  respostas: {
    "preço|valor|custo|quanto": `💰 Orçamento gratuito!

Envie fotos do local e descreva o que precisa.`,
    
    "prazo|tempo|demora": `⏱️ Prazos:
• Reformas: 3-7 dias
• Marcenaria: 15-30 dias  
• Construção: a definir`,
    
    "pagamento|paga": `💳 Pix (5% off), Cartão 12x, ou 50% + 50%`,
    
    "marcenaria|móvel|armário": `🪚 Marcenaria: cozinhas, guarda-roupas, escritórios`,
    
    "reforma|banheiro|pintura": `🔨 Reformas: banheiro, cozinha, pintura, elétrica`,
    
    "construção|casa|obra": `🏗️ Construção civil completa`,
    
    "visita|técnico": `📍 Visita: R$150 (deduzido do orçamento)`
  },

  // 🔨 FLUXO REFORMA (perguntas em sequência)
  fluxo_reforma: {
    p1: "Qual cômodo? (banheiro, cozinha, quarto, sala)",
    p2: "Qual bairro?",
    p3: "Descreva o que precisa:",
    p4: "Seu nome e melhor horário?",
    final: `✅ Visita agendada! Técnico entra em contato em 24h.`
  },

  // 🪚 FLUXO MARCENARIA
  fluxo_marcenaria: {
    p1: "Qual móvel? (cozinha, guarda-roupa, escritório)",
    p2: "Tem as medidas? (C x A x P)",
    final: `✅ Pedido registrado! Marceneiro visita para medição.`
  },

  // 🏗️ FLUXO CONSTRUÇÃO
  fluxo_construcao: {
    p1: "Qual obra? (casa, ampliação, regularização)",
    final: `🏗️ Projeto anotado! Engenheiro visita em 48h.`
  },

  // 🚨 INTERVENÇÃO HUMANA
  intervencao: {
    palavras: ["atendente", "humano", "pessoa", "falar com", "4"],
    mensagem: `🔄 Transferindo para atendente humano...`
  }
};

// ============================================
// CONFIGURAÇÃO TELEGRAM (para notificações)
// ============================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

// ============================================
// BANCO DE DADOS EM MEMÓRIA
// ============================================

const memoria = {
  conversas: {},      // Dados dos clientes
  mensagens: {},      // Histórico de mensagens
  intervencao: {},    // true = humano no controle
  estados: {},        // Etapa da conversa (inicio, ref1, ref2...)
  visitasHoje: []     // Para relatório diário
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
      ultima: memoria.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 40) + '...' || '...'
    }));
    return res.json(lista);
  }
  
  // --- GET: Buscar mensagens (para painel) ---
  if (req.method === 'GET' && query.acao === 'mensagens') {
    return res.json(memoria.mensagens[query.telefone] || []);
  }
  
  // --- GET: Relatório diário (chamar às 19h) ---
  if (req.method === 'GET' && query.acao === 'relatorio') {
    return enviarRelatorioDiario(res);
  }
  
  // --- POST: Receber mensagem do WhatsApp ---
  if (req.method === 'POST' && !query.acao) {
    try {
      const body = req.body;
      
      // Verificar se é evento do WhatsApp
      if (body.object !== 'whatsapp_business_account') {
        return res.status(200).send('OK');
      }
      
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      
      // Se não tiver mensagem, ignora (pode ser status de entrega)
      if (!message || message.type !== 'text') {
        return res.status(200).send('OK');
      }
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      const texto = message.text.body;
      
      console.log(`📩 ${nome} (${telefone}): ${texto}`);
      
      // INICIALIZAR SE FOR NOVO CLIENTE
      if (!memoria.conversas[telefone]) {
        memoria.conversas[telefone] = { 
          nome, 
          inicio: new Date().toISOString(),
          ultimaAtividade: Date.now()
        };
        memoria.mensagens[telefone] = [];
        memoria.estados[telefone] = 'inicio';
        memoria.intervencao[telefone] = false; // IMPORTANTE: começa false
      }
      
      // ATUALIZAR ATIVIDADE
      memoria.conversas[telefone].ultimaAtividade = Date.now();
      
      // SALVAR MENSAGEM DO CLIENTE (sempre salva!)
      memoria.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // VERIFICAR SE ESTÁ EM INTERVENÇÃO HUMANA
      if (memoria.intervencao[telefone]) {
        console.log(`👤 ${telefone}: Intervenção ativa - robô NÃO responde, mas mensagem foi salva`);
        
        // NOTIFICAR TELEGRAM QUE CHEGOU MENSAGEM DURANTE INTERVENÇÃO
        if (TELEGRAM_TOKEN && TELEGRAM_CHAT) {
          enviarTelegram(`💬 *Mensagem durante intervenção*\n\n👤 ${nome}\n📱 ${telefone}\n📝 ${texto.substring(0, 100)}`);
        }
        
        return res.status(200).send('OK');
      }
      
      // PROCESSAR E RESPONDER (robô ativo)
      const resposta = processarMensagem(telefone, nome, texto);
      
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
  
  // --- POST: Ações do painel ---
  if (req.method === 'POST') {
    const { acao } = query;
    const body = req.body;
    const tel = body.telefone;
    
    if (!tel) {
      return res.json({ erro: 'Telefone não informado' });
    }
    
    // GARANTIR QUE CLIENTE EXISTE
    if (!memoria.conversas[tel]) {
      return res.json({ erro: 'Conversa não encontrada' });
    }
    
    // INTERVIR - Assumir controle (CORRIGIDO)
    if (acao === 'intervir') {
      console.log(`🚨 Intervindo: ${tel}`);
      
      // 1. MUDAR ESTADO PRIMEIRO
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio'; // Resetar fluxo
      
      // 2. ENVIAR MENSAGEM AO CLIENTE
      const msg = CONFIG_ROBO.intervencao.mensagem;
      await enviarWhatsApp(tel, msg);
      
      // 3. REGISTRAR NO HISTÓRICO
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Você assumiu o controle]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // 4. NOTIFICAR TELEGRAM
      enviarTelegram(`🚨 *INTERVENÇÃO ATIVADA*\n\n📱 ${tel}\n👤 ${memoria.conversas[tel].nome}\n⏰ ${new Date().toLocaleTimeString('pt-BR')}`);
      
      return res.json({ ok: true, status: 'intervencao_ativada' });
    }
    
    // LIBERAR - Devolver ao robô (CORRIGIDO)
    if (acao === 'liberar') {
      console.log(`🤖 Liberando: ${tel}`);
      
      // 1. MUDAR ESTADO PRIMEIRO
      memoria.intervencao[tel] = false;
      memoria.estados[tel] = 'inicio'; // Resetar para nova conversa
      
      // 2. ENVIAR MENSAGEM AO CLIENTE
      await enviarWhatsApp(tel, '🤖 Robô retomou o atendimento. Como posso ajudar?');
      
      // 3. REGISTRAR NO HISTÓRICO
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
      // Verificar se está em intervenção
      if (!memoria.intervencao[tel]) {
        return res.json({ erro: 'Não está em intervenção. Clique em ASSUMIR primeiro.' });
      }
      
      const mensagem = body.mensagem;
      if (!mensagem || mensagem.trim() === '') {
        return res.json({ erro: 'Mensagem vazia' });
      }
      
      // Enviar ao cliente
      await enviarWhatsApp(tel, mensagem);
      
      // Salvar no histórico
      memoria.mensagens[tel].push({
        tipo: 'humano',
        nome: 'Você',
        texto: mensagem,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// PROCESSAR MENSAGEM DO CLIENTE
// ============================================

function processarMensagem(tel, nome, texto) {
  const t = texto.toLowerCase();
  const estado = memoria.estados[tel];
  const config = CONFIG_ROBO;
  
  // 1. VERIFICAR PALAVRAS DE INTERVENÇÃO
  for (const palavra of config.intervencao.palavras) {
    if (t.includes(palavra.toLowerCase())) {
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio';
      
      // NOTIFICAR TELEGRAM
      enviarTelegram(`🚨 *Cliente pediu atendente*\n\n👤 ${nome}\n📱 ${tel}\n💬 ${texto}`);
      
      return config.intervencao.mensagem;
    }
  }
  
  // 2. RESPOSTAS RÁPIDAS
  for (const [chaves, resp] of Object.entries(config.respostas)) {
    if (chaves.split('|').some(c => t.includes(c.toLowerCase()))) {
      return resp;
    }
  }
  
  // 3. FLUXO REFORMA
  if (t.includes('1') || t.includes('reforma')) {
    memoria.estados[tel] = 'ref1';
    return config.fluxo_reforma.p1;
  }
  
  if (estado === 'ref1') {
    memoria.estados[tel] = 'ref2';
    // Salvar dados
    memoria.conversas[tel].comodo = texto;
    return config.fluxo_reforma.p2;
  }
  
  if (estado === 'ref2') {
    memoria.estados[tel] = 'ref3';
    memoria.conversas[tel].bairro = texto;
    return config.fluxo_reforma.p3;
  }
  
  if (estado === 'ref3') {
    memoria.estados[tel] = 'ref4';
    memoria.conversas[tel].descricao = texto;
    return config.fluxo_reforma.p4;
  }
  
  if (estado === 'ref4') {
    memoria.estados[tel] = 'inicio';
    memoria.conversas[tel].contato = texto;
    
    // REGISTRAR VISITA
    const visita = {
      nome,
      telefone: tel,
      servico: 'Reforma',
      comodo: memoria.conversas[tel].comodo,
      bairro: memoria.conversas[tel].bairro,
      descricao: memoria.conversas[tel].descricao,
      contato: texto,
      data: new Date().toLocaleDateString('pt-BR'),
      hora: new Date().toLocaleTimeString('pt-BR')
    };
    
    memoria.visitasHoje.push(visita);
    
    // NOTIFICAR TELEGRAM - VISITA MARCADA
    enviarTelegram(`✅ *VISITA MARCADA*\n\n👤 ${nome}\n📱 ${tel}\n🏠 ${visita.comodo}\n📍 ${visita.bairro}\n📝 ${visita.descricao.substring(0, 50)}\n📞 ${texto}\n⏰ ${visita.hora}`);
    
    return config.fluxo_reforma.final;
  }
  
  // 4. FLUXO MARCENARIA
  if (t.includes('2') || t.includes('marcenaria')) {
    memoria.estados[tel] = 'marc1';
    return config.fluxo_marcenaria.p1;
  }
  
  if (estado === 'marc1') {
    memoria.estados[tel] = 'marc2';
    memoria.conversas[tel].movel = texto;
    return config.fluxo_marcenaria.p2;
  }
  
  if (estado === 'marc2') {
    memoria.estados[tel] = 'inicio';
    
    enviarTelegram(`🪚 *MARCENARIA*\n\n👤 ${nome}\n📱 ${tel}\n🪑 ${memoria.conversas[tel].movel}\n📐 ${texto}`);
    
    return config.fluxo_marcenaria.final;
  }
  
  // 5. FLUXO CONSTRUÇÃO
  if (t.includes('3') || t.includes('construção') || t.includes('construcao')) {
    memoria.estados[tel] = 'cons1';
    return config.fluxo_construcao.p1;
  }
  
  if (estado === 'cons1') {
    memoria.estados[tel] = 'inicio';
    
    enviarTelegram(`🏗️ *CONSTRUÇÃO*\n\n👤 ${nome}\n📱 ${tel}\n🏗️ ${texto}`);
    
    return config.fluxo_construcao.final;
  }
  
  // 6. SAUDAÇÃO
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom') || t.includes('boa')) {
    return config.saudacao;
  }
  
  // 7. PADRÃO
  return `Olá ${nome}! 👋\n\nPosso ajudar com:\n\n1️⃣ Orçamento de reforma\n2️⃣ Marcenaria sob medida\n3️⃣ Construção civil\n4️⃣ Falar com atendente\n\nO que você precisa?`;
}

// ============================================
// ENVIAR WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
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
    
    if (!res.ok) {
      const erro = await res.json();
      console.error('❌ Erro WhatsApp API:', erro);
    } else {
      console.log('📤 Enviado para', numero);
    }
    
  } catch (e) {
    console.error('❌ Erro enviar WhatsApp:', e);
  }
}

// ============================================
// ENVIAR TELEGRAM
// ============================================

async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    console.log('ℹ️ Telegram não configurado');
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
    console.log('📤 Telegram enviado');
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
    const msg = `📊 *RELATÓRIO ${hoje}*\n\nNenhuma visita marcada hoje.`;
    enviarTelegram(msg);
    return res.json({ mensagem: 'Sem visitas hoje', enviado: msg });
  }
  
  let texto = `📊 *RELATÓRIO DIÁRIO - ${hoje}*\n\n`;
  texto += `*Total:* ${memoria.visitasHoje.length} visitas\n\n`;
  
  memoria.visitasHoje.forEach((v, i) => {
    texto += `*${i + 1}.* ${v.nome}\n`;
    texto += `   📱 ${v.telefone}\n`;
    texto += `   🏠 ${v.servico} - ${v.comodo || v.tipo || ''}\n`;
    texto += `   📍 ${v.bairro || 'Não informado'}\n`;
    texto += `   ⏰ ${v.hora}\n\n`;
  });
  
  enviarTelegram(texto);
  
  // Limpar para amanhã
  memoria.visitasHoje = [];
  
  res.json({ ok: true, enviados: memoria.visitasHoje.length, relatorio: texto });
}
