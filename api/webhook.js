// ... (continuação do código acima)

// ============================================
// NOTIFICAR TÉCNICO
// ============================================

async function notificarTecnico(cliente) {
  let numeroTecnico;
  
  if (cliente.dados.servico?.includes('marcenaria') || cliente.dados.servico?.includes('móvel') || cliente.dados.servico?.includes('armário')) {
    numeroTecnico = CONFIG.tecnicos.marcenaria;
  } else if (cliente.dados.servico?.includes('hidráulica') || cliente.dados.servico?.includes('encanamento') || cliente.dados.servico?.includes('vazamento')) {
    numeroTecnico = CONFIG.tecnicos.hidraulica;
  } else {
    numeroTecnico = CONFIG.tecnicos.reforma;
  }
  
  const mensagem = `NOVO AGENDAMENTO - RC REFORMAS

Cliente: ${cliente.nome}
Telefone: ${cliente.telefone}
Serviço: ${cliente.dados.servico}
Bairro: ${cliente.dados.bairro}
Endereço: ${cliente.dados.endereco}
Data: ${cliente.dados.data} às ${cliente.dados.hora}
Valor Visita: R$${cliente.dados.valor}
${cliente.dados.urgente ? 'ATENÇÃO: SERVIÇO URGENTE' : ''}

Confirme sua disponibilidade.`;

  console.log(`\n📤 Notificando técnico: ${numeroTecnico}`);
  await enviarWhatsApp(numeroTecnico, mensagem);
}

// ============================================
// FALLBACK
// ============================================

function fallbackResposta(cliente, texto) {
  if (!cliente.dados.servico) {
    return `Tudo bem. Me conta, qual serviço você está precisando?`;
  }
  if (!cliente.dados.bairro) {
    return `Entendi que você precisa de ${cliente.dados.servico}. Em qual bairro é?`;
  }
  return `Perfeito. Para quando você quer agendar essa visita?`;
}

// ============================================
// ENVIAR WHATSAPP
// ============================================

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 Enviando para ${numero}:\n${texto}\n---`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('❌ Variáveis não configuradas');
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
    
    if (!response.ok) {
      console.error('❌ Erro:', data);
      return false;
    }
    
    return true;
    
  } catch (e) {
    console.error('❌ Exceção:', e.message);
    return false;
  }
}
