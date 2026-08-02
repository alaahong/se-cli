#!/usr/bin/env node
import { main } from './program';
import { CliError } from './output';
main(process.argv.slice(2)).catch(e => {
  if (e instanceof CliError) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
  process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
