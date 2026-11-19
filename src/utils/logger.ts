import * as vscode from 'vscode';

/** Thin wrapper over a LogOutputChannel ("KeyBlaze" in the Output panel). */
export class Logger implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel;

  constructor(name = 'KeyBlaze') {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  info(message: string): void {
    this.channel.info(message);
  }

  warn(message: string): void {
    this.channel.warn(message);
  }

  error(message: string, err?: unknown): void {
    if (err instanceof Error) this.channel.error(`${message}: ${err.message}`);
    else if (err !== undefined) this.channel.error(`${message}: ${describe(err)}`);
    else this.channel.error(message);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

/** Runs `fn`, logging instead of throwing. Keeps a misbehaving effect from breaking typing. */
export function safely(logger: Logger, context: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error(context, err);
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
