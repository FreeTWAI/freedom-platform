import {createRequire} from 'node:module';
import {posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// The selector loads parsers only from its own installation. CI installs this
// workflow checkout's lockfile with lifecycle scripts disabled; candidate
// node_modules/configuration never supplies the dependency analyzer.
export function loadGuildPresentationParsers() {
  try {
    const require = createRequire(import.meta.url);
    const modules = fileURLToPath(new URL('../../node_modules/', import.meta.url));
    return {ts: require(resolve(modules, '@typescript/typescript6')), css: require(resolve(modules, 'postcss'))};
  } catch { return null; }
}

export function guildPresentationPath(path) {
  if (typeof path !== 'string' || path.split('/').some(part => !part || part === '..' || part.startsWith('.'))) return null;
  const leaf = GUILD_PRESENTATION_PROFILE.leaves.find(item => path.startsWith(`modules/${item.module}/`));
  if (!leaf || /(?:^|\/)(?:AGENTS\.md|[^/]*config[^/]*|freedom\.module\.json)$/i.test(path)) return null;
  if (GUILD_PRESENTATION_PROFILE.previewFiles.includes(path)) return {leaf, kind: 'test'};
  // New preview tests need runner enumeration before they can use this lane.
  if (/(?:^|[._/-])(?:tests?|specs?|fixtures?)(?:[._/-]|$)/i.test(path) || path.endsWith('.d.ts')) return null;
  return /\.(?:ts|tsx)$/.test(path) ? {leaf, kind: 'source'}
    : path.endsWith('.css') ? {leaf, kind: 'style'}
    : path.endsWith('.md') ? {leaf, kind: 'document'} : null;
}

function sourceImports(path, source, ts) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 262144) return null;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (file.parseDiagnostics.length || file.referencedFiles.length || file.typeReferenceDirectives.length
    || file.libReferenceDirectives.length || file.pragmas.has('jsximportsource')) return null;
  const imports = [];
  let valid = true, nodes = 0;
  const visit = (node, depth = 0) => {
    if (!valid || ++nodes > 30000 || depth > 128) { valid = false; return; }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier) || node.attributes) { valid = false; return; }
      imports.push(node.moduleSpecifier.text);
    }
    // Dynamic/type imports, CommonJS loaders and executable code loaders cannot
    // establish a static dependency closure. Ordinary strings/comments do not
    // participate. This is CI selection, not a JavaScript security sandbox.
    if (ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node) || ts.isMetaProperty(node)
      || node.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node) && ['require', 'eval', 'Function', 'Worker', 'SharedWorker'].includes(node.text)) valid = false;
    ts.forEachChild(node, child => visit(child, depth + 1));
  };
  visit(file);
  return valid ? imports : null;
}

function styleProven(source, css) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 262144) return false;
  // Existing local CSS is usable; imported styles/assets and escaped CSS names
  // remain broad until their resolution is explicitly supported by this lane.
  if (source.includes('\\')) return false;
  const root = css.parse(source);
  let valid = true;
  root.walkAtRules(node => { if (node.name.toLowerCase() === 'import') valid = false; });
  root.walkDecls(node => { if (/(?:url|image|image-set|cross-fade|paint|element|src)\s*\(/i.test(node.value)) valid = false; });
  return valid;
}

// Read all source/helper files in the approved module at both immutable Git
// revisions, not only the changed entry. Internal imports must resolve within
// that module. External dependencies remain exactly those present in the base,
// separated between product code and preview tests.
export function guildPresentationDependenciesProven({module, baseline, candidate}, parsers) {
  if (!parsers?.ts?.createSourceFile || !parsers?.css?.parse) return false;
  try {
    let totalBytes = 0;
    const dependencies = files => {
      if (!(files instanceof Map) || !files.size || files.size > 256) throw Error();
      const external = {source: new Set(), test: new Set()};
      for (const [path, source] of files) {
        if (path === `modules/${module}/freedom.module.json`) continue;
        const owner = guildPresentationPath(path);
        if (!owner || owner.leaf.module !== module || typeof source !== 'string') throw Error();
        totalBytes += Buffer.byteLength(source);
        if (totalBytes > 2000000) throw Error();
        if (owner.kind === 'document') continue;
        if (owner.kind === 'style') { if (!styleProven(source, parsers.css)) throw Error(); continue; }
        const imports = sourceImports(path, source, parsers.ts);
        if (!imports) throw Error();
        for (const specifier of imports) {
          if (!specifier || /[\\?#\0]/.test(specifier) || specifier.startsWith('/')) throw Error();
          const target = specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(path), specifier)) : specifier;
          if (target.startsWith(`modules/${module}/`)) {
            const stem = target.replace(/\.js$/, '');
            const matches = [...new Set([target, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`])].filter(file => files.has(file));
            if (matches.length !== 1) throw Error();
            const imported = guildPresentationPath(matches[0]);
            if (!imported || imported.kind === 'document' || owner.kind !== 'test' && imported.kind === 'test') throw Error();
          } else external[owner.kind === 'test' ? 'test' : 'source'].add(target);
        }
      }
      return external;
    };
    const before = dependencies(baseline), after = dependencies(candidate);
    return ['source', 'test'].every(kind => before[kind].size === after[kind].size
      && [...before[kind]].every(value => after[kind].has(value)));
  } catch { return false; }
}

export const GUILD_PRESENTATION_PROFILE = Object.freeze({
  id: 'guild-presentation',
  leaves: Object.freeze([
    Object.freeze({module: 'guild-supply', owner: 'guild-supply-maintainer',
      entry: 'modules/guild-supply/CatalogBlock.tsx', dependencies: Object.freeze(['guild-presentation', 'hosted-distribution', 'supplier-console']),
      surface: 'guild-block.supply-catalog.v1', operations: Object.freeze(['storefront.supply-catalog.list', 'supplier-console.summary'])}),
    Object.freeze({module: 'guild-open-source', owner: 'guild-open-source-maintainer',
      entry: 'modules/guild-open-source/WorksBlock.tsx', dependencies: Object.freeze(['guild-presentation', 'personal-content']),
      surface: 'guild-block.open-source-works.v1', operations: Object.freeze(['community.personal-content-page.view'])}),
  ]),
  runtimeSuite: 'runtime.guild-presentation',
  runtimeFiles: Object.freeze(['guild-blocks', 'guild-launchpad', 'guild-launchpad-contracts', 'guild-launchpad-profiles', 'launchpad-profile-defaults'].map(name => `tests/runtime/${name}.test.ts`)),
  integrationFiles: Object.freeze(['tests/e2e/guild-block-composition.spec.ts', 'tests/e2e/guild-launchpad.spec.ts', 'tests/e2e/guild-launchpad-profiles.spec.ts']),
  previewFiles: Object.freeze(['modules/guild-supply/CatalogBlock.spec.ts', 'modules/guild-open-source/WorksBlock.spec.ts', 'modules/guild-events/EventsBlock.spec.ts']),
});
