// ============================================
// RC ATENDIMENTO - IA AUTONOMA 100% GROQ
// ============================================

const CONFIG = {
  tecnicos: {
    marcenaria: '5521978791765',
    reforma: '5521968112176',
    hidraulica: '5521968112176'
  },
  
  precoZonaSul: 180,
  precoOutros: 220,
  
  bairrosZonaSul: ['ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 'sao conrado', 'vidigal', 'rocinha'],
  
  saudacao: `Ola, tudo bem? Aqui e da RC Reformas. Vi que voce entrou em contato. Me conta, o que voce esta precisando?`
};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';

const clientes = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    if (req.method === 'POST') {
      return await receberMensagem(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (erro) {
    console.error('ERRO:', erro);
    return res.status(200).send('OK');
  }
}

async function receberMensagem(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') {
    return res.status(200).send('OK');
  }
  
  const telefone = message.from;
  const nome = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = message.text.body;
  
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  if (!clientes[telefone]) {
    clientes[telefone] = {
      nome,
      telefone,
      primeiraVez: true,
      historico: [],
      dados: {
        servico: null,
        bairro: null,
        valor: null,
        data: null,
        hora: null,
        endereco: null,
        tecnicoNotificado: false
      }
    };
  }
  
  const cliente = clientes[telefone];
  
  cliente.historico.push({
    role: 'user',
    content: texto,
    timestamp: new Date().toISOString()
  });
  
  const resposta = await processarComIA(cliente, texto);
  
  if (resposta) {
    const enviado = await enviarWhatsApp(telefone, resposta);
    if (enviado) {
      cliente.historico.push({
        role: 'assistant',
        content: resposta,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return res.status(200).send('OK');
}

async function processarComIA(cliente, texto) {
  const t = texto.toLowerCase();
  
  if (cliente.primeiraVez) {
    cliente.primeiraVez = false;
    return CONFIG.saudacao;
  }
  
  if (t.includes('atendente') || t.includes('humano') || t.includes('pessoa') || t.includes('gerente')) {
    return `Entendo perfeitamente. Vou transferir voce agora para um dos nossos especialistas. So um momento.`;
  }
  
  const horaAtual = new Date().getHours();
  const dadosAtuais = JSON.stringify(cliente.dados);
  
  const historicoFormatado = cliente.historico.slice(-6).map(h => {
    return `${h.role === 'user' ? 'Cliente' : 'Consultor'}: ${h.content}`;
  }).join('\n');
  
  const systemPrompt = `Voce e um CONSULTOR DE VENDAS SENIOR da RC Reformas, especialista em reformas e construcao civil. Tem 15 anos de experiencia e e excelente em fechar negocios.

SEU OBJETIVO: Agendar visitas tecnicas e converter leads em vendas.

REGRAS DE NEGOCIO:
1. Valor da visita tecnica:
   - Zona Sul (Ipanema, Leblon, Copacabana, Botafogo, Flamengo, Lagoa, Gavea, Jardim Botanico, Humaita, Urca, Catete, Gloria, Laranjeiras, Cosme Velho): R$180
   - Outros bairros: R$220
   - O valor e abatido do orcamento final se o cliente aprovar o servico
   - O pagamento e feito no ato da visita (Pix, cartao ou dinheiro)

2. Se o cliente disser que nao quer pagar visita:
   - Explique que o valor e abatido do orcamento
   - Se insistir, ofereca pre-orcamento por foto/video (deixe claro que e aproximado)
   - Se for pintura, pode fazer orcamento sem visita pedindo metragem, quantidade de comodos e tipo de tinta

3. Horarios:
   - Se for depois das 19h e quiser mesmo dia: explique que precisa verificar disponibilidade para primeiro horario do dia seguinte
   - Pergunte se e urgente

4. Urgencia (vazamento, risco, quebrou, emergencia):
   - Priorize e mostre preocupacao genuina
   - Diga que vai acionar o tecnico imediatamente

5. ETAPAS PARA AGENDAR:
   - Descobrir qual servico
   - Descobrir o bairro
   - Calcular e informar o valor da visita
   - Perguntar data e horario desejado
   - Coletar endereco completo
   - Confirmar agendamento

6. TOM DE VOZ:
   - Profissional, mas proximo e humano
   - SEM EMOJIS
   - SEM mensagens roboticas ou numeradas
   - Como um vendedor experiente
   - Natural, fluido, direto ao ponto
   - Persuasivo mas nao insistente
   - Use portugues sem acentos (ex: "orcamento" nao "orçamento")

DADOS DO CLIENTE:
- Nome: ${cliente.nome}
- Telefone: ${cliente.telefone}
- Dados ja coletados: ${dadosAtuais}
- Horario atual: ${horaAtual}h

HISTORICO DA CONVERSA:
${historicoFormatado}

INSTRUCAO: Responda como um vendedor senior faria. Seja natural. Nao use emojis. Nao seja robotico. Se o cliente disser "pintura em Ipanema", entenda que e pintura no bairro Ipanema, nao pergunte o bairro de novo.`;
  
  try {
    console.log('🤖 Pensando...');
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texto }
        ],
        temperature: 0.7,
        max_tokens: 400
      })
    });
    
    if (!response.ok) {
      throw new Error(`Erro API: ${response.status}`);
    }
    
    const data = await response.json();
    const respostaIA = data.choices[0].message.content;
    
    console.log('💬 Resposta:', respostaIA.substring(0, 100) + '...');
    
    await extrairEAtualizarDados(cliente, texto, respostaIA);
    
    if (cliente.dados.servico && cliente.dados.bairro && cliente.dados.data && cliente.dados.hora && cliente.dados.endereco && !cliente.dados.tecnicoNotificado) {
      await notificarTecnico(cliente);
      cliente.dados.tecnicoNotificado = true;
    }
    
    return respostaIA;
    
  } catch (erro) {
    console.error('Erro IA:', erro);
    return fallbackResposta(cliente, texto);
  }
}

async function extrairEAtualizarDados(cliente, textoCliente, respostaIA) {
  const prompt = `Analise e extraia dados em JSON:
{
  "servico": "tipo de servico ou null",
  "bairro": "bairro ou null",
  "data": "data ou null",
  "hora": "hora ou null",
  "endereco": "endereco ou null",
  "urgente": true/false
}

Cliente: "${textoCliente}"
Vendedor: "${respostaIA}"

Regras:
- "pintura em Ipanema" = servico: "pintura", bairro: "Ipanema"
- "vazamento", "emergencia", "quebrou" = urgente: true`;
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 150
      })
    });
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    const match = content.match(/\{[^}]+\}/);
    
    if (match) {
      const extraido = JSON.parse(match[0]);
      
      if (extraido.servico) cliente.dados.servico = extraido.servico;
      if (extraido.bairro) cliente.dados.bairro = extraido.bairro;
      if (extraido.data) cliente.dados.data = extraido.data;
      if (extraido.hora) cliente.dados.hora = extraido.hora;
      if (extraido.endereco) cliente.dados.endereco = extraido.endereco;
      if (extraido.urgente) cliente.dados.urgente = extraido.urgente;
      
      if (cliente.dados.bairro && !cliente.dados.valor) {
        const isZonaSul = CONFIG.bairrosZonaSul.some(b => 
          cliente.dados.bairro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
        );
        cliente.dados.valor = isZonaSul ? CONFIG.precoZonaSul : CONFIG.precoOutros;
      }
    }
  } catch (e) {
    console.log('Erro extracao:', e.message);
  }
}

async function notificarTecnico(cliente) {
  let numero;
  
  if (cliente.dados.servico?.includes('marcenaria') || cliente.dados.servico?.includes('movel') || cliente.dados.servico?.includes('armario')) {
    numero = CONFIG.tecnicos.marcenaria;
  } else if (cliente.dados.servico?.includes('hidraulica') || cliente.dados.servico?.includes('encanamento') || cliente.dados.servico?.includes('vazamento')) {
    numero = CONFIG.tecnicos.hidraulica;
  } else {
    numero = CONFIG.tecnicos.reforma;
  }
  
  const msg = `NOVO AGENDAMENTO - RC REFORMAS

Cliente: ${cliente.nome}
Telefone: ${cliente.telefone}
Servico: ${cliente.dados.servico}
Bairro: ${cliente.dados.bairro}
Endereco: ${cliente.dados.endereco}
Data: ${cliente.dados.data} as ${cliente.dados.hora}
Valor Visita: R$${cliente.dados.valor}
${cliente.dados.urgente ? 'ATENCAO: SERVICO URGENTE' : ''}

Confirme disponibilidade.`;
  
  console.log(`\n📤 Notificando tecnico: ${numero}`);
  await enviarWhatsApp(numero, msg);
}

function fallbackResposta(cliente, texto) {
  if (!cliente.dados.servico) {
    return `Tudo bem. Me conta, qual servico voce esta precisando?`;
  }
  if (!cliente.dados.bairro) {
    return `Entendi que voce precisa de ${cliente.dados.servico}. Em qual bairro e?`;
  }
  return `Perfeito. Para quando voce quer agendar?`;
}

async function enviarWhatsApp(numero, texto) {
  console.log(`\n📤 Para ${numero}:\n${texto}\n---`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('ERRO: Variaveis nao configuradas');
    return false;
  }
  
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
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
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error('Erro:', data);
      return false;
    }
    
    return true;
    
  } catch (e) {
    console.error('Excecao:', e.message);
    return false;
  }
}
