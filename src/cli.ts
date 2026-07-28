#!/usr/bin/env node
import { main } from './program';
main(process.argv.slice(2)).catch(e => {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
});
