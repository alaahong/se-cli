import * as path from 'path';
import * as fs from 'fs';

/**
 * SKILL.md multi-target installation (v0.9).
 *
 * Installs skill/SKILL.md (plus skill/references/ when present) into the
 * skill directories of one or more AI agents:
 *
 *   claude   → .claude/skills/se-cli/
 *   cursor   → .cursor/skills/se-cli/
 *   copilot  → .github/copilot/skills/se-cli/
 *   generic  → .agents/skills/se-cli/
 *   custom   → --path=<dir> (requires an explicit path)
 */

export interface AgentTarget {
  name: string;
  dir: string;
}

export const AGENTS: Record<string, string> = {
  claude: path.join('.claude', 'skills', 'se-cli'),
  cursor: path.join('.cursor', 'skills', 'se-cli'),
  copilot: path.join('.github', 'copilot', 'skills', 'se-cli'),
  generic: path.join('.agents', 'skills', 'se-cli'),
};

/** Agents installable without an explicit --path. */
export const DISCOVERABLE_AGENTS = ['claude', 'cursor', 'copilot'] as const;

export function listAgentTargets(): AgentTarget[] {
  return Object.entries(AGENTS).map(([name, dir]) => ({ name, dir }));
}

/**
 * Detect which agent skill directories already exist in the project so
 * `se-cli install --skills` can install everywhere the user already works.
 * copilot is detected via `.github/copilot/`, claude via `.claude/`,
 * cursor via `.cursor/`.
 */
export function detectInstalledAgents(cwd: string): string[] {
  const detectors: Record<string, string[]> = {
    claude: ['.claude'],
    cursor: ['.cursor'],
    copilot: ['.github', 'copilot'],
  };
  const found: string[] = [];
  for (const name of DISCOVERABLE_AGENTS) {
    const parts = detectors[name];
    const probe = path.join(cwd, ...parts);
    if (fs.existsSync(probe)) found.push(name);
  }
  return found;
}

/**
 * Parse a comma-separated --agent value into validated agent names.
 * Throws on unknown agents.
 */
export function parseAgentList(value: string): string[] {
  const names = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error('--agent requires at least one value');
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    if (!AGENTS[name] && name !== 'custom') {
      throw new Error(
        `Unknown agent: ${name}. Supported: ${Object.keys(AGENTS).join(', ')}, custom (with --path)`
      );
    }
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export interface InstallOptions {
  targets: string[];
  cwd: string;
  force?: boolean;
  sourceDir: string;
  customDir?: string;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
}

function copyRecursive(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Install skill/SKILL.md (+ skill/references/) into every requested target.
 * Returns the installed and skipped (already-exists) paths, relative to cwd.
 */
export function installSkills(opts: InstallOptions): InstallResult {
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const name of opts.targets) {
    let targetDir: string;
    if (name === 'custom') {
      if (!opts.customDir) {
        throw new Error('--agent=custom requires --path=<dir>');
      }
      targetDir = path.isAbsolute(opts.customDir) ? opts.customDir : path.join(opts.cwd, opts.customDir);
    } else {
      targetDir = path.join(opts.cwd, AGENTS[name]);
    }

    const destFile = path.join(targetDir, 'SKILL.md');
    if (fs.existsSync(destFile) && !opts.force) {
      skipped.push(destFile);
      continue;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(path.join(opts.sourceDir, 'SKILL.md'), destFile);

    const referencesSrc = path.join(opts.sourceDir, 'references');
    if (fs.existsSync(referencesSrc)) {
      const referencesDest = path.join(targetDir, 'references');
      fs.mkdirSync(referencesDest, { recursive: true });
      copyRecursive(referencesSrc, referencesDest);
    }

    installed.push(destFile);
  }

  return { installed, skipped };
}
