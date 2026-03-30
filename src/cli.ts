#!/usr/bin/env node

import { resolve } from "path";
import { banner, colors } from "./ui.js";
import { train, init, push, list, config } from "./commands.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  banner();
  console.log(`
${colors.bold("Usage:")} skillsmith <command> [options]

${colors.bold("Commands:")}
  ${colors.cyan("train")} <path...>      Learn patterns from one or more repos
  ${colors.cyan("init")}  [dir]          Set up .claude/ skills in a project
  ${colors.cyan("push")}  [repo]         Push your skill library to GitHub
  ${colors.cyan("list")}                 List all trained skills
  ${colors.cyan("config")} [key] [val]   Get or set configuration

${colors.bold("Options:")}
  --all                Install all skills (with init)
  --force              Overwrite existing skills
  -h, --help           Show this help
  -v, --version        Show version

${colors.bold("Examples:")}
  ${colors.dim("# Train on your repos")}
  skillsmith train ~/projects/my-app ~/projects/api-server

  ${colors.dim("# Set up skills in current project")}
  skillsmith init .

  ${colors.dim("# Push skills to GitHub")}
  skillsmith push
`);
}

async function main(): Promise<void> {
  if (!command || command === "-h" || command === "--help") {
    printHelp();
    process.exit(0);
  }

  if (command === "-v" || command === "--version") {
    console.log("skillsmith v0.1.0");
    process.exit(0);
  }

  try {
    switch (command) {
      case "train": {
        const paths = args.slice(1).filter(a => !a.startsWith("-"));
        if (paths.length === 0) {
          console.error(`${colors.red("Error:")} Provide at least one repo path`);
          console.error(`  ${colors.dim("skillsmith train ~/my-project")}`);
          process.exit(1);
        }
        await train(paths.map(p => resolve(p)));
        break;
      }
      case "init": {
        const dir = args[1] && !args[1].startsWith("-") ? resolve(args[1]) : process.cwd();
        const all = args.includes("--all");
        await init(dir, { all });
        break;
      }
      case "push": {
        const remote = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
        await push(remote);
        break;
      }
      case "list": {
        await list();
        break;
      }
      case "config": {
        const key = args[1];
        const value = args[2];
        await config(key, value);
        break;
      }
      default:
        console.error(`${colors.red("Unknown command:")} ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n${colors.red("Error:")} ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
