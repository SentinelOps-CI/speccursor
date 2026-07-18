import { z } from 'zod';

export {
  ALLOWED_ECOSYSTEMS,
  isAllowedEcosystem,
  type AllowedEcosystem,
} from './ecosystem';

// ============================================================================
// Domain Models
// ============================================================================

export interface Upgrade {
  id: string;
  repository: string;
  ecosystem: Ecosystem;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  status: UpgradeStatus;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export interface Proof {
  id: string;
  upgradeId: string;
  proofType: ProofType;
  status: ProofStatus;
  leanCode?: string;
  proofResult?: Record<string, any>;
  verificationTimeMs?: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export interface AIPatch {
  id: string;
  upgradeId: string;
  patchType: PatchType;
  status: PatchStatus;
  originalCode?: string;
  patchedCode?: string;
  diffOutput?: string;
  confidenceScore?: number;
  claudeRequest?: Record<string, any>;
  claudeResponse?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export interface Job {
  id: string;
  jobType: JobType;
  status: JobStatus;
  payload: Record<string, any>;
  result?: Record<string, any>;
  priority: number;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

// ============================================================================
// Enums
// ============================================================================

export enum Ecosystem {
  NODE = 'node',
  RUST = 'rust',
  PYTHON = 'python',
  GO = 'go',
  LEAN = 'lean',
  DOCKERFILE = 'dockerfile',
}

export enum UpgradeStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum ProofStatus {
  PENDING = 'pending',
  VERIFYING = 'verifying',
  VERIFIED = 'verified',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

export enum PatchStatus {
  PENDING = 'pending',
  GENERATING = 'generating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REJECTED = 'rejected',
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum JobType {
  UPGRADE = 'upgrade',
  PROOF = 'proof',
  AI_PATCH = 'ai_patch',
}

export enum ProofType {
  INVARIANT = 'invariant',
  SAFETY = 'safety',
  CORRECTNESS = 'correctness',
  PERFORMANCE = 'performance',
}

export enum PatchType {
  REGRESSION_FIX = 'regression_fix',
  COMPATIBILITY = 'compatibility',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

// ============================================================================
// API Interfaces
// ============================================================================

export interface CreateUpgradeRequest {
  repository: string;
  ecosystem: Ecosystem;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  metadata?: Record<string, any>;
}

export interface CreateUpgradeResponse {
  upgradeId: string;
  status: UpgradeStatus;
  createdAt: Date;
}

export interface GetUpgradeRequest {
  upgradeId: string;
}

export interface GetUpgradeResponse {
  upgrade: Upgrade;
}

export interface ListUpgradesRequest {
  repository?: string;
  ecosystem?: Ecosystem;
  status?: UpgradeStatus;
  limit?: number;
  offset?: number;
}

export interface ListUpgradesResponse {
  upgrades: Upgrade[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateUpgradeStatusRequest {
  upgradeId: string;
  status: UpgradeStatus;
  errorMessage?: string;
}

export interface UpdateUpgradeStatusResponse {
  success: boolean;
  updatedAt: Date;
}

// ============================================================================
// GitHub Webhook Interfaces
// ============================================================================

export interface GitHubWebhookPayload {
  action: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
  };
  sender: {
    id: number;
    login: string;
    type: string;
  };
  installation?: {
    id: number;
  };
}

export interface GitHubReleaseWebhook extends GitHubWebhookPayload {
  action:
    | 'published'
    | 'created'
    | 'edited'
    | 'deleted'
    | 'prereleased'
    | 'released';
  release: {
    id: number;
    tag_name: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
    published_at: string;
    html_url: string;
  };
}

export interface GitHubPullRequestWebhook extends GitHubWebhookPayload {
  action:
    | 'opened'
    | 'edited'
    | 'closed'
    | 'reopened'
    | 'synchronize'
    | 'ready_for_review'
    | 'review_requested'
    | 'review_request_removed';
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string;
    state: string;
    html_url: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
  };
}

// ============================================================================
// AI Service Interfaces
// ============================================================================

export interface ClaudeRequest {
  model: 'claude-3-sonnet-20240229';
  maxTokens: number;
  temperature: number;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface GeneratePatchRequest {
  upgradeId: string;
  originalCode: string;
  errorMessage: string;
  ecosystem: Ecosystem;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
}

export interface GeneratePatchResponse {
  patchId: string;
  patchedCode: string;
  diffOutput: string;
  confidenceScore: number;
  explanation: string;
}

// ============================================================================
// Lean Engine Interfaces
// ============================================================================

export interface LeanRequest {
  command: 'check' | 'prove' | 'build';
  filePath: string;
  theoremName?: string;
  timeout: number;
}

export interface LeanResponse {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  proofStatus?: 'success' | 'failed' | 'timeout';
}

export interface CreateProofRequest {
  upgradeId: string;
  proofType: ProofType;
  leanCode: string;
  theoremName?: string;
}

export interface CreateProofResponse {
  proofId: string;
  status: ProofStatus;
  createdAt: Date;
}

// ============================================================================
// Validation Schemas
// ============================================================================

export const EcosystemSchema = z.nativeEnum(Ecosystem);
export const UpgradeStatusSchema = z.nativeEnum(UpgradeStatus);
export const ProofStatusSchema = z.nativeEnum(ProofStatus);
export const PatchStatusSchema = z.nativeEnum(PatchStatus);
export const JobStatusSchema = z.nativeEnum(JobStatus);
export const JobTypeSchema = z.nativeEnum(JobType);
export const ProofTypeSchema = z.nativeEnum(ProofType);
export const PatchTypeSchema = z.nativeEnum(PatchType);
export const MetricTypeSchema = z.nativeEnum(MetricType);

// Main entity schemas
export const UpgradeSchema = z.object({
  id: z.string().uuid(),
  repository: z.string(),
  ecosystem: EcosystemSchema,
  packageName: z.string(),
  currentVersion: z.string(),
  targetVersion: z.string(),
  status: UpgradeStatusSchema,
  metadata: z.record(z.any()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
});

export const ProofSchema = z.object({
  id: z.string().uuid(),
  upgradeId: z.string().uuid(),
  proofType: ProofTypeSchema,
  status: ProofStatusSchema,
  leanCode: z.string().nullable(),
  proofResult: z.record(z.any()).nullable(),
  verificationTimeMs: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
});

export const AIPatchSchema = z.object({
  id: z.string().uuid(),
  upgradeId: z.string().uuid(),
  patchType: PatchTypeSchema,
  status: PatchStatusSchema,
  originalCode: z.string().nullable(),
  patchedCode: z.string().nullable(),
  diffOutput: z.string().nullable(),
  confidenceScore: z.number().min(0).max(1).nullable(),
  claudeRequest: z.record(z.any()).nullable(),
  claudeResponse: z.record(z.any()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
});

export const JobSchema = z.object({
  id: z.string().uuid(),
  type: JobTypeSchema,
  status: JobStatusSchema,
  priority: z.number().min(1).max(10),
  data: z.record(z.any()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
});

export const MetricSchema = z.object({
  name: z.string(),
  value: z.number(),
  type: MetricTypeSchema,
  labels: z.record(z.string()),
  timestamp: z.string().datetime(),
});

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  userId: z.string().nullable(),
  metadata: z.record(z.any()),
  timestamp: z.string().datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export const SystemConfigSchema = z.object({
  port: z.number(),
  environment: z.string(),
  database: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    username: z.string(),
    password: z.string(),
    ssl: z.boolean(),
    maxConnections: z.number(),
    idleTimeout: z.number(),
  }),
  redis: z.object({
    host: z.string(),
    port: z.number(),
    password: z.string().optional(),
    db: z.number(),
    keyPrefix: z.string(),
  }),
  monitoring: z.object({
    metricsEnabled: z.boolean(),
    tracingEnabled: z.boolean(),
    logLevel: z.string(),
    prometheusPort: z.number(),
    jaegerEndpoint: z.string().optional(),
  }),
});

export const CreateUpgradeRequestSchema = z.object({
  repository: z.string().min(1).max(255),
  ecosystem: EcosystemSchema,
  packageName: z.string().min(1).max(255),
  currentVersion: z.string().min(1).max(100),
  targetVersion: z.string().min(1).max(100),
  metadata: z.record(z.any()).optional(),
});

export const CreateProofRequestSchema = z.object({
  upgradeId: z.string().uuid(),
  proofType: ProofTypeSchema,
  leanCode: z.string().min(1),
  theoremName: z.string().optional(),
});

export const GeneratePatchRequestSchema = z.object({
  upgradeId: z.string().uuid(),
  originalCode: z.string().min(1),
  errorMessage: z.string().min(1),
  ecosystem: EcosystemSchema,
  packageName: z.string().min(1).max(255),
  currentVersion: z.string().min(1).max(100),
  targetVersion: z.string().min(1).max(100),
});

export const GitHubWebhookSchema = z.object({
  action: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    private: z.boolean(),
    html_url: z.string().url(),
  }),
  sender: z.object({
    id: z.number(),
    login: z.string(),
    type: z.string(),
  }),
  installation: z
    .object({
      id: z.number(),
    })
    .optional(),
});

// ============================================================================
// Error Types
// ============================================================================

export class SpecCursorError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SpecCursorError';
  }
}

export class ValidationError extends SpecCursorError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends SpecCursorError {
  constructor(resource: string, id: string) {
    super(`${resource} with id ${id} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends SpecCursorError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends SpecCursorError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// Utility Types
// ============================================================================

export type Result<T, E = SpecCursorError> =
  | { success: true; data: T }
  | { success: false; error: E };

export type AsyncResult<T, E = SpecCursorError> = Promise<Result<T, E>>;

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginationResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  version: string;
  uptime: number;
  checks: Record<
    string,
    {
      status: 'healthy' | 'unhealthy';
      message?: string;
      duration?: number;
    }
  >;
}

// ============================================================================
// Metrics and Monitoring
// ============================================================================

export interface Metric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  labels: Record<string, string>;
  timestamp: Date;
}

export interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  userId?: string;
  metadata: Record<string, any>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  maxConnections: number;
  idleTimeout: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
}

export interface LeanConfig {
  version: string;
  timeoutSeconds: number;
  memoryLimitMb: number;
  mathlibPath: string;
}

export interface SecurityConfig {
  sandboxEnabled: boolean;
  maxExecutionTime: number;
  memoryLimit: string;
  allowedCommands: string[];
}

export interface MonitoringConfig {
  metricsEnabled: boolean;
  tracingEnabled: boolean;
  logLevel: string;
  prometheusPort: number;
  jaegerEndpoint?: string;
}

export interface AppConfig {
  port: number;
  environment: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  claude: ClaudeConfig;
  lean: LeanConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
}
