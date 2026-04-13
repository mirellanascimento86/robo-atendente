import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Permitir CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const configPath = path.join('/tmp', 'config.json');
  
  // GET - Carregar configuração
  if (req.method === 'GET') {
    try {
      // Tentar ler do /tmp primeiro (Vercel permite escrita aqui)
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        return res.json(JSON.parse(data));
      }
      
      // Se não existe em /tmp, ler do projeto
      const defaultPath = path.join(process.cwd(), 'data', 'config.json');
      const data = fs.readFileSync(defaultPath, 'utf8');
      return res.json(JSON.parse(data));
      
    } catch (e) {
      return res.status(500).json({ erro: 'Erro ao carregar: ' + e.message });
    }
  }
  
  // POST - Salvar configuração
  if (req.method === 'POST') {
    try {
      const novaConfig = req.body;
      
      // Validar
      if (!novaConfig || typeof novaConfig !== 'object') {
        return res.status(400).json({ erro: 'Dados inválidos' });
      }
      
      // Salvar em /tmp (único lugar que Vercel permite escrita)
      fs.writeFileSync(configPath, JSON.stringify(novaConfig, null, 2));
      
      console.log('✅ Config salva:', new Date().toISOString());
      
      return res.json({ 
        ok: true, 
        mensagem: 'Configuração salva!',
        hora: new Date().toLocaleString('pt-BR')
      });
      
    } catch (e) {
      console.error('❌ Erro ao salvar:', e);
      return res.status(500).json({ 
        erro: 'Erro ao salvar: ' + e.message 
      });
    }
  }
  
  res.status(405).json({ erro: 'Método não permitido' });
}
