import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { scanRepo } from './scanner.js';
import { generateSkills, type GeneratedSkill } from './generator.js';
import { colors, spinner, banner, ask, confirm, table } from './ui.js';
import { getSkillsDir, listSkills, getConfig, setConfig } from './store.js';

export async function train(paths: string[]): Promise<void> {
  banner();
  const skillsDir = getSkillsDir();
  const allGenerated: GeneratedSkill[] = [];

  for (const p of paths) {
    const repoPath = resolve(p);
    const repoName = basename(repoPath);

    const scanSpin = spinner(`Scanning ${repoName}...`);
    const profile = await scanRepo(repoPath);
    scanSpin.stop();

    const genSpin = spinner(`Generating skills for ${repoName}...`);
    const generated = await generateSkills(profile, skillsDir);
    genSpin.stop();

    allGenerated.push(...generated);
  }

  if (allGenerated.length === 0) {
    console.log(colors.yellow('No skills generated.'));
    return;
  }

  console.log(colors.green(`\n✓ Generated ${allGenerated.length} skill(s):\n`));
  table(allGenerated.map(s => ({
    Name: s.name,
    Description: s.description ?? '',
    Category: s.category ?? '',
    Source: s.sourceRepo ?? '',
  })));

  const shouldPush = await confirm('Push skills to GitHub?');
  if (shouldPush) {
    await push();
  }
}

export async function init(targetDir: string, all = false): Promise<void> {
  const skills = listSkills();
  if (skills.length === 0) {
    console.log(colors.yellow('No trained skills found. Run `skillsmith train` first.'));
    return;
  }

  let selected: typeof skills;

  if (all) {
    selected = skills;
  } else {
    console.log(colors.bold('\nAvailable skills:\n'));
    skills.forEach((s, i) => {
      console.log(`  ${colors.cyan(`[${i + 1}]`)} ${s.name} — ${s.description ?? 'no description'}`);
    });

    const answer = await ask('\nWhich skills to install? (comma-separated numbers, or "all"): ');
    if (answer.trim().toLowerCase() === 'all') {
      selected = skills;
    } else {
      const indices = answer.split(',').map(n => parseInt(n.trim(), 10) - 1);
      selected = indices.filter(i => i >= 0 && i < skills.length).map(i => skills[i]);
    }
  }

  if (selected.length === 0) {
    console.log(colors.yellow('No skills selected.'));
    return;
  }

  const skillsDest = join(resolve(targetDir), '.claude', 'skills');
  mkdirSync(skillsDest, { recursive: true });

  const skillsDir = getSkillsDir();
  for (const skill of selected) {
    const src = join(skillsDir, skill.name);
    const dest = join(skillsDest, skill.name);
    cpSync(src, dest, { recursive: true });
  }

  const settingsPath = join(resolve(targetDir), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, JSON.stringify({ skills: {} }, null, 2));
  }

  console.log(colors.green(`\n✓ Installed ${selected.length} skill(s) into ${skillsDest}:\n`));
  selected.forEach(s => console.log(`  • ${s.name}`));
}

export async function push(remote?: string): Promise<void> {
  const skillsDir = getSkillsDir();

  if (!remote) {
    remote = await ask('GitHub repo name (e.g. my-skills): ');
  }
  remote = remote.trim();

  // Check if repo exists
  try {
    execSync(`gh repo view ${remote}`, { stdio: 'ignore' });
  } catch {
    const spin = spinner(`Creating GitHub repo ${remote}...`);
    execSync(`gh repo create ${remote} --public --confirm`, { stdio: 'ignore' });
    spin.stop();
  }

  // Init git if needed
  if (!existsSync(join(skillsDir, '.git'))) {
    execSync('git init', { cwd: skillsDir, stdio: 'ignore' });
  }

  // Get remote URL
  let repoUrl: string;
  try {
    repoUrl = execSync(`gh repo view ${remote} --json url -q .url`, { encoding: 'utf-8' }).trim();
  } catch {
    repoUrl = `https://github.com/${remote}`;
  }

  // Set remote
  try {
    execSync(`git remote add origin ${repoUrl}.git`, { cwd: skillsDir, stdio: 'ignore' });
  } catch {
    execSync(`git remote set-url origin ${repoUrl}.git`, { cwd: skillsDir, stdio: 'ignore' });
  }

  execSync('git add -A', { cwd: skillsDir, stdio: 'ignore' });

  try {
    execSync('git commit -m "Update skills"', { cwd: skillsDir, stdio: 'ignore' });
  } catch {
    // Nothing to commit
  }

  const pushSpin = spinner('Pushing to GitHub...');
  execSync('git push -u origin main 2>/dev/null || git push -u origin master', {
    cwd: skillsDir,
    stdio: 'ignore',
  });
  pushSpin.stop();

  console.log(colors.green(`\n✓ Skills pushed to ${repoUrl}`));
}

export function list(): void {
  const skills = listSkills();

  if (skills.length === 0) {
    console.log(colors.yellow('No trained skills. Run `skillsmith train` first.'));
    return;
  }

  table(skills.map(s => ({
    Name: s.name,
    Description: s.description ?? '',
    Category: s.category ?? '',
    Source: s.sourceRepo ?? '',
  })));
}

export function config(key?: string, value?: string): void {
  if (!key) {
    const cfg = getConfig();
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }

  if (value === undefined) {
    const cfg = getConfig();
    const val = (cfg as Record<string, unknown>)[key];
    if (val === undefined) {
      console.log(colors.yellow(`Config key "${key}" not set.`));
    } else {
      console.log(`${key} = ${JSON.stringify(val)}`);
    }
    return;
  }

  setConfig(key, value);
  console.log(colors.green(`✓ ${key} = ${JSON.stringify(value)}`));
}
