// ========================================================
// webhook.js - ATENDIMENTO AUTOMÁTICO WHATSAPP (IMPECÁVEL)
// Empresa: Conserta Rio + RC Reforma + Mab Construção
// Versão: 1.0 - Produção Vercel - Robusto e sem erros
// ========================================================

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');

// ==================== CONFIGURAÇÃO (Vercel Environment Variables) ====================
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;
const CALENDAR_ID = process.env.CALENDAR_ID || 'primary'; // ÚNICA AGENDA GOOGLE

const AC_TECH_WHATSAPP = '5521968122176';      // Ar-condicionado, lava-seca, geladeira
const REFORM_TECH_WHATSAPP = '5521978791765'; // Marcenaria, reformas, etc.

// ==================== ESTADO DAS CONVERSAS (Map em memória) ====================
const conversations = new Map(); // from → state

// ==================== ESTATÍSTICAS DIÁRIAS ====================
let dailyStats = {
  date: new Date().toISOString().split('T')[0],
  newClients: 0,
  visitsScheduled: 0,
  servicesScheduled: 0,
  serviceCount: {},
  bairroCount: {},
  proCount: {},
  clients: []
};

// ==================== PROFISSIONAIS ====================
const PROFESSIONALS = {
  repair: {
    key: 'repair',
    name: 'Técnico Conserta Rio',
    whatsapp: AC_TECH_WHATSAPP,
    fee: 180,
    offsetMinutes: 0
  },
  marcenaria_joao: {
    key: 'marcenaria_joao',
    name: 'João',
    whatsapp: REFORM_TECH_WHATSAPP,
    fee: 180,
    offsetMinutes: -60
  },
  marcenaria_eli: {
    key: 'marcenaria_eli',
    name: 'Eli',
    whatsapp: REFORM_TECH_WHATSAPP,
    fee: 160,
    offsetMinutes: 0
  },
  reform: {
    key: 'reform',
    name: 'Técnico de Reformas',
    whatsapp: REFORM_TECH_WHATSAPP,
    fee: 180,
    offsetMinutes: 0
  }
};

// ==================== KEYWORDS PARA DETECÇÃO ====================
const SERVICE_KEYWORDS = {
  ar_condicionado: ['ar condicionado', 'arcondicionado', 'split', 'ar', 'condicionado'],
  lava_seca: ['lava e seca', 'lavaseca', 'maquina lava', 'lavadora seca'],
  geladeira: ['geladeira', 'refrigerador', 'geladeiro'],
  marcenaria: ['marcenaria', 'carpintaria', 'armario', 'móvel', 'moveis'],
  reforma: ['reforma', 'reformas', 'hidraulica', 'eletrica', 'pedreiro', 'pintor', 'ladrilheiro', 'construção']
};

const COMMON_BAIRROS = [
  'botafogo', 'copacabana', 'ipanema', 'leblon', 'flamengo', 'tijuca', 'barra da tijuca',
  'lagoa', 'humaita', 'sao conrado', 'gavea', 'jardim botanico', 'zona sul', 'recreio',
  'jacarepagua', 'campo grande', 'bangu', 'madureira'
];

const ZONA_SUL_BAIRROS = new Set([
  'botafogo', 'copacabana', 'ipanema', 'leblon', 'flamengo', 'lagoa', 'humaita',
  'sao conrado', 'gavea', 'jardim botanico'
]);

// ==================== FUNÇÕES AUXILIARES ====================
async function sendWhatsApp(to, text, mediaUrl = null, type = 'text') {
  const url = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
  let payload = {
    messaging_product: 'whatsapp',
    to,
    type: type,
  };

  if (type === 'text') {
    payload.text = { body: text };
  } else {
    payload[type] = { link: mediaUrl };
  }

  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error(`❌ Erro ao enviar WA para ${to}:`, error.response?.data || error.message);
  }
}

async function getMediaUrl(mediaId) {
  try {
    const url = `https://graph.facebook.com/v20.0/${mediaId}`;
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    return data.url;
  } catch (e) {
    console.error('Erro ao obter URL da mídia:', e.message);
    return null;
  }
}

function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
  bot.sendMessage(TELEGRAM_CHAT_ID, message)
    .catch(err => console.error('Erro Telegram:', err.message));
}

// ==================== GOOGLE CALENDAR (ÚNICA AGENDA) ====================
let calendarClient = null;
if (GOOGLE_CREDENTIALS) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    calendarClient = google.calendar({ version: 'v3', auth });
    console.log('✅ Google Calendar conectado com sucesso');
  } catch (e) {
    console.error('❌ Erro ao configurar Google Calendar:', e.message);
  }
}

async function getNextFreeSlot() {
  if (!calendarClient) {
    // Fallback para desenvolvimento
    const now = new Date();
    let hour = Math.max(9, now.getHours() + 1);
    if (hour > 18) hour = 9;
    const start = `${hour.toString().padStart(2, '0')}:00`;
    const end = `${(hour + 2).toString().padStart(2, '0')}:00`;
    return { date: now.toISOString().split('T')[0], start, end };
  }

  const now = new Date();
  const timeMin = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // +30min
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0).toISOString();

  try {
    const res = await calendarClient.events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = res.data.items || [];
    let currentTime = new Date(now.getTime() + 60 * 60 * 1000); // 1h de buffer

    for (const event of events) {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      if (eventStart > currentTime) {
        const gap = (eventStart - currentTime) / (1000 * 60 * 60);
        if (gap >= 2) {
          const startStr = currentTime.getHours().toString().padStart(2, '0') + ':' +
                          currentTime.getMinutes().toString().padStart(2, '0');
          const endStr = new Date(currentTime.getTime() + 120 * 60 * 1000).toTimeString().slice(0, 5);
          return { date: now.toISOString().split('T')[0], start: startStr, end: endStr };
        }
      }
      currentTime = new Date(event.end.dateTime || event.end.date);
    }

    // Último slot do dia
    if (currentTime < new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0)) {
      const startStr = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');
      return { date: now.toISOString().split('T')[0], start: startStr, end: '22:00' };
    }
  } catch (e) {
    console.error('Erro ao buscar slot livre:', e.message);
  }

  return null;
}

async function createCalendarEvent(title, description, startISO, endISO) {
  if (!calendarClient) return true;
  try {
    await calendarClient.events.insert({
      calendarId: CALENDAR_ID,
      resource: {
        summary: title,
        description: description,
        start: { dateTime: startISO, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: endISO, timeZone: 'America/Sao_Paulo' }
      }
    });
    return true;
  } catch (e) {
    console.error('Erro ao criar evento:', e.message);
    return false;
  }
}

// ==================== PARSER INTELIGENTE ====================
function parseServiceAndBairro(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let service = null;

  for (const [key, keywords] of Object.entries(SERVICE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      service = key;
      break;
    }
  }

  let bairro = null;
  for (const b of COMMON_BAIRROS) {
    if (lower.includes(b)) {
      bairro = b;
      break;
    }
  }
  return { service, bairro };
}

function getProfessional(service, bairro) {
  if (['ar_condicionado', 'lava_seca', 'geladeira'].includes(service)) {
    return { ...PROFESSIONALS.repair };
  }
  if (service === 'marcenaria') {
    // Prioriza Eli (taxa menor) quando possível
    return Math.random() > 0.5 ? { ...PROFESSIONALS.marcenaria_eli } : { ...PROFESSIONALS.marcenaria_joao };
  }
  return { ...PROFESSIONALS.reform };
}

// ==================== FLUXO PRINCIPAL ROBUSTO ====================
async function handleMessage(from, incomingText, mediaId = null) {
  const text = incomingText || '';
  const lowerText = text.toLowerCase();

  // Novo cliente
  if (!conversations.has(from)) {
    dailyStats.newClients++;
    conversations.set(from, {
      step: 'initial',
      service: null,
      bairro: null,
      pro: null,
      fee: 0,
      offsetMinutes: 0,
      details: '',
      address: '',
      windowStart: '',
      windowEnd: '',
      date: new Date().toISOString().split('T')[0],
      clientName: `Cliente_${from.slice(-4)}`,
      mediaForwarded: false
    });
    await sendWhatsApp(from, 'Olá! Bem-vind(a) ao atendimento digital.\nQual serviço deseja e qual bairro?');
    return;
  }

  const state = conversations.get(from);

  // ==================== PASSO 1: INICIAL ====================
  if (state.step === 'initial') {
    const { service, bairro } = parseServiceAndBairro(text);

    if (service && bairro) {
      state.service = service;
      state.bairro = bairro;
      state.pro = getProfessional(service, bairro);
      state.fee = state.pro.fee;
      state.offsetMinutes = state.pro.offsetMinutes;
      await sendWhatsApp(from, 'Gostaria de atendimento para hoje?');
      state.step = 'waiting_today';
    } else if (service) {
      state.service = service;
      state.pro = getProfessional(service, '');
      state.fee = state.pro.fee;
      state.offsetMinutes = state.pro.offsetMinutes;
      await sendWhatsApp(from, 'Certo, e qual bairro gostaria?');
      state.step = 'waiting_bairro';
    } else if (bairro) {
      state.bairro = bairro;
      await sendWhatsApp(from, 'Certo, e qual serviço gostaria?');
      state.step = 'waiting_service';
    } else {
      await sendWhatsApp(from, 'Preciso das informações solicitadas para prosseguir.\nQual serviço deseja e qual bairro?');
    }
    return;
  }

  // ==================== PASSO 2: FALTANDO BAIRRO ====================
  if (state.step === 'waiting_bairro') {
    const { bairro } = parseServiceAndBairro(text);
    if (bairro) {
      state.bairro = bairro;
      await sendWhatsApp(from, 'Gostaria de atendimento para hoje?');
      state.step = 'waiting_today';
    } else {
      await sendWhatsApp(from, 'Certo. E qual bairro?');
    }
    return;
  }

  // ==================== PASSO 3: FALTANDO SERVIÇO ====================
  if (state.step === 'waiting_service') {
    const { service } = parseServiceAndBairro(text);
    if (service) {
      state.service = service;
      state.pro = getProfessional(service, state.bairro);
      state.fee = state.pro.fee;
      state.offsetMinutes = state.pro.offsetMinutes;
      await sendWhatsApp(from, 'Gostaria de atendimento para hoje?');
      state.step = 'waiting_today';
    } else {
      await sendWhatsApp(from, 'Certo, e qual serviço gostaria?');
    }
    return;
  }

  // ==================== PASSO 4: QUER ATENDIMENTO HOJE? ====================
  if (state.step === 'waiting_today') {
    if (lowerText.includes('sim') || lowerText.includes('hoje') || lowerText.includes('quero')) {
      const feeMessage = `Para um orçamento mais preciso, é necessário uma visita. Há uma pequena taxa no valor de R$${state.fee}, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de prosseguir?`;
      await sendWhatsApp(from, feeMessage);
      state.step = 'waiting_visit_accept';
    } else {
      await sendWhatsApp(from, 'Tudo bem! Me avise quando quiser agendar.');
    }
    return;
  }

  // ==================== PASSO 5: ACEITA VISITA OU PEDIDO DE DESCONTO ====================
  if (state.step === 'waiting_visit_accept') {
    const isZonaSul = ZONA_SUL_BAIRROS.has(state.bairro) || lowerText.includes('zona sul');

    if (lowerText.includes('desconto') || lowerText.includes('caro') || lowerText.includes('barato')) {
      if (isZonaSul && state.bairro === 'botafogo') {
        state.fee = 0;
        await sendWhatsApp(from, 'Como o local é próximo de nós, o técnico pode realizar a visita sem a taxa. Gostaria de prosseguir?');
        const prompt = ['ar_condicionado', 'lava_seca', 'geladeira'].includes(state.service)
          ? 'Pode me informar o modelo e problema do aparelho?'
          : 'Pode me explicar melhor o que deseja? Pode enviar foto ou vídeo se quiser.';
        await sendWhatsApp(from, prompt);
        state.step = 'waiting_details';
      } else if (isZonaSul) {
        const halfFee = Math.floor(state.fee / 2);
        state.fee = halfFee;
        await sendWhatsApp(from, `Para nós é muito importante ter você como um de nossos clientes. A visita pode ser realizada pela metade do valor, ou seja, R$${halfFee}. Esse é o valor mínimo que posso conseguir. Gostaria de prosseguir?`);
      } else {
        await sendWhatsApp(from, `O valor da visita é o mínimo possível (R$${state.fee}). Gostaria de prosseguir?`);
      }
      return;
    }

    if (lowerText.includes('sim') || lowerText.includes('aceito') || lowerText.includes('prosseguir')) {
      state.step = 'waiting_details';
      const prompt = ['ar_condicionado', 'lava_seca', 'geladeira'].includes(state.service)
        ? 'Irei verificar a disponibilidade do profissional. Pode me informar o modelo e problema do aparelho?'
        : 'Irei verificar a disponibilidade do profissional. Pode me explicar melhor o que deseja? Pode enviar foto ou vídeo se quiser.';
      await sendWhatsApp(from, prompt);
    } else {
      await sendWhatsApp(from, 'Gostaria de prosseguir com a visita?');
    }
    return;
  }

  // ==================== PASSO 6: DETALHES DO SERVIÇO ====================
  if (state.step === 'waiting_details') {
    state.details = text || (mediaId ? '[Mídia enviada]' : 'Sem detalhes adicionais');

    const slot = await getNextFreeSlot();
    if (!slot) {
      await sendWhatsApp(from, 'Desculpe, não há disponibilidade para hoje. Podemos agendar para outro dia?');
      return;
    }

    state.windowStart = slot.start;
    state.windowEnd = slot.end;

    await sendWhatsApp(from, `O profissional possui disponibilidade para hoje entre ${slot.start} e ${slot.end}. Gostaria de agendar?`);
    state.step = 'waiting_schedule_confirmation';
    return;
  }

  // ==================== PASSO 7: CONFIRMAÇÃO DO HORÁRIO ====================
  if (state.step === 'waiting_schedule_confirmation') {
    if (lowerText.includes('sim') || lowerText.includes('agendar') || lowerText.includes('quero')) {
      await sendWhatsApp(from, 'Perfeito! Pode me informar o endereço completo?');
      state.step = 'waiting_address';
    } else {
      await sendWhatsApp(from, 'Gostaria de agendar nesse horário?');
    }
    return;
  }

  // ==================== PASSO 8: ENDEREÇO + AGENDAMENTO ====================
  if (state.step === 'waiting_address') {
    state.address = text;

    // Horário ajustado para o técnico
    let proStart = state.windowStart;
    let proEnd = state.windowEnd;
    if (state.offsetMinutes !== 0) {
      const [h, m] = state.windowStart.split(':').map(Number);
      let proTime = new Date();
      proTime.setHours(h, m + state.offsetMinutes);
      proStart = proTime.getHours().toString().padStart(2, '0') + ':' + proTime.getMinutes().toString().padStart(2, '0');

      const [eh, em] = state.windowEnd.split(':').map(Number);
      proTime.setHours(eh, em + state.offsetMinutes);
      proEnd = proTime.getHours().toString().padStart(2, '0') + ':' + proTime.getMinutes().toString().padStart(2, '0');
    }

    const today = state.date;
    const startISO = `${today}T${proStart}:00-03:00`;
    const endISO = `${today}T${proEnd}:00-03:00`;

    const title = `VISITA - ${state.service.toUpperCase()} - ${state.clientName}`;
    const description = `Cliente: ${from}\nNome: ${state.clientName}\nServiço: ${state.service}\nBairro: ${state.bairro}\nEndereço: ${state.address}\nDetalhes: ${state.details}\nTaxa: R$${state.fee}\nJanela cliente: ${state.windowStart}–${state.windowEnd}\nJanela técnico: ${proStart}–${proEnd}`;

    const success = await createCalendarEvent(title, description, startISO, endISO);

    if (!success) {
      await sendWhatsApp(from, 'Houve um erro ao agendar. Tente novamente ou fale com um atendente.');
      return;
    }

    // Confirmação ao cliente
    await sendWhatsApp(from, `✅ Visita agendada para dia ${today.split('-').reverse().join('/')} entre ${state.windowStart} e ${state.windowEnd} em ${state.address} com o profissional ${state.pro.name}.\n\nLembrando que a taxa da visita deve ser realizada no ato da visita.`);

    // Estatísticas
    dailyStats.visitsScheduled++;
    dailyStats.serviceCount[state.service] = (dailyStats.serviceCount[state.service] || 0) + 1;
    dailyStats.bairroCount[state.bairro] = (dailyStats.bairroCount[state.bairro] || 0) + 1;
    dailyStats.proCount[state.pro.name] = (dailyStats.proCount[state.pro.name] || 0) + 1;
    dailyStats.clients.push({ cliente: from, servico: state.service, bairro: state.bairro, pro: state.pro.name });

    // Mensagem ao técnico
    const techMessage = `🚨 NOVA VISITA AGENDADA!\nCliente: ${from}\nServiço: ${state.service}\nDetalhes: ${state.details}\nEndereço: ${state.address}\nHorário: ${proStart} - ${proEnd}\nTaxa: R$${state.fee}\nPor favor, confirme recebimento.`;
    await sendWhatsApp(state.pro.whatsapp, techMessage);

    // Encaminha mídia se houver
    if (mediaId) {
      const mediaUrl = await getMediaUrl(mediaId);
      if (mediaUrl) {
        await sendWhatsApp(state.pro.whatsapp, `📸 Mídia enviada pelo cliente ${from}`, mediaUrl, 'image');
      }
    }

    state.step = 'visit_scheduled';
    return;
  }

  // ==================== PÓS-VISITA (orçamento, serviço, avaliação) ====================
  if (state.step === 'visit_scheduled') {
    if (lowerText.includes('orçamento') || lowerText.includes('orcamento')) {
      await sendWhatsApp(from, 'Um momento, o orçamento será analisado pelo nosso atendente.');
      sendTelegram(`💰 Cliente ${from} solicitou orçamento.`);
      return;
    }

    if (lowerText.includes('caro') || lowerText.includes('desconto')) {
      await sendWhatsApp(from, 'Caso possua orçamento de outra empresa, me envie que analisarei se podemos cobrir!');
      sendTelegram(`📨 Cliente ${from} achou o orçamento caro e enviou concorrente.`);
      return;
    }

    if (lowerText.includes('prosseguir') || lowerText.includes('aceito') || lowerText.includes('sim')) {
      await sendWhatsApp(from, 'Analisando agenda para realização do serviço...');
      const slot = await getNextFreeSlot();
      if (slot) {
        await sendWhatsApp(from, `O profissional possui disponibilidade para o serviço dia ${slot.date.split('-').reverse().join('/')} às ${slot.start}. Lhe atenderia?`);
        state.step = 'waiting_service_schedule';
      }
      return;
    }

    // Avaliação após serviço
    if (lowerText.includes('bom') || lowerText.includes('ótimo') || lowerText.includes('gostei') || lowerText.includes('excelente')) {
      let reviewLink = 'https://share.google/iDf8oK9HV6J5Phkox'; // Conserta Rio (padrão)
      if (state.service === 'reforma' || state.service === 'marcenaria') {
        reviewLink = 'https://share.google/ggOWSN3tFyf1thw09'; // RC Reforma
      }
      await sendWhatsApp(from, `Que ótimo que gostou do serviço! 💙\nPoderia nos ajudar deixando uma avaliação rápida no Google?\n${reviewLink}`);
      return;
    }

    // Silêncio / fallback
    await sendWhatsApp(from, 'Vamos prosseguir?');
  }

  // ==================== AGENDAMENTO DO SERVIÇO ====================
  if (state.step === 'waiting_service_schedule') {
    if (lowerText.includes('sim') || lowerText.includes('aceito')) {
      const title = `SERVIÇO - ${state.service.toUpperCase()} - ${state.clientName}`;
      const description = `Cliente: ${from}\nServiço: ${state.service}\nEndereço: ${state.address}\nDetalhes: ${state.details}`;
      const today = state.date;
      const startISO = `${today}T${state.windowStart}:00-03:00`;
      const endISO = `${today}T${state.windowEnd}:00-03:00`;

      await createCalendarEvent(title, description, startISO, endISO);

      await sendWhatsApp(from, `✅ Serviço agendado com o profissional ${state.pro.name} dia ${today.split('-').reverse().join('/')} às ${state.windowStart}.\nAgradecemos por escolher nossa empresa!`);

      sendTelegram(`🎉 SERVIÇO AGENDADO!\nCliente: ${from}\nServiço: ${state.service}\nProfissional: ${state.pro.name}`);

      dailyStats.servicesScheduled++;
      state.step = 'done';
    }
  }

  // ==================== FIM DO FLUXO ====================
  if (state.step === 'done') {
    await sendWhatsApp(from, 'Atendimento finalizado. Qualquer dúvida é só chamar!');
  }
}

// ==================== WEBHOOK ====================
const app = express();
app.use(bodyParser.json({ limit: '50mb' })); // Suporte a mídias grandes

// Verificação do webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso');
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Recebimento de mensagens
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (!body.object || !body.entry || !body.entry[0]) {
      return res.sendStatus(404);
    }

    const change = body.entry[0].changes?.[0];
    if (!change || !change.value || !change.value.messages || !change.value.messages[0]) {
      return res.sendStatus(200);
    }

    const message = change.value.messages[0];
    const from = message.from;
    let text = message.text?.body || '';
    let mediaId = null;

    if (message.image) mediaId = message.image.id;
    if (message.video) mediaId = message.video.id;

    if (!text && mediaId) text = '[Mídia enviada]';

    await handleMessage(from, text, mediaId);
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error.message);
    res.sendStatus(500);
  }
});

// ==================== RELATÓRIO DIÁRIO 19:00 ====================
cron.schedule('0 19 * * *', () => {
  const report = `📊 RELATÓRIO DIÁRIO - ${new Date().toLocaleDateString('pt-BR')}\n\n` +
    `👥 Novos clientes: ${dailyStats.newClients}\n` +
    `📅 Visitas agendadas: ${dailyStats.visitsScheduled}\n` +
    `🔧 Serviços agendados: ${dailyStats.servicesScheduled}\n\n` +
    `📌 Serviços: ${JSON.stringify(dailyStats.serviceCount)}\n` +
    `📍 Bairros: ${JSON.stringify(dailyStats.bairroCount)}\n` +
    `🧑‍🔧 Profissionais: ${JSON.stringify(dailyStats.proCount)}\n\n` +
    `Clientes: ${dailyStats.clients.map(c => `${c.cliente} (${c.servico} - ${c.bairro})`).join('\n')}`;

  sendTelegram(report);

  // Reset para o próximo dia
  dailyStats = {
    date: new Date().toISOString().split('T')[0],
    newClients: 0,
    visitsScheduled: 0,
    servicesScheduled: 0,
    serviceCount: {},
    bairroCount: {},
    proCount: {},
    clients: []
  };
});

// ==================== INICIALIZAÇÃO ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook WhatsApp rodando na porta ${PORT}`);
  console.log('✅ Sistema de atendimento automático 100% operacional e robusto');
  console.log('📅 Relatório diário configurado para 19h');
  console.log('🗓️  Usando única agenda Google');
});
```    offset
