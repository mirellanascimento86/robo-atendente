// ============================================
// CONFIGURAÇÃO DO ROBÔ - EDITE AQUI DIRETO
// ============================================

const CONFIG_ROBO = {
  // 👋 SAUDAÇÃO INICIAL (quando cliente diz "Oi")
  saudacao: `Olá! 👋 Sou o assistente de *Reforma e Construção*.

Como posso ajudar?

1️⃣ Orçamento de reforma
2️⃣ Marcenaria sob medida  
3️⃣ Construção civil
4️⃣ Falar com atendente`,

  // 💬 RESPOSTAS RÁPIDAS (palavra → resposta)
  respostas: {
    "preço|valor|custo|quanto": `💰 Orçamento gratuito!

Envie fotos do local e descreva o que precisa. Avaliamos sem compromisso.`,

    "prazo|tempo|demora|quando": `⏱️ Prazos:
• Pequenas reformas: 3-7 dias
• Marcenaria: 15-30 dias  
• Construção: a definir em visita`,

    "pagamento|paga|forma": `💳 Aceitamos:
• Pix (5% desconto)
• Cartão em até 12x
• Transferência
• 50% entrada + 50% na entrega`,

    "marcenaria|móvel|armário|cozinha": `🪚 Marcenaria Sob Medida!

• Cozinhas planejadas
• Guarda-roupas
• Escritórios
• Racks e painéis

Envie medidas do espaço!`,

    "reforma|banheiro|pintura": `🔨 Reformas em Geral

• Banheiros e cozinhas
• Pintura
• Elétrica e hidráulica
• Pisos e revestimentos

Agende visita técnica!`,

    "construção|casa|obra": `🏗️ Construção Civil

• Fundações e estruturas
• Acabamentos
• Regularização de imóveis
• Projetos completos

Orçamento após visita técnica.`,

    "visita|técnico|avaliação": `📍 Visita Técnica

Valor: R$150 (deduzido do orçamento final)

Informe:
• Endereço completo
• Melhor dia/horário
• Tipo de serviço`,

    "garantia": `✅ Garantia de 1 ano

• Mão de obra: 12 meses
• Materiais: conforme fabricante
• Atendimento pós-venda incluído`
  },

  // 🔨 FLUXO REFORMA (perguntas sequenciais)
  fluxo_reforma: {
    pergunta_1: "Qual cômodo quer reformar? (banheiro, cozinha, quarto, sala, área externa)",
    pergunta_2: "Qual bairro?",
    pergunta_3: "Descreva o que precisa fazer ou envie fotos:",
    pergunta_4: "Seu nome e melhor horário para visita técnica?",
    final: `✅ *Visita agendada!*

Nosso técnico entrará em contato em 24h para confirmar.

💰 Visita técnica: R$150 (deduzida do orçamento)
📋 Orçamento sem compromisso

Obrigado pela preferência! 🙏`
  },

  // 🪚 FLUXO MARCENARIA
  fluxo_marcenaria: {
    pergunta_1: "Qual móvel deseja? (cozinha, guarda-roupa, escritório, rack, outro)",
    pergunta_2: "Tem as medidas do espaço? (comprimento x altura x profundidade)",
    final: `✅ *Pedido de marcenaria registrado!*

Nosso marceneiro visitará para medição precisa.

🪚 Prazo médio: 20-30 dias
💳 Orçamento sem compromisso

Aguarde contato! 📞`
  },

  // 🏗️ FLUXO CONSTRUÇÃO
  fluxo_construcao: {
    pergunta_1: "Qual tipo de obra? (casa nova, ampliação, regularização, reforma estrutural)",
    final: `🏗️ *Projeto de construção anotado!*

Nosso engenheiro fará visita técnica em 48h.

📐 Orçamento técnico gratuito
📋 Inclui regularização (se necessário)

Entraremos em contato! ⚡`
  },

  // 🚨 CONFIGURAÇÃO INTERVENÇÃO
  intervencao: {
    palavras: ["atendente", "humano", "pessoa", "falar com", "especialista", "gerente"],
    mensagem: `🔄 *Transferindo para atendente humano...*

Um momento, por favor. Você será atendido em breve.`
  }
};

// ============================================
// BANCO DE DADOS EM MEMÓRIA
// ============================================

const banco = {
  conversas: {},      // Dados de cada cliente
  mensagens: {},      // Histórico de mensagens
  intervencao: {},    // Quem está em intervenção humana
  estados: {}         // Estado da conversa (inicio, etapa1, etc)
};

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // --- GET: Verificação do webhook (Meta) ---
  if (req.method === 'GET' && req.query['hub.mode']) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'roboatendente') {
      console.log('✅ Webhook verificado');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  
  // --- GET: API do Painel (listar conversas) ---
  if (req.method === 'GET' && req.query.acao === 'listar') {
    const lista = Object.keys(banco.conversas).map(tel => ({
      telefone: tel,
      nome: banco.conversas[tel].nome || 'Cliente',
      intervencao: !!banco.intervencao[tel], // Garante booleano
      ultima: banco.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 40) + '...' || '...'
    }));
    return res.json(lista);
  }
  
  // --- GET: API do Painel (mensagens de uma conversa) ---
  if (req.method === 'GET' && req.query.acao === 'mensagens') {
    const tel = req.query.telefone;
    return res.json(banco.mensagens[tel] || []);
  }
  
  // --- POST: Receber mensagem do WhatsApp ---
  if (req.method === 'POST' && !req.query.acao) {
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
      
      // Inicializar se não existe
      if (!banco.conversas[telefone]) {
        banco.conversas[telefone] = { nome, inicio: new Date().toISOString() };
      }
      if (!banco.mensagens[telefone]) {
        banco.mensagens[telefone] = [];
      }
      if (!banco.estados[telefone]) {
        banco.estados[telefone] = 'inicio';
      }
      
      // Salvar mensagem do cliente
      banco.mensagens[telefone].push({
        tipo: 'cliente',
        nome: nome,
        texto: texto,
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      // VERIFICAR SE ESTÁ EM INTERVENÇÃO
      if (banco.intervencao[telefone]) {
        console.log('👤 Intervenção ativa - robô não responde');
        return res.status(200).send('OK');
      }
      
      // PROCESSAR MENSAGEM E GERAR RESPOSTA
      const resposta = processarMensagem(telefone, nome, texto);
      
      if (resposta) {
        await enviarWhatsApp(telefone, resposta);
        
        banco.mensagens[telefone].push({
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
  
  // --- POST: Ações do Painel ---
  if (req.method === 'POST') {
    const { acao } = req.query;
    const body = req.body;
    
    // INTERVIR - Ativar intervenção humana
    if (acao === 'intervir') {
      const tel = body.telefone;
      
      // LIMPAR ESTADO para não conflitar
      banco.estados[tel] = 'inicio';
      banco.intervencao[tel] = true;
      
      console.log(`🚨 Intervenção ativada para ${tel}`);
      
      // Enviar mensagem avisando cliente
      await enviarWhatsApp(tel, CONFIG_ROBO.intervencao.mensagem);
      
      // Salvar no histórico
      banco.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Atendente humano assumiu o chat]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true, status: 'intervencao_ativada' });
    }
    
    // LIBERAR - Devolver ao robô
    if (acao === 'liberar') {
      const tel = body.telefone;
      
      banco.intervencao[tel] = false;
      banco.estados[tel] = 'inicio'; // Resetar estado
      
      console.log(`🤖 Robô liberado para ${tel}`);
      
      await enviarWhatsApp(tel, '🤖 *Robô retomou o atendimento.*\n\nComo posso ajudar?');
      
      banco.mensagens[tel].push({
        tipo: 'sistema',
        nome: 'Sistema',
        texto: '[Robô retomou o atendimento]',
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
      });
      
      return res.json({ ok: true, status: 'robo_ativado' });
    }
    
    // ENVIAR - Enviar mensagem humana
    if (acao === 'enviar') {
      const tel = body.telefone;
      const msg = body.mensagem;
      
      if (!banco.intervencao[tel]) {
        return res.json({ erro: 'Não está em intervenção. Clique em INTERVIR primeiro.' });
      }
      
      await enviarWhatsApp(tel, msg);
      
      banco.mensagens[tel].push({
        tipo: 'humano',
        nome: 'Você',
        texto: msg,
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

function processarMensagem(telefone, nome, texto) {
  const t = texto.toLowerCase();
  const estado = banco.estados[telefone];
  
  // 1. VERIFICAR PALAVRAS DE INTERVENÇÃO (qualquer momento)
  for (const palavra of CONFIG_ROBO.intervencao.palavras) {
    if (t.includes(palavra)) {
      banco.intervencao[telefone] = true;
      banco.estados[telefone] = 'inicio';
      return CONFIG_ROBO.intervencao.mensagem;
    }
  }
  
  // 2. RESPOSTAS RÁPIDAS (palavras-chave)
  for (const [chaves, resposta] of Object.entries(CONFIG_ROBO.respostas)) {
    const listaChaves = chaves.split('|');
    if (listaChaves.some(chave => t.includes(chave))) {
      return resposta;
    }
  }
  
  // 3. FLUXO REFORMA
  if (t.includes('1') || t.includes('reforma')) {
    banco.estados[telefone] = 'ref_etapa1';
    return CONFIG_ROBO.fluxo_reforma.pergunta_1;
  }
  
  if (estado === 'ref_etapa1') {
    banco.estados[telefone] = 'ref_etapa2';
    return CONFIG_ROBO.fluxo_reforma.pergunta_2;
  }
  
  if (estado === 'ref_etapa2') {
    banco.estados[telefone] = 'ref_etapa3';
    return CONFIG_ROBO.fluxo_reforma.pergunta_3;
  }
  
  if (estado === 'ref_etapa3') {
    banco.estados[telefone] = 'ref_etapa4';
    return CONFIG_ROBO.fluxo_reforma.pergunta_4;
  }
  
  if (estado === 'ref_etapa4') {
    banco.estados[telefone] = 'inicio'; // Finaliza
    return CONFIG_ROBO.fluxo_reforma.final;
  }
  
  // 4. FLUXO MARCENARIA
  if (t.includes('2') || t.includes('marcenaria')) {
    banco.estados[telefone] = 'marc_etapa1';
    return CONFIG_ROBO.fluxo_marcenaria.pergunta_1;
  }
  
  if (estado === 'marc_etapa1') {
    banco.estados[telefone] = 'marc_etapa2';
    return CONFIG_ROBO.fluxo_marcenaria.pergunta_2;
  }
  
  if (estado === 'marc_etapa2') {
    banco.estados[telefone] = 'inicio';
    return CONFIG_ROBO.fluxo_marcenaria.final;
  }
  
  // 5. FLUXO CONSTRUÇÃO
  if (t.includes('3') || t.includes('construção') || t.includes('construcao')) {
    banco.estados[telefone] = 'cons_etapa1';
    return CONFIG_ROBO.fluxo_construcao.pergunta_1;
  }
  
  if (estado === 'cons_etapa1') {
    banco.estados[telefone] = 'inicio';
    return CONFIG_ROBO.fluxo_construcao.final;
  }
  
  // 6. SAUDAÇÃO
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom') || t.includes('boa')) {
    return CONFIG_ROBO.saudacao;
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
// ENVIAR MENSAGEM WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const TOKEN = process.env.WHATSAPP_TOKEN;
  
  if (!PHONE_ID || !TOKEN) {
    console.error('❌ Variáveis de ambiente não configuradas');
    return;
  }
  
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: texto }
      })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ Erro WhatsApp API:', data);
    } else {
      console.log('📤 Enviado para', numero);
    }
    
  } catch (erro) {
    console.error('❌ Erro ao enviar WhatsApp:', erro);
  }
  // RELATÓRIO DIÁRIO 19H
// Vercel não suporta cron nativo, então usamos uma API externa ou verificamos a cada requisição
// Alternativa: configurar um serviço externo para chamar /api/relatorio às 19h

export { banco }; // Exportar para usar no relatório

}

