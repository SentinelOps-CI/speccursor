import Anthropic from '@anthropic-ai/sdk';
import { createTwoFilesPatch } from 'diff';
import type { Logger } from '@speccursor/shared-utils';
import {
  isUsableSecret,
  resolveAnthropicApiKey,
} from '@speccursor/shared-config';

export interface PatchGenerationResult {
  patchedCode: string;
  explanation: string;
  confidenceScore: number;
  raw: unknown;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ClaudePatchClient {
  generatePatch(input: {
    ecosystem: string;
    originalCode: string;
    testFailure: string;
  }): Promise<PatchGenerationResult>;
}

/** Default Messages API model; override with CLAUDE_MODEL. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/**
 * Claude Messages API patch generator with strict JSON extraction and
 * bounded confidence scoring. Fail-closed when ANTHROPIC_API_KEY is missing.
 */
export class AnthropicPatchClient implements ClaudePatchClient {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly apiKeyPresent: boolean;

  constructor(
    private readonly logger: Logger,
    options?: {
      apiKey?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ) {
    const apiKey = options?.apiKey ?? resolveAnthropicApiKey();
    this.apiKeyPresent = isUsableSecret(apiKey);
    if (!this.apiKeyPresent) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set; patch generation will fail closed'
      );
      this.client = null;
    } else {
      this.client = new Anthropic({ apiKey });
    }

    this.model =
      options?.model || process.env['CLAUDE_MODEL'] || DEFAULT_CLAUDE_MODEL;
    this.maxTokens =
      options?.maxTokens ?? Number(process.env['CLAUDE_MAX_TOKENS'] || 4096);
    this.temperature =
      options?.temperature ?? Number(process.env['CLAUDE_TEMPERATURE'] || 0.1);
  }

  async generatePatch(input: {
    ecosystem: string;
    originalCode: string;
    testFailure: string;
  }): Promise<PatchGenerationResult> {
    if (!this.client || !this.apiKeyPresent) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for patch generation (fail-closed)'
      );
    }

    const userPrompt = buildUserPrompt(input);
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system:
        'You are an expert software engineer. Reply with a single JSON object only — no markdown fences, no prose outside JSON.',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = extractTextContent(message.content);
    if (!text.trim()) {
      throw new Error('Empty response from Claude Messages API');
    }

    const parsed = extractJsonObject(text);
    const patchedCode = String(parsed['patchedCode'] ?? '');
    const explanation = String(parsed['explanation'] ?? '');
    let confidenceScore = Number(parsed['confidenceScore'] ?? 0);
    if (!Number.isFinite(confidenceScore)) confidenceScore = 0;
    confidenceScore = Math.min(1, Math.max(0, confidenceScore));

    if (!patchedCode.trim()) {
      throw new Error('Claude response missing patchedCode');
    }

    return {
      patchedCode,
      explanation,
      confidenceScore,
      raw: parsed,
      model: this.model,
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
    };
  }
}

export function extractTextContent(
  content: ReadonlyArray<{ type: string; text?: string }>
): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n');
}

export function buildUnifiedDiff(
  originalCode: string,
  patchedCode: string,
  fileName = 'source'
): string {
  return createTwoFilesPatch(
    `a/${fileName}`,
    `b/${fileName}`,
    originalCode,
    patchedCode,
    undefined,
    undefined,
    { context: 3 }
  );
}

function buildUserPrompt(input: {
  ecosystem: string;
  originalCode: string;
  testFailure: string;
}): string {
  return `Fix a failing test after a dependency upgrade.

Ecosystem: ${input.ecosystem}
Test failure:
\`\`\`
${truncate(input.testFailure, 8_000)}
\`\`\`

Original code:
\`\`\`
${truncate(input.originalCode, 24_000)}
\`\`\`

Return ONLY this JSON shape:
{
  "patchedCode": "<full patched source>",
  "explanation": "<brief explanation>",
  "confidenceScore": 0.0
}

Rules:
- Fix the specific failure
- Prefer minimal, backward-compatible changes
- confidenceScore must be between 0 and 1`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
}

/** Extract the first JSON object from a model response that may include fences. */
export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}
