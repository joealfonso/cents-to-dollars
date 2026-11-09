// F-29: a test fails if any file under src/dsp/ or the shared analysis module (src/take/) references
// `document`, `window`, `navigator`, `self`, `postMessage`, or imports a `node:` module.
// CLAUDE.md: src/dsp is shared by the AudioWorklet, the Worker and the Node runner, so it must stay DOM-free and Node-free.
//
// The scanner strips comments and string/template contents first, so prose such as "the window" in a comment does
// not count, and ignores property accesses (`this.window`, `spec.window`), object keys (`window:`) and
// declarations of a local with that name. The scanner itself is tested below on snippets it must flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { ROOT } from './take.helpers.ts';

const GLOBALS = ['document', 'window', 'navigator', 'self', 'postMessage'];
const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function stripStrings(src: string): string {
  return src.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

/** Matching close index for every opener of `open`/`close` in `code` (-1 when unmatched). */
function matchPairs(code: string, open: string, close: string): Map<number, number> {
  const out = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === open) stack.push(i);
    else if (code[i] === close) { const o = stack.pop(); if (o !== undefined) out.set(o, i); }
  }
  for (const o of stack) out.set(o, code.length);
  return out;
}

interface Decl { name: string; from: number; to: number }

export function scan(source: string): string[] {
  const found: string[] = [];
  const noComments = stripComments(source);
  // Import specifiers are strings, so look at them before the strings are blanked. Template literals count.
  const specs = [
    ...noComments.matchAll(/\bfrom\s*['"`]([^'"`]+)['"`]/g),
    ...noComments.matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g),
    ...noComments.matchAll(/\brequire\s*\(\s*['"`]([^'"`]+)['"`]/g),
    ...noComments.matchAll(/\bimport\s*['"`]([^'"`]+)['"`]/g),
  ].map((m) => m[1]);
  for (const sp of specs) {
    if (sp.startsWith('node:') || NODE_BUILTINS.has(sp.split('/')[0])) found.push(`imports ${sp}`);
  }
  // Dynamic imports or requires whose specifier is not a plain literal cannot be proven free of node: modules.
  for (const m of noComments.matchAll(/\b(?:import|require)\s*\(\s*(?!['"`])/g)) { found.push(`dynamic import/require with a computed specifier at ${m.index}`); break; }
  for (const m of noComments.matchAll(/\b(?:import|require)\s*\(\s*`[^`]*\$\{/g)) { found.push(`template-literal import/require with an expression at ${m.index}`); break; }
  // globalThis.<dom name> and globalThis['<dom name>'] reach the same globals.
  for (const g of GLOBALS) {
    if (new RegExp(`\\bglobalThis\\s*(?:\\?\\.|\\.)\\s*${g}\\b|\\bglobalThis\\s*\\[\\s*['"\`]${g}['"\`]`).test(noComments)) found.push(`references globalThis.${g}`);
  }

  const code = stripStrings(noComments);
  const braces = matchPairs(code, '{', '}');
  const parens = matchPairs(code, '(', ')');
  const enclosingBlock = (pos: number): [number, number] => {
    let best: [number, number] | null = null;
    for (const [o, c] of braces) if (o < pos && pos < c && (!best || o > best[0])) best = [o, c];
    return best ?? [0, code.length];
  };
  /** The block that a `for (...)` header or a parameter list scopes its names to: the next block after the close paren. */
  const bodyAfter = (closeParen: number): [number, number] => {
    const rest = code.slice(closeParen + 1);
    const m = /^\s*(?::[^={;]*)?(?:=>)?\s*\{/.exec(rest);
    if (m) { const o = closeParen + m[0].length; return [o, braces.get(o) ?? code.length]; }
    const semi = code.indexOf(';', closeParen);
    return [closeParen, semi < 0 ? code.length : semi];
  };
  const decls: Decl[] = [];
  const addNames = (list: string, pos: number, scope: [number, number], param = false) => {
    for (const part of list.split(',')) {
      const nm = (param ? part.split(':')[0] : part.split(':').pop()!).split('=')[0].replace(/[.\s]/g, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) decls.push({ name: nm, from: Math.min(scope[0], pos), to: scope[1] });
    }
  };
  const scopeOfDecl = (pos: number): [number, number] => {
    // Inside a `for (` header the names belong to the loop body.
    for (const [o, c] of parens) {
      if (o < pos && pos < c && /\bfor\s*(?:await\s*)?$/.test(code.slice(Math.max(0, o - 12), o))) return bodyAfter(c);
    }
    return enclosingBlock(pos);
  };
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) addNames(m[1], m.index, scopeOfDecl(m.index));
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) addNames(m[1], m.index, scopeOfDecl(m.index));
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) addNames(m[1], m.index, scopeOfDecl(m.index));
  for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) addNames(m[1], m.index, enclosingBlock(m.index));
  // Parameters: `function f(a, b) {`, `(a, b) => ...`, `a => ...`, methods `name(a, b) {`.
  for (const [o, c] of parens) {
    const after = code.slice(c + 1);
    const before = code.slice(Math.max(0, o - 40), o);
    const isFn = /\bfunction\s*[\w$]*\s*$/.test(before) || /^\s*(?::[^={;]*)?=>/.test(after) || (/^\s*(?::[^={;]*)?\{/.test(after) && /[\w$]\s*$/.test(before) && !/\b(?:if|for|while|switch|catch|with)\s*$/.test(before));
    if (isFn) addNames(code.slice(o + 1, c), o, bodyAfter(c), true);
  }
  for (const m of code.matchAll(/(?<![\w$.)])([A-Za-z_$][\w$]*)\s*=>/g)) {
    const end = m.index + m[0].length;
    const nm = m[1];
    const body = /^\s*\{/.test(code.slice(end)) ? bodyAfter(end - 1) : [end, Math.min(code.indexOf(';', end) < 0 ? code.length : code.indexOf(';', end), code.length)] as [number, number];
    decls.push({ name: nm, from: m.index, to: body[1] });
  }

  const shadowed = (name: string, pos: number) => decls.some((d) => d.name === name && d.from <= pos && pos <= d.to);
  const keyOrAnnotation = (pos: number, len: number) => {
    // `name:` is an object key / type annotation only after `{`, `,`, `(` or a modifier; after `?` it is a ternary branch.
    if (!/^\s*:(?!:)/.test(code.slice(pos + len))) return false;
    return /(?:[{,(]|\b(?:readonly|public|private|protected|static|declare))\s*$/.test(code.slice(Math.max(0, pos - 14), pos));
  };
  for (const g of GLOBALS) {
    const re = new RegExp(`(?<![\\w$.])${g}(?![\\w$])`, 'g');
    for (const m of code.matchAll(re)) {
      if (keyOrAnnotation(m.index, g.length)) continue;
      if (shadowed(g, m.index)) continue;
      found.push(`references ${g}`);
      break;
    }
  }
  return found;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)).sort();
}

test('F-29 scanner flags each forbidden reference and import', () => {
  for (const g of GLOBALS) assert.deepEqual(scan(`const x = ${g}.foo;`), [`references ${g}`], g);
  assert.deepEqual(scan('postMessage({ a: 1 });'), ['references postMessage']);
  assert.deepEqual(scan('self.onmessage = () => {};'), ['references self']);
  assert.deepEqual(scan("import { readFileSync } from 'node:fs';"), ['imports node:fs']);
  assert.deepEqual(scan("import fs from 'fs';"), ['imports fs']);
  assert.deepEqual(scan("const m = await import('node:path');"), ['imports node:path']);
  assert.deepEqual(scan("const m = require('node:os');"), ['imports node:os']);
  assert.deepEqual(scan("typeof window !== 'undefined'"), ['references window']);
  assert.deepEqual(scan('const { re } = this; window.addEventListener("x", f);'), ['references window']);
});

test('F-29 scanner flags the bypasses: globalThis access, ternary branches, template-literal imports, shadowing elsewhere in the file', () => {
  assert.deepEqual(scan('globalThis.document.title = "x";'), ['references globalThis.document']);
  assert.deepEqual(scan('globalThis.postMessage(1);'), ['references globalThis.postMessage']);
  assert.deepEqual(scan('const s = globalThis.self;'), ['references globalThis.self']);
  assert.deepEqual(scan("const w = globalThis['window'];"), ['references globalThis.window']);
  assert.deepEqual(scan('const w = globalThis?.navigator;'), ['references globalThis.navigator']);
  assert.deepEqual(scan('const t = cond ? self : other;'), ['references self']);
  assert.deepEqual(scan('const t = cond ? 1 : window;'), ['references window']);
  assert.deepEqual(scan('const t = { a: cond ? document : null };'), ['references document']);
  assert.deepEqual(scan('const m = await import(`node:fs`);'), ['imports node:fs']);
  assert.deepEqual(scan('const m = require(`node:fs`);'), ['imports node:fs']);
  assert.deepEqual(scan('const m = await import(`node:${name}`);').length > 0, true);
  assert.deepEqual(scan('const m = await import(name);').length > 0, true);
  // A local `window` in one function does not hide the global in another.
  assert.deepEqual(scan('function a() { const window = 1; return window; }\nfunction b() { return window.innerWidth; }'), ['references window']);
  assert.deepEqual(scan('function a(window) { return window; }\nconst x = window;'), ['references window']);
  assert.deepEqual(scan('for (const window of list) { use(window); }\nuse(window);'), ['references window']);
  assert.deepEqual(scan('const f = (self) => self;\nconst y = self;'), ['references self']);
});

test('F-29 scanner ignores comments, strings, properties, keys and names the enclosing scope declares', () => {
  assert.deepEqual(scan('// the window of frames, document the self-test\nconst a = 1;'), []);
  assert.deepEqual(scan('/* navigator postMessage */ const a = 1;'), []);
  assert.deepEqual(scan('const s = "self window document";'), []);
  assert.deepEqual(scan('this.window[i] = 1; spec.window = 2;'), []);
  assert.deepEqual(scan('const o = { window: 1, self: 2 };'), []);
  assert.deepEqual(scan('class A { readonly window: Float64Array; }'), []);
  assert.deepEqual(scan('for (const window of windows) { use(window); }'), []);
  assert.deepEqual(scan('class S { m() { const { re, im, window, size } = this; re[0] = window[0]; } }'), []);
  assert.deepEqual(scan('function f(window: number[]) { return window[0]; }'), []);
  assert.deepEqual(scan('const g = (self) => self + 1;'), []);
  assert.deepEqual(scan("import { a } from './local.ts';"), []);
  assert.deepEqual(scan("const m = await import('./local.ts');"), []);
});

test('F-29: src/dsp/ and src/take/ are free of DOM globals, postMessage and node: imports', () => {
  const dirs = [join(ROOT, 'src/dsp'), join(ROOT, 'src/take')];
  const files: string[] = [];
  for (const d of dirs) {
    assert.ok(existsSync(d), `${d} exists (the shared analysis module must live in src/take/)`);
    files.push(...tsFiles(d));
  }
  assert.ok(files.some((f) => f.includes('src/dsp/yin.ts')), 'scan covers src/dsp');
  assert.ok(files.some((f) => f.endsWith('src/take/analyse.ts')), 'scan covers src/take/analyse.ts');
  const problems: string[] = [];
  for (const f of files) for (const p of scan(readFileSync(f, 'utf8'))) problems.push(`${f.slice(ROOT.length + 1)}: ${p}`);
  assert.deepEqual(problems, []);
});
