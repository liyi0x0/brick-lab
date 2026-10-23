import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/core/templates';
import { checkTemplates } from './templateChecks';

describe('示例作品', () => {
  it('数量充足，且包含大型作品', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });
  checkTemplates(TEMPLATES);
});
