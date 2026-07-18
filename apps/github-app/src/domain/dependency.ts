/**
 * Pure domain helpers for classifying GitHub releases and PR file paths.
 * Kept free of Octokit/IO so unit and property tests stay cheap.
 */

const DEPENDENCY_KEYWORDS = [
  'dependency',
  'dependencies',
  'upgrade',
  'update',
  'bump',
  'package',
  'npm',
  'yarn',
  'pnpm',
  'cargo',
  'pip',
  'go.mod',
] as const;

const DEPENDENCY_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.toml',
  'Cargo.lock',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'go.sum',
  'Dockerfile',
]);

export function isDependencyRelease(release: {
  name?: string | null;
  body?: string | null;
  tag_name?: string;
}): boolean {
  const text = `${release.name ?? ''} ${release.body ?? ''}`.toLowerCase();
  return DEPENDENCY_KEYWORDS.some(keyword => text.includes(keyword));
}

export function extractPackageName(release: {
  tag_name?: string;
  name?: string | null;
}): string {
  const tagName = release.tag_name ?? '';
  const patterns = [/^([^@]+)@v?\d+\.\d+\.\d+/, /^([^@/]+)-v?\d+\.\d+\.\d+/];

  for (const pattern of patterns) {
    const match = tagName.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Pure semver tags do not encode a package name.
  if (/^v?\d+\.\d+\.\d+/.test(tagName)) {
    return release.name?.trim() || 'unknown';
  }

  return tagName || 'unknown';
}

export function isDependencyFile(filename: string): boolean {
  const base = filename.split('/').pop() ?? filename;
  return DEPENDENCY_FILE_NAMES.has(base);
}
