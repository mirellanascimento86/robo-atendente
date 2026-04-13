import { Redis } from '@upstash/redis';

// Usar variável de ambiente UPSTASH_REDIS_REST_URL
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Chaves usadas no banco
export const KEYS = {
  config: 'robo:config',      // Configuração do robô
  mensagens: 'robo:mensagens', // Histórico (últimas 100)
  conversas: 'robo:conversas', // Dados das conversas
  intervencao: 'robo:intervencao', // Quem está em intervenção
};
