import { describe } from 'vitest';
import { NATURE_TEMPLATES } from '../src/core/templates/nature';
import { checkTemplates } from './templateChecks';

describe('自然与动物示例', () => checkTemplates(NATURE_TEMPLATES));
