// ============================================
// WEBHOOK - VERSÃO SIMPLES E FUNCIONAL
// ============================================

// Banco de dados em memória (funciona enquanto servidor está ligado)
const banco = {
  conversas: {},      // Dados das conversas
  mensagens: {},      // Histórico de mensagens
  intervencao: {}     // Quem está em intervenção humana
};

export default async function handler(req, res) {
  
  // VERIFICAÇÃO DO WEBHOOK (Meta confirma)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'roboatendente') {
      console.log('✅ Webhook verificado!');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // RECEBER MENSAGEM DO WHATSAPP
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      if (body.object === 'whatsapp_business_account') {
        const value = body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];
        
        if (message && message.type === 'text') {
          const telefone = message.from;
          const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
          const texto = message.text.body;
          
          console.log(`📩 ${nome}: ${texto}`);
          
          // SALVAR NO BANCO
          if (!banco.conversas[telefone]) {
            banco.conversas[telefone] = { nome, data: new Date().toISOString() };
          }
          
          if (!banco.mensagens[telefone]) {
            banco.mensagens[telefone] = [];
          }
          
          banco.mensagens[telefone].push({
            tipo: 'cliente',
            nome: nome,
            texto: texto,
            hora: new Date().toLocaleTimeString('pt-BR')
          });
          
          // SE NÃO ESTIVER EM INTERVENÇÃO, ROBÔ RESPONDE
          if (!banco.intervencao[telefone]) {
            const respostaRobo = gerarRespostaRobo(nome, texto);
            
            await enviarWhatsApp(telefone, respostaRobo);
            
            banco.mensagens[telefone].push({
              tipo: 'robo',
              nome: 'Robô',
              texto: respostaRobo,
              hora: new Date().toLocaleTimeString('pt-BR')
            });
          }
        }
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  // GET /api/webhook?acao=dados - Para o painel buscar dados
  if (req.method === 'GET' && req.query.acao) {
    const { acao, telefone } = req.query;
    
    if (acao === 'conversas') {
      const lista = Object.keys(banco.conversas).map(tel => ({
        telefone: tel,
        nome: banco.conversas[tel].nome,
        intervencao: banco.intervencao[tel] || false,
        ultima: banco.mensagens[tel]?.slice(-1)[0]?.texto?.substring(0, 30) + '...' || '...'
      }));
      return res.json(lista);
    }
    
    if (acao === 'mensagens' && telefone) {
      return res.json(banco.mensagens[telefone] || []);
    }
    
    return res.json({ erro: 'Ação inválida' });
  }
  
  // POST /api/webhook?acao=intervir - Painel intervém
  if (req.method === 'POST' && req.query.acao) {
    const { acao } = req.query;
    const body = req.body;
    
    if (acao === 'intervir') {
      banco.intervencao[body.telefone] = true;
      
      await enviarWhatsApp(body.telefone, '👤 Atendente humano assumiu o chat. Como posso ajudar?');
      
      return res.json({ ok: true });
    }
    
    if (acao === 'liberar') {
      banco.intervencao[body.telefone] = false;
      
      await enviarWhatsApp(body.telefone, '🤖 Robô retomou o atendimento.');
      
      return res.json({ ok: true });
    }
    
    if (acao === 'enviar') {
      await enviarWhatsApp(body.telefone, body.mensagem);
      
      banco.mensagens[body.telefone].push({
        tipo: 'humano',
        nome: 'Você',
        texto: body.mensagem,
        hora: new Date().toLocaleTimeString('pt-BR')
      });
      
      return res.json({ ok: true });
    }
    
    return res.json({ erro: 'Ação inválida' });
  }
  
  res.status(405).end();
}

// FUNÇÃO: ROBÔ GERA RESPOSTA (sem IA - 100% código)
function gerarRespostaRobo(nome, mensagem) {
  const t = mensagem.toLowerCase();
  
  // SAUDAÇÃO
  if (t.includes('oi') || t.includes('olá') || t.includes('ola') || t.includes('bom dia') || t.includes('boa tarde')) {
    return `Olá ${nome}! 👋\n\nSou o assistente virtual. Como posso ajudar?\n\n1️⃣ *Ar condicionado*\n2️⃣ *Geladeira*\n3️⃣ *Máquina de lavar*\n4️⃣ *Falar com atendente*`;
  }
  
  // SERVIÇOS
  if (t.includes('1') || t.includes('ar') || t.includes('condicionado')) {
    return '❄️ *Ar Condicionado*\n\nPara agendar, preciso saber:\n• Quantos BTUs?\n• Qual bairro?\n• Qual o problema?\n\nOu digite *atendente* para falar com uma pessoa.';
  }
  
  if (t.includes('2') || t.includes('geladeira')) {
    return '🧊 *Geladeira*\n\nQual a marca e modelo?\nQual o problema?\n\nVisita técnica: R$140';
  }
  
  if (t.includes('3') || t.includes('máquina') || t.includes('lavar')) {
    return '👕 *Máquina de Lavar*\n\nQual a marca?\nNão liga, não centrifuga ou vazamento?';
  }
  
  // ATENDENTE
  if (t.includes('4') || t.includes('atendente') || t.includes('humano') || t.includes('pessoa')) {
    return '🔄 *Transferindo...*\n\nUm atendente humano vai assumir em instantes. Aguarde.';
  }
  
  // PREÇO
  if (t.includes('preço') || t.includes('valor') || t.includes('custo') || t.includes('quanto')) {
    return '💰 *Valores:*\n\n• Visita técnica: R$140\n• Orçamento: Gratuito\n• Mão de obra: A combinar\n\nAceitamos Pix, cartão e dinheiro.';
  }
  
  // HORÁRIO
  if (t.includes('horário') || t.includes('hora') || t.includes('funcionamento')) {
    return '⏰ *Horário:*\n\nSegunda a Sexta: 8h às 18h\nSábado: 8h às 12h\n\nEmergências: (21) 99999-9999';
  }
  
  // LOCALIZAÇÃO
  if (t.includes('onde') || t.includes('endereço') || t.includes('local')) {
    return '📍 Atendemos em toda a região!\n\nQual seu bairro? Verifico disponibilidade.';
  }
  
  // PADRÃO
  return `Entendi, ${nome}. 🤔\n\nPosso ajudar com:\n1️⃣ Ar condicionado\n2️⃣ Geladeira\n3️⃣ Máquina de lavar\n4️⃣ Falar com atendente\n\nO que precisa?`;
}

// FUNÇÃO: ENVIAR MENSAGEM WHATSAPP
async function enviarWhatsApp(numero, mensagem) {
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const TOKEN = process.env.WHATSAPP_TOKEN;
  
  try {
    await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: mensagem }
      })
    });
    console.log('📤 Enviado:', mensagem.substring(0, 30));
  } catch (e) {
    console.error('Erro ao enviar:', e);
  }
}
