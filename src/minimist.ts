export interface ParseOptions {
  boolean: string[];
  string: string[];
  alias: Record<string, string>;
}

export interface ParsedArgs {
  _: string[];
  [key: string]: any;
}

export function parseArgs(argv: string[], opts: ParseOptions): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  const allBoolean = new Set(opts.boolean);
  const allString = new Set(opts.string);

  for (const key of Object.values(opts.alias)) {
    allBoolean.add(key);
  }
  for (const [alias, full] of Object.entries(opts.alias)) {
    if (allBoolean.has(full)) allBoolean.add(alias);
    if (allString.has(full)) allString.add(alias);
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--') {
      result._.push(...argv.slice(i + 1));
      break;
    }

    const eqMatch = arg.match(/^(-{1,2})([\w-]+)=(.*)$/);
    if (eqMatch) {
      const isShort = eqMatch[1] === '-';
      const key = isShort ? (opts.alias[eqMatch[2]] || eqMatch[2]) : eqMatch[2];
      result[key] = eqMatch[3];
      i++;
      continue;
    }

    const flagMatch = arg.match(/^(-{1,2})([\w-]+)$/);
    if (flagMatch) {
      const isShort = flagMatch[1] === '-';
      const key = isShort ? (opts.alias[flagMatch[2]] || flagMatch[2]) : flagMatch[2];
      if (allBoolean.has(key)) {
        result[key] = true;
        i++;
      } else if (allString.has(key) && i + 1 < argv.length) {
        result[key] = argv[i + 1];
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
      continue;
    }

    result._.push(arg);
    i++;
  }

  return result;
}
