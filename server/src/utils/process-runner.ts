import { execFile as nodeExecFile } from 'child_process';

export type ExecFileCallback = (error: NodeJS.ErrnoException | null, stdoutOrResult: string | { stdout: string; stderr: string }, stderr?: string) => void;
export type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: Record<string, unknown>,
  callback: ExecFileCallback,
) => void;

export interface RunFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
  execFile?: ExecFileLike;
}

export function runFile(command: string, args: string[], options: RunFileOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const { execFile = nodeExecFile as unknown as ExecFileLike, ...execOptions } = options;
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...execOptions, shell: false }, (error, stdoutOrResult, stderr = '') => {
      const result: { stdout: string; stderr: string } = typeof stdoutOrResult === 'string'
        ? { stdout: stdoutOrResult, stderr: String(stderr || '') }
        : stdoutOrResult;
      if (error) {
        Object.assign(error, result);
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

export function buildArchiveCommand(format: string, destination: string, sources: string[]): { command: string; args: string[] } {
  if (!sources.length) throw new Error('At least one source path is required');
  if (format === 'zip') return { command: 'zip', args: ['-r', destination, ...sources] };
  if (format === 'tar.gz' || format === 'tgz') return { command: 'tar', args: ['-czf', destination, ...sources] };
  throw new Error('Unsupported archive format');
}

export function buildArchiveListCommand(archivePath: string): { command: string; args: string[]; verboseArgs: string[] } {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) return { command: 'unzip', args: ['-Z1', archivePath], verboseArgs: ['zipinfo', '-l', archivePath] };
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return { command: 'tar', args: ['-tzf', archivePath], verboseArgs: ['tar', '-tzvf', archivePath] };
  if (lower.endsWith('.tar.bz2')) return { command: 'tar', args: ['-tjf', archivePath], verboseArgs: ['tar', '-tjvf', archivePath] };
  if (lower.endsWith('.tar')) return { command: 'tar', args: ['-tf', archivePath], verboseArgs: ['tar', '-tvf', archivePath] };
  throw new Error('Unsupported archive format');
}

export function buildArchiveExtractCommand(archivePath: string, destination: string): { command: string; args: string[] } {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) return { command: 'unzip', args: ['-o', archivePath, '-d', destination] };
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return { command: 'tar', args: ['--no-same-owner', '--no-same-permissions', '-xzf', archivePath, '-C', destination] };
  if (lower.endsWith('.tar.bz2')) return { command: 'tar', args: ['--no-same-owner', '--no-same-permissions', '-xjf', archivePath, '-C', destination] };
  if (lower.endsWith('.tar')) return { command: 'tar', args: ['--no-same-owner', '--no-same-permissions', '-xf', archivePath, '-C', destination] };
  throw new Error('Unsupported archive format');
}
