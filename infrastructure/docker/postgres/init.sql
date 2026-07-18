-- SpecCursor Database Schema
-- PostgreSQL 15 initialization script

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create schema
CREATE SCHEMA IF NOT EXISTS speccursor;

-- Persist search_path so app pools resolve tables without schema prefixes.
ALTER DATABASE speccursor SET search_path TO speccursor, public;
ALTER ROLE speccursor SET search_path TO speccursor, public;

-- Set search path for this init session
SET search_path TO speccursor, public;

-- Upgrades table
CREATE TABLE IF NOT EXISTS upgrades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository VARCHAR(255) NOT NULL,
    ecosystem VARCHAR(50) NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    current_version VARCHAR(100) NOT NULL,
    target_version VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

-- Proofs table
CREATE TABLE IF NOT EXISTS proofs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    upgrade_id UUID REFERENCES upgrades(id) ON DELETE CASCADE,
    proof_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    lean_code TEXT,
    proof_result JSONB,
    verification_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    CONSTRAINT valid_proof_status CHECK (status IN ('pending', 'verifying', 'verified', 'failed', 'timeout'))
);

-- AI Patches table
CREATE TABLE IF NOT EXISTS ai_patches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    upgrade_id UUID REFERENCES upgrades(id) ON DELETE CASCADE,
    patch_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    original_code TEXT,
    patched_code TEXT,
    diff_output TEXT,
    confidence_score DECIMAL(3,2),
    claude_request JSONB,
    claude_response JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    CONSTRAINT valid_patch_status CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'rejected')),
    CONSTRAINT valid_confidence_score CHECK (confidence_score >= 0 AND confidence_score <= 1)
);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL,
    result JSONB,
    priority INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    CONSTRAINT valid_job_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

-- Metrics table
CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(15,6) NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    labels JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_metric_type CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'summary'))
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    user_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System configuration table
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(255)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_upgrades_repository ON upgrades(repository);
CREATE INDEX IF NOT EXISTS idx_upgrades_status ON upgrades(status);
CREATE INDEX IF NOT EXISTS idx_upgrades_created_at ON upgrades(created_at);
CREATE INDEX IF NOT EXISTS idx_upgrades_ecosystem ON upgrades(ecosystem);

CREATE INDEX IF NOT EXISTS idx_proofs_upgrade_id ON proofs(upgrade_id);
CREATE INDEX IF NOT EXISTS idx_proofs_status ON proofs(status);
CREATE INDEX IF NOT EXISTS idx_proofs_created_at ON proofs(created_at);

CREATE INDEX IF NOT EXISTS idx_ai_patches_upgrade_id ON ai_patches(upgrade_id);
CREATE INDEX IF NOT EXISTS idx_ai_patches_status ON ai_patches(status);
CREATE INDEX IF NOT EXISTS idx_ai_patches_created_at ON ai_patches(created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);

CREATE INDEX IF NOT EXISTS idx_metrics_metric_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_metric_type ON metrics(metric_type);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_upgrades_status_created
  ON upgrades(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrades_ecosystem_created
  ON upgrades(ecosystem, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_patches_status_created
  ON ai_patches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_patches_upgrade_created
  ON ai_patches(upgrade_id, created_at DESC);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_upgrades_updated_at BEFORE UPDATE ON upgrades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_proofs_updated_at BEFORE UPDATE ON proofs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_patches_updated_at BEFORE UPDATE ON ai_patches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial system configuration
INSERT INTO system_config (key, value, description) VALUES
('claude_api', '{"model": "claude-sonnet-4-20250514", "max_tokens": 4096, "temperature": 0.1}', 'Claude Messages API configuration'),
('lean_engine', '{"version": "4.20.0", "timeout_seconds": 300, "memory_limit_mb": 2048}', 'Lean engine configuration'),
('security', '{"sandbox_enabled": true, "max_execution_time": 600, "memory_limit": "2GB"}', 'Security configuration'),
('monitoring', '{"metrics_enabled": true, "tracing_enabled": true, "log_level": "info"}', 'Monitoring configuration')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();

-- Create views for common queries
CREATE OR REPLACE VIEW upgrade_summary AS
SELECT 
    u.id,
    u.repository,
    u.ecosystem,
    u.package_name,
    u.current_version,
    u.target_version,
    u.status,
    u.created_at,
    u.completed_at,
    CASE 
        WHEN u.completed_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (u.completed_at - u.created_at))
        ELSE NULL 
    END as duration_seconds,
    COUNT(p.id) as proof_count,
    COUNT(ap.id) as patch_count
FROM upgrades u
LEFT JOIN proofs p ON u.id = p.upgrade_id
LEFT JOIN ai_patches ap ON u.id = ap.upgrade_id
GROUP BY u.id, u.repository, u.ecosystem, u.package_name, u.current_version, u.target_version, u.status, u.created_at, u.completed_at;

-- Grant permissions
GRANT USAGE ON SCHEMA speccursor TO speccursor;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA speccursor TO speccursor;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA speccursor TO speccursor;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA speccursor TO speccursor; 