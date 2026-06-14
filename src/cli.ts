#!/usr/bin/env node

import { parseArgs, UsageError, usageText } from "./args.js";
import { runCli } from "./runtime.js";

export async function run(argv: string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${usageText}\n`);
      return 0;
    }

    return await runCli(options);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${usageText}\n`);
      return 1;
    }
    throw error;
  }
}

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
