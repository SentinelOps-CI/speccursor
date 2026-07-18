import { ALLOWED_ECOSYSTEMS, isAllowedEcosystem } from '../../ecosystem';

describe('ecosystem domain', () => {
  it('accepts known ecosystems and rejects others', () => {
    for (const eco of ALLOWED_ECOSYSTEMS) {
      expect(isAllowedEcosystem(eco)).toBe(true);
    }
    expect(isAllowedEcosystem('cobol')).toBe(false);
    expect(isAllowedEcosystem('')).toBe(false);
  });
});
