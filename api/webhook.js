// ============================================
// RC ATENDIMENTO - ROBÔ ESPLÊNDIDO v2.0
// Zero IA, 100% Inteligência de Fluxo
// ============================================

import { createClient } from '@supabase/supabase-js';

// CONFIGURAÇÕES
const CONFIG = {
  TELEGRAM_TOKEN: '8517608136:AAFJmE04CPd7DecwKVh_MzGA6bnGGmbT3zI',
  TELEGRAM_CHAT_ID: '-5246111585',
  
  TECNICOS: {
    marcenaria: { nome: 'João Marceneiro', numero: '5521978791765', servicos: ['marcenaria', 'moveis', 'armario', 'porta'] },
    reforma: { nome: 'Pedro Reformas', numero: '5521968112176', servicos: ['reforma', 'construcao', 'pedreiro', 'azulejo', 'revestimento'] },
    hidraulica: { nome: 'Carlos Hidráulica', numero: '5521968112176', servicos: ['hidraulica', 'encanamento', 'vazamento', 'pia', 'banheiro', 'chuveiro'] },
    eletrica: { nome: 'Maria Elétrica', numero: '5521987654321', servicos: ['eletrica', 'instalacao', 'tomada', 'disjuntor', 'luz'] },
    pintura: { nome: 'Ana Pintura', numero: '5521976543210', servicos: ['pintura', 'tinta', 'parede', 'latex'] }
  },
  
  PRECO_ZONA_SUL: 180,
  PRECO_OUTROS: 220,
  
  BAIRROS_ZONA_SUL: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha'
  ],
  
  HORARIOS_DISPONIVEIS: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']
};

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Estado em memória (Vercel é stateless, por isso usamos Supabase)
const processadas = new Set();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    // Webhook WhatsApp Cloud API
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    if (req.method === 'POST') {
      return await receberMensagem(req, res);
    }
    
    // API do Painel
    if (req.query.acao) {
      return await apiPainel(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO CRÍTICO:', e);
    await notificarTelegram(`🚨 ERRO CRÍTICO NO SERVIDOR: ${e.message}`, 'urgente');
    return res.status(200).send('OK');
  }
}

// ============================================
// RECEPÇÃO DE MENSAGENS
// ============================================
async function receberMensagem(req, res) {
  const body = req.body;
  
  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('OK');
  }
  
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  if (!changes) return res.status(200).send('OK');
  
  // Ignorar status de entrega
  if (changes.statuses) return res.status(200).send('OK');
  
  const msg = changes.messages?.[0];
  if (!msg || !msg.id) return res.status(200).send('OK');
  
  // Evitar duplicatas
  if (processadas.has(msg.id)) return res.status(200).send('OK');
  processadas.add(msg.id);
  // Limpar cache após 1 hora
  setTimeout(() => processadas.delete(msg.id), 3600000);
  
  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  
  // Ignorar mensagens do próprio número
  if (telefone === process.env.NUMERO_RC) return res.status(200).send('OK');
  
  // Verificar se é técnico
  const tecnico = Object.entries(CONFIG.TECNICOS).find(([k, v]) => 
    telefone.includes(v.numero.replace('55', ''))
  );
  
  // Salvar mensagem no banco (histórico eterno)
  await salvarMensagem(telefone, msg.text?.body || '[mídia]', tecnico ? 'tecnico' : 'cliente', nome);
  
  // Se for técnico, processar como intermediação
  if (tecnico) {
    await processarMensagemTecnico(telefone, msg.text?.body || '', tecnico[1], nome);
    return res.status(200).send('OK');
  }
  
  // Processar cliente
  if (msg.type === 'audio') {
    await enviarWhatsApp(telefone, "No momento não consigo ouvir áudios. Pode escrever, por favor? 😊");
    return res.status(200).send('OK');
  }
  
  if (msg.type !== 'text') return res.status(200).send('OK');
  
  const texto = msg.text.body;
  console.log(`\n📨 ${nome} (${telefone}): ${texto}`);
  
  // Verificar se está em intervenção humana
  const { data: intervencao } = await supabase
    .from('intervencoes')
    .select('*')
    .eq('telefone', telefone)
    .eq('ativa', true)
    .single();
  
  if (intervencao) {
    // Apenas notificar - não responder
    await notificarTelegram(
      `💬 <b>Cliente em intervenção:</b>\n` +
      `"${texto}"\n\n` +
      `📞 ${telefone}\n` +
      `👤 ${nome}`,
      'alerta'
    );
    return res.status(200).send('OK');
  }
  
  // Buscar ou criar sessão
  const { data: sessao } = await supabase
    .from('sessoes')
    .select('*')
    .eq('telefone', telefone)
    .single();
  
  const estado = sessao || {
    telefone,
    nome,
    etapa: 'INICIO',
    dados: {},
    ultima_atividade: new Date().toISOString()
  };
  
  // Processar fluxo
  const resposta = await processarFluxo(estado, texto.toLowerCase(), texto, nome);
  
  if (resposta) {
    await enviarWhatsApp(telefone, resposta);
    await salvarMensagem(telefone, resposta, 'robo', 'RC Atendente');
  }
  
  // Atualizar sessão
  await supabase.from('sessoes').upsert({
    telefone,
    nome,
    etapa: estado.etapa,
    dados: estado.dados,
    ultima_atividade: new Date().toISOString()
  });
  
  // Notificar painel em tempo real (usando Supabase Realtime ou polling)
  
  return res.status(200).send('OK');
}

// ============================================
// FLUXO INTELIGENTE DO ROBÔ
// ============================================
async function processarFluxo(estado, t, original, nome) {
  const d = estado.dados;
  
  // ===== DETECÇÃO DE INTENÇÕES AVANÇADA =====
  
  // 1. OBJEÇÕES DE PREÇO (detecção reforçada)
  if (t.match(/(caro|car demais|muito caro|tá caro|tah caro|esta caro|absurdo|exagerado|salado|roubando|mamando|abusado|não tenho dinheiro|não posso pagar|tá louco|tah louco)/)) {
    return "Entendo perfeitamente sua consideração sobre o valor. Posso explicar: o valor da visita técnica cobre o deslocamento do profissional qualificado e a análise detalhada do serviço. O diferencial da RC Reformas é que trabalhamos com profissionais de alta confiança que atendem clientes exigentes na Zona Sul. Além disso, se aprovarem o orçamento, esse valor é abatido do total. Posso verificar disponibilidade para você?";
  }
  
  // 2. COMPARAÇÃO COM CONCORRENTES
  if (t.match(/(comparar|outras empresas|vou pesquisar|vou ver outro|mais barato|outro orçamento)/)) {
    return "Compreendo perfeitamente. Se desejar, pode enviar o orçamento de outra empresa que verificamos se conseguimos cobrir o valor. Trabalhamos com preço justo e qualidade garantida.";
  }
  
  // 3. DESCONFIANÇA/PAGAMENTO ANTES
  if (t.match(/(não confio|pagar antes|dinheiro adiantado|sinal|garantia)/)) {
    return "Entendo sua preocupação. A RC Reformas é uma empresa séria com anos de mercado. Podemos fazer da seguinte forma: 50% no início do serviço e 50% na conclusão. Isso lhe dá segurança e confiança. Posso agendar a visita?";
  }
  
  // 4. IDENTIDADE DO ATENDENTE
  if (t.match(/(quem é você|quem e voce|você é robô|voce e robo|é humano|e humano|atendente|pessoa real)/)) {
    return "Sou o Atendimento Digital da RC Reforma e Construção. Estou aqui para ajudá-lo a agendar sua visita técnica com praticidade e rapidez. Todas as informações são registradas e acompanhadas por nossa equipe.";
  }
  
  // 5. CENÁRIOS ESPECIAIS (não atendemos)
  if (t.match(/(síndico|sindico|condomínio|condominio|empresa|prédio|predio|comercial|loja|escritorio|escritório)/)) {
    return "Infelizmente, no momento estamos com alta demanda e nosso profissional está atendendo apenas pessoas físicas, não empresas ou condomínios. Agradecemos a compreensão.";
  }
  
  // 6. VENDA DE MATERIAL APENAS
  if (t.match(/(só material|apenas material|comprar material|venda de material|quanto custa o material)/)) {
    return "Nossos profissionais realizam apenas serviços, não vendem produtos ou materiais. Podemos indicar fornecedores de confiança após a visita técnica.";
  }
  
  // 7. EVASIVOS/ADIAMENTO
  if (t.match(/(depois eu te falo|depois eu falo|só queria saber preço|so queria saber preco|depois eu entro em contato|vou pensar|volto depois|depois eu decido)/)) {
    return "Sem problemas! Quando precisar de atendimento, é só entrar em contato. Estarei por aqui. Se surgir alguma dúvida, pode me chamar.";
  }
  
  // 8. CANCELAMENTO
  if (t.match(/(desisti|cancela|quero cancelar|desistir|não quero mais|nao quero mais)/)) {
    return "Sinto muito por isso. Pode me contar o que aconteceu? Talvez possamos resolver ou ajustar algo para atender melhor suas necessidades.";
  }
  
  // 9. URGÊNCIA/EMERGÊNCIA (prioridade máxima)
  if (t.match(/(urgente|emergencia|emergência|vazando muito|inundando|quebrou tudo|sem luz|sem água)/)) {
    // Notificar Telegram imediatamente
    await notificarTelegram(
      `🚨 <b>EMERGÊNCIA!</b>\n` +
      `Cliente: ${nome}\n` +
      `Tel: ${estado.telefone}\n` +
      `"${original}"`,
      'urgente'
    );
    
    // Verificar disponibilidade imediata
    const hoje = new Date().toISOString().split('T')[0];
    const { data: ocupados } = await supabase
      .from('agenda')
      .select('horario')
      .eq('data', hoje)
      .eq('status', 'ocupado');
    
    const horariosLivres = CONFIG.HORARIOS_DISPONIVEIS.filter(h => 
      !ocupados?.some(o => o.horario === h)
    );
    
    if (horariosLivres.length > 0) {
      d.urgente = true;
      d.data = 'hoje';
      estado.etapa = 'AGUARDANDO_HORARIO_URGENTE';
      return `Entendi que é urgente! 🚨\n\nTemos disponibilidade para hoje nos horários:\n${horariosLivres.map((h, i) => `${i+1}️⃣ ${h}`).join('\n')}\n\nQual horário serve? (Digite o número ou o horário)`;
    } else {
      return `Entendi a urgência! Infelizmente hoje está lotado, mas posso colocar você como PRIORIDADE para o primeiro horário de amanhã. Posso?`;
    }
  }
  
  // ===== FLUXO POR ETAPA =====
  switch (estado.etapa) {
    case 'INICIO':
    case undefined:
      return await etapaInicio(estado, t, original, d);
      
    case 'AGUARDANDO_BAIRRO':
      return await etapaAguardandoBairro(estado, t, original, d);
      
    case 'AGUARDANDO_SERVICO':
      return await etapaAguardandoServico(estado, t, original, d);
      
    case 'VALOR_APRESENTADO':
      return await etapaValorApresentado(estado, t, original, d);
      
    case 'AGUARDANDO_DATA':
      return await etapaAguardandoData(estado, t, original, d);
      
    case 'AGUARDANDO_HORARIO':
    case 'AGUARDANDO_HORARIO_URGENTE':
      return await etapaAguardandoHorario(estado, t, original, d);
      
    case 'AGUARDANDO_ENDERECO':
      return await etapaAguardandoEndereco(estado, t, original, d);
      
    case 'CONFIRMAR_AGENDAMENTO':
      return await etapaConfirmar(estado, t, original, d, nome);
      
    case 'AGENDADO':
      return "Visita confirmada! Se precisar de mais alguma coisa, é só chamar. Estou por aqui! 👋";
      
    case 'INTERVENCAO_HUMANA':
      return null; // Não responde, aguarda humano
      
    default:
      estado.etapa = 'INICIO';
      return "Olá! Me informe o serviço e o bairro que deseja atendimento, por favor.";
  }
}

// ============================================
// ETAPAS DO FLUXO
// ============================================

async function etapaInicio(estado, t, original, d) {
  const { servico, bairro } = extrairServicoEBairro(t, original);
  
  if (servico && bairro) {
    d.servico = servico;
    d.bairro = bairro;
    d.valor = calcularValor(bairro);
    estado.etapa = 'VALOR_APRESENTADO';
    
    return `Perfeito! Para enviar um orçamento preciso, é necessário uma visita técnica no local. O investimento da visita é de R$${d.valor}, mas fique tranquilo: esse valor é abatido do total se o orçamento for aprovado.\n\nPara quando gostaria de agendar?`;
  }
  
  if (servico) {
    d.servico = servico;
    estado.etapa = 'AGUARDANDO_BAIRRO';
    return `Certo. Qual o bairro que deseja atendimento?`;
  }
  
  if (bairro) {
    d.bairro = bairro;
    estado.etapa = 'AGUARDANDO_SERVICO';
    return `Qual serviço deseja? Temos:\n🔧 Hidráulica\n⚡ Elétrica\n🎨 Pintura\n🏗️ Reforma\n🪚 Marcenaria`;
  }
  
  if (t.match(/(quanto custa|qual o preço|valor|orçamento)/)) {
    return `Para qual serviço? Não posso informar um valor exato sem conhecer o local, mas posso enviar uma média de valores. Deseja?`;
  }
  
  return `Olá! Bem-vindo à RC Reformas. 🏠\n\nSou seu assistente virtual e vou te ajudar a agendar uma visita técnica.\n\nPara começar, me informe:\n1️⃣ Qual serviço você precisa?\n2️⃣ Qual bairro você está localizado?`;
}

async function etapaAguardandoBairro(estado, t, original, d) {
  const bairro = extrairBairro(t, original);
  
  if (bairro) {
    d.bairro = bairro;
    d.valor = calcularValor(bairro);
    estado.etapa = 'VALOR_APRESENTADO';
    
    return `Ótimo! Para oferecer um orçamento mais preciso, é necessário que um profissional realize uma visita técnica. O investimento da visita é de R$${d.valor}, mas esse valor é abatido do total caso o orçamento seja aprovado.\n\nGostaria de agendar?`;
  }
  
  return `Certo. Qual o bairro que deseja atendimento? (Ex: Ipanema, Copacabana, Botafogo...)`;
}

async function etapaAguardandoServico(estado, t, original, d) {
  const servico = extrairServico(t);
  
  if (servico) {
    d.servico = servico;
    d.valor = calcularValor(d.bairro);
    estado.etapa = 'VALOR_APRESENTADO';
    
    return `Perfeito! Para oferecer um orçamento mais preciso, é necessário que um profissional realize uma visita técnica. O investimento da visita é de R$${d.valor}, mas esse valor é abatido do total caso o orçamento seja aprovado.\n\nGostaria de agendar?`;
  }
  
  return `Qual serviço deseja? Temos:\n🔧 Hidráulica (vazamentos, encanamentos)\n⚡ Elétrica (instalações, reparos)\n🎨 Pintura (interna e externa)\n🏗️ Reforma (construção, reparos)\n🪚 Marcenaria (móveis, armários)`;
}

async function etapaValorApresentado(estado, t, original, d) {
  // Por que pagar visita?
  if (t.match(/(por que tem que pagar|por que pagar|para que serve a visita|por que cobra|justificar)/)) {
    return `O valor da visita cobre o deslocamento do profissional qualificado e a análise técnica detalhada do que precisa ser feito. Se aprovarem o orçamento, a visita sai de graça pois o valor é abatido do total. Posso verificar disponibilidade?`;
  }
  
  // Não vou pagar
  if (t.match(/(não vou pagar|visita grátis|gratuita|orçamento grátis|não aceito pagar|de graça)/)) {
    const isBotafogo = d.bairro?.toLowerCase().includes('botafogo');
    const isZonaSul = CONFIG.BAIRROS_ZONA_SUL.some(b => 
      d.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isBotafogo) {
      d.valor = 0;
      estado.etapa = 'AGUARDANDO_DATA';
      return `Como exceção para o bairro de Botafogo, posso oferecer a visita sem cobrança. Para quando gostaria de agendar?`;
    } else if (isZonaSul) {
      return `Posso oferecer 50% de desconto no valor da visita. Ficaria em R$90. Podemos prosseguir?`;
    } else {
      return `Entendo, mas infelizmente para este bairro a taxa da visita precisa ser mantida. Posso garantir que vale a pena pelo profissionalismo do atendimento. Podemos agendar?`;
    }
  }
  
  // Desconto
  if (t.match(/(desconto|faz mais barato|tem desconto|consegue abaixar|negociar)/)) {
    const isZonaSul = CONFIG.BAIRROS_ZONA_SUL.some(b => 
      d.bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(b)
    );
    
    if (isZonaSul) {
      return `Posso oferecer até 50% de desconto no valor da visita. Ficaria em R$90. Deseja prosseguir?`;
    } else {
      return `Para este bairro o valor é fixo, mas garanto que o profissionalismo compensa. Podemos agendar?`;
    }
  }
  
  // AVANÇA PARA DATA
  if (t.match(/(pode ser|quando|data|horário|hoje|amanhã|agendar|marcar|ok|sim|pode|claro|tá bom|tah bom|vamos)/)) {
    estado.etapa = 'AGUARDANDO_DATA';
    return `Perfeito! Para quando gostaria de agendar? Posso verificar hoje ou amanhã se preferir.`;
  }
  
  return `Gostaria de agendar a visita técnica? Posso verificar a disponibilidade para você.`;
}

async function etapaAguardandoData(estado, t, original, d) {
  const horaAtual = new Date().getHours();
  
  // Urgência detectada
  if (t.match(/(urgente|vazando|quebrou|emergência|emergencia|inundando)/)) {
    d.urgente = true;
  }
  
  // Hoje
  if (t.match(/(hoje|hoje ainda|ainda hoje)/)) {
    if (horaAtual >= 19) {
      return `Já são mais de 19h, mas posso entrar em contato com o profissional para o primeiro horário de amanhã. Deseja?`;
    }
    
    // Verificar disponibilidade na agenda
    const hoje = new Date().toISOString().split('T')[0];
    const { data: ocupados } = await supabase
      .from('agenda')
      .select('horario')
      .eq('data', hoje)
      .eq('status', 'ocupado');
    
    const horariosLivres = CONFIG.HORARIOS_DISPONIVEIS.filter(h => 
      !ocupados?.some(o => o.horario === h)
    );
    
    if (horariosLivres.length === 0) {
      return `Hoje está lotado, mas posso colocar você como prioridade para amanhã. Pode ser?`;
    }
    
    d.data = hoje;
    estado.etapa = 'AGUARDANDO_HORARIO';
    return `Temos disponibilidade para hoje nos horários:\n${horariosLivres.map((h, i) => `${i+1}️⃣ ${h}`).join('\n')}\n\nQual prefere?`;
  }
  
  // Amanhã
  if (t.match(/(amanhã|amanha)/)) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    d.data = amanha.toISOString().split('T')[0];
    
    const { data: ocupados } = await supabase
      .from('agenda')
      .select('horario')
      .eq('data', d.data)
      .eq('status', 'ocupado');
    
    const horariosLivres = CONFIG.HORARIOS_DISPONIVEIS.filter(h => 
      !ocupados?.some(o => o.horario === h)
    );
    
    estado.etapa = 'AGUARDANDO_HORARIO';
    return `Para amanhã temos:\n${horariosLivres.map((h, i) => `${i+1}️⃣ ${h}`).join('\n')}\n\nQual horário?`;
  }
  
  // Data específica (DD/MM)
  const dataMatch = t.match(/(\d{1,2})\/(\d{1,2})/);
  if (dataMatch) {
    const dia = parseInt(dataMatch[1]);
    const mes = parseInt(dataMatch[2]) - 1;
    const ano = new Date().getFullYear();
    const data = new Date(ano, mes, dia);
    d.data = data.toISOString().split('T')[0];
    
    estado.etapa = 'AGUARDANDO_HORARIO';
    return `Qual seria um bom horário para ${dia}/${dataMatch[2]}? Temos disponibilidade entre 9h e 16h.`;
  }
  
  // Indeciso
  if (t.match(/(não sei|ainda não sei|vou ver|qualquer dia)/)) {
    return `Posso oferecer hoje à tarde ou amanhã de manhã. Alguma dessas opções serve?`;
  }
  
  return `Para quando gostaria de agendar? (hoje, amanhã, ou uma data específica)`;
}

async function etapaAguardandoHorario(estado, t, original, d) {
  const hora = extrairHora(original);
  
  if (hora) {
    d.hora = hora;
    
    // Verificar se horário está disponível na agenda
    const { data: ocupado } = await supabase
      .from('agenda')
      .select('*')
      .eq('data', d.data)
      .eq('horario', hora)
      .eq('status', 'ocupado')
      .single();
    
    if (ocupado) {
      return `Esse horário acabou de ser preenchido. 😅\n\nTem outro que prefere?`;
    }
    
    estado.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é? (Rua, número, complemento)`;
  }
  
  // Se escolheu por número (1, 2, 3...)
  const num = parseInt(t.match(/\d+/)?.[0]);
  if (num && num > 0 && num <= CONFIG.HORARIOS_DISPONIVEIS.length) {
    d.hora = CONFIG.HORARIOS_DISPONIVEIS[num - 1];
    estado.etapa = 'AGUARDANDO_ENDERECO';
    return `Perfeito! Agora preciso do endereço completo para confirmar a visita. Qual é? (Rua, número, complemento)`;
  }
  
  return `Qual seria um bom horário? Temos disponibilidade entre 9h e 16h.`;
}

async function etapaAguardandoEndereco(estado, t, original, d) {
  if (original.length > 10 && t.match(/(rua|av|avenida|número|numero|apartamento|casa|bloco)/)) {
    d.endereco = original;
    estado.etapa = 'CONFIRMAR_AGENDAMENTO';
    
    return `Posso confirmar:\n\n` +
           `📋 Visita de ${d.servico}\n` +
           `📅 ${formatarData(d.data)} às ${d.hora}\n` +
           `📍 ${d.bairro}\n` +
           `🏠 ${original}\n\n` +
           `Está correto? (Sim/Não)`;
  }
  
  if (t.match(/(rua|av)/) && !t.match(/\d+/)) {
    return `Qual o número? É casa ou apartamento?`;
  }
  
  return `Qual o endereço completo para a visita? (Rua, número, complemento, ponto de referência)`;
}

async function etapaConfirmar(estado, t, original, d, nome) {
  if (t.match(/(sim|pode|ok|confirmo|tá bom|tah bom|perfeito|ótimo|otimo)/)) {
    // Encontrar técnico
    const tecnicoEntry = Object.entries(CONFIG.TECNICOS).find(([k, v]) => 
      v.servicos.some(s => d.servico.toLowerCase().includes(s))
    );
    
    if (!tecnicoEntry) {
      await notificarTelegram(
        `🚨 <b>SEM TÉCNICO DISPONÍVEL</b>\n` +
        `Serviço: ${d.servico}\n` +
        `Cliente: ${nome} (${estado.telefone})`,
        'urgente'
      );
      return `Desculpe, no momento não temos técnicos disponíveis para ${d.servico}. Um atendente humano entrará em contato em breve.`;
    }
    
    const [tipoTecnico, tecnico] = tecnicoEntry;
    
    // Marcar na agenda
    await supabase.from('agenda').insert({
      data: d.data,
      horario: d.hora,
      cliente_telefone: estado.telefone,
      cliente_nome: nome,
      servico: d.servico,
      bairro: d.bairro,
      endereco: d.endereco,
      tecnico: tecnico.nome,
      tecnico_numero: tecnico.numero,
      valor_visita: d.valor,
      status: 'agendado'
    });
    
    // Notificar técnico via WhatsApp
    await enviarWhatsApp(
      tecnico.numero,
      `🔔 *NOVA VISITA AGENDADA*\n\n` +
      `📅 ${formatarData(d.data)} às ${d.hora}\n` +
      `📍 ${d.bairro}\n` +
      `🔧 ${d.servico}\n` +
      `🏠 ${d.endereco}\n` +
      `👤 Cliente: ${nome}\n` +
      `📞 ${estado.telefone}\n\n` +
      `Responda *OK* para confirmar ou informe se precisar de algo.`
    );
    
    // Notificar Telegram
    await notificarTelegram(
      `✅ <b>NOVA VISITA AGENDADA!</b>\n\n` +
      `👤 ${nome}\n` +
      `📞 ${estado.telefone}\n` +
      `🔧 ${d.servico}\n` +
      `📍 ${d.bairro}\n` +
      `📅 ${formatarData(d.data)} às ${d.hora}\n` +
      `👨‍🔧 ${tecnico.nome}\n` +
      `💰 R$${d.valor}`,
      'sucesso'
    );
    
    estado.etapa = 'AGENDADO';
    
    return `✅ *VISITA CONFIRMADA!*\n\n` +
           `O técnico ${tecnico.nome} foi notificado e confirmará em breve.\n\n` +
           `📅 ${formatarData(d.data)} às ${d.hora}\n` +
           `Se precisar de mais alguma coisa, é só chamar!`;
  }
  
  if (t.match(/(não|nao|mudar|alterar|trocar|outro dia|errado)/)) {
    estado.etapa = 'AGUARDANDO_DATA';
    return `Sem problemas. Qual seria o dia mais próximo que teria disponibilidade?`;
  }
  
  return `Posso confirmar o agendamento para ${formatarData(d.data)} às ${d.hora}? (Sim/Não)`;
}

// ============================================
// PROCESSAR MENSAGEM DO TÉCNICO (PONTE)
// ============================================
async function processarMensagemTecnico(telefone, texto, tecnicoInfo, nome) {
  const t = texto.toLowerCase();
  
  // Buscar visita ativa deste técnico
  const { data: visita } = await supabase
    .from('agenda')
    .select('*')
    .eq('tecnico_numero', tecnicoInfo.numero)
    .eq('status', 'agendado')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (!visita) {
    await notificarTelegram(
      `💬 <b>${tecnicoInfo.nome} enviou:</b>\n` +
      `"${texto}"\n\n` +
      `⚠️ Não encontrei visita ativa para ele`,
      'alerta'
    );
    return;
  }
  
  // Confirmação do técnico
  if (t.match(/(ok|confirmado|confirmo|vou|chegarei|estou indo)/)) {
    // Atualizar status
    await supabase.from('agenda')
      .update({ status: 'confirmado' })
      .eq('id', visita.id);
    
    // Notificar cliente
    await enviarWhatsApp(
      visita.cliente_telefone,
      `✅ *${tecnicoInfo.nome} confirmou sua visita!*\n\n` +
      `📅 ${formatarData(visita.data)} às ${visita.horario}\n` +
      `Está tudo certo! O técnico chegará no horário combinado.`
    );
    
    await notificarTelegram(
      `✅ <b>${tecnicoInfo.nome} confirmou visita</b>\n` +
      `Cliente: ${visita.cliente_nome}`,
      'sucesso'
    );
    return;
  }
  
  // Técnico precisa de informação (pergunta ao cliente)
  if (t.match(/(estacionamento|portaria|elevador|predio|prédio|andar|bloco|apartamento|casa|numero|número|qual o andar|tem vaga)/)) {
    // Salvar pergunta do técnico
    await supabase.from('intermediacao').insert({
      visita_id: visita.id,
      tipo: 'tecnico_pergunta',
      mensagem: texto,
      timestamp: new Date().toISOString()
    });
    
    // Perguntar ao cliente
    await enviarWhatsApp(
      visita.cliente_telefone,
      `📢 *Pergunta do técnico ${tecnicoInfo.nome}:*\n\n` +
      `"${texto}"\n\n` +
      `Poderia responder para que ele se prepare melhor?`
    );
    
    await notificarTelegram(
      `🔧 <b>Intermediação necessária</b>\n` +
      `Técnico ${tecnicoInfo.nome} perguntou: "${texto}"\n` +
      `Cliente: ${visita.cliente_nome} (${visita.cliente_telefone})`,
      'alerta'
    );
    return;
  }
  
  // Técnico quer cancelar/adiar
  if (t.match(/(não posso|nao posso|adiar|remarcar|cancelar|impedimento)/)) {
    await notificarTelegram(
      `🚨 <b>${tecnicoInfo.nome} NÃO PODE ATENDER</b>\n` +
      `"${texto}"\n\n` +
      `Visita: ${visita.cliente_nome} - ${formatarData(visita.data)} ${visita.horario}\n` +
      `⚠️ PRECISA REMARCAR`,
      'urgente'
    );
    
    await enviarWhatsApp(
      visita.cliente_telefone,
      `Olá! Tivemos um imprevisto com o técnico ${tecnicoInfo.nome}.\n\n` +
      `Estamos remarcando sua visita. Em breve entraremos em contato com novo horário.`
    );
    
    await supabase.from('agenda')
      .update({ status: 'remarcar' })
      .eq('id', visita.id);
    return;
  }
  
  // Mensagem genérica do técnico - repassar ao cliente
  await enviarWhatsApp(visita.cliente_telefone, 
    `👨‍🔧 *${tecnicoInfo.nome}:*\n${texto}`
  );
  
  await notificarTelegram(
    `💬 <b>${tecnicoInfo.nome} → Cliente:</b>\n` +
    `"${texto}"\n` +
    `Cliente: ${visita.cliente_nome}`,
    'info'
  );
}

// ============================================
// API DO PAINEL
// ============================================
async function apiPainel(req, res) {
  const { acao } = req.query;
  
  switch (acao) {
    case 'listar':
      return await listarConversas(res);
      
    case 'mensagens':
      return await listarMensagens(req, res);
      
    case 'intervir':
      return await intervir(req, res);
      
    case 'liberar':
      return await liberar(req, res);
      
    case 'enviar':
      return await enviarHumano(req, res);
      
    case 'estatisticas':
      return await estatisticas(res);
      
    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}

async function listarConversas(res) {
  // Buscar sessões ativas
  const { data: sessoes } = await supabase
    .from('sessoes')
    .select('*')
    .order('ultima_atividade', { ascending: false });
  
  // Buscar intervenções ativas
  const { data: intervencoes } = await supabase
    .from('intervencoes')
    .select('*')
    .eq('ativa', true);
  
  const intervencaoMap = new Map(intervencoes?.map(i => [i.telefone, i]));
  
  const conversas = sessoes?.map(s => ({
    telefone: s.telefone,
    nome: s.nome,
    etapa: s.etapa,
    intervencao: !!intervencaoMap.get(s.telefone),
    ultima: s.dados?.servico ? `${s.dados.servico} - ${s.dados.bairro || '?'}` : 'Novo atendimento',
    ultimaAtividade: new Date(s.ultima_atividade).getTime()
  })) || [];
  
  return res.json(conversas);
}

async function listarMensagens(req, res) {
  const { telefone } = req.query;
  
  const { data: mensagens } = await supabase
    .from('mensagens')
    .select('*')
    .eq('telefone', telefone)
    .order('timestamp', { ascending: true });
  
  const formatadas = mensagens?.map(m => ({
    tipo: m.tipo,
    texto: m.mensagem,
    hora: new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    nome: m.remetente || (m.tipo === 'cliente' ? 'Cliente' : m.tipo === 'tecnico' ? 'Técnico' : 'RC')
  })) || [];
  
  return res.json(formatadas);
}

async function intervir(req, res) {
  const { telefone } = req.body;
  
  await supabase.from('intervencoes').upsert({
    telefone,
    ativa: true,
    inicio: new Date().toISOString()
  });
  
  // Enviar mensagem ao cliente
  await enviarWhatsApp(telefone, 
    '👋 Olá! Sou o atendente humano. Acabei de assumir nossa conversa. Como posso ajudar?'
  );
  
  await notificarTelegram(`🚨 <b>Intervenção humana iniciada</b>\n📞 ${telefone}`, 'alerta');
  
  return res.json({ ok: true });
}

async function liberar(req, res) {
  const { telefone } = req.body;
  
  await supabase.from('intervencoes')
    .update({ ativa: false, fim: new Date().toISOString() })
    .eq('telefone', telefone);
  
  // Resetar sessão
  await supabase.from('sessoes')
    .update({ etapa: 'INICIO', dados: {} })
    .eq('telefone', telefone);
  
  await enviarWhatsApp(telefone,
    '✅ Vou passar você de volta para nosso assistente virtual. Ele continuará te ajudando!'
  );
  
  return res.json({ ok: true });
}

async function enviarHumano(req, res) {
  const { telefone, mensagem } = req.body;
  
  await enviarWhatsApp(telefone, mensagem);
  await salvarMensagem(telefone, mensagem, 'humano', 'Atendente');
  
  return res.json({ ok: true });
}

async function estatisticas(res) {
  const hoje = new Date().toISOString().split('T')[0];
  
  const { data: visitas } = await supabase
    .from('agenda')
    .select('*')
    .gte('created_at', hoje);
  
  const { data: mensagens } = await supabase
    .from('mensagens')
    .select('*')
    .gte('timestamp', hoje);
  
  return res.json({
    visitasHoje: visitas?.length || 0,
    confirmadas: visitas?.filter(v => v.status === 'confirmado').length || 0,
    mensagensHoje: mensagens?.length || 0,
    clientesUnicos: new Set(mensagens?.map(m => m.telefone)).size
  });
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

async function salvarMensagem(telefone, mensagem, tipo, remetente = null) {
  await supabase.from('mensagens').insert({
    telefone,
    mensagem,
    tipo,
    remetente,
    timestamp: new Date().toISOString()
  });
}

async function enviarWhatsApp(numero, texto) {
  // Implementação via WhatsApp Cloud API
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  
  if (!token || !phoneId) {
    console.error('❌ WhatsApp não configurado');
    return false;
  }
  
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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
      console.error('❌ Erro WhatsApp API:', data);
      return false;
    }
    
    console.log('✅ Enviado para', numero);
    return true;
    
  } catch (e) {
    console.error('❌ Erro enviar WhatsApp:', e);
    return false;
  }
}

async function notificarTelegram(mensagem, tipo = 'info') {
  const icones = { info: 'ℹ️', alerta: '⚠️', urgente: '🚨', sucesso: '✅' };
  const icone = icones[tipo] || 'ℹ️';
  
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: `${icone} ${mensagem}`,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Erro Telegram:', e);
  }
}

function extrairServicoEBairro(t, original) {
  const servicos = ['pintura', 'marcenaria', 'hidráulica', 'hidraulica', 'elétrica', 'eletrica', 'reforma', 'azulejo', 'pedreiro', 'gesso', 'vazamento', 'encanamento', 'moveis', 'armario', 'porta'];
  const bairros = [...CONFIG.BAIRROS_ZONA_SUL, 'tijuca', 'madureira', 'meier', 'vila isabel', 'barra', 'recreio', 'jacarepaguá', 'jacarepagua', 'centro'];
  
  let servico = null, bairro = null;
  
  for (const s of servicos) {
    if (t.includes(s)) { servico = s; break; }
  }
  
  for (const b of bairros) {
    if (t.includes(b)) { bairro = b; break; }
  }
  
  // Extrair bairro de frases como "moro em X" ou "no bairro Y"
  const m = original.match(/(em|no|na)\s+([A-Za-zÀ-ÿ\s]+)/i);
  if (m && !bairro) {
    const p = m[2].trim().toLowerCase();
    for (const b of bairros) {
      if (p.includes(b)) { bairro = b; break; }
    }
  }
  
  return { servico, bairro };
}

function extrairServico(t) { return extrairServicoEBairro(t, t).servico; }
function extrairBairro(t, txt) { return extrairServicoEBairro(t, txt).bairro; }

function extrairHora(txt) {
  const m = txt.match(/(\d{1,2})[:h](\d{2})?/);
  return m ? `${m[1].padStart(2,'0')}:${m[2] || '00'}` : null;
}

function calcularValor(bairro) {
  const n = bairro?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
  return CONFIG.BAIRROS_ZONA_SUL.some(b => n.includes(b)) ? CONFIG.PRECO_ZONA_SUL : CONFIG.PRECO_OUTROS;
}

function formatarData(dataStr) {
  if (dataStr === 'hoje') return 'hoje';
  if (dataStr === 'amanhã') return 'amanhã';
  
  const data = new Date(dataStr);
  if (isNaN(data)) return dataStr;
  
  return data.toLocaleDateString('pt-BR', { 
    day: '2-digit', 
    month: '2-digit',
    weekday: 'short'
  });
}
