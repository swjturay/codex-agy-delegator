export function parseCommandLine(commandLine: string): string[] {
  const input = commandLine.trim();
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (char === '\\') {
      const escapesNext = next !== undefined && (
        quote === '"'
          ? next === '"' || next === '\\'
          : /\s/u.test(next) || next === '"' || next === "'" || next === '\\'
      );
      if (escapesNext) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error(`Unterminated ${quote} quote in command: ${commandLine}`);
  if (current) parts.push(current);
  if (parts.length === 0) throw new Error('Command cannot be empty');
  return parts;
}
