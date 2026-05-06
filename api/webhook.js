// ============================================
// WEBHOOK WHATSAPP - RC REFORMA E CONSTRUCAO
// v2.0 - COM PAINEL DE TREINAMENTO + PERSISTÊNCIA
// ============================================

import { createClient } from '@supabase/supabase-js';

// CONFIGURAÇÃO
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = 'roboatendente';

// SUPABASE (service_role = acesso total ao servidor)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CACHE EM MEMÓRIA (performance + fallback)
const cacheInstrucoes = {
  dados: null,
  atualizadoEm: 0,
  TTL: 30000 // 30 segundos
};

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
    console.log(`[WEBHOOK] ${req.method} action=${action}`);

    // ===== 1. VERIFICAÇÃO DO WEBHOOK (Meta) =====
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }

    // ===== 2. ROTAS DO PAINEL DE INTERVENÇÃO =====

    // LISTAR CONVERSAS
    if (action === 'list') {
      const { data, error } = await supabase
        .from('conversas')
        .select('*')
        .order('ultima_atividade', { ascending: false });

      if (error) throw error;

      // Converter mensagens de JSONB para array normal
      const lista = (data || []).map(c => ({
        telefone: c.telefone,
        nome: c.nome,
        mensagens: c.mensagens || [],
        emIntervencao: c.em_intervencao,
        etapa: c.etapa,
        ultimaAtividade: c.ultima_atividade,
        ultima: c.ultima
      }));

      return res.status(200).json({ conversas: lista });
    }

    // BUSCAR MENSAGENS DE UMA CONVERSA
    if (action === 'messages') {
      const phone = req.query.phone;
      const { data, error } = await supabase
        .from('conversas')
        .select('*')
        .eq('telefone', phone)
        .single();

      if (error || !data) {
        return res.status(404).json({ erro: 'Conversa nao encontrada' });
      }

      return res.status(200).json({
        mensagens: data.mensagens || [],
        emIntervencao: data.em_intervencao,
        telefone: data.telefone,
        nome: data.nome
      });
    }

    // ASSUMIR CONTROLE (intervenção humana)
    if (action === 'intervene' && req.method === 'POST') {
      const { phone } = req.body;

      const { data: existente } = await supabase
        .from('conversas')
        .select('*')
        .eq('telefone', phone)
        .single();

      if (!existente) {
        await supabase.from('conversas').insert({
          telefone: phone,
          nome: 'Cliente',
          mensagens: [{
            tipo: 'system',
            mensagem: '⚡ Humano assumiu o controle',
            data: new Date().toISOString(),
            nome: 'Sistema'
          }],
          em_intervencao: true,
          etapa: 'intervencao',
          ultima_atividade: new Date().toISOString(),
          ultima: 'Intervencao iniciada'
        });
      } else {
        const msgs = [...(existente.mensagens || []), {
          tipo: 'system',
          mensagem: '⚡ Humano assumiu o controle',
          data: new Date().toISOString(),
          nome: 'Sistema'
        }];

        await supabase.from('conversas').update({
          em_intervencao: true,
          mensagens: msgs,
          ultima_atividade: new Date().toISOString()
        }).eq('telefone', phone);
      }

      return res.status(200).json({ ok: true, emIntervencao: true, telefone: phone });
    }

    // LIBERAR ROBO
    if (action === 'release' && req.method === 'POST') {
      const { phone } = req.body;

      const { data: existente } = await supabase
        .from('conversas')
        .select('mensagens')
        .eq('telefone', phone)
        .single();

      if (existente) {
        const msgs = [...(existente.mensagens || []), {
          tipo: 'system',
          mensagem: '🤖 Robo retomou o atendimento',
          data: new Date().toISOString(),
          nome: 'Sistema'
        }];

        await supabase.from('conversas').update({
          em_intervencao: false,
          mensagens: msgs,
          ultima_atividade: new Date().toISOString()
        }).eq('telefone', phone);
      }

      return res.status(200).json({ ok: true, emIntervencao: false });
    }

    // ENVIAR MENSAGEM MANUAL (humano)
    if (action === 'send' && req.method === 'POST') {
      const { phone, message } = req.body;

      const { data: conv } = await supabase
        .from('conversas')
        .select('*')
        .eq('telefone', phone)
        .single();

      if (!conv || !conv.em_intervencao) {
        return res.status(403).json({
          ok: false,
          erro: 'Nao esta em intervencao',
          emIntervencao: conv?.em_intervencao || false
        });
      }

      const enviado = await enviarWhatsApp(phone, message);

      if (enviado) {
        const msgs = [...conv.mensagens, {
          tipo: 'humano',
          mensagem: message,
          data: new Date().toISOString(),
          nome: 'Atendente'
        }];

        await supabase.from('conversas').update({
          mensagens: msgs,
          ultima: message,
          ultima_atividade: new Date().toISOString()
        }).eq('telefone', phone);
      }

      return res.status(200).json({ ok: enviado });
    }

    // ===== 3. ROTAS DO PAINEL DE TREINAMENTO =====

    // LISTAR INSTRUÇÕES
    if (action === 'training-list') {
      const { data, error } = await supabase
        .from('instrucoes_robo')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (error) throw error;
      return res.status(200).json({ instrucoes: data || [] });
    }

    // CRIAR NOVA INSTRUÇÃO
    if (action === 'training-create' && req.method === 'POST') {
      const { palavras_chave, resposta, descricao, ordem } = req.body;

      const { data, error } = await supabase
        .from('instrucoes_robo')
        .insert({
          palavras_chave: Array.isArray(palavras_chave)
            ? palavras_chave
            : palavras_chave.split(',').map(p => p.trim().toLowerCase()),
          resposta,
          descricao: descricao || '',
          ordem: ordem || 0,
          ativo: true
        })
        .select()
        .single();

      if (error) throw error;

      // Invalida cache
      cacheInstrucoes.dados = null;

      return res.status(200).json({ ok: true, instrucao: data });
    }

    // ATUALIZAR INSTRUÇÃO
    if (action === 'training-update' && req.method === 'PUT') {
      const { id, palavras_chave, resposta, descricao, ordem, ativo } = req.body;

      const updateData = {};
      if (palavras_chave !== undefined) {
        updateData.palavras_chave = Array.isArray(palavras_chave)
          ? palavras_chave
          : palavras_chave.split(',').map(p => p.trim().toLowerCase());
      }
      if (resposta !== undefined) updateData.resposta = resposta;
      if (descricao !== undefined) updateData.descricao = descricao;
      if (ordem !== undefined) updateData.ordem = ordem;
      if (ativo !== undefined) updateData.ativo = ativo;

      const { data, error } = await supabase
        .from('instrucoes_robo')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      cacheInstrucoes.dados = null;

      return res.status(200).json({ ok: true, instrucao: data });
    }

    // DELETAR INSTRUÇÃO
    if (action === 'training-delete' && req.method === 'DELETE') {
      const { id } = req.query;
      const { error } = await supabase
        .from('instrucoes_robo')
        .delete()
        .eq('id', id);

      if (error) throw error;

      cacheInstrucoes.dados = null;

      return res.status(200).json({ ok: true });
    }

    // ATUALIZAR FALLBACK
    if (action === 'training-fallback' && req.method === 'PUT') {
      const { resposta } = req.body;

      const { error } = await supabase
        .from('config_robo')
        .update({ valor: resposta })
        .eq('chave', 'fallback');

      if (error) throw error;

      cacheInstrucoes.dados = null;

      return res.status(200).json({ ok: true });
    }

    // PEGAR FALLBACK
    if (action === 'training-fallback' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('config_robo')
        .select('valor')
        .eq('chave', 'fallback')
        .single();

      if (error) throw error;

      return res.status(200).json({ fallback: data?.valor || '' });
    }

    // ===== 4. RECEBER MENSAGEM DO WHATSAPP =====
    if (req.method === 'POST' && !action) {
      res.status(200).send('OK');

      processarMensagem(req.body).catch(err => {
        console.error('Erro ao processar:', err);
      });

      return;
    }

    res.status(200).send('Webhook RC Reforma v2.0 - OK');

  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    res.status(200).send('OK');
  }
}

// ============================================
// PROCESSAR MENSAGEM RECEBIDA
// ============================================

async function processarMensagem(body) {
  if (!body || body.object !== 'whatsapp_business_account') return;

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  if (!changes) return;
  if (changes.statuses) return;

  const msg = changes.messages?.[0];
  if (!msg) return;

  const telefone = msg.from;
  const nome = changes.contacts?.[0]?.profile?.name || 'Cliente';

  if (msg.type !== 'text') return;

  const texto = msg.text.body;

  // Buscar ou criar conversa no Supabase
  const { data: convExistente } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', telefone)
    .single();

  let conv;
  if (!convExistente) {
    const novaConv = {
      telefone: telefone,
      nome: nome,
      mensagens: [],
      em_intervencao: false,
      etapa: 'novo',
      ultima_atividade: new Date().toISOString(),
      ultima: ''
    };

    await supabase.from('conversas').insert(novaConv);
    conv = novaConv;
  } else {
    conv = {
      telefone: convExistente.telefone,
      nome: convExistente.nome,
      mensagens: convExistente.mensagens || [],
      em_intervencao: convExistente.em_intervencao,
      etapa: convExistente.etapa,
      ultima_atividade: convExistente.ultima_atividade,
      ultima: convExistente.ultima
    };
  }

  // Adicionar mensagem do cliente
  const msgsCliente = [...conv.mensagens, {
    tipo: 'cliente',
    mensagem: texto,
    data: new Date().toISOString(),
    nome: nome
  }];

  await supabase.from('conversas').update({
    mensagens: msgsCliente,
    ultima: texto,
    ultima_atividade: new Date().toISOString()
  }).eq('telefone', telefone);

  console.log(`[RECEBIDO] ${telefone} (${nome}): ${texto.substring(0, 50)}`);
  console.log(`[ESTADO] emIntervencao=${conv.em_intervencao}`);

  // SE NÃO ESTIVER EM INTERVENÇÃO, RESPONDE AUTOMATICAMENTE
  if (!conv.em_intervencao) {
    const resposta = await gerarRespostaDinamica(texto.toLowerCase(), nome);

    const enviado = await enviarWhatsApp(telefone, resposta);

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

      console.log(`[BOT] Resposta automatica enviada`);
    }
  } else {
    console.log(`[BOT] BLOQUEADO - conversa em intervencao humana`);
  }
}

// ============================================
// GERAR RESPOSTA DINÂMICA (do banco!)
// ============================================

async function gerarRespostaDinamica(texto, nome) {
  // Busca instruções com cache
  let instrucoes = cacheInstrucoes.dados;
  const agora = Date.now();

  if (!instrucoes || (agora - cacheInstrucoes.atualizadoEm) > cacheInstrucoes.TTL) {
    const { data, error } = await supabase
      .from('instrucoes_robo')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true });

    if (error) {
      console.error('Erro ao buscar instrucoes:', error);
      return `Ola, ${nome}! Como posso ajudar?`;
    }

    instrucoes = data || [];
    cacheInstrucoes.dados = instrucoes;
    cacheInstrucoes.atualizadoEm = agora;
    console.log(`[CACHE] ${instrucoes.length} instrucoes carregadas`);
  }

  // Procura palavra-chave no texto
  for (const inst of instrucoes) {
    const palavras = inst.palavras_chave || [];
    const encontrou = palavras.some(palavra => texto.includes(palavra.toLowerCase()));

    if (encontrou) {
      // Substitui {nome} pelo nome do cliente
      return inst.resposta.replace(/{nome}/g, nome);
    }
  }

  // Fallback: busca do banco
  const { data: fallbackData } = await supabase
    .from('config_robo')
    .select('valor')
    .eq('chave', 'fallback')
    .single();

  const fallback = fallbackData?.valor ||
    `Entendi, ${nome}!

Para agilizar seu atendimento, me diga:
1. Qual servico precisa?
2. Qual bairro do Rio?

Ou pergunte sobre precos, horarios ou servicos disponiveis.`;

  return fallback.replace(/{nome}/g, nome);
}

// ============================================
// ENVIAR MENSAGEM PELO WHATSAPP
// ============================================

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

    console.log('Mensagem enviada para', numero);
    return true;

  } catch (e) {
    console.error('Erro ao enviar WhatsApp:', e.message);
    return false;
  }
}
