import * as fc from 'fast-check';
import {
  extractPackageName,
  isDependencyFile,
  isDependencyRelease,
} from '../../domain/dependency';

describe('Webhook domain properties', () => {
  it('dependency file detection is basename-exact (no substring false positives)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), name => {
        const decorated = `prefix-${name}-suffix.md`;
        // Random non-manifest names must not match known manifests.
        if (
          ![
            'package.json',
            'pnpm-lock.yaml',
            'Cargo.toml',
            'go.mod',
            'Dockerfile',
          ].includes(name)
        ) {
          expect(isDependencyFile(decorated)).toBe(false);
        }
        return true;
      }),
      { numRuns: 50 }
    );

    expect(isDependencyFile('apps/web/package.json')).toBe(true);
    expect(isDependencyFile('docs/packaging-notes.md')).toBe(false);
  });

  it('release classification is keyword-driven and deterministic', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'dependency bump',
          'upgrade lodash',
          'chore: bump package',
          'npm update'
        ),
        body => {
          expect(
            isDependencyRelease({ name: 'release', body, tag_name: 'v1.0.0' })
          ).toBe(true);
          return true;
        }
      ),
      { numRuns: 20 }
    );

    expect(
      isDependencyRelease({
        name: 'Notes',
        body: 'no relevant changes',
        tag_name: 'v1.0.0',
      })
    ).toBe(false);
  });

  it('package name extraction never throws on arbitrary tags', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), tag => {
        const name = extractPackageName({ tag_name: tag, name: 'fallback' });
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
