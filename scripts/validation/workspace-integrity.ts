/**
 * Workspace dependency/packaging integrity validation.
 *
 * Guards against the class of bug where a production workspace package
 * compiles and passes Jest (via moduleNameMapper) but fails at runtime under
 * plain `node dist/main.js` because either:
 *  1. a `@projectx/*` value import is not declared in the importing package's
 *     `dependencies`, or
 *  2. a workspace package that others depend on does not declare a `main`
 *     entrypoint (Node then falls back to `<pkg>/index.js`, which does not
 *     exist for dist-built packages), or
 *  3. the declared `main` points at a file missing from an existing build
 *     output directory.
 *
 * Usable as a library (Jest spec) and as a CLI (`pnpm validate:workspace`).
 */
import * as fs from 'fs';
import * as path from 'path';

export interface WorkspacePackage {
  name: string;
  dir: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  main?: string;
  types?: string;
}

export interface ImportUsage {
  packageName: string;
  file: string;
  typeOnly: boolean;
}

export interface IntegrityViolation {
  package: string;
  rule: 'undeclared-runtime-dependency' | 'undeclared-type-dependency' | 'missing-main-entrypoint' | 'missing-built-entrypoint';
  detail: string;
}

const WORKSPACE_SCOPE = '@projectx/';
const SOURCE_ROOTS = ['packages', 'apps'];

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function discoverWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  const result: WorkspacePackage[] = [];
  for (const root of SOURCE_ROOTS) {
    const rootDir = path.join(repoRoot, root);
    if (!fs.existsSync(rootDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pkgJsonPath = path.join(rootDir, entry.name, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) {
        continue;
      }
      const pkg = readJson(pkgJsonPath);
      result.push({
        name: pkg.name as string,
        dir: path.join(rootDir, entry.name),
        dependencies: (pkg.dependencies as Record<string, string>) ?? {},
        devDependencies: (pkg.devDependencies as Record<string, string>) ?? {},
        main: pkg.main as string | undefined,
        types: pkg.types as string | undefined,
      });
    }
  }
  return result;
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
        continue;
      }
      files.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts') || entry.name.endsWith('.spec.ts')) {
      continue;
    }
    files.push(full);
  }
  return files;
}

/**
 * Extracts `@projectx/*` imports from a TypeScript source file, classifying
 * each as type-only (fully erased at compile time) or a value import (emits a
 * runtime `require`).
 *
 * Type-only forms: `import type { X } from 'm'` and `export type { X } from 'm'`.
 * Everything else that references the module specifier (default/named/star
 * imports, bare side-effect imports, re-exports, `require(...)`) is treated
 * as a runtime import.
 */
export function extractWorkspaceImports(filePath: string): ImportUsage[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const usages: ImportUsage[] = [];

  const importExportRe =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"](@projectx\/[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importExportRe.exec(source)) !== null) {
    usages.push({
      packageName: match[3],
      file: filePath,
      typeOnly: Boolean(match[2]),
    });
  }

  const requireRe = /require\(\s*['"](@projectx\/[^'"]+)['"]\s*\)/g;
  while ((match = requireRe.exec(source)) !== null) {
    usages.push({ packageName: match[1], file: filePath, typeOnly: false });
  }

  return usages;
}

export function validateWorkspaceIntegrity(repoRoot: string): IntegrityViolation[] {
  const packages = discoverWorkspacePackages(repoRoot);
  const packagesByName = new Map(packages.map((p) => [p.name, p]));
  const violations: IntegrityViolation[] = [];

  const dependedUpon = new Set<string>();
  const rootPkg = readJson(path.join(repoRoot, 'package.json'));
  const rootDeps = {
    ...((rootPkg.dependencies as Record<string, string>) ?? {}),
    ...((rootPkg.devDependencies as Record<string, string>) ?? {}),
  };
  for (const dep of Object.keys(rootDeps)) {
    if (dep.startsWith(WORKSPACE_SCOPE)) {
      dependedUpon.add(dep);
    }
  }

  for (const pkg of packages) {
    for (const dep of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
      if (dep.startsWith(WORKSPACE_SCOPE) && packagesByName.has(dep)) {
        dependedUpon.add(dep);
      }
    }
  }

  // Rule 1: every @projectx/* import in src must be declared.
  for (const pkg of packages) {
    const srcDir = path.join(pkg.dir, 'src');
    const declaredRuntime = new Set(
      Object.keys(pkg.dependencies).filter((d) => d.startsWith(WORKSPACE_SCOPE)),
    );
    const declaredAnywhere = new Set([
      ...declaredRuntime,
      ...Object.keys(pkg.devDependencies).filter((d) => d.startsWith(WORKSPACE_SCOPE)),
    ]);

    const runtimeImports = new Map<string, string>();
    const typeOnlyImports = new Map<string, string>();
    for (const file of listSourceFiles(srcDir)) {
      for (const usage of extractWorkspaceImports(file)) {
        if (usage.packageName === pkg.name) {
          continue;
        }
        const rel = path.relative(repoRoot, usage.file);
        if (usage.typeOnly) {
          if (!typeOnlyImports.has(usage.packageName)) {
            typeOnlyImports.set(usage.packageName, rel);
          }
        } else if (!runtimeImports.has(usage.packageName)) {
          runtimeImports.set(usage.packageName, rel);
        }
      }
    }

    for (const [imported, file] of runtimeImports) {
      if (!declaredRuntime.has(imported)) {
        violations.push({
          package: pkg.name,
          rule: 'undeclared-runtime-dependency',
          detail: `${pkg.name} has a runtime (value) import of '${imported}' (e.g. ${file}) but does not declare it in "dependencies".`,
        });
      }
    }
    for (const [imported, file] of typeOnlyImports) {
      if (runtimeImports.has(imported)) {
        continue; // already required (and possibly reported) as runtime
      }
      if (!declaredAnywhere.has(imported)) {
        violations.push({
          package: pkg.name,
          rule: 'undeclared-type-dependency',
          detail: `${pkg.name} has a type-only import of '${imported}' (e.g. ${file}) but does not declare it in "dependencies" or "devDependencies".`,
        });
      }
    }
  }

  // Rule 2 + 3: every workspace package that is depended on must declare a
  // dist entrypoint, and if the build output directory exists the entrypoint
  // file must exist inside it.
  for (const name of dependedUpon) {
    const pkg = packagesByName.get(name);
    if (!pkg) {
      continue;
    }
    if (!pkg.main || !pkg.types) {
      violations.push({
        package: pkg.name,
        rule: 'missing-main-entrypoint',
        detail: `${pkg.name} is depended on by other workspace packages but does not declare "main" and "types" (expected ./dist/index.js and ./dist/index.d.ts). Plain 'node' cannot resolve it at runtime without them.`,
      });
      continue;
    }
    const mainPath = path.join(pkg.dir, pkg.main);
    const distDir = path.join(pkg.dir, 'dist');
    if (fs.existsSync(distDir) && !fs.existsSync(mainPath)) {
      violations.push({
        package: pkg.name,
        rule: 'missing-built-entrypoint',
        detail: `${pkg.name} declares "main": "${pkg.main}" but the file is missing from the existing build output (${path.relative(pkg.dir, distDir)}/). The build likely emits to a different layout.`,
      });
    }
  }

  return violations;
}

/* istanbul ignore next -- CLI wrapper exercised via pnpm validate:workspace */
if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const violations = validateWorkspaceIntegrity(repoRoot);
  if (violations.length === 0) {
    console.log('workspace-integrity: OK (no undeclared @projectx/* runtime dependencies, all depended-on packages declare dist entrypoints)');
    process.exit(0);
  }
  console.error(`workspace-integrity: ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`- [${v.rule}] ${v.detail}`);
  }
  process.exit(1);
}
