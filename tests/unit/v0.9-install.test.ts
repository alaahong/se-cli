import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AGENTS,
  listAgentTargets,
  detectInstalledAgents,
  parseAgentList,
  installSkills,
} from '../../src/install';

let tmpDir: string;
let sourceDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-install-test-'));
  sourceDir = path.join(tmpDir, 'skill');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '---\nname: se-cli\n---\n');
  fs.mkdirSync(path.join(sourceDir, 'references'));
  fs.writeFileSync(path.join(sourceDir, 'references', 'commands.md'), '# commands');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AGENTS / listAgentTargets', () => {
  it('maps known agents to their skill directories', () => {
    expect(AGENTS.claude).toBe(path.join('.claude', 'skills', 'se-cli'));
    expect(AGENTS.cursor).toBe(path.join('.cursor', 'skills', 'se-cli'));
    expect(AGENTS.copilot).toBe(path.join('.github', 'copilot', 'skills', 'se-cli'));
    expect(AGENTS.generic).toBe(path.join('.agents', 'skills', 'se-cli'));
  });

  it('lists all installable targets', () => {
    const targets = listAgentTargets();
    expect(targets.map((t) => t.name).sort()).toEqual(['claude', 'copilot', 'cursor', 'generic']);
    expect(targets.every((t) => typeof t.dir === 'string' && t.dir.length > 0)).toBe(true);
  });
});

describe('detectInstalledAgents', () => {
  it('detects none when no agent directories exist', () => {
    expect(detectInstalledAgents(tmpDir)).toEqual([]);
  });

  it('detects claude via .claude/', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    expect(detectInstalledAgents(tmpDir)).toContain('claude');
  });

  it('detects cursor via .cursor/', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    expect(detectInstalledAgents(tmpDir)).toContain('cursor');
  });

  it('detects copilot via .github/copilot/', () => {
    fs.mkdirSync(path.join(tmpDir, '.github', 'copilot'), { recursive: true });
    expect(detectInstalledAgents(tmpDir)).toContain('copilot');
  });

  it('detects multiple agents at once', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.github', 'copilot'), { recursive: true });
    const found = detectInstalledAgents(tmpDir);
    expect(found.sort()).toEqual(['claude', 'copilot', 'cursor']);
  });
});

describe('parseAgentList', () => {
  it('parses comma-separated agents', () => {
    expect(parseAgentList('claude,cursor,copilot')).toEqual(['claude', 'cursor', 'copilot']);
  });

  it('trims whitespace and dedupes', () => {
    expect(parseAgentList(' claude , cursor , claude ')).toEqual(['claude', 'cursor']);
  });

  it('accepts custom', () => {
    expect(parseAgentList('custom')).toEqual(['custom']);
  });

  it('throws on unknown agents', () => {
    expect(() => parseAgentList('claude,foo')).toThrow(/Unknown agent: foo/);
  });

  it('throws on empty values', () => {
    expect(() => parseAgentList('')).toThrow(/at least one value/);
    expect(() => parseAgentList(',,')).toThrow(/at least one value/);
  });
});

describe('installSkills', () => {
  it('installs SKILL.md and references into the requested target', () => {
    const result = installSkills({ targets: ['claude'], cwd: tmpDir, sourceDir });
    expect(result.installed).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    const dest = path.join(tmpDir, AGENTS.claude);
    expect(fs.existsSync(path.join(dest, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toContain('name: se-cli');
    expect(fs.existsSync(path.join(dest, 'references', 'commands.md'))).toBe(true);
  });

  it('installs into multiple targets', () => {
    const result = installSkills({ targets: ['claude', 'cursor', 'copilot'], cwd: tmpDir, sourceDir });
    expect(result.installed).toHaveLength(3);
    expect(fs.existsSync(path.join(tmpDir, AGENTS.claude, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, AGENTS.cursor, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, AGENTS.copilot, 'SKILL.md'))).toBe(true);
  });

  it('skips existing files without --force', () => {
    const dest = path.join(tmpDir, AGENTS.claude);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), 'existing');
    const result = installSkills({ targets: ['claude'], cwd: tmpDir, sourceDir });
    expect(result.installed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('existing');
  });

  it('overwrites existing files with --force', () => {
    const dest = path.join(tmpDir, AGENTS.claude);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), 'existing');
    const result = installSkills({ targets: ['claude'], cwd: tmpDir, sourceDir, force: true });
    expect(result.installed).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toContain('name: se-cli');
  });

  it('installs to a custom --path (relative to cwd)', () => {
    const result = installSkills({
      targets: ['custom'],
      cwd: tmpDir,
      sourceDir,
      customDir: path.join('my-agent', 'skills'),
    });
    expect(result.installed).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, 'my-agent', 'skills', 'SKILL.md'))).toBe(true);
  });

  it('installs to an absolute custom path', () => {
    const abs = path.join(tmpDir, 'abs-skills');
    const result = installSkills({ targets: ['custom'], cwd: tmpDir, sourceDir, customDir: abs });
    expect(result.installed).toHaveLength(1);
    expect(fs.existsSync(path.join(abs, 'SKILL.md'))).toBe(true);
  });

  it('throws when custom is requested without --path', () => {
    expect(() => installSkills({ targets: ['custom'], cwd: tmpDir, sourceDir })).toThrow(
      /--agent=custom requires --path/
    );
  });

  it('returns empty results when nothing is installed', () => {
    const existing = path.join(tmpDir, AGENTS.generic);
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), 'x');
    const result = installSkills({ targets: ['generic'], cwd: tmpDir, sourceDir });
    expect(result.installed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
});
