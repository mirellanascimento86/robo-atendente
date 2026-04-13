import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  // GET - Carregar configuração atual
  if (req.method === 'GET') {
    try {
      const configPath = path.join(process.cwd(), 'data', 'config.json');
      const config = await fs.readFile(configPath, 'utf8');
      return res.json(JSON.parse(config));
    } catch (e) {
      return res.status(500).json({ erro: 'Erro ao carregar configuração' });
    }
  }
  
  // POST - Salvar nova configuração
  if (req.method === 'POST') {
    try {
      const novaConfig = req.body;
      const configPath = path.join(process.cwd(), 'data', 'config.json');
      
      // Validar se é JSON válido
      const configString = JSON.stringify(novaConfig, null, 2);
      
      // Salvar no arquivo
      await fs.writeFile(configPath, configString, 'utf8');
      
      console.log('✅ Configuração salva em:', new Date().toISOString());
      
      return res.json({ 
        ok: true, 
        mensagem: 'Configuração salva com sucesso!',
        timestamp: new Date().toISOString()
      });
      
    } catch (e) {
      console.error('❌ Erro ao salvar:', e);
      return res.status(500).json({ 
        erro: 'Erro ao salvar configuração',
        detalhes: e.message 
      });
    }
  }
  
  res.status(405).json({ erro: 'Método não permitido' });
}
