// api/webhook.js - Arquivo único completo
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { google } from 'googleapis';
import TelegramBot from 'node-telegram-bot-api';

// ==========================================
// CONFIGURAÇÃO E VARIÁVEIS DE AMBIENTE
// ==========================================
const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  cronSecret: process.env.CRON_SECRET
};

// Inicialização de serviços
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const telegramBot = new TelegramBot(CONFIG.telegramToken);

// ==========================================
// DADOS DOS PROFISSIONAIS
// ==========================================
const PROFESSIONALS = {
  ar_condicionado: [
    { name: 'Técnico Ar 1', phone: '5511999999991', calendarId: 'primary', email: 'tecnico1@empresa.com' },
    { name: 'Técnico Ar 2', phone: '5511999999992', calendarId: 'primary', email: 'tecnico2@empresa.com' }
  ],
  geladeira: [
    { name: 'Técnico Refri 1', phone: '5511999999993', calendarId: 'primary', email: 'refrigeracao@empresa.com' }
  ],
  lava_seca: [
    { name: 'Técnico Lava 1', phone: '5511999999994', calendarId: 'primary', email: 'lavaseca@empresa.com' }
  ],
  marcenaria: [
    { name: 'João', phone: '5511999999995', calendarId: 'primary', email: 'joao@marcenaria.com', antecedencia: 60 }, // 1h antes
    { name: 'Eli', phone: '5511999999996', calendarId: 'primary', email: 'eli@marcenaria.com', precoVisita: 160 }
  ],
  reforma: [
    { name: 'Pedreiro Carlos', phone: '5511999999997', calendarId: 'primary', email: 'carlos@reforma.com' },
    { name: 'Pintor Ana', phone: '5511999999998', calendarId: 'primary', email: 'ana@pintura.com' },
    { name: 'Hidráulico Pedro', phone: '5511999999999', calendarId: 'primary', email: 'pedro@hidraulica.com' }
  ]
};

// Mapeamento de empresas
const COMPANY_MAP = {
  'PHONE_ID_CONSERTA_RIO': 'conserta_rio',
  'PHONE_ID_RC_REFORMA': 'rc_reforma',
  'PHONE_ID_MAB': 'mab_construcao'
};

const REVIEW_LINKS = {
  'rc_reforma': 'https://share.google/ggOWSN3tFyf1thw09',
  'mab_construcao': 'https://share.google/xCFetDX4PoyjDw4gH',
  'conserta_rio': 'https://share.google/iDf8oK9HV6J5Phkox'
};

// ==========================================
// SERVIÇOS WHATSAPP
// ==========================================
const whatsappService = {
  async sendMessage(to, text) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${CONFIG.whatsappPhoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: { body: text }
        },
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.whatsappToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Erro WhatsApp:', error.message);
      await telegramBot.sendMessage(CONFIG.telegramChatId, `❌ Erro ao enviar WhatsApp para ${to}: ${error.message}`);
    }
  },

  async sendMedia(to, mediaUrl, type = 'image') {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: type,
        [type]: { link: mediaUrl }
      };
      
      await axios.post(
        `https://graph.facebook.com/v18.0/${CONFIG.whatsappPhoneId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.whatsappToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Erro ao enviar mídia:', error.message);
    }
  }
};

// ==========================================
// SERVIÇOS TELEGRAM
// ==========================================
const telegramService = {
  async send(message, urgent = false) {
    try {
      const prefix = urgent ? '🚨 URGENTE: ' : '';
      await telegramBot.sendMessage(CONFIG.telegramChatId, `${prefix}${message}`, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Erro Telegram:', error.message);
    }
  },

  async sendDailyReport(stats) {
    const message = `
📊 <b>RELATÓRIO DIÁRIO - ${stats.date}</b>

👥 Novos clientes: ${stats.new_clients}
✅ Visitas agendadas: ${stats.visits_scheduled}
🔧 Serviços agendados: ${stats.services_scheduled}

📋 Detalhes:
${stats.details.map(d => `• ${d.service} | ${d.location} | ${d.professional} | ${d.client}`).join('\n')}`;
    
    await this.send(message);
  }
};

// ==========================================
// SERVIÇOS GOOGLE CALENDAR
// ==========================================
const calendarService = {
  async getAuth() {
    return new google.auth.GoogleAuth({
      credentials: CONFIG.googleCredentials,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
  },

  async findAvailableSlots(professionals, date, clientLocation, minDuration = 60) {
    const auth = await this.getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const slots = [];
    
    const targetDate = new Date(date);
    targetDate.setHours(8, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(18, 0, 0, 0);

    for (const prof of professionals) {
      try {
        const events = await calendar.events.list({
          calendarId: prof.calendarId,
          timeMin: targetDate.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: 'startTime'
        });

        const busySlots = events.data.items || [];
        let currentTime = new Date(targetDate);

        // Verificar gaps
        for (const event of busySlots) {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const diff = (eventStart - currentTime) / 60000;

          if (diff >= minDuration) {
            // Verificar se há tempo suficiente após eventos anteriores considerando localização
            if (busySlots.length > 0) {
              const prevEvent = busySlots[busySlots.indexOf(event) - 1];
              if (prevEvent) {
                const prevEnd = new Date(prevEvent.end.dateTime || prevEvent.end.date);
                const timeGap = (currentTime - prevEnd) / 60000;
                // Se for mesmo bairro, precisa de 35min, se for diferente, 60min
                // Simplificação: assumindo que precisamos checar o bairro do evento anterior
              }
            }

            slots.push({
              professional: prof,
              startDateTime: currentTime.toISOString(),
              endDateTime: new Date(currentTime.getTime() + minDuration * 60000).toISOString(),
              startTime: formatTime(currentTime),
              endTime: formatTime(new Date(currentTime.getTime() + minDuration * 60000)),
              date: targetDate.toISOString().split('T')[0]
            });
          }
          currentTime = new Date(event.end.dateTime || event.end.date);
        }

        // Verificar após último evento
        const remaining = (endOfDay - currentTime) / 60000;
        if (remaining >= minDuration) {
          slots.push({
            professional: prof,
            startDateTime: currentTime.toISOString(),
            endDateTime: new Date(currentTime.getTime() + minDuration * 60000).toISOString(),
            startTime: formatTime(currentTime),
            endTime: formatTime(new Date(currentTime.getTime() + minDuration * 60000)),
            date: targetDate.toISOString().split('T')[0]
          });
        }
      } catch (error) {
        console.error(`Erro agenda ${prof.name}:`, error.message);
      }
    }

    return slots.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
  },

  async createEvent({ title, description, startTime, endTime, professional, location }) {
    const auth = await this.getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary: title,
      description: description,
      start: { dateTime: startTime, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: endTime, timeZone: 'America/Sao_Paulo' },
      location: location,
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 120 }]
      }
    };

    const response = await calendar.events.insert({
      calendarId: professional.calendarId,
      resource: event
    });

    return response.data;
  }
};

// ==========================================
// UTILITÁRIOS
// ==========================================
function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function categorizeService(text) {
  const lower = text.toLowerCase();
  if (lower.includes('ar condicionado') || lower.includes('split') || lower.includes('ar-condicionado')) return 'ar_condicionado';
  if (lower.includes('geladeira') || lower.includes('refrigerador') || lower.includes('freezer')) return 'geladeira';
  if (lower.includes('lava') || lower.includes('secadora') || lower.includes('máquina') || lower.includes('lavadora')) return 'lava_seca';
  if (lower.includes('marcenaria') || lower.includes('marceneiro') || lower.includes('móvel') || lower.includes('armário') || lower.includes('cozinha planejada') || lower.includes('guarda-roupa')) return 'marcenaria';
  if (lower.includes('reforma') || lower.includes('pedreiro') || lower.includes('pintor') || lower.includes('pintura') || lower.includes('hidraulica') || lower.includes('elétrica') || lower.includes('eletrica') || lower.includes('ladrilheiro') || lower.includes('azulejista') || lower.includes('construção')) return 'reforma';
  return 'other';
}

function parseMessage(text) {
  const lower = text.toLowerCase();
  
  const bairros = [
    'copacabana', 'ipanema', 'leblon', 'botafogo', 'flamengo', 'tijuca',
    'barra da tijuca', 'recreio', 'jacarepaguá', 'madureira', 'campo grande',
    'santa cruz', 'ilha do governador', 'penha', 'ramos', 'bonsucesso',
    'centro', 'lapa', 'catete', 'glória', 'laranjeiras', 'cosme velho',
    'humaitá', 'jardim botânico', 'gávea', 'são conrado', 'vidigal',
    'rocinha', 'lagoa', 'jardim oceanico', 'freguesia', 'anil', 'curicica',
    'pechincha', 'tanque', 'praça seca', 'vila valqueire', 'taquara',
    'vargem grande', 'vargem pequena', 'guaratiba', 'sepetiba', 'santíssimo'
  ];

  const servicosMap = {
    'ar_condicionado': ['ar condicionado', 'ar-condicionado', 'split', 'conserto ar', 'instalação ar'],
    'geladeira': ['geladeira', 'refrigerador', 'freezer', 'conserto geladeira'],
    'lava_seca': ['lava e seca', 'máquina de lavar', 'secadora', 'lavadora', 'conserto lava'],
    'marcenaria': ['marcenaria', 'marceneiro', 'móvel', 'móveis', 'armário', 'cozinha planejada', 'guarda-roupa', 'rack', 'estante'],
    'reforma': ['reforma', 'construção', 'pedreiro', 'pintor', 'pintura', 'hidraulica', 'hidráulica', 'eletrica', 'elétrica', 'ladrilheiro', 'azulejista', 'gesseiro', 'serralheiro']
  };

  let service = null;
  let location = null;

  // Detectar serviço
  for (const [cat, keywords] of Object.entries(servicosMap)) {
    if (keywords.some(k => lower.includes(k))) {
      service = cat;
      break;
    }
  }

  // Detectar bairro
  for (const bairro of bairros) {
    if (lower.includes(bairro)) {
      location = bairro.charAt(0).toUpperCase() + bairro.slice(1);
      break;
    }
  }

  return { service, location, original: text };
}

function isZonaSul(bairro) {
  const zonaSul = ['copacabana', 'ipanema', 'leblon', 'botafogo', 'flamengo', 'laranjeiras', 'cosme velho', 'humaitá', 'jardim botânico', 'gávea', 'são conrado', 'vidigal', 'rocinha', 'lagoa'];
  return zonaSul.some(b => bairro.toLowerCase().includes(b));
}

// ==========================================
// GERENCIAMENTO DE FLUXO (DATABASE)
// ==========================================
const flowManager = {
  async get(phone) {
    const { data } = await supabase
      .from('active_flows')
      .select('*')
      .eq('phone', phone)
      .single();
    return data || { step: 'awaiting_service_and_location', data: {} };
  },

  async set(phone, step, data) {
    await supabase
      .from('active_flows')
      .upsert({ phone, step, data, updated_at: new Date().toISOString() });
  },

  async update(phone, newData) {
    const current = await this.get(phone);
    await this.set(phone, current.step, { ...current.data, ...newData });
  },

  async clear(phone) {
    await supabase.from('active_flows').delete().eq('phone', phone);
  }
};

// ==========================================
// HANDLERS PRINCIPAIS DO FLUXO
// ==========================================
async function handleNewClient(phone, company) {
  // Criar cliente no banco
  await supabase.from('clients').insert([{
    phone,
    company_origin: company,
    created_at: new Date().toISOString(),
    status: 'new'
  }]);

  await whatsappService.sendMessage(phone, "Olá! Bem-vind(a) ao atendimento digital. Qual serviço deseja e qual bairro?");
  await flowManager.set(phone, 'awaiting_service_and_location', {});
  
  // Incrementar contador de novos clientes do dia
  await updateDailyStats('new_client');
}

async function handleServiceAndLocation(phone, text, client) {
  const parsed = parseMessage(text);

  if (parsed.service && parsed.location) {
    // Tem ambos
    await saveClientInfo(phone, { service: parsed.service, location: parsed.location, service_type: categorizeService(parsed.service) });
    await flowManager.set(phone, 'awaiting_urgency', { service: parsed.service, location: parsed.location });
    await whatsappService.sendMessage(phone, "Gostaria de atendimento para hoje?");
  } else if (parsed.service || parsed.location) {
    // Tem apenas um
    const has = parsed.service ? 'service' : 'location';
    const value = parsed.service || parsed.location;
    await flowManager.set(phone, 'awaiting_missing_info', { has, value });
    
    if (has === 'service') {
      await whatsappService.sendMessage(phone, "Certo, e qual bairro?");
    } else {
      await whatsappService.sendMessage(phone, "Certo, e qual serviço gostaria?");
    }
  } else {
    // Não tem nenhum
    await whatsappService.sendMessage(phone, "Preciso das informações solicitadas para prosseguir");
  }
}

async function handleMissingInfo(phone, text, flow) {
  if (flow.data.has === 'service') {
    // Recebeu bairro
    const location = text;
    const service = flow.data.value;
    await saveClientInfo(phone, { service, location, service_type: categorizeService(service) });
    await flowManager.set(phone, 'awaiting_urgency', { service, location });
  } else {
    // Recebeu serviço
    const service = text;
    const location = flow.data.value;
    await saveClientInfo(phone, { service, location, service_type: categorizeService(service) });
    await flowManager.set(phone, 'awaiting_urgency', { service, location });
  }
  await whatsappService.sendMessage(phone, "Gostaria de atendimento para hoje?");
}

async function handleUrgency(phone, text, flow, client) {
  const response = text.toLowerCase();
  const serviceType = categorizeService(flow.data.service);

  if (response.includes('sim') || response.includes('yes') || response.includes('hoje') || response.includes('quero')) {
    // Quer atendimento hoje
    if (['ar_condicionado', 'geladeira', 'lava_seca'].includes(serviceType)) {
      // Assistência técnica - R$180
      await flowManager.set(phone, 'awaiting_visit_confirmation', { ...flow.data, visit_price: 180, service_type: serviceType });
      await whatsappService.sendMessage(phone, "Para um orçamento mais preciso, é necessário uma visita. Há uma pequena taxa no valor de R$180, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de prosseguir?");
    } else if (serviceType === 'marcenaria') {
      // Marcenaria - verificar disponibilidade primeiro
      await flowManager.set(phone, 'awaiting_service_details', { ...flow.data, step_detail: 'marcenaria', service_type: serviceType });
      await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me explicar melhor o que deseja?");
    } else {
      // Reforma
      await flowManager.set(phone, 'awaiting_service_details', { ...flow.data, step_detail: 'reforma', service_type: serviceType });
      await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me explicar melhor o que deseja? Pode enviar fotos se quiser.");
    }
  } else {
    // Não quer hoje - agendar para outra data
    await flowManager.set(phone, 'awaiting_service_schedule', flow.data);
    await whatsappService.sendMessage(phone, "Para qual data você gostaria de agendar?");
  }
}

async function handleVisitConfirmation(phone, text, flow) {
  const response = text.toLowerCase();

  if (response.includes('sim') || response.includes('yes') || response.includes('quero') || response.includes('ok') || response.includes('certo')) {
    // Aceitou
    await flowManager.set(phone, 'awaiting_equipment_details', flow.data);
    await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me informar o modelo e problema do aparelho?");
  } else if (response.includes('caro') || response.includes('desconto') || response.includes('barato') || response.includes('negocia') || response.includes('muito')) {
    // Quer desconto
    await handleDiscountRequest(phone, flow.data);
  } else {
    await whatsappService.sendMessage(phone, "Vamos prosseguir? Responda sim ou diga se deseja negociar o valor.");
  }
}

async function handleDiscountRequest(phone, data) {
  const location = data.location.toLowerCase();
  const isZS = isZonaSul(location);

  if (isZS) {
    if (location.includes('botafogo')) {
      // Botafogo = grátis
      await flowManager.set(phone, 'awaiting_equipment_details', { ...data, visit_price: 0, discount: '100%' });
      await whatsappService.sendMessage(phone, "Como o local é próximo de nós, o técnico pode realizar a visita sem a taxa. Gostaria?");
    } else {
      // Zona Sul = 50%
      await flowManager.set(phone, 'awaiting_discount_response', { ...data, visit_price: 90, discount: '50%' });
      await whatsappService.sendMessage(phone, "Para nós é muito importante ter você como um de nossos clientes. A visita pode ser realizada pela metade do valor, ou seja, R$90. Esse é o valor mínimo que posso conseguir. Gostaria de prosseguir?");
    }
  } else {
    // Outros bairros - sem desconto
    await flowManager.set(phone, 'awaiting_discount_response', { ...data, visit_price: 180, discount: '0%' });
    await whatsappService.sendMessage(phone, "Infelizmente esse é o valor mínimo para sua região. Gostaria de prosseguir mesmo assim?");
  }
}

async function handleDiscountResponse(phone, text, flow) {
  const response = text.toLowerCase();

  if (response.includes('sim') || response.includes('yes') || response.includes('quero') || response.includes('ok') || response.includes('certo') || response.includes('bom')) {
    await flowManager.set(phone, 'awaiting_equipment_details', flow.data);
    await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me informar o modelo e problema do aparelho?");
  } else if (response.includes('não') || response.includes('nao') || response.includes('no')) {
    await flowManager.clear(phone);
    await whatsappService.sendMessage(phone, "Entendido. Caso mude de ideia, estamos à disposição!");
  } else {
    await whatsappService.sendMessage(phone, "Vamos prosseguir?");
  }
}

async function handleEquipmentDetails(phone, text, flow) {
  // Salvar detalhes
  await supabase.from('clients').update({ equipment_details: text }).eq('phone', phone);
  
  const serviceType = flow.data.service_type || categorizeService(flow.data.service);
  const professionals = PROFESSIONALS[serviceType] || [];
  
  // Buscar horários disponíveis
  const slots = await calendarService.findAvailableSlots(professionals, new Date(), flow.data.location);
  
  if (slots.length === 0) {
    await whatsappService.sendMessage(phone, "Não temos disponibilidade para hoje. Posso agendar para amanhã ou outra data?");
    await flowManager.set(phone, 'awaiting_service_schedule', { ...flow.data, equipment_details: text });
    return;
  }

  const slot = slots[0];
  await flowManager.set(phone, 'awaiting_schedule_confirmation', { 
    ...flow.data, 
    equipment_details: text,
    proposed_slot: slot,
    professional: slot.professional
  });

  await whatsappService.sendMessage(phone, `O profissional possui disponibilidade para hoje entre ${slot.startTime} e ${slot.endTime}. Gostaria de agendar?`);
}

async function handleScheduleConfirmation(phone, text, flow) {
  const response = text.toLowerCase();

  if (response.includes('sim') || response.includes('yes') || response.includes('quero') || response.includes('ok')) {
    await flowManager.set(phone, 'awaiting_address', flow.data);
    await whatsappService.sendMessage(phone, "Perfeito! Pode me informar o endereço completo?");
  } else {
    // Buscar próximo horário
    const slots = await calendarService.findAvailableSlots(
      [flow.data.professional], 
      new Date(), 
      flow.data.location,
      60
    );
    
    if (slots.length > 1) {
      const nextSlot = slots[1];
      await flowManager.update(phone, { proposed_slot: nextSlot });
      await whatsappService.sendMessage(phone, `Temos outro horário disponível entre ${nextSlot.startTime} e ${nextSlot.endTime}. Gostaria de agendar?`);
    } else {
      await whatsappService.sendMessage(phone, "Não temos mais horários para hoje. Posso verificar para amanhã?");
      await flowManager.set(phone, 'awaiting_service_schedule', flow.data);
    }
  }
}

async function handleAddress(phone, text, flow, client) {
  const address = text;
  const slot = flow.data.proposed_slot;
  const prof = flow.data.professional;
  const visitPrice = flow.data.visit_price || 180;
  const serviceType = flow.data.service_type;

  // Ajustar horário para profissional se necessário
  let profStartTime = slot.startTime;
  let profEndTime = slot.endTime;
  
  if (prof.antecedencia && serviceType === 'marcenaria') {
    // João chega 1h antes
    const [h, m] = slot.startTime.split(':').map(Number);
    profStartTime = `${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const [h2, m2] = slot.endTime.split(':').map(Number);
    profEndTime = `${String(h2 - 1).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
  }

  // Criar evento no Google Calendar
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`;
  
  const eventTitle = `VISITA - ${client.name || phone} - ${flow.data.service}`;
  const eventDesc = `
CLIENTE: ${client.name || 'Não informado'} (${phone})
SERVIÇO: ${flow.data.service}
BAIRRO: ${flow.data.location}
ENDEREÇO: ${address}
EQUIPAMENTO: ${flow.data.equipment_details || 'Não informado'}
VALOR VISITA: R$${visitPrice}
PROFISSIONAL: ${prof.name}
TIPO: VISITA TÉCNICA (NÃO É EXECUÇÃO)
  `;

  try {
    const calendarEvent = await calendarService.createEvent({
      title: eventTitle,
      description: eventDesc,
      startTime: slot.startDateTime,
      endTime: slot.endDateTime,
      professional: prof,
      location: address
    });

    // Salvar agendamento
    await supabase.from('appointments').insert([{
      client_phone: phone,
      client_name: client.name,
      service: flow.data.service,
      location: flow.data.location,
      address: address,
      professional_name: prof.name,
      professional_phone: prof.phone,
      visit_date: today.toISOString().split('T')[0],
      start_time: slot.startTime,
      end_time: slot.endTime,
      visit_price: visitPrice,
      status: 'scheduled',
      calendar_event_id: calendarEvent.id,
      is_visit: true,
      created_at: new Date().toISOString()
    }]);

    // Confirmar cliente
    await whatsappService.sendMessage(phone, 
      `Visita agendada para dia ${dateStr} entre ${slot.startTime} e ${slot.endTime} em ${address} com o profissional ${prof.name}. Lembrando que a taxa da visita deve ser realizada no ato da visita ao profissional.`);

    // Notificar profissional
    const profMsg = `Visita agendada para ${client.name || phone} - ${flow.data.service}${flow.data.equipment_details ? ` - ${flow.data.equipment_details}` : ''} em ${address} entre ${profStartTime} e ${profEndTime}. Valor da visita: R$${visitPrice}. Por favor, confirme.`;
    await whatsappService.sendMessage(prof.phone, profMsg);

    // Aguardar confirmação do profissional (salvar estado)
    await supabase.from('pending_confirmations').insert([{
      appointment_id: calendarEvent.id,
      professional_phone: prof.phone,
      client_phone: phone,
      created_at: new Date().toISOString()
    }]);

    // Configurar lembrete 2h antes
    const reminderTime = new Date(slot.startDateTime);
    reminderTime.setHours(reminderTime.getHours() - 2);
    await supabase.from('reminders').insert([{
      client_phone: phone,
      professional_phone: prof.phone,
      reminder_time: reminderTime.toISOString(),
      type: 'visit',
      status: 'pending'
    }]);

    // Agendar follow-up para avaliação (24h depois)
    const followUpTime = new Date(slot.endDateTime);
    followUpTime.setHours(followUpTime.getHours() + 24);
    await supabase.from('follow_ups').insert([{
      client_phone: phone,
      company: client.company_origin,
      review_link: REVIEW_LINKS[client.company_origin] || '',
      scheduled_time: followUpTime.toISOString(),
      status: 'pending'
    }]);

    // Notificar Telegram
    await telegramService.send(`✅ NOVO AGENDAMENTO\nCliente: ${client.name || phone}\nServiço: ${flow.data.service}\nBairro: ${flow.data.location}\nProfissional: ${prof.name}\nHorário: ${dateStr} ${slot.startTime}-${slot.endTime}\nValor: R$${visitPrice}`);

    // Atualizar estatísticas
    await updateDailyStats('visit_scheduled');

    await flowManager.clear(phone);

  } catch (error) {
    console.error('Erro ao agendar:', error);
    await whatsappService.sendMessage(phone, "Houve um erro ao agendar. Por favor, tente novamente ou fale com nosso atendente.");
    await telegramService.send(`❌ ERRO AO AGENDAR: ${error.message}`, true);
  }
}

async function handleServiceDetails(phone, text, flow, client, mediaUrls = null) {
  // Salvar detalhes e mídia
  await supabase.from('clients').update({ 
    service_details: text,
    media_urls: mediaUrls 
  }).eq('phone', phone);

  const serviceType = flow.data.service_type;
  const professionals = PROFESSIONALS[serviceType] || [];
  
  // Buscar disponibilidade
  const slots = await calendarService.findAvailableSlots(professionals, new Date(), flow.data.location);
  
  if (slots.length === 0) {
    await whatsappService.sendMessage(phone, "Não temos disponibilidade para hoje. Para qual data gostaria de agendar?");
    await flowManager.set(phone, 'awaiting_service_schedule', { ...flow.data, service_details: text });
    return;
  }

  const slot = slots[0];
  let visitPrice = 180;
  
  // Preços específicos para marcenaria
  if (serviceType === 'marcenaria') {
    if (slot.professional.name === 'Eli') visitPrice = 160;
    else if (slot.professional.name === 'João') visitPrice = 180;
  }

  await flowManager.set(phone, 'awaiting_visit_confirmation', {
    ...flow.data,
    service_details: text,
    proposed_slot: slot,
    professional: slot.professional,
    visit_price: visitPrice,
    step_detail: 'from_service_details'
  });

  await whatsappService.sendMessage(phone, 
    `Para um orçamento mais preciso, é necessário uma visita. Há uma pequena taxa no valor de R$${visitPrice}, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de prosseguir?`);
}

async function handleServiceSchedule(phone, text, flow, client) {
  // Cliente quer agendar para data específica
  const dateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})/);
  
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1;
    const year = new Date().getFullYear();
    const targetDate = new Date(year, month, day);
    
    const serviceType = flow.data.service_type || categorizeService(flow.data.service);
    const professionals = PROFESSIONALS[serviceType] || [];
    
    const slots = await calendarService.findAvailableSlots(professionals, targetDate, flow.data.location);
    
    if (slots.length > 0) {
      const slot = slots[0];
      await flowManager.set(phone, 'awaiting_schedule_confirmation', {
        ...flow.data,
        proposed_slot: slot,
        professional: slot.professional
      });
      await whatsappService.sendMessage(phone, `Temos disponibilidade para ${day}/${month + 1} entre ${slot.startTime} e ${slot.endTime}. Gostaria de agendar?`);
    } else {
      await whatsappService.sendMessage(phone, "Não temos disponibilidade para essa data. Pode sugerir outra?");
    }
  } else {
    await whatsappService.sendMessage(phone, "Por favor, informe a data desejada (ex: 20/04 ou amanhã).");
  }
}

async function handleBudgetResponse(phone, text, client) {
  const response = text.toLowerCase();

  if (response.includes('caro') || response.includes('muito') || response.includes('alto')) {
    await whatsappService.sendMessage(phone, "Caso possua orçamento de outra empresa, me envie que analisarei se podemos cobrir!");
    await telegramService.send(`💰 Cliente ${phone} achou orçamento caro. Aguardando orçamento concorrente.`);
  } else if (response.includes('sim') || response.includes('quero') || response.includes('aprovo') || response.includes('ok')) {
    // Cliente aprovou orçamento - agendar SERVIÇO (não visita)
    await whatsappService.sendMessage(phone, "Ótimo! Vou verificar a disponibilidade do profissional para execução do serviço. Um momento...");
    
    // Buscar próxima disponibilidade para SERVIÇO (maior duração)
    const serviceType = client.service_type;
    const professionals = PROFESSIONALS[serviceType] || [];
    const slots = await calendarService.findAvailableSlots(professionals, new Date(), client.location, 180); // 3h para serviço
    
    if (slots.length > 0) {
      const slot = slots[0];
      await supabase.from('appointments').insert([{
        client_phone: phone,
        client_name: client.name,
        service: client.service,
        location: client.location,
        address: client.address,
        professional_name: slot.professional.name,
        professional_phone: slot.professional.phone,
        visit_date: slot.date,
        start_time: slot.startTime,
        end_time: slot.endTime,
        status: 'service_scheduled',
        is_visit: false,
        created_at: new Date().toISOString()
      }]);

      await whatsappService.sendMessage(phone, 
        `Serviço agendado com o profissional ${slot.professional.name} dia ${slot.date.split('-')[2]}/${slot.date.split('-')[1]} às ${slot.startTime}. Agradecemos por escolher nossa empresa!`);
      
      await telegramService.send(`🔧 SERVIÇO AGENDADO (pós-orçamento)\nCliente: ${client.name || phone}\nProfissional: ${slot.professional.name}\nData: ${slot.date} ${slot.startTime}`);
      
      // Notificar profissional
      await whatsappService.sendMessage(slot.professional.phone, 
        `Serviço de ${client.service} agendado com ${client.name || phone} dia ${slot.date} às ${slot.startTime}. Endereço: ${client.address}`);
      
      await updateDailyStats('service_scheduled');
    }
  } else if (response.includes('orçamento') && (response.includes('outra') || response.includes('empresa') || response.includes('concorrente'))) {
    // Cliente enviou orçamento de outra empresa
    await telegramService.send(`📄 Cliente ${phone} enviou orçamento de concorrente. Análise humana necessária.`, true);
    await whatsappService.sendMessage(phone, "Um momento, estou analisando...");
  } else {
    // Cliente não respondeu sobre orçamento
    await whatsappService.sendMessage(phone, "Gostaria de prosseguir?");
  }
}

async function handleFeedback(phone, text, client) {
  const response = text.toLowerCase();
  
  if (response.includes('bom') || response.includes('ótimo') || response.includes('excelente') || response.includes('perfeito') || response.includes('gostei') || response.includes('sim')) {
    const reviewLink = REVIEW_LINKS[client.company_origin];
    if (reviewLink) {
      await whatsappService.sendMessage(phone, 
        `Ficamos muito felizes que gostou! Poderia nos avaliar no Google? Aqui está o link: ${reviewLink}\nSua avaliação é muito importante para nós!`);
    }
  }
  
  // Marcar follow-up como respondido
  await supabase.from('follow_ups').update({ status: 'answered' }).eq('client_phone', phone);
  await flowManager.clear(phone);
}

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================
async function saveClientInfo(phone, data) {
  await supabase.from('clients').update(data).eq('phone', phone);
}

async function updateDailyStats(type) {
  const today = new Date().toISOString().split('T')[0];
  
  const { data: existing } = await supabase
    .from('daily_stats')
    .select('*')
    .eq('date', today)
    .single();
  
  if (existing) {
    const update = {};
    if (type === 'new_client') update.new_clients = (existing.new_clients || 0) + 1;
    if (type === 'visit_scheduled') update.visits_scheduled = (existing.visits_scheduled || 0) + 1;
    if (type === 'service_scheduled') update.services_scheduled = (existing.services_scheduled || 0) + 1;
    
    await supabase.from('daily_stats').update(update).eq('date', today);
  } else {
    await supabase.from('daily_stats').insert([{
      date: today,
      new_clients: type === 'new_client' ? 1 : 0,
      visits_scheduled: type === 'visit_scheduled' ? 1 : 0,
      services_scheduled: type === 'service_scheduled' ? 1 : 0
    }]);
  }
}

async function checkNoResponse(phone, client) {
  // Verificar se cliente está inativo há mais de 15 minutos
  const { data: lastMessage } = await supabase
    .from('message_history')
    .select('created_at')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (lastMessage) {
    const lastTime = new Date(lastMessage.created_at);
    const now = new Date();
    const diffMin = (now - lastTime) / 60000;
    
    if (diffMin > 15 && diffMin < 20) {
      await whatsappService.sendMessage(phone, "Vamos prosseguir?");
    }
  }
}

// ==========================================
// CRON FUNCTIONS (chamadas via endpoint separado ou cron jobs)
// ==========================================
async function processReminders() {
  const now = new Date().toISOString();
  
  const { data: reminders } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('reminder_time', now);
  
  for (const rem of reminders || []) {
    await whatsappService.sendMessage(rem.professional_phone, 
      `⏰ Lembrete: Você tem ${rem.type === 'visit' ? 'uma visita' : 'um serviço'} agendado em 2 horas.`);
    await telegramService.send(`⏰ Lembrete enviado ao técnico ${rem.professional_phone}`);
    await supabase.from('reminders').update({ status: 'sent' }).eq('id', rem.id);
  }
}

async function processPendingConfirmations() {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60000).toISOString();
  
  const { data: pending } = await supabase
    .from('pending_confirmations')
    .select('*, appointments(*)')
    .lte('created_at', fifteenMinAgo)
    .eq('status', 'pending');
  
  for (const conf of pending || []) {
    await telegramService.send(
      `🚨 TÉCNICO NÃO CONFIRMOU\nProfissional: ${conf.professional_phone}\nCliente: ${conf.client_phone}\nHorário: ${conf.appointments?.start_time}\nJá se passaram 15 min!`, 
      true
    );
  }
}

async function processFollowUps() {
  const now = new Date().toISOString();
  
  const { data: followups } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_time', now);
  
  for (const fu of followups || []) {
    await whatsappService.sendMessage(fu.client_phone, 
      "Olá! Como foi o atendimento do nosso profissional? Ficou satisfeito com o serviço?");
    
    await supabase.from('active_flows').upsert({
      phone: fu.client_phone,
      step: 'awaiting_feedback',
      data: { review_link: fu.review_link, company: fu.company }
    });
    
    await supabase.from('follow_ups').update({ status: 'sent' }).eq('id', fu.id);
  }
}

async function generateDailyReport() {
  const today = new Date().toISOString().split('T')[0];
  
  const { data: stats } = await supabase
    .from('daily_stats')
    .select('*')
    .eq('date', today)
    .single();
  
  const { data: appointments } = await supabase
    .from('appointments')
    .select('*')
    .eq('visit_date', today);
  
  const details = (appointments || []).map(a => ({
    service: a.service,
    location: a.location,
    professional: a.professional_name,
    client: a.client_name || a.client_phone
  }));
  
  await telegramService.sendDailyReport({
    date: today.split('-').reverse().join('/'),
    new_clients: stats?.new_clients || 0,
    visits_scheduled: stats?.visits_scheduled || 0,
    services_scheduled: stats?.services_scheduled || 0,
    details
  });
}

// ==========================================
// MAIN HANDLER
// ==========================================
export default async function handler(req, res) {
  // Verificação do webhook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Recebimento de mensagens (POST)
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      // Verificar se é cron job interno
      if (req.headers.authorization === `Bearer ${CONFIG.cronSecret}` && body.cron_type) {
        switch (body.cron_type) {
          case 'reminders':
            await processReminders();
            break;
          case 'confirmations':
            await processPendingConfirmations();
            break;
          case 'followups':
            await processFollowUps();
            break;
          case 'daily_report':
            await generateDailyReport();
            break;
        }
        return res.status(200).json({ success: true });
      }

      // Processar webhook do WhatsApp
      if (!body.entry?.[0]?.changes?.[0]?.value?.messages) {
        return res.status(200).send('OK');
      }

      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const text = message.text?.body || '';
      const media = message.image || message.video || message.document || null;
      const mediaUrls = media ? [media.id] : null; // Simplificado, precisa baixar mídia real
      
      // Identificar empresa
      const phoneId = body.entry[0].changes[0].value?.metadata?.phone_number_id;
      const company = COMPANY_MAP[phoneId] || 'unknown';

      // Salvar histórico de mensagem
      await supabase.from('message_history').insert([{
        phone: from,
        message: text,
        direction: 'received',
        created_at: new Date().toISOString()
      }]);

      // Buscar cliente
      let { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('phone', from)
        .single();

      // Novo cliente
      if (!client) {
        await handleNewClient(from, company);
        return res.status(200).send('OK');
      }

      // Verificar inatividade (responder "Vamos prosseguir?" se necessário)
      await checkNoResponse(from, client);

      // Obter fluxo atual
      const flow = await flowManager.get(from);

      // Roteamento baseado no fluxo
      switch (flow.step) {
        case 'awaiting_service_and_location':
          await handleServiceAndLocation(from, text, client);
          break;
        case 'awaiting_missing_info':
          await handleMissingInfo(from, text, flow);
          break;
        case 'awaiting_urgency':
          await handleUrgency(from, text, flow, client);
          break;
        case 'awaiting_visit_confirmation':
          await handleVisitConfirmation(from, text, flow);
          break;
        case 'awaiting_discount_response':
          await handleDiscountResponse(from, text, flow);
          break;
        case 'awaiting_equipment_details':
          await handleEquipmentDetails(from, text, flow);
          break;
        case 'awaiting_schedule_confirmation':
          await handleScheduleConfirmation(from, text, flow);
          break;
        case 'awaiting_address':
          await handleAddress(from, text, flow, client);
          break;
        case 'awaiting_service_details':
          await handleServiceDetails(from, text, flow, client, mediaUrls);
          break;
        case 'awaiting_service_schedule':
          await handleServiceSchedule(from, text, flow, client);
          break;
        case 'awaiting_feedback':
          await handleFeedback(from, text, client);
          break;
        default:
          // Verificar contexto anterior
          if (client.last_interaction === 'budget_sent') {
            await handleBudgetResponse(from, text, client);
          } else {
            await handleServiceAndLocation(from, text, client);
          }
      }

      // Atualizar última interação
      await supabase.from('clients').update({ last_interaction: new Date().toISOString() }).eq('phone', from);

      return res.status(200).send('OK');
      
    } catch (error) {
      console.error('Erro no webhook:', error);
      await telegramService.send(`❌ ERRO NO WEBHOOK: ${error.message}`, true);
      return res.status(500).send('Error');
    }
  }

  res.status(405).send('Method Not Allowed');
}
