import { describe } from 'vitest';
import { CITY_TEMPLATES } from '../src/core/templates/city';
import { checkTemplates } from './templateChecks';

describe('城市与建筑示例', () => checkTemplates(CITY_TEMPLATES));
