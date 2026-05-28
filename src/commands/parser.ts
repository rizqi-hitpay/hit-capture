export interface ParsedCommand {
  type: 'click' | 'type' | 'scroll' | 'wait' | 'hover';
  target?: string;
  value?: string;
  ms?: number;
  direction?: 'up' | 'down';
  amount?: number;
}

export interface ParseError {
  line: number;
  text: string;
  reason: string;
}

export interface ParseResult {
  commands: ParsedCommand[];
  errors: ParseError[];
}

export function parseCommands(script: string): ParseResult {
  const commands: ParsedCommand[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < script.split('\n').length; i++) {
    const raw = script.split('\n')[i].trim();
    if (!raw || raw.startsWith('#')) continue;

    try {
      commands.push(parseLine(raw));
    } catch (err) {
      errors.push({ line: i + 1, text: raw, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { commands, errors };
}

function parseLine(line: string): ParsedCommand {
  const lower = line.toLowerCase();

  if (lower.startsWith('click ')) {
    const target = extractFirstQuoted(line);
    if (!target) throw new Error('Expected: click "Button Text"');
    return { type: 'click', target };
  }

  if (lower.startsWith('hover ')) {
    const target = extractFirstQuoted(line);
    if (!target) throw new Error('Expected: hover "Element Text"');
    return { type: 'hover', target };
  }

  if (lower.startsWith('type ')) {
    const [value, target] = extractTwoQuoted(line);
    if (!value || !target) throw new Error('Expected: type "value" in "field label"');
    return { type: 'type', value, target };
  }

  if (lower.startsWith('wait ')) {
    const rest = line.slice(5).trim().replace(/ms$/i, '');
    const ms = parseInt(rest, 10);
    if (isNaN(ms) || ms < 0) throw new Error('Expected: wait 500ms');
    return { type: 'wait', ms };
  }

  if (lower.startsWith('scroll ')) {
    const rest = lower.slice(7).trim();
    const direction: 'up' | 'down' | null = rest.startsWith('down')
      ? 'down'
      : rest.startsWith('up')
      ? 'up'
      : null;
    if (!direction) throw new Error('Expected: scroll down [px] or scroll up [px]');
    const afterDir = rest.slice(direction.length).trim();
    const amount = afterDir ? parseInt(afterDir, 10) : 300;
    return { type: 'scroll', direction, amount: isNaN(amount) ? 300 : amount };
  }

  throw new Error(`Unknown command. Supported: click, type, scroll, wait, hover`);
}

function extractFirstQuoted(line: string): string | null {
  const open = line.indexOf('"');
  if (open === -1) return null;
  const close = line.indexOf('"', open + 1);
  if (close === -1) return null;
  return line.slice(open + 1, close);
}

function extractTwoQuoted(line: string): [string | null, string | null] {
  const open1 = line.indexOf('"');
  if (open1 === -1) return [null, null];
  const close1 = line.indexOf('"', open1 + 1);
  if (close1 === -1) return [null, null];
  const first = line.slice(open1 + 1, close1);

  const open2 = line.indexOf('"', close1 + 1);
  if (open2 === -1) return [first, null];
  const close2 = line.indexOf('"', open2 + 1);
  if (close2 === -1) return [first, null];
  return [first, line.slice(open2 + 1, close2)];
}
