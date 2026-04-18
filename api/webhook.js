// api/webhook.js - Ponto de entrada principal
import { handleMessage } from '../src/handlers/messageHandler';
import { verifyWebhook } from '../src/utils/verify';

export default async function handler(req, res) {
  // Verificação do webhook (GET)
  if (req.method === 'GET') {
    return verifyWebhook(req, res);
  }

  // Recebimento de mensagens (POST)
  if (req.method === 'POST') {
    try {
      const { entry } = req.body;
      
      if (!entry || !entry[0]?.changes[0]?.value?.messages) {
        return res.status(200).send('OK');
      }

      const message = entry[0].changes[0].value.messages[0];
      const from = message.from; // Número do cliente
      const text = message.text?.body || '';
      const media = message.image || message.video || message.audio || null;
      
      // Identificar empresa de origem
      const businessPhone = entry[0].changes[0].value?.metadata?.phone_number_id;
      const company = identifyCompany(businessPhone);

      await handleMessage(from, text, media, company);
      
      return res.status(200).send('OK');
    } catch (error) {
      console.error('Erro no webhook:', error);
      return res.status(500).send('Error');
    }
  }

  res.status(405).send('Method Not Allowed');
}

function identifyCompany(phoneNumberId) {
  // Mapear IDs de telefone para empresas
  const mapping = {
    'PHONE_ID_CONSERTA_RIO': 'conserta_rio',
    'PHONE_ID_RC_REforma': 'rc_reforma',
    'PHONE_ID_MAB': 'mab_construcao'
  };
  return mapping[phoneNumberId] || 'unknown';
}
