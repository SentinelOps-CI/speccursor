#!/usr/bin/env node
/**
 * SpecCursor AI patch CLI (Messages API).
 *
 * Usage:
 *   pnpm exec tsx scripts/ai-patch.ts --original src.ts --failure fail.txt --ecosystem node
 *   pnpm exec tsx scripts/ai-patch.ts --original src.ts --failure fail.txt --dry-run
 *
 * Required env:
 *   ANTHROPIC_API_KEY
 * Optional env:
 *   CLAUDE_MODEL (default: claude-sonnet-4-20250514)
 *   CLAUDE_MAX_TOKENS (default: 4096)
 *   CLAUDE_TEMPERATURE (default: 0.1)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createTwoFilesPatch } from 'diff';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

interface Options {
  originalPath: string;
  failurePath: string;
  ecosystem: string;
  outPath?: string;
  dryRun: boolean;
  model: string;
  maxTokens: number;
  temperature: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    originalPath: '',
    failurePath: '',
    ecosystem: 'node',
    dryRun: false,
    model: process.env['CLAUDE_MODEL'] || DEFAULT_MODEL,
    maxTokens: Number(process.env['CLAUDE_MAX_TOKENS'] || 4096),
    temperature: Number(process.env['CLAUDE_TEMPERATURE'] || 0.1),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--original':
        options.originalPath = next || '';
        i++;
        break;
      case '--failure':
        options.failurePath = next || '';
        i++;
        break;
      case '--ecosystem':
        options.ecosystem = next || 'node';
        i++;
        break;
      case '--out':
        options.outPath = next;
        i++;
        break;
      case '--model':
        options.model = next || options.model;
        i++;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        break;
    }
  }

  if (!options.originalPath || !options.failurePath) {
    printHelp();
    throw new Error('--original and --failure are required');
  }

  return options;
}

function printHelp(): void {
  console.log(`SpecCursor AI patch CLI

Required:
  --original <file>   Source file to patch
  --failure <file>    Test failure output

Optional:
  --ecosystem <name>  node|rust|python|go|lean|dockerfile (default: node)
  --out <file>        Write patched source here
  --model <id>        Claude model id
  --dry-run           Print JSON result without writing files

Env:
  ANTHROPIC_API_KEY   Required unless --dry-run with local fixture mode
  CLAUDE_MODEL        Default ${DEFAULT_MODEL}
`);
}

function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required (fail-closed)');
  }

  const originalCode = await readFile(resolve(options.originalPath), 'utf8');
  const testFailure = await readFile(resolve(options.failurePath), 'utf8');

  const client = new Anthropic({ apiKey });
  const prompt = `Fix a failing test after a dependency upgrade.

Ecosystem: ${options.ecosystem}
Test failure:
\`\`\`
${truncate(testFailure, 8_000)}
\`\`\`

Original code:
\`\`\`
${truncate(originalCode, 24_000)}
\`\`\`

Return ONLY this JSON shape:
{
  "patchedCode": "<full patched source>",
  "explanation": "<brief explanation>",
  "confidenceScore": 0.0
}`;

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          model: options.model,
          ecosystem: options.ecosystem,
          originalBytes: originalCode.length,
          failureBytes: testFailure.length,
        },
        null,
        2
      )
    );
    return;
  }

  const message = await client.messages.create({
    model: options.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    system:
      'You are an expert software engineer. Reply with a single JSON object only.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const parsed = extractJsonObject(text);
  const patchedCode = String(parsed['patchedCode'] ?? '');
  if (!patchedCode.trim()) {
    throw new Error('Model response missing patchedCode');
  }

  const confidence = Math.min(
    1,
    Math.max(0, Number(parsed['confidenceScore'] ?? 0) || 0)
  );
  const diff = createTwoFilesPatch(
    'a/source',
    'b/source',
    originalCode,
    patchedCode,
    undefined,
    undefined,
    { context: 3 }
  );

  const result = {
    model: options.model,
    explanation: String(parsed['explanation'] ?? ''),
    confidenceScore: confidence,
    usage: message.usage,
    diff,
    patchedCode,
  };

  if (options.outPath) {
    await writeFile(resolve(options.outPath), patchedCode, 'utf8');
  }

  console.log(
    JSON.stringify(
      { ...result, patchedCode: undefined, written: options.outPath || null },
      null,
      2
    )
  );
  if (!options.outPath) {
    console.log('\n--- PATCHED SOURCE ---\n');
    console.log(patchedCode);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
