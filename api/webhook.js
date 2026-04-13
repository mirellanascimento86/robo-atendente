export default async function handler(req, res) {
  
  // VERIFICAÇÃO GET - Meta confirma webhook
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    console.log('Verificação:', { mode, token });
    
    // SEU TOKEN: roboatendente
    if (mode === 'subscribe' && token === 'roboatendente') {
      console.log('✅ Verificado!');
      return res.status(200).send(challenge);
    }
    
    return res.status(403).send('Forbidden');
  }

  // RECEBER MENSAGENS POST
  if (req.method === 'POST') {
    try {
      console.log('📩 Mensagem recebida');
      
      const body = req.body;
      
      if (body.object === 'whatsapp_business_account') {
        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        
        if (message && message.type === 'text') {
          const telefone = message.from;
          const texto = message.text.body;
          
          console.log(`💬 ${telefone}: ${texto}`);
          
          // RESPOSTA DE TESTE
          await enviarWhatsApp(telefone, `Recebi: "${texto}"\n\nRobô funcionando! 🤖`);
        }
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(200).send('OK');
    }
  }
  
  return res.status(405).end();
}

// Enviar mensagem de volta
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
    console.log('📤 Resposta enviada');
  } catch (e) {
    console.error('Erro ao enviar:', e);
  }
}
