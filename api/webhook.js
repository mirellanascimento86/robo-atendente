// ============================================
// 📝 TREINAMENTO DO ROBÔ - EDITE AQUI
// ============================================

// 👋 SAUDAÇÃO INICIAL
const SAUDACAO = `Olá! 👋 Sou o assistente de *Reforma e Construção*.

Como posso ajudar?

1️⃣ Orçamento de reforma
2️⃣ Marcenaria sob medida  
3️⃣ Construção civil
4️⃣ Falar com atendente`;

// 💬 RESPOSTAS RÁPIDAS (palavra → resposta)
// Formato: "palavra1|palavra2|palavra3": "resposta aqui"
const RESPOSTAS = {
  "preço|valor|custo|quanto": `💰 Orçamento gratuito! Envie fotos do local.`,
  "prazo|tempo|demora": `⏱️ Reformas: 3-7 dias | Marcenaria: 15-30 dias`,
  "pagamento|paga|pix": `💳 Pix (5% off), Cartão 12x, ou 50% + 50%`,
  "marcenaria|móvel|armário|cozinha": `🪚 Marcenaria: cozinhas, guarda-roupas, escritórios`,
  "reforma|banheiro|pintura|elétrica": `🔨 Reformas: banheiro, cozinha, pintura, elétrica`,
  "construção|casa|obra|fundacao": `🏗️ Construção civil completa`,
  "visita|técnico|avaliação": `📍 Visita: R$150 (deduzido do orçamento)`,
  "garantia": `✅ Garantia de 1 ano em todos os serviços`
};

// 🔨 FLUXO REFORMA (perguntas em sequência)
const FLUXO_REFORMA = {
  p1: "Qual cômodo quer reformar? (banheiro, cozinha, quarto, sala, área externa)",
  p2: "Qual bairro?",
  p3: "Descreva o que precisa fazer ou envie fotos:",
  p4: "Seu nome e melhor horário para visita técnica?",
  final: `✅ *Visita agendada!*

Técnico entrará em contato em 24h para confirmar.

💰 Visita técnica: R$150 (deduzida do orçamento)
📋 Orçamento sem compromisso

Obrigado pela preferência! 🙏`
};

// 🪚 FLUXO MARCENARIA
const FLUXO_MARCENARIA = {
  p1: "Qual móvel deseja? (cozinha, guarda-roupa, escritório, rack, outro)",
  p2: "Tem as medidas do espaço? (comprimento x altura x profundidade)",
  final: `✅ *Pedido de marcenaria registrado!*

Nosso marceneiro visitará para medição precisa.

🪚 Prazo médio: 20-30 dias
💳 Orçamento sem compromisso

Aguarde contato! 📞`
};

// 🏗️ FLUXO CONSTRUÇÃO
const FLUXO_CONSTRUCAO = {
  p1: "Qual tipo de obra? (casa nova, ampliação, regularização, reforma estrutural)",
  final: `🏗️ *Projeto de construção anotado!*

Nosso engenheiro fará visita técnica em 48h.

📐 Orçamento técnico gratuito
📋 Inclui regularização (se necessário)

Entraremos em contato! ⚡`
};

// 🚨 PALAVRAS QUE ATIVAM INTERVENÇÃO (separadas por | )
const PALAVRAS_INTERVENCAO = "atendente|humano|pessoa|falar com|especialista|gerente|4|cancelar|reclamar|problema|urgente";

// 📝 MENSAGEM QUANDO TRANSFERE PARA HUMANO
const MSG_INTERVENCAO = `🔄 *Transferindo para atendente humano...*

Um momento, por favor. Você será atendido em breve.`;

// ============================================
// CONFIGURAÇÃO TELEGRAM
// ============================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

// ============================================
// BANCO DE DADOS EM MEMÓRIA
// ============================================

const memoria = {
  conversas: {},        // Dados dos clientes
  mensagens: {},        // Histórico de mensagens
  intervencao: {},      // true = humano no controle
  estados: {},          // Etapa da conversa
  visitasHoje: [],      // Para relatório diário
  precisaIntervencao: {} // 🆕 Sinaliza conversas que precisam de intervenção
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
      precisaIntervencao: !!memoria.precisaIntervencao[tel], // 🆕 NOVO
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
          ultimaAtividade: Date.now()
        };
        memoria.mensagens[telefone] = [];
        memoria.estados[telefone] = 'inicio';
        memoria.intervencao[telefone] = false;
        memoria.precisaIntervencao[telefone] = false; // 🆕 NOVO
      }
      
      memoria.conversas[telefone].ultimaAtividade = Date.now();
      
      // SALVAR MENSAGEM DO CLIENTE
      memoria.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // SE EM INTERVENÇÃO, NÃO RESPONDE
      if (memoria.intervencao[telefone]) {
        return res.status(200).send('OK');
      }
      
      // PROCESSAR E RESPONDER
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
    
    if (!tel || !memoria.conversas[tel]) {
      return res.json({ erro: 'Telefone não encontrado' });
    }
    
    // INTERVIR - Assumir controle
    if (acao === 'intervir') {
      console.log(`🚨 Intervindo: ${tel}`);
      
      memoria.intervencao[tel] = true;
      memoria.precisaIntervencao[tel] = false; // 🆕 Limpa sinalização
      memoria.estados[tel] = 'inicio';
      
      await enviarWhatsApp(tel, MSG_INTERVENCAO);
      
      memoria.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Você assumiu o controle]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
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
      
      memoria.conversas[tel].ultimaAtividade = Date.now();
      
      return res.json({ ok: true });
    }
  }
  
  res.status(405).end();
}

// ============================================
// PROCESSAR MENSAGEM
// ============================================

function processarMensagem(tel, nome, texto) {
  const t = texto.toLowerCase();
  const estado = memoria.estados[tel];
  
  // 1. VERIFICAR PALAVRAS DE INTERVENÇÃO
  const palavrasInt = PALAVRAS_INTERVENCAO.split('|');
  for (const palavra of palavrasInt) {
    if (t.includes(palavra.toLowerCase())) {
      // 🆕 SINALIZAR QUE PRECISA DE INTERVENÇÃO
      memoria.precisaIntervencao[tel] = true;
      memoria.intervencao[tel] = true;
      memoria.estados[tel] = 'inicio';
      
      // 🆕 NOTIFICAR TELEGRAM URGENTE
      enviarTelegram(`🚨 *PRECISA DE INTERVENÇÃO URGENTE*

👤 Cliente: ${nome}
📱 ${tel}
💬 Mensagem: "${texto.substring(0, 100)}"

🔗 Acesse o painel: ${process.env.VERCEL_URL || 'seu-link.vercel.app'}/painel.html

⚠️ Esta conversa está sinalizada no painel!`);
      
      return MSG_INTERVENCAO;
    }
  }
  
  // 2. RESPOSTAS RÁPIDAS
  for (const [chaves, resp] of Object.entries(RESPOSTAS)) {
    if (chaves.split('|').some(c => t.includes(c.toLowerCase()))) {
      return resp;
    }
  }
  
  // 3. FLUXO REFORMA
  if (t.includes('1') || t.includes('reforma')) {
    memoria.estados[tel] = 'ref1';
    return FLUXO_REFORMA.p1;
  }
  
  if (estado === 'ref1') {
    memoria.estados[tel] = 'ref2';
    memoria.conversas[tel].comodo = texto;
    return FLUXO_REFORMA.p2;
  }
  
  if (estado === 'ref2') {
    memoria.estados[tel] = 'ref3';
    memoria.conversas[tel].bairro = texto;
    return FLUXO_REFORMA.p3;
  }
  
  if (estado === 'ref3') {
    memoria.estados[tel] = 'ref4';
    memoria.conversas[tel].descricao = texto;
    return FLUXO_REFORMA.p4;
  }
  
  if (estado === 'ref4') {
    memoria.estados[tel] = 'inicio';
    memoria.conversas[tel].contato = texto;
    
    // REGISTRAR VISITA
    const visita = {
      nome, telefone: tel, servico: 'Reforma',
      comodo: memoria.conversas[tel].comodo,
      bairro: memoria.conversas[tel].bairro,
      descricao: memoria.conversas[tel].descricao,
      contato: texto,
      data: new Date().toLocaleDateString('pt-BR'),
      hora: new Date().toLocaleTimeString('pt-BR')
    };
    
    memoria.visitasHoje.push(visita);
    
    // NOTIFICAR TÉCNICO
    enviarTelegram(`✅ *VISITA MARCADA*

👤 ${nome}
📱 ${tel}
🏠 ${visita.comodo}
📍 ${visita.bairro}
⏰ ${visita.hora}`);
    
    return FLUXO_REFORMA.final;
  }
  
  // 4. FLUXO MARCENARIA
  if (t.includes('2') || t.includes('marcenaria')) {
    memoria.estados[tel] = 'marc1';
    return FLUXO_MARCENARIA.p1;
  }
  
  if (estado === 'marc1') {
    memoria.estados[tel] = 'marc2';
    memoria.conversas[tel].movel = texto;
    return FLUXO_MARCENARIA.p2;
  }
  
  if (estado === 'marc2') {
    memoria.estados[tel] = 'inicio';
    
    enviarTelegram(`🪚 *MARCENARIA*

👤 ${nome}
📱 ${tel}
🪑 ${memoria.conversas[tel].movel}
📐 ${texto}`);
    
    return FLUXO_MARCENARIA.final;
  }
  
  // 5. FLUXO CONSTRUÇÃO
  if (t.includes('3') || t.includes('construção') || t.includes('construcao')) {
    memoria.estados[tel] = 'cons1';
    return FLUXO_CONSTRUCAO.p1;
  }
  
  if (estado === 'cons1') {
    memoria.estados[tel] = 'inicio';
    
    enviarTelegram(`🏗️ *CONSTRUÇÃO*

👤 ${nome}
📱 ${tel}
🏗️ ${texto}`);
    
    return FLUXO_CONSTRUCAO.final;
  }
  
  // 6. SAUDAÇÃO
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom') || t.includes('boa')) {
    return SAUDACAO;
  }
  
  // 7. PADRÃO
  return `Olá ${nome}! 👋

Posso ajudar com:

1️⃣ Orçamento de reforma
2️⃣ Marcenaria sob medida
3️⃣ Construção civil
4️⃣ Falar com atendente

O que você precisa?`;
}

// ============================================
// FUNÇÕES AUXILIARES
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
    console.log('📤 Telegram enviado');
  } catch (e) {
    console.error('❌ Erro Telegram:', e);
  }
}

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
  
  enviarTelegram(texto);
  memoria.visitasHoje = [];
  res?.json({ ok: true });
}
