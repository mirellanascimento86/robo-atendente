// ============================================
// RC ATENDIMENTO - ROBÔ IMPECÁVEL v2.0
// PONTE DE COMUNICAÇÃO CLIENTE ↔ PROFISSIONAL
// ============================================

import { createClient } from '@supabase/supabase-js';

// ============ CONFIGURAÇÕES ============
const CONFIG = {
  // SUPABASE - SUBSTITUA COM SEUS DADOS
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_KEY: 'sua-chave-anon-aqui',
  
  // TELEGRAM
  TELEGRAM_TOKEN: '8517608136:AAFJmE04CPd7DecwKVh_MzGA6bnGGmbT3zI',
  TELEGRAM_CHAT_ID: '-5246111585',
  
  // NÚMERO DO ROBÔ
  NUMERO_ROBO: '5521997653578',
  
  // PROFISSIONAIS - ADICIONE OS SEUS AQUI
  PROFISSIONAIS: [
    {
      id: 'joao',
      nome: 'João Silva',
      telefone: '5521987654321',
      servicos: ['Hidráulica', 'Elétrica', 'Encanamento'],
      agenda: {}, // Será populado do banco
      horariosPadrao: ['09:00', '11:00', '14:00', '16:00']
    },
    {
      id: 'pedro',
      nome: 'Pedro Santos',
      telefone: '5521976543210',
      servicos: ['Reforma', 'Construção', 'Gesso', 'Drywall'],
      agenda: {},
      horariosPadrao: ['08:00', '10:00', '13:00', '15:00']
    },
    {
      id: 'maria',
      nome: 'Maria Oliveira',
      telefone: '5521965432109',
      servicos: ['Pintura', 'Gesso', 'Textura'],
      agenda: {},
      horariosPadrao: ['09:30', '11:30', '14:30', '16:30']
    }
  ],
  
  // PREÇOS
  precos: {
    zonaSul: 180,
    outros: 220,
    descontoZonaSul: 90 // 50% off
  },
  
  bairrosZonaSul: [
    'ipanema', 'leblon', 'copacabana', 'botafogo', 'flamengo', 
    'lagoa', 'gavea', 'jardim botanico', 'humaita', 'urca', 
    'catete', 'gloria', 'laranjeiras', 'cosme velho', 'leme', 
    'sao conrado', 'vidigal', 'rocinha'
  ]
};

// Inicializar Supabase
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// Estado em memória (rápido) + persistência no banco
const sessoes = new Map();
const conversasHumanas = new Set(); // Quem está com atendente humano
const ponteComunicacao = new Map(); // numProfissional -> numCliente

// ============ UTILITÁRIOS ============

function normalizarTexto(texto) {
  return texto.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatarTelefone(num) {
  return num.replace(/\D/g, '').replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4');
}

// ============ NOTIFICAÇÕES TELEGRAM ============

async function notificarTelegram(mensagem, tipo = 'info') {
  const icones = {
    info: 'ℹ️',
    sucesso: '✅',
    alerta: '⚠️',
    urgente: '🚨',
    dinheiro: '💰',
    novo: '🆕',
    ponte: '🌉'
  };
  
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: `${icones[tipo] || 'ℹ️'} ${mensagem}`,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Erro Telegram:', e);
  }
}

// ============ BANCO DE DADOS ============

async function salvarMensagem(numero, mensagem, tipo, metadata = {}) {
  try {
    await supabase.from('mensagens').insert({
      numero,
      mensagem,
      tipo, // 'cliente', 'profissional', 'robo', 'humano'
      metadata,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Erro salvar mensagem:', e);
  }
}

async function atualizarConversa(numero, dados) {
  try {
    await supabase.from('conversas').upsert({
      numero,
      ...dados,
      updated_at: new Date().toISOString()
    }, { onConflict: 'numero' });
  } catch (e) {
    console.error('Erro atualizar conversa:', e);
  }
}

async function carregarAgendaProfissional(profissionalId) {
  const hoje = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('agenda')
    .select('*')
    .eq('profissional_id', profissionalId)
    .gte('data', hoje);
  
  return data || [];
}

async function bloquearHorario(profissionalId, data, horario, clienteNumero) {
  try {
    await supabase.from('agenda').insert({
      profissional_id: profissionalId,
      data,
      horario,
      cliente_numero: clienteNumero,
      status: 'ocupado',
      created_at: new Date().toISOString()
    });
    return true;
  } catch (e) {
    console.error('Erro ao bloquear horário:', e);
    return false;
  }
}

// ============ INTELIGÊNCIA DO ROBÔ ============

function detectarIntencao(texto) {
  const t = normalizarTexto(texto);
  
  // Saudações
  if (/^(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|eae|hey|opa|tudo bem|tudo bom|como vai)/.test(t)) {
    return 'saudacao';
  }
  
  // Serviços específicos
  const servicos = {
    hidraulica: /hidraulica|encanamento|cano|vazamento|agua|esgoto|pia|vaso|chuveiro|torneira|ralo|descarga/,
    eletrica: /eletrica|luz|tomada|disjuntor|fio|curto|energia|chuveiro eletrico|ventilador/,
    pintura: /pintura|pintar|tinta|parede|latex|massa corrida|verniz/,
    reforma: /reforma|reformar|construcao|construir|obra|casa|apartamento|reparo|conserto/,
    gesso: /gesso|sanca|forro|drywall|divisoria|rebaixo/,
    marcenaria: /marcenaria|marceneiro|armario|moveis|movel|porta|janela|madeira/,
    azulejo: /azulejo|piso|ceramica|revestimento|banheiro|cozinha/,
    pedreiro: /pedreiro|alvenaria|tijolo|cimento|concreto/fundação/
  };
  
  for (const [servico, regex] of Object.entries(servicos)) {
    if (regex.test(t)) return `servico_${servico}`;
  }
  
  // Bairro
  if (/(moro|fica|sou de|endereco|bairro|rua|av |avenida|apartamento|casa)/.test(t)) {
    return 'bairro';
  }
  
  // Urgência
  if (/(hoje|agora|urgente|emergencia|preciso ja|muito urgente|vazando|quebrou|inundando)/.test(t)) {
    return 'urgencia';
  }
  
  // Confirmação
  if (/^(sim|s|yes|ok|beleza|pode ser|tudo bem|combinado|fechado|show|top|perfeito|claro|pode|va em frente)/.test(t)) {
    return 'confirmacao';
  }
  
  // Negação
  if (/^(nao|não|n|no|nope|depois|outro dia|outro horario|nao posso|não posso|ocupado|nao quero)/.test(t)) {
    return 'negacao';
  }
  
  // Preço
  if (/(preco|preço|valor|custo|quanto custa|quanto fica|orcamento|barato|caro|dinheiro|pagar|taxa)/.test(t)) {
    return 'preco';
  }
  
  // Intervenção humana
  if (/(atendente|humano|pessoa|gerente|chefe|proprietario|dono|reclamacao|problema|nao entendi|não entendi|dificil|complicado|errado|erro)/.test(t)) {
    return 'intervencao';
  }
  
  // Despedida
  if (/(tchau|ate logo|obrigado|obrigada|valeu|flw|adeus)/.test(t)) {
    return 'despedida';
  }
  
  // Pergunta sobre visita
  if (/(visita tecnica|visita|agendamento|marcar|horario|data|disponibilidade)/.test(t)) {
    return 'agendamento';
  }
  
  return 'generico';
}

function extrairServico(texto) {
  const t = normalizarTexto(texto);
  const servicos = ['hidraulica', 'eletrica', 'pintura', 'reforma', 'gesso', 'marcenaria', 'azulejo', 'pedreiro'];
  
  for (const s of servicos) {
    if (t.includes(s)) return s;
  }
  return null;
}

function extrairBairro(texto) {
  const t = normalizarTexto(texto);
  
  // Bairros específicos
  const bairros = [...CONFIG.bairrosZonaSul, 'tijuca', 'madureira', 'meier', 'barra', 'recreio', 
    'jacarepagua', 'centro', 'lapa', 'santa teresa', 'vila isabel', 'graçatiba'];
  
  for (const b of bairros) {
    if (t.includes(b)) return b;
  }
  
  // Tentar extrair após "bairro", "em", "na"
  const match = texto.match(/(?:bairro|em|na|no)\s+([A-Za-zÀ-ÖØ-öø-ÿ\s]+)/i);
  if (match) {
    return match[1].trim().split(/[,\.]/)[0];
  }
  
  return null;
}

function calcularPreco(bairro) {
  const bairroNormalizado = normalizarTexto(bairro);
  const isZonaSul = CONFIG.bairrosZonaSul.some(b => bairroNormalizado.includes(b));
  
  return {
    valor: isZonaSul ? CONFIG.precos.zonaSul : CONFIG.precos.outros,
    desconto: isZonaSul ? CONFIG.precos.descontoZonaSul : null,
    isZonaSul
  };
}

// ============ FLUXO DE ATENDIMENTO ============

async function processarMensagem(numero, mensagem, isProfissional = false) {
  // Verificar se está em intervenção humana
  if (!isProfissional && conversasHumanas.has(numero)) {
    await salvarMensagem(numero, mensagem, 'cliente');
    // Notificar painel via broadcast (implementar no painel-data.js)
    return { acao: 'intervencao', mensagem: 'Atendente humano no controle' };
  }
  
  // Carregar ou criar sessão
  let sessao = sessoes.get(numero);
  if (!sessao) {
    const { data } = await supabase.from('conversas').select('*').eq('numero', numero).single();
    sessao = data || {
      numero,
      etapa: 'inicio',
      dados: {},
      historico: []
    };
  }
  
  const intencao = detectarIntencao(mensagem);
  
  // Salvar mensagem
  await salvarMensagem(numero, mensagem, isProfissional ? 'profissional' : 'cliente');
  sessao.historico.push({ tipo: 'recebida', conteudo: mensagem, hora: new Date() });
  
  // Se for profissional, processar como ponte de comunicação
  if (isProfissional) {
    return await processarProfissional(numero, mensagem, sessao);
  }
  
  // Fluxo do cliente
  let resposta = null;
  let novaEtapa = sessao.etapa;
  
  switch (sessao.etapa) {
    case 'inicio':
      if (intencao === 'saudacao' || intencao.startsWith('servico_') || intencao === 'bairro') {
        resposta = `Olá! Sou o assistente virtual da RC Reformas. 🏠\n\nVou te ajudar a agendar uma visita técnica. É rápido!\n\nPara começar, me informe:\n1️⃣ Qual serviço você precisa?\n2️⃣ Qual bairro você está?`;
        novaEtapa = 'coletando_servico_bairro';
      } else {
        resposta = `Olá! Bem-vindo à RC Reformas. Sou o assistente virtual e vou te ajudar.\n\nQual serviço você precisa e em qual bairro? (Ex: "Preciso de pintura em Ipanema")`;
        novaEtapa = 'coletando_servico_bairro';
      }
      break;
      
    case 'coletando_servico_bairro':
      const servico = extrairServico(mensagem);
      const bairro = extrairBairro(mensagem);
      
      if (servico) sessao.dados.servico = servico;
      if (bairro) sessao.dados.bairro = bairro;
      
      if (sessao.dados.servico && sessao.dados.bairro) {
        const preco = calcularPreco(sessao.dados.bairro);
        sessao.dados.preco = preco;
        
        // Encontrar profissional
        const profissional = CONFIG.PROFISSIONAIS.find(p => 
          p.servicos.some(s => normalizarTexto(s).includes(sessao.dados.servico))
        );
        
        if (!profissional) {
          resposta = `No momento não temos profissional disponível para ${sessao.dados.servico} nessa região. Vou transferir para um atendente humano.`;
          novaEtapa = 'intervencao';
          await notificarTelegram(`🚨 Sem profissional para ${sessao.dados.servico} em ${sessao.dados.bairro}`, 'urgente');
        } else {
          sessao.dados.profissional = profissional;
          
          let msgPreco = `Perfeito! Encontrei o técnico ideal: *${profissional.nome}* 👨‍🔧\n\n`;
          msgPreco += `Para enviar um orçamento preciso, precisamos de uma visita técnica.\n\n`;
          
          if (preco.isZonaSul) {
            msgPreco += `💰 Valor da visita: R$${preco.valor}\n`;
            msgPreco += `🎉 *Oferta especial*: 50% de desconto = R$${preco.desconto}!\n`;
          } else {
            msgPreco += `💰 Valor da visita: R$${preco.valor}\n`;
          }
          
          msgPreco += `\n✅ Esse valor é *abatido do total* se aprovar o orçamento\n`;
          msgPreco += `\nGostaria de agendar? (Sim/Não)`;
          
          resposta = msgPreco;
          novaEtapa = 'confirmando_visita';
        }
      } else if (sessao.dados.servico) {
        resposta = `Certo, serviço: *${sessao.dados.servico}* ✅\n\nAgora me informe o bairro:`;
      } else if (sessao.dados.bairro) {
        resposta = `Bairro: *${sessao.dados.bairro}* ✅\n\nQual serviço você precisa?`;
      } else {
        resposta = `Preciso saber:\n• Qual serviço?\n• Qual bairro?\n\nPode me informar ambos?`;
      }
      break;
      
    case 'confirmando_visita':
      if (intencao === 'confirmacao' || intencao === 'urgencia') {
        // Verificar agenda do profissional
        const agenda = await carregarAgendaProfissional(sessao.dados.profissional.id);
        const hoje = new Date().toLocaleDateString('pt-BR');
        const amanha = new Date(Date.now() + 86400000).toLocaleDateString('pt-BR');
        
        // Filtrar horários disponíveis
        const horariosOcupados = agenda
          .filter(a => a.data === hoje)
          .map(a => a.horario);
        
        const horariosLivres = sessao.dados.profissional.horariosPadrao
          .filter(h => !horariosOcupados.includes(h));
        
        if (horariosLivres.length === 0) {
          resposta = `O técnico está com agenda cheia para hoje. Posso verificar para amanhã (${amanha}) ou outro dia. Qual prefere?`;
          novaEtapa = 'escolhendo_data';
        } else {
          sessao.dados.data = hoje;
          let msg = `🕐 *Horários disponíveis para HOJE:*\n\n`;
          horariosLivres.forEach((h, i) => {
            msg += `${i + 1}️⃣ ${h}\n`;
          });
          msg += `\nQual horário prefere? (Digite o número)`;
          
          sessao.dados.horariosDisponiveis = horariosLivres;
          resposta = msg;
          novaEtapa = 'escolhendo_horario';
        }
      } else if (intencao === 'negacao') {
        resposta = `Entendo. Posso oferecer um orçamento aproximado por foto/vídeo, mas a visita técnica garante precisão total.\n\nQuando mudar de ideia, é só chamar! 👋`;
        novaEtapa = 'finalizado';
      } else if (intencao === 'preco') {
        resposta = `O valor cobre o deslocamento do profissional qualificado e a análise técnica detalhada. Se aprovar o orçamento, a visita sai de graça (valor abatido).\n\nPosso agendar?`;
      } else {
        resposta = `Gostaria de agendar a visita técnica? Responda *Sim* para ver horários ou *Não* se preferir orçamento online.`;
      }
      break;
      
    case 'escolhendo_data':
      if (mensagem.toLowerCase().includes('hoje')) {
        // Tentar hoje de novo
        const agenda = await carregarAgendaProfissional(sessao.dados.profissional.id);
        const hoje = new Date().toLocaleDateString('pt-BR');
        const horariosOcupados = agenda.filter(a => a.data === hoje).map(a => a.horario);
        const horariosLivres = sessao.dados.profissional.horariosPadrao.filter(h => !horariosOcupados.includes(h));
        
        if (horariosLivres.length > 0) {
          sessao.dados.data = hoje;
          let msg = `✅ Consegui um horário para hoje!\n\n`;
          horariosLivres.forEach((h, i) => msg += `${i + 1}️⃣ ${h}\n`);
          msg += `\nQual prefere?`;
          
          sessao.dados.horariosDisponiveis = horariosLivres;
          resposta = msg;
          novaEtapa = 'escolhendo_horario';
        } else {
          resposta = `Infelizmente hoje está realmente lotado. Amanhã tem mais disponibilidade. Pode ser?`;
        }
      } else if (mensagem.toLowerCase().includes('amanha') || mensagem.toLowerCase().includes('amanhã')) {
        const amanha = new Date(Date.now() + 86400000).toLocaleDateString('pt-BR');
        sessao.dados.data = amanha;
        
        let msg = `📅 *Amanhã (${amanha})* temos estes horários:\n\n`;
        sessao.dados.profissional.horariosPadrao.forEach((h, i) => {
          msg += `${i + 1}️⃣ ${h}\n`;
        });
        msg += `\nQual prefere?`;
        
        sessao.dados.horariosDisponiveis = sessao.dados.profissional.horariosPadrao;
        resposta = msg;
        novaEtapa = 'escolhendo_horario';
      } else {
        // Data específica
        const dataMatch = mensagem.match(/(\d{1,2})[\/\-.](\d{1,2})/);
        if (dataMatch) {
          const data = `${dataMatch[1].padStart(2, '0')}/${dataMatch[2].padStart(2, '0')}/2025`;
          sessao.dados.data = data;
          
          let msg = `📅 *${data}* anotado!\n\nHorários disponíveis:\n`;
          sessao.dados.profissional.horariosPadrao.forEach((h, i) => {
            msg += `${i + 1}️⃣ ${h}\n`;
          });
          msg += `\nQual prefere?`;
          
          sessao.dados.horariosDisponiveis = sessao.dados.profissional.horariosPadrao;
          resposta = msg;
          novaEtapa = 'escolhendo_horario';
        } else {
          resposta = `Para quando gostaria? Posso verificar:\n• Hoje (se houver cancelamento)\n• Amanhã\n• Outra data (digite DD/MM)`;
        }
      }
      break;
      
    case 'escolhendo_horario':
      let horarioEscolhido = null;
      
      // Verificar se digitou número da opção
      const numOpcao = parseInt(mensagem);
      if (numOpcao > 0 && numOpcao <= (sessao.dados.horariosDisponiveis?.length || 0)) {
        horarioEscolhido = sessao.dados.horariosDisponiveis[numOpcao - 1];
      } else {
        // Verificar se digitou horário direto
        const horaMatch = mensagem.match(/(\d{1,2})[:h]?(\d{2})?/);
        if (horaMatch) {
          horarioEscolhido = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2] || '00'}`;
        }
      }
      
      if (horarioEscolhido) {
        // Verificar se horário ainda está livre
        const agenda = await carregarAgendaProfissional(sessao.dados.profissional.id);
        const ocupado = agenda.some(a => a.data === sessao.dados.data && a.horario === horarioEscolhido);
        
        if (ocupado) {
          resposta = `⚠️ Esse horário acabou de ser ocupado! Temos:\n`;
          const livres = sessao.dados.horariosDisponiveis.filter(h => 
            !agenda.some(a => a.data === sessao.dados.data && a.horario === h)
          );
          livres.forEach((h, i) => resposta += `${i + 1}️⃣ ${h}\n`);
          resposta += `\nQual outro prefere?`;
        } else {
          sessao.dados.horario = horarioEscolhido;
          resposta = `⏰ *${horarioEscolhido}* anotado!\n\nAgora preciso do endereço completo para confirmar:\n(Rua, número, complemento, ponto de referência)`;
          novaEtapa = 'coletando_endereco';
        }
      } else {
        resposta = `Qual horário prefere? Digite o número da opção ou o horário direto (ex: 14:00)`;
      }
      break;
      
    case 'coletando_endereco':
      if (mensagem.length > 10 && /(rua|av|avenida|número|numero|ap|apartamento|casa)/i.test(mensagem)) {
        sessao.dados.endereco = mensagem;
        
        // Resumo final
        const d = sessao.dados;
        resposta = `✅ *VISITA CONFIRMADA!*\n\n` +
          `📋 *Resumo:*\n` +
          `👤 Técnico: ${d.profissional.nome}\n` +
          `🔧 Serviço: ${d.servico}\n` +
          `📍 Bairro: ${d.bairro}\n` +
          `📅 Data: ${d.data}\n` +
          `🕐 Horário: ${d.horario}\n` +
          `🏠 Endereço: ${d.endereco}\n` +
          `💰 Valor visita: R$${d.preco.isZonaSul ? d.preco.desconto : d.preco.valor}\n\n` +
          `O técnico confirmará em breve. Qualquer dúvida, estou por aqui! 👋`;
        
        // Bloquear na agenda
        await bloquearHorario(d.profissional.id, d.data, d.horario, numero);
        
        // Notificar profissional
        await notificarProfissional(d, numero);
        
        // Notificar Telegram
        await notificarTelegram(
          `✅ <b>NOVA VISITA</b>\n` +
          `👤 ${formatarTelefone(numero)}\n` +
          `🔧 ${d.servico} | ${d.bairro}\n` +
          `📅 ${d.data} às ${d.horario}\n` +
          `👨‍🔧 ${d.profissional.nome}`,
          'sucesso'
        );
        
        novaEtapa = 'agendado';
      } else {
        resposta = `Preciso do endereço completo para o técnico chegar:\n• Rua e número\n• Apartamento/bloco (se houver)\n• Ponto de referência`;
      }
      break;
      
    case 'agendado':
      if (intencao === 'intervencao') {
        resposta = `Vou transferir você para um atendente humano. Aguarde um momento...`;
        novaEtapa = 'intervencao';
        await notificarTelegram(`🚨 Cliente ${numero} pediu intervenção após agendamento`, 'alerta');
      } else {
        resposta = `Sua visita já está confirmada! Se precisar alterar algo, me avise. 👍`;
      }
      break;
      
    case 'intervencao':
      resposta = null; // Não responde, atendente humano assume
      break;
      
    default:
      resposta = `Olá! Como posso ajudar?`;
      novaEtapa = 'inicio';
  }
  
  // Atualizar sessão
  sessao.etapa = novaEtapa;
  sessoes.set(numero, sessao);
  
  await atualizarConversa(numero, {
    etapa: novaEtapa,
    dados: sessao.dados,
    intervencao: novaEtapa === 'intervencao'
  });
  
  return { resposta, etapa: novaEtapa, dados: sessao.dados };
}

// ============ PONTE DE COMUNICAÇÃO ============

async function processarProfissional(numeroProfissional, mensagem, sessaoCliente) {
  // Identificar qual cliente está vinculado a este profissional
  const numeroCliente = ponteComunicacao.get(numeroProfissional);
  
  if (!numeroCliente) {
    // Profissional iniciou conversa, verificar se é sobre uma visita
    // Buscar visitas pendentes deste profissional
    const { data: visitas } = await supabase
      .from('agenda')
      .select('*')
      .eq('profissional_id', sessaoCliente.dados?.profissional?.id)
      .eq('status', 'agendada')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (visitas && visitas.length > 0) {
      ponteComunicacao.set(numeroProfissional, visitas[0].cliente_numero);
      // Continuar fluxo...
    } else {
      return { 
        resposta: `Olá! Sou o assistente virtual. Para qual visita você está se referindo? Envie o número do cliente ou endereço.`,
        etapa: 'aguardando_contexto'
      };
    }
  }
  
  const t = normalizarTexto(mensagem);
  
  // Confirmação do profissional
  if (/^(ok|confirmado|confirmo|vou|chegarei|estou indo|beleza|combinado)/.test(t)) {
    // Notificar cliente
    await enviarWhatsApp(numeroCliente, 
      `✅ *${sessaoCliente.dados.profissional.nome} confirmou a visita!*\n` +
      `Está tudo certo para ${sessaoCliente.dados.data} às ${sessaoCliente.dados.horario}.`
    );
    
    await supabase.from('agenda')
      .update({ status: 'confirmada' })
      .eq('cliente_numero', numeroCliente)
      .eq('data', sessaoCliente.dados.data);
    
    await notificarTelegram(
      `✅ Profissional confirmou visita\n` +
      `Cliente: ${numeroCliente}\n` +
      `Data: ${sessaoCliente.dados.data} ${sessaoCliente.dados.horario}`,
      'sucesso'
    );
    
    return { resposta: 'Perfeito! Confirmado. Qualquer imprevisto, me avise.', etapa: 'confirmado' };
  }
  
  // Cancelamento/recusa
  if (/^(nao posso|não posso|cancelar|desmarcar|impedido|outro dia)/.test(t)) {
    await enviarWhatsApp(numeroCliente,
      `⚠️ *Atenção:* O técnico ${sessaoCliente.dados.profissional.nome} teve um imprevisto.\n` +
      `Vou verificar outro horário para você. Um momento...`
    );
    
    // Liberar horário
    await supabase.from('agenda')
      .update({ status: 'cancelada' })
      .eq('cliente_numero', numeroCliente)
      .eq('data', sessaoCliente.dados.data);
    
    await notificarTelegram(
      `⚠️ Profissional CANCELOU visita\n` +
      `Cliente: ${numeroCliente}\n` +
      `Motivo: ${mensagem}`,
      'alerta'
    );
    
    // Tentar remarcar automaticamente
    return await tentarRemarcar(numeroCliente, sessaoCliente);
  }
  
  // Pergunta ao cliente (ponte)
  if (/(estacionamento|portaria|elevador|predio|prédio|andar|bloco|numero|número|ap|casa|referencia)/.test(t)) {
    // Enviar pergunta ao cliente
    await enviarWhatsApp(numeroCliente,
      `📢 *Pergunta do técnico ${sessaoCliente.dados.profissional.nome}:*\n` +
      `"${mensagem}"\n\n` +
      `Poderia responder?`
    );
    
    // Marcar que estamos aguardando resposta do cliente
    sessaoCliente.etapa = 'aguardando_resposta_cliente';
    sessaoCliente.dados.perguntaPendente = mensagem;
    sessoes.set(numeroCliente, sessaoCliente);
    
    await notificarTelegram(
      `🌉 <b>PONTE:</b> Profissional pergunta\n` +
      `"${mensagem}"\n` +
      `Cliente: ${numeroCliente}`,
      'ponte'
    );
    
    return { 
      resposta: `Pergunta enviada ao cliente. Assim que responder, te passo a resposta.`,
      etapa: 'aguardando_cliente'
    };
  }
  
  // Resposta genérica - repassar contexto
  return {
    resposta: `Entendido. Vou repassar ao cliente se necessário. Precisa de mais alguma informação?`,
    etapa: 'aguardando'
  };
}

async function tentarRemarcar(numeroCliente, sessao) {
  const profissional = sessao.dados.profissional;
  const agenda = await carregarAgendaProfissional(profissional.id);
  
  // Buscar próximo horário livre
  const datas = ['hoje', 'amanha', 'depois'];
  let horarioEncontrado = null;
  let dataEncontrada = null;
  
  for (const dataRef of datas) {
    let dataStr;
    if (dataRef === 'hoje') dataStr = new Date().toLocaleDateString('pt-BR');
    else if (dataRef === 'amanha') dataStr = new Date(Date.now() + 86400000).toLocaleDateString('pt-BR');
    else dataStr = new Date(Date.now() + 172800000).toLocaleDateString('pt-BR');
    
    const ocupados = agenda.filter(a => a.data === dataStr).map(a => a.horario);
    const livres = profissional.horariosPadrao.filter(h => !ocupados.includes(h));
    
    if (livres.length > 0) {
      dataEncontrada = dataStr;
      horarioEncontrado = livres[0];
      break;
    }
  }
  
  if (horarioEncontrado) {
    await enviarWhatsApp(numeroCliente,
      `✅ *Novo horário encontrado!*\n` +
      `📅 ${dataEncontrada} às ${horarioEncontrado}\n` +
      `👨‍🔧 Mesmo técnico: ${profissional.nome}\n\n` +
      `Confirma? (Sim/Não)`
    );
    
    sessao.dados.data = dataEncontrada;
    sessao.dados.horario = horarioEncontrado;
    sessao.etapa = 'confirmando_reagendamento';
    sessoes.set(numeroCliente, sessao);
    
    return {
      resposta: `Encontrei: ${dataEncontrada} às ${horarioEncontrado}. Aguardando confirmação do cliente.`,
      etapa: 'aguardando_confirmacao'
    };
  } else {
    await enviarWhatsApp(numeroCliente,
      `⚠️ *Agenda lotada*\n` +
      `Não encontrei horários disponíveis nos próximos dias.\n` +
      `Um atendente humano entrará em contato para encontrar a melhor solução.`
    );
    
    await notificarTelegram(
      `🚨 Sem horários para remarcar\n` +
      `Cliente: ${numeroCliente}\n` +
      `Profissional: ${profissional.nome}`,
      'urgente'
    );
    
    return {
      resposta: `Não encontrei horários livres. Vou solicitar intervenção humana.`,
      etapa: 'intervencao_necessaria'
    };
  }
}

// ============ WHATSAPP API ============

async function enviarWhatsApp(numero, mensagem) {
  // Implementar conforme sua API atual (Meta/WhatsApp Business)
  // Esta é uma simulação - adapte para sua API real
  
  console.log(`📤 ENVIANDO para ${numero}: ${mensagem.substring(0, 50)}...`);
  
  // Se estiver usando API oficial do Meta:
  /*
  await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: numero,
      type: 'text',
      text: { body: mensagem }
    })
  });
  */
  
  // Salvar no banco
  await salvarMensagem(numero, mensagem, 'robo');
  
  return true;
}

async function notificarProfissional(dados, numeroCliente) {
  const msg = `🔔 *NOVA VISITA AGENDADA*\n\n` +
    `📅 ${dados.data} às ${dados.horario}\n` +
    `📍 ${dados.bairro}\n` +
    `🏠 ${dados.endereco}\n` +
    `🔧 ${dados.servico}\n` +
    `👤 Cliente: ${formatarTelefone(numeroCliente)}\n\n` +
    `Responda *OK* para confirmar ou envie sua dúvida (ex: "Tem estacionamento?")`;
  
  await enviarWhatsApp(dados.profissional.telefone, msg);
  
  // Estabelecer ponte de comunicação
  ponteComunicacao.set(dados.profissional.telefone, numeroCliente);
  
  // Agendar lembrete em 10 minutos se não confirmar
  setTimeout(async () => {
    const { data } = await supabase
      .from('agenda')
      .select('status')
      .eq('cliente_numero', numeroCliente)
      .eq('data', dados.data)
      .single();
    
    if (data && data.status === 'agendada') {
      await enviarWhatsApp(dados.profissional.telefone,
        `⏰ *Lembrete:* Visita em ${dados.data} ${dados.horario} ainda não confirmada.\n` +
        `Responda OK ou cancele se não puder ir.`
      );
      
      await notificarTelegram(
        `⏰ Profissional não confirmou visita\n` +
        `Cliente: ${numeroCliente}\n` +
        `Data: ${dados.data} ${dados.horario}`,
        'alerta'
      );
    }
  }, 10 * 60 * 1000); // 10 minutos
}

// ============ HANDLER PRINCIPAL (VERCEL) ============

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Webhook verification (Meta)
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.verify_token'] === 'roboatendente') {
        return res.status(200).send(req.query['hub.challenge']);
      }
      return res.status(403).send('Forbidden');
    }
    
    // Receber mensagem
    if (req.method === 'POST') {
      const body = req.body;
      
      // Verificar se é webhook do Meta
      if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0]?.value;
        
        if (changes?.messages?.[0]) {
          const msg = changes.messages[0];
          const numero = msg.from;
          const texto = msg.text?.body || '';
          
          // Ignorar mensagens do próprio robô
          if (numero === CONFIG.NUMERO_ROBO) {
            return res.status(200).send('OK');
          }
          
          // Verificar se é profissional
          const isProfissional = CONFIG.PROFISSIONAIS.some(p => 
            numero.includes(p.telefone.replace('55', ''))
          );
          
          // Processar
          const resultado = await processarMensagem(numero, texto, isProfissional);
          
          // Enviar resposta se houver
          if (resultado.resposta) {
            await enviarWhatsApp(numero, resultado.resposta);
          }
          
          return res.status(200).json({ 
            success: true, 
            etapa: resultado.etapa 
          });
        }
      }
      
      // API interna para painel
      if (req.query.acao) {
        return await handlePainelAPI(req, res);
      }
    }
    
    // API do painel (GET)
    if (req.method === 'GET' && req.query.acao) {
      return await handlePainelAPI(req, res);
    }
    
    res.status(200).send('OK');
    
  } catch (e) {
    console.error('ERRO CRÍTICO:', e);
    await notificarTelegram(`🚨 ERRO: ${e.message}`, 'urgente');
    return res.status(200).send('OK'); // Sempre retornar 200 para WhatsApp
  }
}

// ============ API DO PAINEL ============

async function handlePainelAPI(req, res) {
  const { acao } = req.query;
  
  switch (acao) {
    case 'listar': {
      // Listar todas as conversas ativas
      const { data: conversas } = await supabase
        .from('conversas')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(50);
      
      const { data: mensagensRecentes } = await supabase
        .from('mensagens')
        .select('numero, mensagem, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      
      // Agrupar última mensagem por conversa
      const ultimasMsgs = {};
      mensagensRecentes?.forEach(m => {
        if (!ultimasMsgs[m.numero]) {
          ultimasMsgs[m.numero] = m;
        }
      });
      
      const resultado = conversas?.map(c => ({
        telefone: c.numero,
        nome: c.dados?.nome || 'Cliente',
        etapa: c.etapa,
        intervencao: c.intervencao || conversasHumanas.has(c.numero),
        ultima: ultimasMsgs[c.numero]?.mensagem?.substring(0, 50) || '...',
        ultimaAtividade: new Date(c.updated_at).getTime(),
        dados: c.dados
      })) || [];
      
      return res.status(200).json(resultado);
    }
    
    case 'mensagens': {
      const { telefone } = req.query;
      const { data: mensagens } = await supabase
        .from('mensagens')
        .select('*')
        .eq('numero', telefone)
        .order('created_at', { ascending: true })
        .limit(200);
      
      const formatadas = mensagens?.map(m => ({
        tipo: m.tipo,
        texto: m.mensagem,
        hora: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        nome: m.tipo === 'cliente' ? 'Cliente' : 
              m.tipo === 'profissional' ? 'Técnico' : 
              m.tipo === 'humano' ? 'Você' : 'Robô'
      })) || [];
      
      return res.status(200).json(formatadas);
    }
    
    case 'intervir': {
      const { telefone } = req.body;
      conversasHumanas.add(telefone);
      
      await supabase.from('conversas')
        .update({ intervencao: true })
        .eq('numero', telefone);
      
      // Notificar cliente
      await enviarWhatsApp(telefone, 
        '👋 Olá! Sou o atendente humano. Acabei de assumir nossa conversa. Como posso ajudar?'
      );
      
      await notificarTelegram(`👤 Assumiu conversa: ${telefone}`, 'info');
      
      return res.status(200).json({ ok: true });
    }
    
    case 'liberar': {
      const { telefone } = req.body;
      conversasHumanas.delete(telefone);
      
      await supabase.from('conversas')
        .update({ intervencao: false })
        .eq('numero', telefone);
      
      // Resetar sessão
      const sessao = sessoes.get(telefone);
      if (sessao) {
        sessao.etapa = 'inicio';
        sessao.dados = {};
        sessoes.set(telefone, sessao);
      }
      
      await enviarWhatsApp(telefone,
        '✅ Vou passar você de volta para nosso assistente virtual. Ele continuará te ajudando!'
      );
      
      return res.status(200).json({ ok: true });
    }
    
    case 'enviar': {
      const { telefone, mensagem } = req.body;
      
      await enviarWhatsApp(telefone, mensagem);
      
      // Salvar como mensagem humana
      await salvarMensagem(telefone, mensagem, 'humano');
      
      return res.status(200).json({ ok: true });
    }
    
    case 'estatisticas': {
      const hoje = new Date().toISOString().split('T')[0];
      
      const [visitas, mensagens, pendentes] = await Promise.all([
        supabase.from('agenda').select('*').gte('created_at', hoje),
        supabase.from('mensagens').select('*').gte('created_at', hoje),
        supabase.from('agenda').select('*').eq('status', 'agendada')
      ]);
      
      return res.status(200).json({
        visitasHoje: visitas.data?.length || 0,
        mensagensHoje: mensagens.data?.length || 0,
        pendentes: pendentes.data?.length || 0,
        humanosAtivos: conversasHumanas.size
      });
    }
    
    default:
      return res.status(400).json({ erro: 'Ação desconhecida' });
  }
}
