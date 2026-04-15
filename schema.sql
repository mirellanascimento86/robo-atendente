
# Criar arquivo de schema do Supabase

schema_sql = """
-- Schema do Supabase para Robô de Atendimento RC Reforma
-- Execute este SQL no SQL Editor do Supabase

-- ==========================================
-- TABELA: Configurações do Robô
-- ==========================================
CREATE TABLE IF NOT EXISTS configs (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    descricao TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Configurações iniciais
INSERT INTO configs (chave, valor, descricao) VALUES
('boas_vindas', 'Olá! Sou da RC Reforma e Construção. Para te ajudar rápido, me conta: qual serviço precisa e qual bairro do Rio?', 'Mensagem inicial do robô'),
('preco', 'Entendo. A visita técnica custa R$180, mas temos descontos especiais. Na Zona Sul fica R$90, e em Botafogo é gratuita. O técnico vai até você, avalia tudo e faz um orçamento detalhado. Se aprovar o serviço, esse valor vira desconto no total.', 'Resposta sobre preços'),
('objecao_caro', 'Posso oferecer 50% de desconto para Zona Sul, ficando R$90. Ou, se conseguir trazer o serviço para Botafogo, fica 100% gratuito como cortesia.', 'Quando cliente acha caro'),
('confirmacao', 'Visita confirmada. O técnico vai entrar em contato em até 48 horas. Se precisar remarcar, avise com 2 horas de antecedência.', 'Confirmação de agendamento'),
('empresa', 'RC Reforma e Construção', 'Nome da empresa'),
('preco_visita', '180', 'Preço padrão'),
('preco_zs', '90', 'Preço Zona Sul'),
('gratuito_botafogo', 'true', 'Visita gratuita em Botafogo'),
('bairros', 'ipanema\nleblon\ncopacabana\nbotafogo\nflamengo\nlagoa\ngavea\njardim botanico\nhumaita\nurca\ncatete\ngloria\nlaranjeiras\ncosme velho\nleme\nsao conrado\nvidigal\nrocinha\ncentro\nlapa\nsanta teresa', 'Lista de bairros'),
('servicos', 'pedreiro\npintura\nmarcenaria\nhidraulica\nelétrica\nreforma\nazulejo\ngesso\nvazamento\nencanamento\nserralheria\ndrywall\nporcelanato\nrevestimento\nimpermeabilização', 'Lista de serviços'),
('palavras_risco', 'processo\njudicial\nadvogado\nprocon\nreclamação\npolícia\ndenunciar\ngolpe\nfraude\nenganado\ncalote\nquero falar com humano\nvocê é robô\ncancelar tudo\nnão quero mais', 'Palavras que ativam intervenção')
ON CONFLICT (chave) DO NOTHING;

-- ==========================================
-- TABELA: Mensagens (histórico)
-- ==========================================
CREATE TABLE IF NOT EXISTS mensagens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telefone TEXT NOT NULL,
    nome TEXT,
    tipo TEXT NOT NULL CHECK (tipo IN ('cliente', 'bot', 'humano', 'system')),
    conteudo TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    lida BOOLEAN DEFAULT FALSE,
    requer_atencao BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_mensagens_telefone ON mensagens(telefone);
CREATE INDEX IF NOT EXISTS idx_mensagens_timestamp ON mensagens(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mensagens_lida ON mensagens(lida) WHERE lida = FALSE;

-- ==========================================
-- TABELA: Clientes (estado da conversa)
-- ==========================================
CREATE TABLE IF NOT EXISTS clientes (
    telefone TEXT PRIMARY KEY,
    nome TEXT,
    etapa TEXT DEFAULT 'INICIO',
    dados JSONB DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- TABELA: Intervenções Humanas
-- ==========================================
CREATE TABLE IF NOT EXISTS intervencoes (
    telefone TEXT PRIMARY KEY,
    ativa BOOLEAN DEFAULT TRUE,
    atendente TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- TABELA: Agendamentos
-- ==========================================
CREATE TABLE IF NOT EXISTS agendamentos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telefone TEXT NOT NULL,
    nome TEXT,
    servico TEXT,
    bairro TEXT,
    data TEXT,
    data_formatada TEXT,
    hora TEXT,
    endereco TEXT,
    valor INTEGER,
    status TEXT DEFAULT 'confirmado',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- TABELA: Respostas Personalizadas
-- ==========================================
CREATE TABLE IF NOT EXISTS respostas_personalizadas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    gatilho TEXT NOT NULL,
    resposta TEXT NOT NULL,
    ativa BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- TABELA: Fluxo de Conversa
-- ==========================================
CREATE TABLE IF NOT EXISTS fluxo_conversa (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ordem INTEGER NOT NULL,
    nome TEXT NOT NULL,
    gatilho TEXT,
    resposta TEXT NOT NULL,
    ativa BOOLEAN DEFAULT TRUE
);

-- ==========================================
-- POLÍTICAS DE SEGURANÇA (RLS)
-- ==========================================
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervencoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE respostas_personalizadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fluxo_conversa ENABLE ROW LEVEL SECURITY;

-- Política: Permitir tudo para anon (painel de treinamento)
CREATE POLICY "allow_all_configs" ON configs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_mensagens" ON mensagens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_clientes" ON clientes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_intervencoes" ON intervencoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_agendamentos" ON agendamentos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_respostas" ON respostas_personalizadas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_fluxo" ON fluxo_conversa FOR ALL USING (true) WITH CHECK (true);

-- ==========================================
-- FUNÇÕES ÚTEIS
-- ==========================================

-- Função para marcar mensagens como lidas
CREATE OR REPLACE FUNCTION marcar_como_lida(p_telefone TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE mensagens SET lida = TRUE WHERE telefone = p_telefone AND lida = FALSE;
END;
$$ LANGUAGE plpgsql;

-- Função para obter estatísticas
CREATE OR REPLACE FUNCTION get_stats()
RETURNS TABLE (
    total_conversas BIGINT,
    mensagens_hoje BIGINT,
    intervencoes_ativas BIGINT,
    agendamentos_hoje BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(DISTINCT telefone) FROM mensagens),
        (SELECT COUNT(*) FROM mensagens WHERE DATE(created_at) = CURRENT_DATE),
        (SELECT COUNT(*) FROM intervencoes WHERE ativa = TRUE),
        (SELECT COUNT(*) FROM agendamentos WHERE data = 'hoje');
END;
$$ LANGUAGE plpgsql;
"""

print("Schema SQL criado")
print(f"Total de linhas: {len(schema_sql.split(chr(10)))}")
print("\n" + "="*60)
print("INSTRUÇÕES DE INSTALAÇÃO:")
print("="*60)
