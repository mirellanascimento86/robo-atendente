const WHATSAPP_TOKEN = 'SEU_TOKEN_AQUI';
const PHONE_ID = 'SEU_PHONE_ID_AQUI';
const SEU_NUMERO = '5521XXXXXXXX'; // Seu número com 55

async function testarWhatsApp() {
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: SEU_NUMERO,
        type: 'text',
        text: { body: 'Teste de conexão! ✅' }
      })
    });
    
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Resposta:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erro:', e.message);
  }
}

testarWhatsApp();
