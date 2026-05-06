// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// v3.1 - CORRIGIDO E COM LOGS DETALHADOS
// ============================================

import { createClient } from '@supabase/supabase-js';

// CONFIGURAÇÃO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'consertario-bot';

// SUPABASE
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CACHE DE INSTRUÇÕES (30 segundos)
const cache = { dados: null, atualizadoEm: 0, TTL: 30000 };

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action } = req.query;
    console.log(`[WEBHOOK] ${req.method} action=${action || 'webhook'} | path=${req.url}`);

    // ===== 1. VERIFICAÇÃO META =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      console.log('[VERIFY] Modo verificacao detectado');
      console.log('[VERIFY] Token recebido:', req.query['hub.verify_token']);
      console.log('[VERIFY] Token esperado:', VERIFY_TOKEN);
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        console.log('[VERIFY] SUCESSO - Retornando challenge');
        return res.status(200).send(req.query['hub.challenge']);
      }
      console.log('[VERIFY] FALHA - Token nao confere');
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL DE INTERVENÇÃO =====

    if (action === 'list') {
      console.log('[LIST] Listando conversas...');
      const { data, error } = await supabase.from('conversas').select('*').order('ultima_atividade', { ascending: false });
      if (error) { console.error('[LIST] ERRO:', error); throw error; }
      console.log(`[LIST] ${data?.length || 0} conversas encontradas`);
      return res.status(200).json({
        conversas: (data || []).map(c => ({
          telefone: c.telefone, nome: c.nome, mensagens: c.mensagens || [],
          emIntervencao: c.em_intervencao, etapa: c.etapa,
          ultimaAtividade: c.ultima_atividade, ultima: c.ultima,
          aparelho: c.aparelho, marca: c.marca, bairro: c.bairro
        }))
      });
    }

    if (action === 'messages') {
      const phone = req.query.phone;
      console.log(`[MESSAGES] Buscando mensagens de ${phone}`);
      const { data, error } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      if (error || !data) {
        console.log(`[MESSAGES] Conversa nao encontrada: ${phone}`);
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }
      return res.status(200).json({
        mensagens: data.mensagens || [], emIntervencao: data.em_intervencao,
        telefone: data.telefone, nome: data.nome,
        aparelho: data.aparelho, marca: data.marca, bairro: data.bairro
      });
    }

    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      console.log(`[INTERVENE] Intervencao no telefone: ${phone}`);
      const { data: ex } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      const sysMsg = { tipo: 'system', mensagem: '⚡ Humano assumiu o controle', data: new Date().toISOString(), nome: 'Sistema' };
      if (!ex) {
        console.log('[INTERVENE] Criando nova conversa em intervencao');
        await supabase.from('conversas').insert({
          telefone: phone, nome: 'Cliente', mensagens: [sysMsg],
          em_intervencao: true, etapa: 'intervencao',
          ultima_atividade: new Date().toISOString(), ultima: 'Intervencao iniciada'
        });
      } else {
        console.log('[INTERVENE] Atualizando conversa existente para intervencao');
        await supabase.from('conversas').update({
          em_intervencao: true,
          mensagens: [...(ex.mensagens || []), sysMsg],
          ultima_atividade: new Date().toISOString()
        }).eq('telefone', phone);
      }
      return res.status(200).json({ ok: true, emIntervencao: true });
    }

    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;
      console.log(`[RELEASE] Liberando robo para: ${phone}`);
      const { data: ex } = await supabase.from('conversas').select('mensagens').eq('telefone', phone).single();
      if (ex) {
        await supabase.from('conversas').update({
          em_intervencao: false,
          mensagens: [...(ex.mensagens || []), { tipo: 'system', mensagem: '🤖 Robo retomou o atendimento', data: new Date().toISOString(), nome: 'Sistema' }],
          ultima_atividade: new Date().toISOString()
        }).eq('telefone', phone);
      }
      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;
      console.log(`[SEND] Enviando mensagem manual para ${phone}: ${message}`);
      const { data: conv } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      if (!conv || !conv.em_intervencao) {
        console.log('[SEND] BLOQUEADO - Nao esta em intervencao');
        return res.status(403).json({ ok: false, erro: 'Nao esta em intervencao', emIntervencao: conv?.em_intervencao || false });
      }
      const enviado = await enviarWhatsApp(phone, message);
      if (enviado) {
        await supabase.from('conversas').update({
          mensagens: [...conv.mensagens, { tipo: 'humano', mensagem: message, data: new Date().toISOString(), nome: 'Atendente' }],
          ultima: message, ultima_atividade: new Date().toISOString()
        }).eq('telefone', phone);
      }
      return res.status(200).json({ ok: enviado });
    }

    // ===== 3. ROTAS DO PAINEL DE TREINAMENTO =====

    if (action === 'training-list') {
      console.log('[TRAINING] Listando instrucoes...');
      const { data, error } = await supabase.from('instrucoes_robo').select('*').eq('ativo', true).order('ordem', { ascending: true });
      if (error) { console.error('[TRAINING] ERRO:', error); throw error; }
      console.log(`[TRAINING] ${data?.length || 0} instrucoes encontradas`);
      return res.status(200).json({ instrucoes: data || [] });
    }

    if (action === 'training-create' && req.method === 'POST') {
      const { palavras_chave, resposta, descricao, ordem, categoria } = req.body;
      console.log('[TRAINING] Criando nova instrucao:', { categoria, ordem });
      const { data, error } = await supabase.from('instrucoes_robo').insert({
        palavras_chave: Array.isArray(palavras_chave) ? palavras_chave : palavras_chave.split(',').map(p => p.trim().toLowerCase()),
        resposta, descricao: descricao || '', ordem: ordem || 0, ativo: true, categoria: categoria || 'geral'
      }).select().single();
      if (error) { console.error('[TRAINING] ERRO ao criar:', error); throw error; }
      cache.dados = null;
      return res.status(200).json({ ok: true, instrucao: data });
    }

    if (action === 'training-update' && req.method === 'PUT') {
      const { id, palavras_chave, resposta, descricao, ordem, ativo, categoria } = req.body;
      console.log(`[TRAINING] Atualizando instrucao ${id}`);
      const upd = {};
      if (palavras_chave !== undefined) upd.palavras_chave = Array.isArray(palavras_chave) ? palavras_chave : palavras_chave.split(',').map(p => p.trim().toLowerCase());
      if (resposta !== undefined) upd.resposta = resposta;
      if (descricao !== undefined) upd.descricao = descricao;
      if (ordem !== undefined) upd.ordem = ordem;
      if (ativo !== undefined) upd.ativo = ativo;
      if (categoria !== undefined) upd.categoria = categoria;
      const { data, error } = await supabase.from('instrucoes_robo').update(upd).eq('id', id).select().single();
      if (error) { console.error('[TRAINING] ERRO ao atualizar:', error); throw error; }
      cache.dados = null;
      return res.status(200).json({ ok: true, instrucao: data });
    }

    if (action === 'training-delete' && req.method === 'DELETE') {
      const id = req.query.id;
      console.log(`[TRAINING] Deletando instrucao ${id}`);
      const { error } = await supabase.from('instrucoes_robo').delete().eq('id', id);
      if (error) { console.error('[TRAINING] ERRO ao deletar:', error); throw error; }
      cache.dados = null;
      return res.status(200).json({ ok: true });
    }

    if (action === 'training-fallback' && req.method === 'PUT') {
      console.log('[TRAINING] Atualizando fallback');
      const { error } = await supabase.from('config_robo').update({ valor: req.body.resposta }).eq('chave', 'fallback');
      if (error) { console.error('[TRAINING] ERRO fallback:', error); throw error; }
      cache.dados = null;
      return res.status(200).json({ ok: true });
    }

    if (action === 'training-fallback' && req.method === 'GET') {
      console.log('[TRAINING] Buscando fallback');
      const { data, error } = await supabase.from('config_robo').select('valor').eq('chave', 'fallback').single();
      if (error) { console.error('[TRAINING] ERRO ao buscar fallback:', error); throw error; }
      return res.status(200).json({ fallback: data?.valor || '' });
    }

    // ===== 4. RECEBER MENSAGEM WHATSAPP =====
    if (req.method === 'POST' && !action) {
      console.log('[WEBHOOK] Mensagem recebida do WhatsApp');
      console.log('[WEBHOOK] Body:', JSON.stringify(req.body, null, 2));
      
      // Responde imediatamente para o Meta
      res.status(200).send('OK');
      
      // Processa assíncrono
      processarMensagem(req.body).catch(err => {
        console.error('[WEBHOOK] ERRO ao processar mensagem:', err);
      });
      return;
    }

    console.log('[WEBHOOK] Rota nao encontrada, retornando OK');
    res.status(200).send('Conserta Rio Bot v3.1 - OK');

  } catch (e) {
    console.error('[ERRO GERAL]', e.message);
    console.error(e.stack);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAR MENSAGEM
// ============================================

async function processarMensagem(body) {
  console.log('[PROCESSAR] Iniciando processamento...');
  
  if (!body) {
    console.log('[PROCESSAR] Body vazio, ignorando');
    return;
  }
  
  if (body.object !== 'whatsapp_business_account') {
    console.log('[PROCESSAR] Nao e whatsapp_business_account:', body.object);
    return;
  }

  const entry = body.entry?.[0];
  if (!entry) {
    console.log('[PROCESSAR] Sem entry no body');
    return;
  }
  
  const changes = entry?.changes?.[0]?.value;
  if (!changes) {
    console.log('[PROCESSAR] Sem changes');
    return;
  }
  
  if (changes.statuses) {
    console.log('[PROCESSAR] E um status update, ignorando');
    return;
  }

  const msg = changes.messages?.[0];
  if (!msg) {
    console.log('[PROCESSAR] Sem mensagem no changes');
    return;
  }

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';

  console.log(`[PROCESSAR] Nova mensagem de ${telefone} (${nome})`);
  console.log(`[PROCESSAR] Tipo: ${msg.type}`);

  if (msg.type !== 'text') {
    console.log(`[PROCESSAR] Tipo ${msg.type} nao suportado, ignorando`);
    return;
  }

  const texto = msg.text.body;
  console.log(`[PROCESSAR] Texto: "${texto}"`);
  const lower = texto.toLowerCase();

  // Buscar ou criar conversa no Supabase
  console.log(`[PROCESSAR] Buscando conversa no Supabase...`);
  const { data: convExistente, error: convError } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', telefone)
    .single();

  if (convError && convError.code !== 'PGRST116') {
    console.error('[PROCESSAR] ERRO ao buscar conversa:', convError);
  }

  let conv;
  if (!convExistente) {
    console.log(`[PROCESSAR] Conversa nova, criando...`);
    conv = {
      telefone: telefone,
      nome: nome,
      mensagens: [],
      em_intervencao: false,
      etapa: 'novo',
      ultima_atividade: new Date().toISOString(),
      ultima: '',
      aparelho: null,
      marca: null,
      bairro: null
    };

    const { error: insertError } = await supabase.from('conversas').insert(conv);
    if (insertError) {
      console.error('[PROCESSAR] ERRO ao criar conversa:', insertError);
      return;
    }
    console.log('[PROCESSAR] Conversa criada com sucesso');
  } else {
    console.log(`[PROCESSAR] Conversa existente encontrada, etapa: ${convExistente.etapa}`);
    conv = {
      telefone: convExistente.telefone,
      nome: convExistente.nome || nome,
      mensagens: convExistente.mensagens || [],
      em_intervencao: convExistente.em_intervencao,
      etapa: convExistente.etapa || 'novo',
      ultima_atividade: convExistente.ultima_atividade,
      ultima: convExistente.ultima,
      aparelho: convExistente.aparelho,
      marca: convExistente.marca,
      bairro: convExistente.bairro
    };
  }

  // Adicionar mensagem do cliente
  const msgsCliente = [...conv.mensagens, {
    tipo: 'cliente',
    mensagem: texto,
    data: new Date().toISOString(),
    nome: nome
  }];

  // Extrai dados da mensagem
  const aparelho = extrairAparelho(lower);
  const marca = extrairMarca(lower);
  const bairro = extrairBairro(lower);

  console.log(`[PROCESSAR] Dados extraidos - aparelho: ${aparelho}, marca: ${marca}, bairro: ${bairro}`);

  // Atualiza conversa no Supabase
  const { error: updateError } = await supabase.from('conversas').update({
    mensagens: msgsCliente,
    ultima: texto,
    ultima_atividade: new Date().toISOString(),
    aparelho: aparelho || conv.aparelho,
    marca: marca || conv.marca,
    bairro: bairro || conv.bairro
  }).eq('telefone', telefone);

  if (updateError) {
    console.error('[PROCESSAR] ERRO ao atualizar conversa:', updateError);
  }

  console.log(`[PROCESSAR] emIntervencao=${conv.em_intervencao}`);

  // SE NÃO ESTIVER EM INTERVENÇÃO, RESPONDE AUTOMATICAMENTE
  if (!conv.em_intervencao) {
    console.log('[PROCESSAR] Gerando resposta automatica...');
    const resposta = await gerarResposta(lower, nome, conv);
    console.log(`[PROCESSAR] Resposta gerada: "${resposta.substring(0, 100)}..."`);

    const enviado = await enviarWhatsApp(telefone, resposta);
    console.log(`[PROCESSAR] Envio WhatsApp: ${enviado ? 'SUCESSO' : 'FALHA'}`);

    if (enviado) {
      const { data: convAtual } = await supabase
        .from('conversas')
        .select('mensagens')
        .eq('telefone', telefone)
        .single();

      const msgsBot = [...(convAtual?.mensagens || []), {
        tipo: 'bot',
        mensagem: resposta,
        data: new Date().toISOString(),
        nome: 'Robo'
      }];

      await supabase.from('conversas').update({
        mensagens: msgsBot,
        ultima: resposta,
        ultima_atividade: new Date().toISOString()
      }).eq('telefone', telefone);

      console.log('[PROCESSAR] Resposta salva no Supabase');
    }
  } else {
    console.log('[PROCESSAR] BLOQUEADO - conversa em intervencao humana');
  }
}

// ============================================
// MOTOR DE RESPOSTA INTELIGENTE
// ============================================

async function gerarResposta(texto, nome, conv) {
  console.log(`[RESPOSTA] Gerando resposta para etapa: ${conv.etapa}, bairro: ${conv.bairro}, aparelho: ${conv.aparelho}`);
  
  const etapa = conv.etapa || 'novo';
  const bairro = conv.bairro;

  // 1. Busca instruções do treinamento (com cache)
  console.log('[RESPOSTA] Buscando instrucoes do treinamento...');
  const instrucoes = await getInstrucoes();
  console.log(`[RESPOSTA] ${instrucoes.length} instrucoes carregadas`);

  // 2. Verifica intenções específicas primeiro
  for (const inst of instrucoes) {
    const pchs = inst.palavras_chave || [];
    const achou = pchs.some(p => texto.includes(p.toLowerCase()));
    if (achou) {
      console.log(`[RESPOSTA] Intencao encontrada: ${inst.nome} (categoria: ${inst.categoria})`);
      return inst.resposta.replace(/{nome}/g, nome).replace(/{bairro}/g, bairro || '');
    }
  }
  console.log('[RESPOSTA] Nenhuma intencao especifica encontrada, usando fluxo padrao');

  // 3. FLUXO CONSERTA RIO

  // Se é novo e não tem aparelho/marca
  if (etapa === 'novo' && !conv.aparelho) {
    console.log('[RESPOSTA] Fluxo: Saudacao inicial');
    await supabase.from('conversas').update({ etapa: 'aguardando_aparelho' }).eq('telefone', conv.telefone);
    return `Olá, ${nome}! 👋 Sou o assistente virtual da Conserta Rio.\n\nQual aparelho está com defeito e qual a marca dele?\n\nNós atendemos:\n🌀 Ar condicionado (portátil, janela, split, piso teto)\n🧺 Máquina de lavar, lava e seca, secadora, lava-louças\n❄️ Geladeira, freezer, frigobar\n\nTodas as marcas! ✅`;
  }

  // Se tem aparelho mas não perguntou sobre visita ainda
  if (etapa === 'aguardando_aparelho' && conv.aparelho) {
    console.log('[RESPOSTA] Fluxo: Perguntar sobre visita');
    await supabase.from('conversas').update({ etapa: 'aguardando_bairro' }).eq('telefone', conv.telefone);
    return `Certo, ${nome}. Para agilizarmos o conserto, você gostaria de agendar uma visita técnica imediata? 🚗💨`;
  }

  // Se quer agendar mas não tem bairro
  if ((etapa === 'aguardando_bairro' || texto.includes('agendar') || texto.includes('visita')) && !conv.bairro) {
    console.log('[RESPOSTA] Fluxo: Pedir bairro');
    return `Ótimo! Para verificar a disponibilidade e o valor da visita, me diga em qual bairro você está. 📍`;
  }

  // Se tem bairro
  if (conv.bairro && (etapa === 'aguardando_bairro' || texto.includes('bairro'))) {
    console.log('[RESPOSTA] Fluxo: Calcular valor da visita');
    const valor = calcularVisita(conv.bairro);
    if (valor === 'nao_atende') {
      await supabase.from('conversas').update({ etapa: 'nao_atende' }).eq('telefone', conv.telefone);
      return `Agradeço a informação, ${nome}. Infelizmente, no momento não conseguimos atender na Baixada Fluminense. Sinto muito por não poder ajudar diretamente. 😔`;
    }
    await supabase.from('conversas').update({ etapa: 'aguardando_horario' }).eq('telefone', conv.telefone);
    return `Perfeito! Para o bairro ${conv.bairro}, a taxa de visita técnica é de ${valor}. 💰\n\nEsse valor é abatido do orçamento final se você aprovar o serviço. Aceitamos Pix ou dinheiro.\n\nQual dia da semana (incluindo fins de semana) e horário comercial seria melhor? 📅`;
  }

  // Se pergunta valor antes de dar bairro
  if (texto.includes('quanto') || texto.includes('valor') || texto.includes('custa') || texto.includes('preço')) {
    if (!conv.bairro) {
      console.log('[RESPOSTA] Fluxo: Valor sem bairro');
      return `Compreendo. Para te informar o valor da visita, me diga em qual bairro você está. 📍`;
    }
  }

  // Se pergunta sobre cartão
  if (texto.includes('cartão') || texto.includes('cartao') || texto.includes('credito') || texto.includes('débito')) {
    console.log('[RESPOSTA] Fluxo: Cartao -> transferir humano');
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Para pagamento com cartão, preciso de um momento para te auxiliar. Pode aguardar um instante? 💳\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  // Se pede desconto
  if (texto.includes('desconto') || texto.includes('barato') || texto.includes('muito caro')) {
    console.log('[RESPOSTA] Fluxo: Desconto -> transferir humano');
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Entendi, ${nome}. Para verificar a possibilidade de desconto, vou precisar de um momento para analisar. Pode aguardar? 🕐\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  // Se pergunta sobre garantia
  if (texto.includes('garantia') || texto.includes('retorno') || texto.includes('voltou')) {
    console.log('[RESPOSTA] Fluxo: Garantia -> transferir humano');
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Entendi, ${nome}. Para verificar a garantia do serviço, vou precisar de um momento. Pode aguardar? 🛡️\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  // Se quer cancelar/reagendar
  if (texto.includes('cancelar') || texto.includes('reagendar') || texto.includes('mudar') || texto.includes('adiar')) {
    console.log('[RESPOSTA] Fluxo: Cancelar/Reagendar -> transferir humano');
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Entendi, ${nome}. Para ${texto.includes('cancelar') ? 'cancelamento' : 'reagendamento'}, vou precisar verificar as informações. Pode aguardar? 📋\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  // Se forneceu horário
  if (etapa === 'aguardando_horario' && (texto.includes('hora') || texto.includes(':') || texto.includes('h') || /\d{1,2}[:h]\d{2}/.test(texto))) {
    console.log('[RESPOSTA] Fluxo: Confirmar agendamento');
    const horaSolicitada = extrairHora(texto);
    const agora = new Date();
    const diffHoras = horaSolicitada ? (horaSolicitada - agora) / (1000 * 60 * 60) : 0;
    
    if (diffHoras > 0 && diffHoras < 2) {
      const novaHora = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
      const horaStr = novaHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `Compreendo a urgência! Precisamos de 2h de prazo para deslocamento. Poderia sugerir a partir das ${horaStr} ou outro dia? ⏰`;
    }
    
    await supabase.from('conversas').update({ etapa: 'agendado' }).eq('telefone', conv.telefone);
    return `Visita agendada! 🎉\n\n📍 Bairro: ${conv.bairro}\n💰 Taxa visita: ${calcularVisita(conv.bairro)}\n\nO técnico chegará em até 2h após o horário combinado. Em breve você receberá a confirmação. Agradecemos a preferência pela Conserta Rio! 🛠️`;
  }

  // Fallback
  console.log('[RESPOSTA] Usando fallback');
  const fallback = await getConfig('fallback');
  return (fallback || `Entendi, ${nome}! Pode me dizer mais detalhes? Ou digite "atendente" para falar com uma pessoa.`).replace(/{nome}/g, nome);
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

async function getInstrucoes() {
  const agora = Date.now();
  if (cache.dados && (agora - cache.atualizadoEm) < cache.TTL) {
    console.log('[CACHE] Usando cache');
    return cache.dados;
  }
  console.log('[CACHE] Buscando do Supabase...');
  const { data, error } = await supabase.from('instrucoes_robo').select('*').eq('ativo', true).order('ordem', { ascending: true });
  if (error) { 
    console.error('[CACHE] ERRO:', error); 
    return []; 
  }
  cache.dados = data || []; 
  cache.atualizadoEm = agora;
  console.log(`[CACHE] ${data?.length || 0} instrucoes carregadas`);
  return cache.dados;
}

async function getConfig(chave) {
  console.log(`[CONFIG] Buscando: ${chave}`);
  const { data, error } = await supabase.from('config_robo').select('valor').eq('chave', chave).single();
  if (error) {
    console.error(`[CONFIG] ERRO ao buscar ${chave}:`, error);
    return null;
  }
  return data?.valor;
}

function calcularVisita(bairro) {
  if (!bairro) return 'R$ 160';
  const b = bairro.toLowerCase();
  const zonaSul = ['botafogo', 'copacabana', 'ipanema', 'leblon', 'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 'laranjeiras', 'catete', 'cosme velho', 'flamengo'];
  const baixada = ['sao joao de meriti', 'nova iguacu', 'nilopolis', 'mesquita', 'queimados', 'japeri', 'paracambi', 'itatiaia', 'seropedica'];
  
  if (baixada.some(bai => b.includes(bai))) return 'nao_atende';
  if (b.includes('botafogo')) return 'R$ 100';
  if (zonaSul.some(bai => b.includes(bai))) return 'R$ 120';
  return 'R$ 160';
}

function extrairAparelho(texto) {
  if (!texto) return null;
  const aparelhos = [
    'ar condicionado portatil', 'ar condicionado de janela', 'ar condicionado split', 'ar split', 'ar portatil', 'ar janela',
    'piso teto', 'piso-teto',
    'maquina de lavar', 'maquina lava e seca', 'lava e seca', 'secadora', 'maquina de lavar louca', 'lava louca', 'lava-louca',
    'geladeira', 'freezer', 'frigobar', 'refrigerador'
  ];
  for (const a of aparelhos) if (texto.includes(a)) return a;
  return null;
}

function extrairMarca(texto) {
  if (!texto) return null;
  const marcas = ['samsung', 'lg', 'electrolux', 'brastemp', 'consul', 'panasonic', 'carrier', 'springer', 'fujitsu', 'gree', 'philco', 'midea', 'elgin'];
  for (const m of marcas) if (texto.includes(m)) return m;
  return null;
}

function extrairBairro(texto) {
  if (!texto) return null;
  const bairros = [
    'botafogo', 'copacabana', 'ipanema', 'leblon', 'lagoa', 'gavea', 'humaita', 'urca', 'flamengo', 'catete', 'laranjeiras', 'cosme velho',
    'tijuca', 'vila isabel', 'grajau', 'andaraí', 'engenho novo', 'engenho de dentro', 'meier', 'alto da boa vista',
    'madureira', 'bangu', 'campo grande', 'santa cruz', 'realengo', 'padre miguel', 'jardim sulacap',
    'barra da tijuca', 'jacarepagua', 'recreio', 'vargem grande', 'vargem pequena',
    'centro', 'saude', 'gamboa', 'santo cristo', 'cidade nova',
    'sao joao de meriti', 'nova iguacu', 'nilopolis', 'mesquita', 'queimados'
  ];
  for (const b of bairros) if (texto.includes(b)) return b;
  return null;
}

function extrairHora(texto) {
  if (!texto) return null;
  const match = texto.match(/(\d{1,2})[:h](\d{2})/);
  if (!match) return null;
  const h = parseInt(match[1]), m = parseInt(match[2]);
  const agora = new Date();
  const data = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), h, m);
  if (data < agora) data.setDate(data.getDate() + 1);
  return data;
}

async function enviarWhatsApp(numero, texto) {
  console.log(`[WHATSAPP] Enviando para ${numero}: "${texto.substring(0, 80)}..."`);
  
  if (!WHATSAPP_TOKEN) {
    console.error('[WHATSAPP] ERRO: WHATSAPP_TOKEN nao configurado');
    return false;
  }
  if (!WHATSAPP_PHONE_ID) {
    console.error('[WHATSAPP] ERRO: WHATSAPP_PHONE_ID nao configurado');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`;
    console.log(`[WHATSAPP] URL: ${url}`);
    
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: numero,
      type: 'text',
      text: { body: texto }
    };
    
    const r = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) { 
      const e = await r.json(); 
      console.error('[WHATSAPP] ERRO API:', JSON.stringify(e, null, 2)); 
      return false; 
    }
    
    console.log('[WHATSAPP] Mensagem enviada com sucesso');
    return true;

  } catch (e) { 
    console.error('[WHATSAPP] ERRO fetch:', e.message); 
    return false; 
  }
}
