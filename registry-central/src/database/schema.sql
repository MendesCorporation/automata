-- Schema para o Agent Registry
-- PostgreSQL 12+

-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Tabela de agentes
CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    endpoint VARCHAR(512) NOT NULL,
    description TEXT,
    intents TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    categories TEXT[] DEFAULT '{}',
    location_scope VARCHAR(512),
    languages TEXT[] DEFAULT '{}',
    version VARCHAR(50),
    meta JSONB DEFAULT '{}',
    input_schema JSONB, -- JSON Schema for input validation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Garantir coluna intents mesmo em bancos existentes
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS intents TEXT[] DEFAULT '{}'::text[];
ALTER TABLE agents
    ALTER COLUMN intents SET DEFAULT '{}'::text[];
UPDATE agents SET intents = '{}'::text[] WHERE intents IS NULL;
ALTER TABLE agents
    ALTER COLUMN intents SET NOT NULL;

-- Add caller_id for agent ownership
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS caller_id VARCHAR(255);

-- Add input_schema for schema validation
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS input_schema JSONB;

-- Add status and quarantine columns for anti-fraud system
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
    ADD COLUMN IF NOT EXISTS quarantine_at TIMESTAMP;

-- Add tasks column for task discovery
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS tasks TEXT[] DEFAULT '{}';

-- Indices para melhor performance de busca
CREATE INDEX IF NOT EXISTS idx_agents_intents ON agents USING GIN (intents);
CREATE INDEX IF NOT EXISTS idx_agents_categories ON agents USING GIN (categories);
CREATE INDEX IF NOT EXISTS idx_agents_tags ON agents USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_agents_tasks ON agents USING GIN (tasks);
CREATE INDEX IF NOT EXISTS idx_agents_languages ON agents USING GIN (languages);
CREATE INDEX IF NOT EXISTS idx_agents_location_scope ON agents (location_scope);
CREATE INDEX IF NOT EXISTS idx_agents_caller_id ON agents (caller_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);

-- Trigram index for fuzzy intent matching (functional index via immutable wrapper)
CREATE OR REPLACE FUNCTION intents_to_text(arr text[])
RETURNS text
IMMUTABLE
LANGUAGE sql
AS $$
  SELECT array_to_string($1, ',');
$$;

DROP INDEX IF EXISTS idx_agents_intents_trgm;
CREATE INDEX IF NOT EXISTS idx_agents_intents_trgm
  ON agents
  USING GIN (intents_to_text(intents) gin_trgm_ops);

-- Tabela de estatisticas dos agentes
CREATE TABLE IF NOT EXISTS agent_stats (
    agent_id VARCHAR(255) PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    calls_total INTEGER DEFAULT 0,
    calls_success INTEGER DEFAULT 0,
    avg_latency_ms NUMERIC(10, 2) DEFAULT 0,
    avg_rating NUMERIC(3, 2) DEFAULT 0,
    last_feedback_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indice para busca por ultimo feedback
CREATE INDEX IF NOT EXISTS idx_agent_stats_last_feedback ON agent_stats (last_feedback_at);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_agents_updated_at ON agents;
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_stats_updated_at ON agent_stats;
CREATE TRIGGER update_agent_stats_updated_at BEFORE UPDATE ON agent_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTHENTICATION TABLES (Auto-generated caller_id system)
-- ============================================================

-- Tabela de callers (auto-registered consumers and providers)
CREATE TABLE IF NOT EXISTS callers (
    caller_id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- 'consumer' or 'provider'
    identifier VARCHAR(512) NOT NULL, -- IP, endpoint, or unique identifier
    jwt_token TEXT, -- hash of current JWT token
    token_expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, identifier)
);

-- Indexes for callers
CREATE INDEX IF NOT EXISTS idx_callers_identifier ON callers (type, identifier);
CREATE INDEX IF NOT EXISTS idx_callers_jwt_token ON callers (jwt_token);

-- Trigger for callers updated_at
DROP TRIGGER IF EXISTS update_callers_updated_at ON callers;
CREATE TRIGGER update_callers_updated_at BEFORE UPDATE ON callers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ANTI-FRAUD SYSTEM TABLES
-- ============================================================

-- Tabela de feedbacks individuais (histórico completo com rastreamento)
CREATE TABLE IF NOT EXISTS agent_feedbacks (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    consumer_id VARCHAR(255) NOT NULL REFERENCES callers(caller_id),
    success BOOLEAN NOT NULL,
    latency_ms NUMERIC(10, 2) NOT NULL,
    rating NUMERIC(3, 2) NOT NULL CHECK (rating >= 0 AND rating <= 1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance e detecção de fraude
CREATE INDEX IF NOT EXISTS idx_feedbacks_agent_consumer ON agent_feedbacks (agent_id, consumer_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_agent_created ON agent_feedbacks (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_consumer ON agent_feedbacks (consumer_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON agent_feedbacks (created_at DESC);

-- Tabela de logs de detecção de fraude
CREATE TABLE IF NOT EXISTS fraud_detection_log (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) REFERENCES agents(id) ON DELETE CASCADE,
    consumer_id VARCHAR(255) REFERENCES callers(caller_id),
    fraud_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    details JSONB DEFAULT '{}',
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para análise de fraude
CREATE INDEX IF NOT EXISTS idx_fraud_agent ON fraud_detection_log (agent_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_consumer ON fraud_detection_log (consumer_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_type ON fraud_detection_log (fraud_type);
CREATE INDEX IF NOT EXISTS idx_fraud_severity ON fraud_detection_log (severity);

-- Função para limpar logs antigos
CREATE OR REPLACE FUNCTION cleanup_old_fraud_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM fraud_detection_log
    WHERE detected_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
