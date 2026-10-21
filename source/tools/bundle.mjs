// Resolve and read inputs through Node, including on Windows with restricted directory traversal.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [entry, outfile, ...extra] = process.argv.slice(2);
await esbuild.build({
  entryPoints: [path.resolve(entry)], bundle: true, format: 'iife', platform: 'browser',
  minify: true, target: 'es2020', write: false, tsconfigRaw: {},
  define: extra.includes('--define:import.meta.url=self.location.href') ? { 'import.meta.url': 'self.location.href' } : {},
  plugins: [{ name: 'node-file-access', setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('node:')) return { path: args.path, external: true };
      let resolved;
      if (path.isAbsolute(args.path)) resolved = args.path;
      else if (args.path.startsWith('.')) resolved = path.resolve(path.dirname(args.importer), args.path);
      else {
        const require = createRequire(args.importer || path.resolve('package.json'));
        try { resolved = fileURLToPath(import.meta.resolve(args.path)); }
        catch { resolved = require.resolve(args.path); }
        // Prefer ESM package entry points for tree shaking, as the browser resolver does.
        const pkgFile = (() => { try { return require.resolve(args.path + '/package.json'); } catch { return null; } })();
        if (pkgFile) {
          const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
          if (typeof pkg.module === 'string') resolved = path.resolve(path.dirname(pkgFile), pkg.module);
        }
      }
      return { path: resolved, namespace: 'source' };
    });
    build.onLoad({ filter: /.*/, namespace: 'source' }, (args) => ({
      contents: fs.readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.json') ? 'json' : 'js',
    }));
  }}],
}).then((result) => fs.writeFileSync(outfile, result.outputFiles[0].contents));
