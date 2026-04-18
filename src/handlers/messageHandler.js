// src/handlers/messageHandler.js
import { supabase } from '../services/supabase';
import { whatsappService } from '../services/whatsapp';
import { calendarService } from '../services/calendar';
import { telegramService } from '../services/telegram';
import { flowManager } from '../utils/flowManager';
import { parseMessage } from '../utils/parser';

export async function handleMessage(phone, text, media, company) {
  // Buscar ou criar cliente no Supabase
  let { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!client) {
    const { data: newClient } = await supabase
      .from('clients')
      .insert([{ 
        phone, 
        company_origin: company,
        created_at: new Date().toISOString(),
        status: 'new'
      }])
      .select()
      .single();
    client = newClient;
    
    // Mensagem de boas-vindas para novos clientes
    await whatsappService.sendMessage(phone, 
      "Olá! Bem-vind(a) ao atendimento digital. Qual serviço deseja e qual bairro?");
    return;
  }

  // Verificar fluxo atual do cliente
  const currentFlow = await flowManager.getFlow(phone);
  
  // Processar mensagem baseada no fluxo
  switch (currentFlow.step) {
    case 'awaiting_service_and_location':
      await handleServiceAndLocation(phone, text, client, company);
      break;
    case 'awaiting_missing_info':
      await handleMissingInfo(phone, text, client);
      break;
    case 'awaiting_urgency':
      await handleUrgency(phone, text, client);
      break;
    case 'awaiting_visit_confirmation':
      await handleVisitConfirmation(phone, text, client);
      break;
    case 'awaiting_discount_response':
      await handleDiscountResponse(phone, text, client);
      break;
    case 'awaiting_equipment_details':
      await handleEquipmentDetails(phone, text, client, media);
      break;
    case 'awaiting_address':
      await handleAddress(phone, text, client);
      break;
    case 'awaiting_schedule_confirmation':
      await handleScheduleConfirmation(phone, text, client);
      break;
    case 'awaiting_service_details':
      await handleServiceDetails(phone, text, client, media);
      break;
    case 'awaiting_budget_response':
      await handleBudgetResponse(phone, text, client);
      break;
    case 'awaiting_service_schedule':
      await handleServiceSchedule(phone, text, client);
      break;
    case 'awaiting_feedback':
      await handleFeedback(phone, text, client);
      break;
    default:
      // Se não estiver em fluxo, verificar se tem serviço e bairro
      await checkServiceAndLocation(phone, text, client);
  }
}

async function handleServiceAndLocation(phone, text, client, company) {
  const parsed = parseMessage(text);
  
  // Verificar se enviou ambos (serviço e bairro)
  if (parsed.service && parsed.location) {
    // Salvar no banco
    await supabase
      .from('clients')
      .update({ 
        service: parsed.service,
        location: parsed.location,
        service_type: categorizeService(parsed.service)
      })
      .eq('phone', phone);
    
    await flowManager.setFlow(phone, 'awaiting_urgency', {
      service: parsed.service,
      location: parsed.location
    });
    
    await whatsappService.sendMessage(phone, "Gostaria de atendimento para hoje?");
    return;
  }
  
  // Se enviou apenas um
  if (parsed.service || parsed.location) {
    const missing = parsed.service ? 'location' : 'service';
    await flowManager.setFlow(phone, 'awaiting_missing_info', {
      has: parsed.service ? 'service' : 'location',
      value: parsed.service || parsed.location
    });
    
    if (missing === 'location') {
      await whatsappService.sendMessage(phone, "Certo, e qual bairro?");
    } else {
      await whatsappService.sendMessage(phone, "Certo, e qual serviço gostaria?");
    }
    return;
  }
  
  // Se não enviou nenhum dos dois
  await whatsappService.sendMessage(phone, "Preciso das informações solicitadas para prosseguir");
}

async function handleMissingInfo(phone, text, client) {
  const flow = await flowManager.getFlow(phone);
  
  if (flow.data.has === 'service') {
    // Recebeu bairro, precisava do serviço
    const service = text;
    await supabase
      .from('clients')
      .update({ service, service_type: categorizeService(service) })
      .eq('phone', phone);
    
    await flowManager.setFlow(phone, 'awaiting_urgency', {
      ...flow.data,
      service
    });
  } else {
    // Recebeu serviço, precisava do bairro
    const location = text;
    await supabase
      .from('clients')
      .update({ location })
      .eq('phone', phone);
    
    await flowManager.setFlow(phone, 'awaiting_urgency', {
      ...flow.data,
      location
    });
  }
  
  await whatsappService.sendMessage(phone, "Gostaria de atendimento para hoje?");
}

async function handleUrgency(phone, text, client) {
  const flow = await flowManager.getFlow(phone);
  const response = text.toLowerCase();
  
  if (response.includes('sim') || response.includes('yes') || response.includes('hoje')) {
    // Cliente quer atendimento hoje
    const serviceType = categorizeService(flow.data.service);
    
    if (['ar_condicionado', 'geladeira', 'lava_seca'].includes(serviceType)) {
      // Assistência técnica
      await flowManager.setFlow(phone, 'awaiting_visit_confirmation', flow.data);
      await whatsappService.sendMessage(phone, 
        "Para um orçamento mais preciso, é necessário uma visita. Há uma pequena taxa no valor de R$180, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de prosseguir?");
    } else if (serviceType === 'marcenaria') {
      // Marcenaria - verificar profissional disponível
      await flowManager.setFlow(phone, 'awaiting_service_details', {
        ...flow.data,
        step_detail: 'marcenaria_check'
      });
      await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me explicar melhor o que deseja?");
    } else {
      // Reformas e construção
      await flowManager.setFlow(phone, 'awaiting_service_details', {
        ...flow.data,
        step_detail: 'reforma_check'
      });
      await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me explicar melhor o que deseja? Pode enviar fotos se quiser.");
    }
  } else {
    // Cliente não quer hoje - agendar para outro dia
    await flowManager.setFlow(phone, 'awaiting_service_schedule', flow.data);
    await whatsappService.sendMessage(phone, "Para qual data você gostaria de agendar?");
  }
}

async function handleVisitConfirmation(phone, text, client) {
  const flow = await flowManager.getFlow(phone);
  const response = text.toLowerCase();
  
  if (response.includes('sim') || response.includes('yes') || response.includes('quero') || response.includes('ok')) {
    // Cliente aceitou o valor
    await flowManager.setFlow(phone, 'awaiting_equipment_details', flow.data);
    await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me informar o modelo e problema do aparelho?");
  } else if (response.includes('caro') || response.includes('desconto') || response.includes('barato') || response.includes('negocia')) {
    // Cliente quer desconto
    await handleDiscountRequest(phone, flow.data);
  } else {
    // Resposta não clara
    await whatsappService.sendMessage(phone, "Gostaria de prosseguir com a visita? Responda sim ou se deseja negociar o valor.");
  }
}

async function handleDiscountRequest(phone, data) {
  const location = data.location.toLowerCase();
  
  // Verificar se é Zona Sul do Rio
  const zonaSul = ['ipanema', 'copacabana', 'leblon', 'botafogo', 'flamengo', 'laranjeiras', 'cosme velho', 'humaitá', 'jardim botânico', 'gávea', 'são conrado', 'vidigal', 'rocinha', 'lagoa'];
  const isZonaSul = zonaSul.some(bairro => location.includes(bairro));
  
  if (isZonaSul) {
    if (location.includes('botafogo')) {
      // Botafogo - visita gratuita
      await flowManager.setFlow(phone, 'awaiting_equipment_details', {
        ...data,
        visit_price: 0,
        discount_applied: '100%'
      });
      await whatsappService.sendMessage(phone, 
        "Como o local é próximo de nós, o técnico pode realizar a visita sem a taxa. Gostaria?");
    } else {
      // Outros bairros Zona Sul - 50% desconto
      await flowManager.setFlow(phone, 'awaiting_discount_response', {
        ...data,
        visit_price: 90,
        discount_applied: '50%'
      });
      await whatsappService.sendMessage(phone, 
        "Para nós é muito importante ter você como um de nossos clientes. A visita pode ser realizada pela metade do valor, ou seja, R$90. Esse é o valor mínimo que posso conseguir. Gostaria de prosseguir?");
    }
  } else {
    // Não é Zona Sul - não pode dar desconto
    await whatsappService.sendMessage(phone, 
      "Infelizmente esse é o valor mínimo para sua região. Gostaria de prosseguir mesmo assim?");
    await flowManager.setFlow(phone, 'awaiting_discount_response', {
      ...data,
      visit_price: 180,
      discount_applied: 'none'
    });
  }
}

async function handleDiscountResponse(phone, text, client) {
  const flow = await flowManager.getFlow(phone);
  const response = text.toLowerCase();
  
  if (response.includes('sim') || response.includes('yes') || response.includes('quero') || response.includes('ok')) {
    if (flow.data.discount_applied === 'none' && !response.includes('mesmo')) {
      // Cliente não aceitou
      await flowManager.clearFlow(phone);
      await whatsappService.sendMessage(phone, "Entendido. Caso mude de ideia, estamos à disposição!");
      return;
    }
    
    // Cliente aceitou o desconto ou valor original
    await flowManager.setFlow(phone, 'awaiting_equipment_details', flow.data);
    await whatsappService.sendMessage(phone, "Irei verificar a disponibilidade do profissional. Pode me informar o modelo e problema do aparelho?");
  } else if (response.includes('não') || response.includes('nao') || response.includes('no')) {
    await flowManager.clearFlow(phone);
    await whatsappService.sendMessage(phone, "Entendido. Caso mude de ideia, estamos à disposição!");
  } else {
    await whatsappService.sendMessage(phone, "Vamos prosseguir?");
  }
}

async function handleEquipmentDetails(phone, text, client, media) {
  const flow = await flowManager.getFlow(phone);
  
  // Salvar detalhes do equipamento
  await supabase
    .from('clients')
    .update({ 
      equipment_details: text,
      media_urls: media ? JSON.stringify(media) : null
    })
    .eq('phone', phone);
  
  // Verificar disponibilidade na agenda
  const serviceType = categorizeService(flow.data.service);
  const professionals = getProfessionalsForService(serviceType);
  
  // Buscar horários disponíveis para hoje
  const availableSlots = await calendarService.findAvailableSlots(
    professionals, 
    new Date(),
    flow.data.location
  );
  
  if (availableSlots.length === 0) {
    await whatsappService.sendMessage(phone, 
      "Não temos disponibilidade para hoje. Posso agendar para amanhã ou outra data?");
    await flowManager.setFlow(phone, 'awaiting_service_schedule', flow.data);
    return;
  }
  
  // Pegar primeiro slot disponível
  const slot = availableSlots[0];
  await flowManager.setFlow(phone, 'awaiting_schedule_confirmation', {
    ...flow.data,
    equipment_details: text,
    proposed_slot: slot,
    professional: slot.professional
  });
  
  await whatsappService.sendMessage(phone, 
    `O profissional possui disponibilidade para hoje entre ${slot.startTime} e ${slot.endTime}. Gostaria de agendar?`);
}

async function handleScheduleConfirmation(phone, text, client) {
  const flow = await flowManager.getFlow(phone);
  const response = text.toLowerCase();
  
  if (response.includes('sim') || response.includes('yes') || response.includes('quero') || response.includes('ok')) {
    await flowManager.setFlow(phone, 'awaiting_address', flow.data);
    await whatsappService.sendMessage(phone, "Perfeito! Pode me informar o endereço completo?");
  } else {
    // Cliente não aceitou o horário - buscar próximo
    const availableSlots = await calendarService.findAvailableSlots(
      [flow.data.professional],
      new Date(),
      flow.data.location,
      flow.data.proposed_slot.endTime
    );
    
    if (availableSlots.length > 0) {
      const nextSlot = availableSlots[0];
      await flowManager.updateFlow(phone, {
        proposed_slot: nextSlot
      });
      await whatsappService.sendMessage(phone, 
        `Temos outro horário disponível entre ${nextSlot.startTime} e ${nextSlot.endTime}. Gostaria de agendar?`);
    } else {
      await whatsappService.sendMessage(phone, 
        "Não temos mais horários disponíveis para hoje. Posso verificar para amanhã?");
      await flowManager.setFlow(phone, 'awaiting_service_schedule', flow.data);
    }
  }
}

async function handleAddress(phone, text, client) {
  const flow = await flowManager.getFlow(phone);
  
  // Salvar endereço
  await supabase
    .from('clients')
    .update({ address: text })
    .eq('phone', phone);
  
  const slot = flow.data.proposed_slot;
  const professional = flow.data.professional;
  const visitPrice = flow.data.visit_price || 180;
  
  // Ajustar horário para profissional (1h antes para João de marcenaria)
  let professionalStartTime = slot.startTime;
  let professionalEndTime = slot.endTime;
  
  if (professional.name === 'João' && categorizeService(flow.data.service) === 'marcenaria') {
    // João de marcenaria - chega 1h antes
    const [startHour, startMin] = slot.startTime.split(':').map(Number);
    const [endHour, endMin] = slot.endTime.split(':').map(Number);
    professionalStartTime = `${String(startHour - 1).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
    professionalEndTime = `${String(endHour - 1).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
  }
  
  // Criar evento no Google Calendar
  const eventTitle = `VISITA - ${client.name || phone} - ${flow.data.service}`;
  const eventDescription = `
Cliente: ${client.name || 'Não informado'} (${phone})
Serviço: ${flow.data.service}
Bairro: ${flow.data.location}
Endereço: ${text}
Equipamento/Detalhes: ${flow.data.equipment_details || 'Não informado'}
Valor visita: R$${visitPrice}
Profissional: ${professional.name}
Tipo: VISITA (não é serviço)
  `;
  
  const calendarEvent = await calendarService.createEvent({
    title: eventTitle,
    description: eventDescription,
    startTime: slot.startDateTime,
    endTime: slot.endDateTime,
    professional: professional,
    location: text
  });
  
  // Salvar agendamento no banco
  await supabase
    .from('appointments')
    .insert([{
      client_phone: phone,
      client_name: client.name,
      service: flow.data.service,
      location: flow.data.location,
      address: text,
      professional_name: professional.name,
      professional_phone: professional.phone,
      visit_date: slot.date,
      start_time: slot.startTime,
      end_time: slot.endTime,
      visit_price: visitPrice,
      status: 'scheduled',
      calendar_event_id: calendarEvent.id,
      created_at: new Date().toISOString()
    }]);
  
  // Enviar confirmação ao cliente
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`;
  
  await whatsappService.sendMessage(phone, 
    `Visita agendada para dia ${dateStr} entre ${slot.startTime} e ${slot.endTime} em ${text} com o profissional ${professional.name}. Lembrando que a taxa da visita deve ser realizada no ato da visita ao profissional.`);
  
  // Notificar profissional
  const profMessage = `Visita agendada para ${client.name || phone} - ${flow.data.service}${flow.data.equipment_details ? ` - ${flow.data.equipment_details}` : ''} em ${text} entre ${professionalStartTime} e ${professionalEndTime}. Valor da visita: R$${visitPrice}. Por favor, confirme.`;
  
  await whatsappService.sendMessage(professional.phone, profMessage);
  
  // Se tiver mídia, encaminhar para o profissional
  if (flow.data.media_urls) {
    await whatsappService.forwardMedia(professional.phone, flow.data.media_urls);
  }
  
  // Configurar lembrete 2h antes
  await scheduleReminder(phone, professional.phone, slot, 'visit');
  
  // Configurar follow-up pós-visita (para solicitar avaliação)
  await scheduleFollowUp(phone, client.company_origin, slot.endDateTime);
  
  // Limpar fluxo
  await flowManager.clearFlow(phone);
  
  // Notificar Telegram sobre novo agendamento
  await telegramService.sendNotification(
    `✅ NOVO AGENDAMENTO\n\nCliente: ${client.name || phone}\nServiço: ${flow.data.service}\nBairro: ${flow.data.location}\nProfissional: ${professional.name}\nHorário: ${dateStr} ${slot.startTime}-${slot.endTime}\nValor: R$${visitPrice}`
  );
}

async function handleServiceDetails(phone, text, client, media) {
  const flow = await flowManager.getFlow(phone);
  
  // Salvar detalhes
  await supabase
    .from('clients')
    .update({ 
      service_details: text,
      media_urls: media ? JSON.stringify(media) : null
    })
    .eq('phone', phone);
  
  // Verificar disponibilidade
  const serviceType = categorizeService(flow.data.service);
  const professionals = getProfessionalsForService(serviceType);
  
  const availableSlots = await calendarService.findAvailableSlots(
    professionals,
    new Date(),
    flow.data.location
  );
  
  if (availableSlots.length === 0) {
    await whatsappService.sendMessage(phone, 
      "Não temos disponibilidade para hoje. Para qual data gostaria de agendar?");
    await flowManager.setFlow(phone, 'awaiting_service_schedule', {
      ...flow.data,
      service_details: text
    });
    return;
  }
  
  const slot = availableSlots[0];
  
  // Definir preço baseado no profissional (marcenaria)
  let visitPrice = 180;
  if (serviceType === 'marcenaria') {
    if (slot.professional.name === 'Eli') {
      visitPrice = 160;
    } else if (slot.professional.name === 'João') {
      visitPrice = 180;
    }
  }
  
  await flowManager.setFlow(phone, 'awaiting_visit_confirmation', {
    ...flow.data,
    service_details: text,
    proposed_slot: slot,
    professional: slot.professional,
    visit_price: visitPrice
  });
  
  await whatsappService.sendMessage(phone, 
    `Para um orçamento mais preciso, é necessário uma visita. Há uma pequena taxa no valor de R$${visitPrice}, que inclui o deslocamento do profissional e análise técnica. Caso o orçamento seja aprovado, essa taxa é descontada do valor final. Gostaria de prosseguir?`);
}

// ... (continuação com mais handlers)

// Funções auxiliares
function categorizeService(serviceText) {
  const text = serviceText.toLowerCase();
  if (text.includes('ar condicionado') || text.includes('ar-condicionado') || text.includes('split')) return 'ar_condicionado';
  if (text.includes('geladeira') || text.includes('refrigerador')) return 'geladeira';
  if (text.includes('lava') || text.includes('secadora') || text.includes('máquina')) return 'lava_seca';
  if (text.includes('marcenaria') || text.includes('marceneiro') || text.includes('móvel') || text.includes('armário')) return 'marcenaria';
  if (text.includes('reforma') || text.includes('construção') || text.includes('pedreiro') || text.includes('pintor') || text.includes('hidraulica') || text.includes('eletrica') || text.includes('ladrilheiro')) return 'reforma';
  return 'other';
}

function getProfessionalsForService(serviceType) {
  const professionals = {
    ar_condicionado: [
      { name: 'Técnico Ar 1', phone: '5511999999991', calendarId: 'primary' },
      { name: 'Técnico Ar 2', phone: '5511999999992', calendarId: 'primary' }
    ],
    geladeira: [
      { name: 'Técnico Refri 1', phone: '5511999999993', calendarId: 'primary' }
    ],
    lava_seca: [
      { name: 'Técnico Lava 1', phone: '5511999999994', calendarId: 'primary' }
    ],
    marcenaria: [
      { name: 'João', phone: '5511999999995', calendarId: 'primary' },
      { name: 'Eli', phone: '5511999999996', calendarId: 'primary' }
    ],
    reforma: [
      { name: 'Pedreiro 1', phone: '5511999999997', calendarId: 'primary' },
      { name: 'Pintor 1', phone: '5511999999998', calendarId: 'primary' }
    ]
  };
  return professionals[serviceType] || [];
}

async function scheduleReminder(clientPhone, profPhone, slot, type) {
  // Implementar sistema de lembretes (pode usar Vercel Cron ou agendamento externo)
  const reminderTime = new Date(slot.startDateTime);
  reminderTime.setHours(reminderTime.getHours() - 2);
  
  // Salvar no banco para processamento posterior
  await supabase
    .from('reminders')
    .insert([{
      client_phone: clientPhone,
      professional_phone: profPhone,
      reminder_time: reminderTime.toISOString(),
      type: type,
      status: 'pending'
    }]);
}

async function scheduleFollowUp(phone, company, visitEndTime) {
  // Agendar solicitação de avaliação 24h após a visita
  const followUpTime = new Date(visitEndTime);
  followUpTime.setHours(followUpTime.getHours() + 24);
  
  let reviewLink = '';
  if (company === 'rc_reforma') {
    reviewLink = 'https://share.google/ggOWSN3tFyf1thw09';
  } else if (company === 'mab_construcao') {
    reviewLink = 'https://share.google/xCFetDX4PoyjDw4gH';
  } else if (company === 'conserta_rio') {
    reviewLink = 'https://share.google/iDf8oK9HV6J5Phkox';
  }
  
  await supabase
    .from('follow_ups')
    .insert([{
      client_phone: phone,
      company: company,
      review_link: reviewLink,
      scheduled_time: followUpTime.toISOString(),
      status: 'pending'
    }]);
}

export async function checkServiceAndLocation(phone, text, client) {
  // Se cliente já tem serviço e bairro, verificar contexto
  if (client.service && client.location) {
    // Verificar se está respondendo sobre orçamento
    if (text.toLowerCase().includes('orçamento') || text.toLowerCase().includes('caro') || text.toLowerCase().includes('preço')) {
      await handleBudgetResponse(phone, text, client);
      return;
    }
    
    // Verificar se é feedback pós-serviço
    if (client.last_service_date) {
      await handleFeedback(phone, text, client);
      return;
    }
  }
  
  // Se não tem contexto, pedir serviço e bairro novamente
  await whatsappService.sendMessage(phone, "Olá! Bem-vind(a) ao atendimento digital. Qual serviço deseja e qual bairro?");
}
