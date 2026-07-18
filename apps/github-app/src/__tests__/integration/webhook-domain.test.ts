import {
  extractPackageName,
  isDependencyFile,
  isDependencyRelease,
} from '../../domain/dependency';

describe('webhook domain helpers', () => {
  it('detects dependency releases from keywords', () => {
    expect(
      isDependencyRelease({
        name: 'Bump lodash',
        body: 'dependency update',
        tag_name: 'v1.2.3',
      })
    ).toBe(true);
    expect(
      isDependencyRelease({
        name: 'Release notes',
        body: 'no relevant changes',
        tag_name: 'v1.2.3',
      })
    ).toBe(false);
  });

  it('extracts package names from common tag patterns', () => {
    expect(extractPackageName({ tag_name: 'left-pad@1.2.3' })).toBe('left-pad');
    expect(extractPackageName({ tag_name: 'widgets-v2.0.0' })).toBe('widgets');
    expect(extractPackageName({ tag_name: 'v1.0.0', name: 'widgets' })).toBe(
      'widgets'
    );
  });

  it('matches dependency filenames by basename (not substring)', () => {
    expect(isDependencyFile('package.json')).toBe(true);
    expect(isDependencyFile('apps/web/package.json')).toBe(true);
    expect(isDependencyFile('docs/packaging-notes.md')).toBe(false);
    expect(isDependencyFile('src/Dockerfile')).toBe(true);
  });
});
