function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function hasGlob(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
  const source = normalizePath(pattern);
  let regex = '^';

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '*' && next === '*') {
      const afterNext = source[i + 2];
      if (afterNext === '/') {
        regex += '(?:.*/)?';
        i += 2;
      } else {
        regex += '.*';
        i += 1;
      }
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(char);
    }
  }

  regex += '$';
  return new RegExp(regex);
}

export function matchesPathRule(filePath: string, pattern: string, loose: boolean = false): boolean {
  const file = normalizePath(filePath);
  const rule = normalizePath(pattern);
  if (!file || !rule) return false;

  if (hasGlob(rule)) {
    return globToRegex(rule).test(file);
  }

  if (file === rule || file.startsWith(`${rule}/`)) {
    return true;
  }

  return loose ? file.includes(rule) : false;
}

export function findRuleViolations(files: string[], rules: string[], loose: boolean = false): string[] {
  if (rules.length === 0) return [];
  return files.filter((file) => rules.some((rule) => matchesPathRule(file, rule, loose)));
}

export function findFilesOutsideRules(files: string[], rules: string[]): string[] {
  if (rules.length === 0) return [];
  return files.filter((file) => !rules.some((rule) => matchesPathRule(file, rule)));
}
