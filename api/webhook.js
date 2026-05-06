// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// v4.0 - TUDO EDITÁVEL PELO PAINEL (SEM CÓDIGO)
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

// CACHE (atualiza a cada 30 segundos)
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

    // ===== 1. VERIFICAÇÃO META =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL DE INTERVENÇÃO =====

    if (action === 'list') {
      const { data, error } = await supabase.from('conversas').select('*').order('ultima_atividade', { ascending: false });
      if (error) throw error;
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
      const { data, error } = await supabase.from('conversas').select('*').eq('telefone', req.query.phone).single();
      if (error || !data) return res.status(404).json({ erro: 'Conversa nao encontrada' });
      return res.status(200).json({
        mensagens: data.mensagens || [], emIntervencao: data.em_intervencao,
        telefone: data.telefone, nome: data.nome,
        aparelho: data.aparelho, marca: data.marca, bairro: data.bairro
      });
    }

    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      const { data: ex } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      const sysMsg = { tipo: 'system', mensagem: '⚡ Humano assumiu o controle', data: new Date().toISOString(), nome: 'Sistema' };
      if (!ex) {
        await supabase.from('conversas').insert({
          telefone: phone, nome: 'Cliente', mensagens: [sysMsg],
          em_intervencao: true, etapa: 'intervencao',
          ultima_atividade: new Date().toISOString(), ultima: 'Intervencao iniciada'
        });
      } else {
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
      const { data: conv } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      if (!conv || !conv.em_intervencao) {
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
      const { data, error } = await supabase.from('instrucoes_robo').select('*').eq('ativo', true).order('ordem', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ instrucoes: data || [] });
    }

    if (action === 'training-create' && req.method === 'POST') {
      const { palavras_chave, resposta, descricao, ordem, categoria } = req.body;
      const { data, error } = await supabase.from('instrucoes_robo').insert({
        palavras_chave: Array.isArray(palavras_chave) ? palavras_chave : palavras_chave.split(',').map(p => p.trim().toLowerCase()),
        resposta, descricao: descricao || '', ordem: ordem || 0, ativo: true, categoria: categoria || 'geral'
      }).select().single();
      if (error) throw error;
      cache.dados = null;
      return res.status(200).json({ ok: true, instrucao: data });
    }

    if (action === 'training-update' && req.method === 'PUT') {
      const { id, palavras_chave, resposta, descricao, ordem, ativo, categoria } = req.body;
      const upd = {};
      if (palavras_chave !== undefined) upd.palavras_chave = Array.isArray(palavras_chave) ? palavras_chave : palavras_chave.split(',').map(p => p.trim().toLowerCase());
     qui está o **webhook.js v4.0** completo. Agora **100% editável pelo painel**, sem mexer no código:

```javascript
// ============================================
// WEBHOOK WHATSAPP - CONSERTA RIO
// v4.0 - TUDO EDITÁVEL PELO PAINEL (SEM CÓDIGO)
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

// CACHE (atualiza a cada 30 segundos)
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

    // ===== 1. VERIFICAÇÃO META =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL DE INTERVENÇÃO =====

    if (action === 'list') {
      const { data, error } = await supabase.from('conversas').select('*').order('ultima_atividade', { ascending: false });
      if (error) throw error;
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
      const { data, error } = await supabase.from('conversas').select('*').eq('telefone', req.query.phone).single();
      if (error || !data) return res.status(404).json({ erro: 'Conversa nao encontrada' });
      return res.status(200).json({
        mensagens: data.mensagens || [], emIntervencao: data.em_intervencao,
        telefone: data.telefone, nome: data.nome,
        aparelho: data.aparelho, marca: data.marca, bairro: data.bairro
      });
    }

    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      const { data: ex } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      const sysMsg = { tipo: 'system', mensagem: '⚡ Humano assumiu o controle', data: new Date().toISOString(), nome: 'Sistema' };
      if (!ex) {
        await supabase.from('conversas').insert({
          telefone: phone, nome: 'Cliente', mensagens: [sysMsg],
          em_intervencao: true, etapa: 'intervencao',
          ultima_atividade: new Date().toISOString(), ultima: 'Intervencao iniciada'
        });
      } else {
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
      const { data: conv } = await supabase.from('conversas').select('*').eq('telefone', phone).single();
      if (!conv || !conv.em_intervencao) {
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
      const { data, error } = await supabase.from('instrucoes_robo').select('*').eq('ativo', true).order('ordem', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ instrucoes: data || [] });
    }

    if (action === 'training-create' && req.method === 'POST') {
      const { palavras_chave, resposta, descricao, ordem, categoria } = req.body;
      const { data, error } = await supabase.from('instrucoes_robo').insert({
        palavras_chave: Array.isArray(palavras_chave) ? palavras_chave : palavras_chave.split(',').map(p => p.trim().toLowerCase()),
        resposta, descricao: descricao || '', ordem: ordem || 0, ativo: true, categoria: categoria || 'geral'
      }).select().single();
      if (error) throw error;
      cache.dados = null;
      return res.status(200).json({ ok: true, instrucao: data });
    }

    if (action === 'training-update' && req.method === 'PUT') {
      const { id, palavras_chave, resposta, descricao, ordem, ativo, categoria } = req.body;
      const upd = {};
      if (palavras_chave !== undefined) upd.palavras_chave = Array.isArray(palavras_chave) ? palavras_chave : palavras_chave.split(',').map(p => p.trim().toLowerCase());
      if (resposta !== undefined) upd.resposta = resposta;
      if (descricao !== undefined) upd.descricao = descricao;
      if (ordem !== undefined) upd.ordem = ordem;
      if (ativo !== undefined) upd.ativo = ativo;
      if (categoria !== undefined) upd.categoria = categoria;
      const { data, error } = await supabase.from('instrucoes_robo').update(upd).eq('id', id).select().single();
      if (error) throw error;
      cache.dados = null;
      return res.status(200).json({ ok: true, instrucao: data });
    }

    if (action === 'training-delete' && req.method === 'DELETE') {
      const { error } = await supabase.from('instrucoes_robo').delete().eq('id', req.query.id);
      if (error) throw error;
      cache.dados = null;
      return res.status(200).json({ ok: true });
    }

    if (action === 'training-fallback' && req.method === 'PUT') {
      const { error } = await supabase.from('config_robo').update({ valor: req.body.resposta }).eq('chave', 'fallback');
      if (error) throw error;
      cache.dados = null;
      return res.status(200).json({ ok: true });
    }

    if (action === 'training-fallback' && req.method === 'GET') {
      const { data, error } = await supabase.from('config_robo').select('valor').eq('chave', 'fallback').single();
      if (error) throw error;
      return res.status(200).json({ fallback: data?.valor || '' });
    }

    // ===== 4. RECEBER MENSAGEM WHATSAPP =====
    if (req.method === 'POST' && !action) {
      res.status(200).send('OK');
      processarMensagem(req.body).catch(err => console.error('Erro:', err));
      return;
    }

    res.status(200).send('Conserta Rio Bot v4.0 - OK');

  } catch (e) {
    console.error('ERRO:', e.message);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAR MENSAGEM
// ============================================

async function processarMensagem(body) {
  if (!body || body.object !== 'whatsapp_business_account') return;
  const changes = body.entry?.[0]?.changes?.[0]?.value;
  if (!changes || changes.statuses) return;
  const msg = changes.messages?.[0];
  if (!msg || msg.type !== 'text') return;

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = msg.text.body;
  const lower = texto.toLowerCase();

  // Buscar/criar conversa
  const { data: ex } = await supabase.from('conversas').select('*').eq('telefone', telefone).single();
  let conv = ex || {
    telefone, nome, mensagens: [], em_intervencao: false,
    etapa: 'novo', ultima_atividade: new Date().toISOString(), ultima: '',
    aparelho: null, marca: null, bairro: null
  };

  if (!ex) {
    await supabase.from('conversas').insert({
      telefone, nome, mensagens: [], em_intervencao: false, etapa: 'novo',
      ultima_atividade: new Date().toISOString(), ultima: '',
      aparelho: null, marca: null, bairro: null
    });
  }

  // Salva mensagem do cliente
  const msgsCliente = [...(conv.mensagens || []), {
    tipo: 'cliente', mensagem: texto, data: new Date().toISOString(), nome
  }];

  const aparelho = extrairAparelho(lower);
  const marca = extrairMarca(lower);
  const bairro = extrairBairro(lower);

  await supabase.from('conversas').update({
    mensagens: msgsCliente, ultima: texto, ultima_atividade: new Date().toISOString(),
    aparelho: aparelho || conv.aparelho,
    marca: marca || conv.marca,
    bairro: bairro || conv.bairro
  }).eq('telefone', telefone);

  // Se em intervenção, não responde
  if (conv.em_intervencao) return;

  // Verifica palavras para chamar atendente
  const cfgHuman = await getConfig('human_keywords');
  const humanWords = (cfgHuman || 'atendente,humano,pessoa,nao e bot').split(',').map(w => w.trim());
  if (humanWords.some(w => lower.includes(w))) {
    const resp = await getRespostaByCategoria('atendente_humano');
    await enviarERegistrar(telefone, resp || '👨‍🔧 Vou chamar um atendente humano. Aguarde um momento...', nome);
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', telefone);
    return;
  }

  // GERA RESPOSTA INTELIGENTE (tudo do banco!)
  const resposta = await gerarResposta(lower, nome, conv);
  await enviarERegistrar(telefone, resposta, nome);
}

// ============================================
// MOTOR DE RESPOSTA - TUDO DO SUPABASE!
// ============================================

async function gerarResposta(texto, nome, conv) {
  const etapa = conv.etapa || 'novo';
  const bairro = conv.bairro;

  // 1. Busca instruções do treinamento (com cache)
  const instrucoes = await getInstrucoes();

  // 2. Verifica intenções específicas do treinamento PRIMEIRO
  for (const inst of instrucoes) {
    const pchs = inst.palavras_chave || [];
    const achou = pchs.some(p => texto.includes(p.toLowerCase()));
    if (achou) {
      return inst.resposta.replace(/{nome}/g, nome).replace(/{bairro}/g, bairro || '');
    }
  }

  // 3. FLUXO AUTOMÁTICO (só entra se não achou intenção no treinamento)

  if (etapa === 'novo' && !conv.aparelho) {
    await supabase.from('conversas').update({ etapa: 'aguardando_aparelho' }).eq('telefone', conv.telefone);
    return `Olá, ${nome}! 👋 Sou o assistente virtual da Conserta Rio.\n\nQual aparelho está com defeito e qual a marca dele?\n\nNós atendemos:\n🌀 Ar condicionado (portátil, janela, split, piso teto)\n🧺 Máquina de lavar, lava e seca, secadora, lava-louças\n❄️ Geladeira, freezer, frigobar\n\nTodas as marcas! ✅`;
  }

  if (etapa === 'aguardando_aparelho' && conv.aparelho) {
    await supabase.from('conversas').update({ etapa: 'aguardando_bairro' }).eq('telefone', conv.telefone);
    return `Certo, ${nome}. Para agilizarmos o conserto, você gostaria de agendar uma visita técnica imediata? 🚗💨`;
  }

  if ((etapa === 'aguardando_bairro' || texto.includes('agendar') || texto.includes('visita')) && !conv.bairro) {
    return `Ótimo! Para verificar a disponibilidade e o valor da visita, me diga em qual bairro você está. 📍`;
  }

  if (conv.bairro && (etapa === 'aguardando_bairro' || texto.includes('bairro'))) {
    const valor = calcularVisita(conv.bairro);
    if (valor === 'nao_atende') {
      await supabase.from('conversas').update({ etapa: 'nao_atende' }).eq('telefone', conv.telefone);
      return `Agradeço a informação, ${nome}. Infelizmente, no momento não conseguimos atender na Baixada Fluminense. Sinto muito por não poder ajudar diretamente. 😔`;
    }
    await supabase.from('conversas').update({ etapa: 'aguardando_horario' }).eq('telefone', conv.telefone);
    return `Perfeito! Para o bairro ${conv.bairro}, a taxa de visita técnica é de ${valor}. 💰\n\nEsse valor é abatido do orçamento final se você aprovar o serviço. Aceitamos Pix ou dinheiro.\n\nQual dia da semana (incluindo fins de semana) e horário comercial seria melhor? 📅`;
  }

  if ((texto.includes('quanto') || texto.includes('valor') || texto.includes('custa') || texto.includes('preço')) && !conv.bairro) {
    return `Compreendo. Para te informar o valor da visita, me diga em qual bairro você está. 📍`;
  }

  if (texto.includes('cartão') || texto.includes('cartao') || texto.includes('credito') || texto.includes('débito')) {
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Para pagamento com cartão, preciso de um momento para te auxiliar. Pode aguardar um instante? 💳\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  if (texto.includes('desconto') || texto.includes('barato') || texto.includes('muito caro')) {
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Entendi, ${nome}. Para verificar a possibilidade de desconto, vou precisar de um momento para analisar. Pode aguardar? 🕐\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  if (texto.includes('garantia') || texto.includes('retorno') || texto.includes('voltou')) {
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Entendi, ${nome}. Para verificar a garantia do serviço, vou precisar de um momento. Pode aguardar? 🛡️\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  if (texto.includes('cancelar') || texto.includes('reagendar') || texto.includes('mudar') || texto.includes('adiar')) {
    await supabase.from('conversas').update({ em_intervencao: true }).eq('telefone', conv.telefone);
    return `Entendi, ${nome}. Para ${texto.includes('cancelar') ? 'cancelamento' : 'reagendamento'}, vou precisar verificar as informações. Pode aguardar? 📋\n\n⏳ Um atendente humano vai te ajudar agora.`;
  }

  if (etapa === 'aguardando_horario' && (texto.includes('hora') || texto.includes(':') || texto.includes('h'))) {
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

  // Fallback do banco
  const fallback = await getConfig('fallback');
  return (fallback || `Entendi, ${nome}! Pode me dizer mais detalhes? Ou digite "atendente" para falar com uma pessoa.`).replace(/{nome}/g, nome);
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

async function getInstrucoes() {
  const agora = Date.now();
  if (cache.dados && (agora - cache.atualizadoEm) < cache.TTL) return cache.dados;
  const { data, error } = await supabase.from('instrucoes_robo').select('*').eq('ativo', true).order('ordem', { ascending: true });
  if (error) { console.error('Erro instrucoes:', error); return []; }
  cache.dados = data || []; cache.atualizadoEm = agora;
  return cache.dados;
}

async function getConfig(chave) {
  const { data } = await supabase.from('config_robo').select('valor').eq('chave', chave).single();
  return data?.valor;
}

async function getRespostaByCategoria(cat) {
  const { data } = await supabase.from('instrucoes_robo').select('resposta').eq('categoria', cat).eq('ativo', true).limit(1).single();
  return data?.resposta;
}

async function enviarERegistrar(telefone, resposta, nome) {
  const enviado = await enviarWhatsApp(telefone, resposta);
  if (enviado) {
    const { data: conv } = await supabase.from('conversas').select('mensagens').eq('telefone', telefone).single();
    await supabase.from('conversas').update({
      mensagens: [...(conv?.mensagens || []), { tipo: 'bot', mensagem: resposta, data: new Date().toISOString(), nome: 'Robo' }],
      ultima: resposta, ultima_atividade: new Date().toISOString()
    }).eq('telefone', telefone);
  }
}

function calcularVisita(bairro) {
  const b = bairro.toLowerCase();
  const zonaSul = ['botafogo', 'copacabana', 'ipanema', 'leblon', 'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 'laranjeiras', 'catete', 'cosme velho', 'flamengo'];
  const baixada = ['sao joao de meriti', 'nova iguacu', 'nilopolis', 'mesquita', 'queimados', 'japeri', 'paracambi', 'itatiaia', 'seropedica'];
  
  if (baixada.some(bai => b.includes(bai))) return 'nao_atende';
  if (b.includes('botafogo')) return 'R$ 100';
  if (zonaSul.some(bai => b.includes(bai))) return 'R$ 120';
  return 'R$ 160';
}

function extrairAparelho(texto) {
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
  const marcas = ['samsung', 'lg', 'electrolux', 'brastemp', 'consul', 'panasonic', 'carrier', 'springer', 'fujitsu', 'gree', 'philco', 'midea', 'elgin'];
  for (const m of marcas) if (texto.includes(m)) return m;
  return null;
}

function extrairBairro(texto) {
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
  const match = texto.match(/(\d{1,2})[:h](\d{2})/);
  if (!match) return null;
  const h = parseInt(match[1]), m = parseInt(match[2]);
  const agora = new Date();
  const data = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), h, m);
  if (data < agora) data.setDate(data.getDate() + 1);
  return data;
}

async function enviarWhatsApp(numero, texto) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.error('Token ou Phone ID nao configurado');
    return false;
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
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
      }
    );
    if (!response.ok) {
      const erro = await response.json();
      console.error('Erro API WhatsApp:', erro);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Erro ao enviar WhatsApp:', e.message);
    return false;
  }
}
