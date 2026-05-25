const ALLOWED_DEPLOY_COMMANDS = new Set(['git', 'npm', 'pnpm', 'yarn', 'composer', 'php', 'node', 'pm2', 'systemctl']);
const UNSUPPORTED_SHELL_SYNTAX = /[;|`$<>(){}\n\r]/;

export interface DeployCommandStep {
  command: string;
  args: string[];
}

function splitWords(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (quote) throw new Error('Unterminated quote in deploy command');
  if (current) words.push(current);
  return words;
}

export function parseDeployCommandPlan(deployCommand: string): DeployCommandStep[] {
  if (typeof deployCommand !== 'string' || !deployCommand.trim()) throw new Error('deploy_command is empty');
  if (UNSUPPORTED_SHELL_SYNTAX.test(deployCommand)) throw new Error('Unsupported shell syntax in deploy_command');

  const steps = deployCommand.split(/\s+&&\s+/).map(part => part.trim()).filter(Boolean).map(part => {
    const [command, ...args] = splitWords(part);
    if (!command || !ALLOWED_DEPLOY_COMMANDS.has(command)) throw new Error(`Unsupported deploy command: ${command || '(empty)'}`);
    if (args.some(arg => arg.includes('&&'))) throw new Error('Unsupported shell syntax in deploy_command');
    return { command, args };
  });

  if (!steps.length) throw new Error('deploy_command is empty');
  return steps;
}
