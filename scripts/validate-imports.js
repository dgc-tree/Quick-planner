#!/usr/bin/env node
/**
 * Pre-push import validator for Quick Planner.
 * Checks that all JS imports resolve to tracked (or allowably untracked) files.
 * Runs in < 2 seconds, no network required.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// All git-tracked files
const trackedFiles = new Set(
  execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
);

// All tracked JS files
const trackedJS = [...trackedFiles].filter(f => f.endsWith('.js') && !f.includes('node_modules'));

let errors = 0;

function checkImport(sourceFile, importPath, isStatic, lineNum) {
  // Only check relative imports
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) return;

  const sourceDir = dirname(resolve(repoRoot, sourceFile));
  const resolved = relative(repoRoot, resolve(sourceDir, importPath));

  if (trackedFiles.has(resolved)) return; // Tracked — all good

  if (existsSync(resolve(repoRoot, resolved))) {
    // File exists but is untracked/gitignored
    if (isStatic) {
      console.error(`ERROR: ${sourceFile}:${lineNum} — static import of untracked file '${importPath}'`);
      console.error(`  → Use dynamic import().catch() instead, or git-track the file`);
      errors++;
    }
    // Dynamic imports of untracked files are OK (version.js pattern)
  } else {
    console.error(`ERROR: ${sourceFile}:${lineNum} — import target '${importPath}' does not exist`);
    errors++;
  }
}

const STATIC_IMPORT_RE = /^\s*import\s.*from\s+['"]([^'"]+)['"]/;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]/g;
const TOP_LEVEL_AWAIT_IMPORT_RE = /^\s*await\s+import\(/;

for (const file of trackedJS) {
  const content = readFileSync(resolve(repoRoot, file), 'utf8');
  const lines = content.split('\n');
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track brace depth
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }

    // Static imports
    const staticMatch = line.match(STATIC_IMPORT_RE);
    if (staticMatch) {
      checkImport(file, staticMatch[1], true, lineNum);
    }

    // Dynamic imports
    let dynMatch;
    DYNAMIC_IMPORT_RE.lastIndex = 0;
    while ((dynMatch = DYNAMIC_IMPORT_RE.exec(line)) !== null) {
      checkImport(file, dynMatch[1], false, lineNum);

      // Warn about top-level await import
      if (braceDepth <= 0 && TOP_LEVEL_AWAIT_IMPORT_RE.test(line)) {
        console.warn(`WARNING: ${file}:${lineNum} — top-level 'await import()' can crash module evaluation`);
        console.warn(`  → Use import().then().catch() instead`);
      }
    }
  }
}

// ── Phase 2: Validate named imports resolve to actual exports ──
const NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;

for (const file of trackedJS) {
  const content = readFileSync(resolve(repoRoot, file), 'utf8');
  let match;
  NAMED_IMPORT_RE.lastIndex = 0;
  while ((match = NAMED_IMPORT_RE.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const from = match[2];
    if (!from.startsWith('./') && !from.startsWith('../')) continue;

    const sourceDir = dirname(resolve(repoRoot, file));
    const targetPath = resolve(sourceDir, from);
    if (!existsSync(targetPath)) continue; // already caught in phase 1

    const targetContent = readFileSync(targetPath, 'utf8');
    for (const name of names) {
      const exportPatterns = [
        new RegExp(`export\\s+(function|const|let|var|class)\\s+${name}\\b`),
        new RegExp(`export\\s+async\\s+function\\s+${name}\\b`),
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
      ];
      if (!exportPatterns.some(p => p.test(targetContent))) {
        console.error(`ERROR: ${file} — named import '${name}' not exported by '${from}'`);
        errors++;
      }
    }
  }
}

if (errors > 0) {
  console.error(`\nPre-push check FAILED: ${errors} import error(s) found.`);
  process.exit(1);
} else {
  console.log('Pre-push check passed — all imports resolve.');
  process.exit(0);
}
