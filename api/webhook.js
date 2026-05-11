// ============================================
// WEBHOOK WHATSAPP - GENÉRICO V2
// Toda a lógica vem do JSON de treinamento via API
// Nenhuma lógica de negócio hardcoded
// ============================================

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'roboatendente';
const API_CONFIG_URL = process.env.API_CONFIG_URL;
const API_KEY = process.env.API_KEY;

const conversas = new Map();
const timers = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, empresa_id } = req.query;
    console.log(`[WEBHOOK] ${req.method} action=${action} empresa=${empresa_id}`);

    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    if (action === 'list') {
      const lista = Array.from(conversas.values())
        .filter(c => c.empresa_id === empresa_id)
        .sort((a, b) => new Date(b.ultimaAtividade || 0) - new Date(a.ultimaAtividade || 0));
      return res.status(200).json({ conversas: lista });
    }

    if (action === 'messages') {
      const phone = req.query.phone;
      const conv = conversas.get(`${empresa_id}:${phone}`);
      if (!conv) return res.status(404).json({ erro: 'Conversa nao encontrada' });
      return res.status(200).json({
        mensagens: conv.mensagens || [], emIntervencao: conv.emIntervencao,
        telefone: conv.telefone, nome: conv.nome, etapa: conv.etapa
      });
    }

    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;
      const chave = `${empresa_id}:${phone}`;
      const conv = conversas.get(chave);
      if (!conv) {
        conversas.set(chave, {
          empresa_id, telefone: phone, nome: 'Cliente', mensagens: [],
          emIntervencao: true, etapa: 'intervencao',
          ultimaAtividade: new Date().toISOString(), ultima: 'Intervencao iniciada', contexto: {}
        });
      } else {
        conv.emIntervencao = true;
        conv.ultimaAtividade = new Date().toISOString();
        conv.mensagens.push({ tipo: 'system', mensagem: 'Humano assumiu o controle', data: new Date().toISOString(), nome: 'Sistema' });
      }
      return res.status(200).json({ ok: true, emIntervencao: true });
    }

    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;
      const chave = `${empresa_id}:${phone}`;
      const conv = conversas.get(chave);
      if (conv) {
        conv.emIntervencao = false;
        conv.ultimaAtividade = new Date().toISOString();
        conv.mensagens.push({ tipo: 'system', mensagem: 'Robo retomou o atendimento', data: new Date().toISOString(), nome: 'Sistema' });
      }
      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;
      const chave = `${empresa_id}:${phone}`;
      const conv = conversas.get(chave);
      if (!conv || !conv.emIntervencao) {
        return res.status(403).json({ ok: false, erro: 'Nao esta em intervencao' });
      }
      const enviado = await enviarWhatsApp(phone, message);
      if (enviado) {
        conv.mensagens.push({ tipo: 'humano', mensagem: message, data: new Date().toISOString(), nome: 'Atendente' });
        conv.ultima = message; conv.ultimaAtividade = new Date().toISOString();
      }
      return res.status(200).json({ ok: enviado });
    }

    if (req.method === 'POST' && !action) {
      res.status(200).send('OK');
      processarMensagem(req.body, empresa_id).catch(err => console.error('Erro:', err));
      return;
    }

    res.status(200).send('Webhook Generico - OK');
  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    res.status(200).send('OK');
  }
}

async function processarMensagem(body, empresa_id) {
  if (!body || body.object !== 'whatsapp_business_account') return;
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  if (!changes || changes.statuses) return;
  const msg = changes.messages?.[0];
  if (!msg || msg.type !== 'text') return;

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';
  const texto = msg.text.body;

  const config = await buscarConfiguracao(empresa_id);
  if (!config) { console.error(`[ERRO] Config nao encontrada: ${empresa_id}`); return; }

  const chave = `${empresa_id}:${telefone}`;
  if (!conversas.has(chave)) {
    conversas.set(chave, {
      empresa_id, telefone, nome, mensagens: [], emIntervencao: false,
      etapa: config.fluxo_inicial || 'saudacao',
      ultimaAtividade: new Date().toISOString(), ultima: '',
      aguardandoResposta: false, tentativas: 0, contexto: {}, dadosColetados: {}
    });
  }

  const conv = conversas.get(chave);
  conv.mensagens.push({ tipo: 'cliente', mensagem: texto, data: new Date().toISOString(), nome });
  conv.ultima = texto; conv.ultimaAtividade = new Date().toISOString();
  conv.aguardandoResposta = false; conv.tentativas = 0;

  if (timers.has(chave)) { clearTimeout(timers.get(chave)); timers.delete(chave); }

  console.log(`[RECEBIDO] ${empresa_id} | ${telefone}: ${texto.substring(0,50)}`);

  if (conv.emIntervencao) { console.log('[BOT] BLOQUEADO - intervencao'); return; }

  const etapaConfig = config.fluxos?.[conv.etapa];
  if (etapaConfig?.silencio) { console.log(`[BOT] SILENCIO etapa ${conv.etapa}`); return; }

  const resposta = await gerarResposta(texto, nome, conv, config);
  if (resposta) {
    await enviarWhatsApp(telefone, resposta);
    conv.mensagens.push({ tipo: 'bot', mensagem: resposta, data: new Date().toISOString(), nome: config.nome_bot || 'Robo' });
    conv.ultima = resposta; conv.ultimaAtividade = new Date().toISOString();
    conv.ultimaMsgBot = resposta; conv.aguardandoResposta = true;

    if (etapaConfig?.reengajamento?.ativo) {
      const min = etapaConfig.reengajamento.minutos || 2;
      timers.set(chave, setTimeout(() => reengajar(chave, config), min * 60 * 1000));
    }
    console.log('[BOT] Resposta enviada');
  }
}

async function gerarResposta(texto, nome, conv, config) {
  const txt = texto.toLowerCase().trim();
  const etapa = conv.etapa;
  const etapaConfig = config.fluxos?.[etapa];

  if (!etapaConfig) return config.mensagem_erro || 'Desculpe, nao entendi.';

  const palavrasHumano = config.palavras_humano || [];
  if (palavrasHumano.some(p => txt.includes(p.toLowerCase()))) {
    conv.emIntervencao = true;
    if (config.notificacoes?.telegram?.ativo) await enviarTelegram(conv, config, 'intervencao');
    return config.mensagem_intervencao || 'Um momento.';
  }

  if (config.intencoes_globais) {
    for (const int of config.intencoes_globais) {
      if (int.palavras_chave.some(p => txt.includes(p.toLowerCase()))) {
        if (int.proxima_etapa) conv.etapa = int.proxima_etapa;
        if (int.campo_dados) conv.dadosColetados[int.campo_dados] = texto;
        return substituirVars(int.resposta, { nome, ...conv.dadosColetados });
      }
    }
  }

  if (etapaConfig.transicoes) {
    for (const trans of etapaConfig.transicoes) {
      const match = trans.condicoes.some(c => avaliarCondicao(c, texto, txt));
      if (match) {
        if (trans.acoes) {
          for (const acao of trans.acoes) executarAcao(acao, texto, txt, conv);
        }
        if (trans.proxima_etapa) conv.etapa = trans.proxima_etapa;
        const resp = trans.resposta || etapaConfig.resposta_padrao;
        return substituirVars(resp, { nome, ...conv.dadosColetados });
      }
    }
  }

  if (etapaConfig.resposta_padrao) {
    conv.tentativas++;
    if (etapaConfig.fallback_etapa && conv.tentativas >= (etapaConfig.max_tentativas || 2)) {
      conv.etapa = etapaConfig.fallback_etapa;
      const fb = config.fluxos[etapaConfig.fallback_etapa];
      return substituirVars(fb?.resposta_padrao || etapaConfig.resposta_padrao, { nome, ...conv.dadosColetados });
    }
    return substituirVars(etapaConfig.resposta_padrao, { nome, ...conv.dadosColetados });
  }

  return config.mensagem_erro || 'Desculpe, nao entendi.';
}

function avaliarCondicao(condicao, textoOriginal, textoLower) {
  switch (condicao.tipo) {
    case 'qualquer': return true;
    case 'contem': return textoLower.includes(condicao.valor.toLowerCase());
    case 'regex': return new RegExp(condicao.valor, 'i').test(textoOriginal);
    case 'nao_contem': return !textoLower.includes(condicao.valor.toLowerCase());
    case 'igual': return textoLower === condicao.valor.toLowerCase();
    case 'comeca_com': return textoLower.startsWith(condicao.valor.toLowerCase());
    case 'termina_com': return textoLower.endsWith(condicao.valor.toLowerCase());
    case 'lista_contem': return condicao.valores.some(v => textoLower.includes(v.toLowerCase()));
    default: return false;
  }
}

function executarAcao(acao, textoOriginal, textoLower, conv) {
  switch (acao.tipo) {
    case 'salvar_dado':
      conv.dadosColetados[acao.campo] = textoOriginal;
      break;
    case 'salvar_extracao': {
      const extraido = extrairDado(textoLower, acao.padrao);
      if (extraido) conv.dadosColetados[acao.campo] = extraido;
      break;
    }
    case 'funcao_condicional': {
      const resultado = executarCondicional(conv.dadosColetados, acao.regras);
      if (resultado) {
        if (resultado.proxima_etapa) conv.etapa = resultado.proxima_etapa;
        if (resultado.resposta) {
          // Retorna resposta do condicional imediatamente
          const resp = substituirVars(resultado.resposta, { ...conv.dadosColetados, ...resultado.dados });
          if (resultado.dados) Object.assign(conv.dadosColetados, resultado.dados);
          // Nota: a resposta será usada pela transição que chamou esta ação
          conv._respostaCondicional = resp;
        }
        if (resultado.dados) Object.assign(conv.dadosColetados, resultado.dados);
      }
      break;
    }
    case 'salvar_horario': {
      const horario = extrairHorario(textoOriginal);
      if (horario) {
        conv.dadosColetados.horarioInicio = horario.inicio;
        conv.dadosColetados.horarioFim = horario.fim;
      }
      break;
    }
    case 'definir_horario_padrao': {
      const agora = new Date();
      const h1 = agora.getHours() + 2;
      const h2 = h1 + 2;
      conv.dadosColetados.horarioInicio = `${h1.toString().padStart(2,'0')}:00`;
      conv.dadosColetados.horarioFim = `${h2.toString().padStart(2,'0')}:00`;
      break;
    }
    case 'notificar':
      if (acao.tipo_notif === 'telegram_visita') enviarTelegram(conv, null, 'visita');
      break;
  }
}

function extrairDado(texto, padrao) {
  if (padrao.tipo === 'lista') {
    for (const item of padrao.valores) {
      if (texto.includes(item.palavra.toLowerCase())) return item.valor;
    }
    return padrao.default || null;
  }
  if (padrao.tipo === 'regex') {
    const match = texto.match(new RegExp(padrao.valor, 'i'));
    return match ? match[0] : null;
  }
  if (padrao.tipo === 'primeira_palavra') {
    return texto.split(' ')[0];
  }
  return texto;
}

function executarCondicional(dados, regras) {
  for (const regra of regras) {
    const campo = dados[regra.campo];
    if (campo === undefined) continue;
    const valorCampo = campo.toString().toLowerCase();
    const match = regra.condicoes.some(c => {
      switch (c.operador) {
        case 'igual': return valorCampo === c.valor.toLowerCase();
        case 'contem': return valorCampo.includes(c.valor.toLowerCase());
        case 'inclui': return valorCampo.includes(c.valor.toLowerCase());
        case 'nao_contem': return !valorCampo.includes(c.valor.toLowerCase());
        case 'comeca_com': return valorCampo.startsWith(c.valor.toLowerCase());
        case 'termina_com': return valorCampo.endsWith(c.valor.toLowerCase());
        case 'maior_que': return parseFloat(valorCampo) > parseFloat(c.valor);
        case 'menor_que': return parseFloat(valorCampo) < parseFloat(c.valor);
        case 'qualquer': return true;
        default: return false;
      }
    });
    if (match) return regra.resultado;
  }
  return regras.find(r => r.condicoes.some(c => c.operador === 'qualquer'))?.resultado || null;
}

function extrairHorario(texto) {
  const txt = texto.toLowerCase();
  const padroes = [
    /(\d{1,2})[h:](\d{2})/,
    /(\d{1,2})\s*h(?:s|oras?)?/,
    /(\d{1,2})\s*:\s*(\d{2})/,
    /(\d{1,2})\s*da\s*(manha|tarde|noite)/,
  ];
  let hora = null, minuto = 0;
  for (const p of padroes) {
    const m = txt.match(p);
    if (m) {
      hora = parseInt(m[1]);
      if (m[2] && !isNaN(parseInt(m[2]))) minuto = parseInt(m[2]);
      if (m[2] === 'tarde' && hora < 12) hora += 12;
      if (m[2] === 'noite' && hora < 12) hora += 12;
      break;
    }
  }
  if (hora === null) return null;
  const hFim = hora + 2;
  const fmt = (h, m) => `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
  return { inicio: fmt(hora, minuto), fim: fmt(hFim, minuto) };
}

async function reengajar(chave, config) {
  const conv = conversas.get(chave);
  if (!conv || !conv.aguardandoResposta) return;
  const etapaConfig = config.fluxos?.[conv.etapa];
  if (!etapaConfig?.reengajamento?.ativo) return;
  const ultima = new Date(conv.ultimaAtividade);
  const agora = new Date();
  const diffMin = (agora - ultima) / 1000 / 60;
  const min = etapaConfig.reengajamento.minutos || 2;
  if (diffMin < min * 0.9) return;

  const msg = etapaConfig.reengajamento.mensagem || etapaConfig.resposta_padrao;
  await enviarWhatsApp(conv.telefone, msg);
  conv.mensagens.push({ tipo: 'bot', mensagem: msg, data: new Date().toISOString(), nome: config.nome_bot || 'Robo' });
  conv.ultima = msg; conv.ultimaAtividade = new Date().toISOString();
  console.log(`[REENGAGE] ${chave}`);
}

function substituirVars(texto, vars) {
  let r = texto;
  for (const [k, v] of Object.entries(vars)) {
    r = r.replace(new RegExp(`{{${k}}}`, 'g'), v || '');
  }
  return r;
}

async function buscarConfiguracao(empresa_id) {
  try {
    const res = await fetch(`${API_CONFIG_URL}/api/config/${empresa_id}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.configuracao;
  } catch (e) {
    console.error('[API] Erro:', e.message);
    return null;
  }
}

async function enviarWhatsApp(numero, texto) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) { console.error('Token nao configurado'); return false; }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'text', text: { body: texto } })
    });
    if (!res.ok) { const e = await res.json(); console.error('Erro API:', e); return false; }
    console.log('Enviado para', numero);
    return true;
  } catch (e) { console.error('Erro enviar:', e.message); return false; }
}

async function enviarTelegram(conv, config, tipo) {
  const cfg = config || (await buscarConfiguracao(conv.empresa_id));
  if (!cfg?.notificacoes?.telegram?.ativo) return;
  const t = cfg.notificacoes.telegram;
  if (!t.token || !t.chat_id) return;

  let msg = '';
  if (tipo === 'intervencao') {
    msg = `🚨 INTERVENCAO HUMANA\n\nEmpresa: ${cfg.nome_empresa}\nNumero: ${conv.telefone}\nNome: ${conv.nome}\nEtapa: ${conv.etapa}`;
  } else if (tipo === 'visita') {
    msg = `✅ NOVA VISITA\n\nEmpresa: ${cfg.nome_empresa}\nNumero: ${conv.telefone}\nNome: ${conv.nome}\nEndereco: ${conv.dadosColetados.endereco || 'N/A'}\nBairro: ${conv.dadosColetados.bairro || 'N/A'}\nHorario: ${conv.dadosColetados.horarioInicio || 'N/A'} - ${conv.dadosColetados.horarioFim || 'N/A'}\nValor: R$${conv.dadosColetados.valor_visita || 'N/A'}`;
  }

  try {
    await fetch(`https://api.telegram.org/bot${t.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: t.chat_id, text: msg, parse_mode: 'HTML' })
    });
  } catch (e) { console.error('[TELEGRAM] Erro:', e.message); }
}
