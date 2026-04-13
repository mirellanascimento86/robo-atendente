// ============================================
// WEBHOOK COM PAINEL DE INTERVENÇÃO
// ============================================

import { conversas, mensagens } from './painel.js';

const CONFIG = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID
};

export default async function handler(req, res) {
  
  // VERIFICAÇÃO GET
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'roboatendente') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // RECEBER MENSAGEM
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      if (body.object === 'whatsapp_business_account') {
        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        
        if (message && message.type === 'text') {
          const telefone = message.from;
          const nome = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Cliente';
          const texto = message.text.body;
          
          console.log(`📩 ${nome} (${telefone}): ${texto}`);
          
          // Registrar conversa
          if (!conversas[telefone]) {
            conversas[telefone] = { nome, intervencao: false };
          }
          
          // Salvar mensagem
          if (!mensagens[telefone]) mensagens[telefone] = [];
          mensagens[telefone].push({
            tipo: 'cliente',
            nome: nome,
            texto: texto,
            data: new Date().toISOString()
          });
          
          // VERIFICAR SE ESTÁ EM INTERVENÇÃO
          if (conversas[telefone].intervencao) {
            console.log('👤 Intervenção ativa - robô não responde');
            return res.status(200).send('OK');
          }
          
          // ROBÔ RESPONDE (fluxo simples)
          let resposta = '';
          
          const t = texto.toLowerCase();
          
          if (t.includes('oi') || t.includes('olá') || t.includes('ola')) {
            resposta = `Olá ${nome}! Sou o assistente virtual. Como posso ajudar?\n\n1️⃣ Ar condicionado\n2️⃣ Geladeira\n3️⃣ Máquina de lavar\n4️⃣ Falar com atendente`;
          }
          else if (t.includes('1') || t.includes('ar')) {
            resposta = 'Perfeito! Para ar condicionado, preciso saber:\n- Quantos BTUs?\n- Qual bairro?\n- Qual o problema?';
          }
          else if (t.includes('atendente') || t.includes('humano') || t.includes('pessoa') || t.includes('4')) {
            conversas[telefone].intervencao = true; // Ativa intervenção automaticamente
            resposta = '🔄 Transferindo para atendente humano...\n\nUm momento, por favor.';
          }
          else {
            resposta = `Entendi que você disse: "${texto}"\n\nPosso ajudar com:\n1️⃣ Ar condicionado\n2️⃣ Geladeira\n3️⃣ Máquina de lavar\n4️⃣ Falar com atendente`;
          }
          
          // Enviar resposta
          await enviarWhatsApp(telefone, resposta);
          
          // Salvar resposta do robô
          mensagens[telefone].push({
            tipo: 'robo',
            nome: 'Robô',
            texto: resposta,
            data: new Date().toISOString()
          });
        }
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('❌ Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  return res.status(405).end();
}

async function enviarWhatsApp(numero, mensagem) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${CONFIG.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: mensagem }
      })
    });
    console.log('📤 Resposta enviada');
  } catch (e) {
    console.error('Erro ao enviar:', e);
  }
}
