import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Funções de banco
export async function salvarMensagem(telefone, nome, tipo, texto) {
  const { error } = await supabase
    .from('mensagens')
    .insert([{
      telefone,
      nome,
      tipo, // 'cliente', 'robo', 'humano', 'sistema'
      texto,
      criado_em: new Date().toISOString()
    }]);
  
  if (error) console.error('Erro salvar mensagem:', error);
}

export async function buscarMensagens(telefone, limite = 50) {
  const { data, error } = await supabase
    .from('mensagens')
    .select('*')
    .eq('telefone', telefone)
    .order('criado_em', { ascending: true })
    .limit(limite);
  
  if (error) {
    console.error('Erro buscar mensagens:', error);
    return [];
  }
  
  return data.map(m => ({
    tipo: m.tipo,
    nome: m.nome,
    texto: m.texto,
    hora: new Date(m.criado_em).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
    data: new Date(m.criado_em).toLocaleDateString('pt-BR')
  }));
}

export async function listarConversas() {
  const { data, error } = await supabase
    .from('mensagens')
    .select('telefone, nome, tipo, texto, criado_em')
    .order('criado_em', { ascending: false });
  
  if (error) {
    console.error('Erro listar conversas:', error);
    return [];
  }
  
  // Agrupar por telefone
  const conversas = {};
  data.forEach(m => {
    if (!conversas[m.telefone]) {
      conversas[m.telefone] = {
        telefone: m.telefone,
        nome: m.nome || 'Cliente',
        ultima: m.texto,
        ultima_data: m.criado_em
      };
    }
  });
  
  return Object.values(conversas);
}

export async function salvarVisita(dados) {
  const { error } = await supabase
    .from('visitas')
    .insert([{
      ...dados,
      criado_em: new Date().toISOString()
    }]);
  
  if (error) console.error('Erro salvar visita:', error);
}

export async function buscarVisitasHoje() {
  const hoje = new Date().toISOString().split('T')[0];
  
  const { data, error } = await supabase
    .from('visitas')
    .select('*')
    .gte('criado_em', hoje + 'T00:00:00')
    .lte('criado_em', hoje + 'T23:59:59');
  
  if (error) {
    console.error('Erro buscar visitas:', error);
    return [];
  }
  
  return data;
}
