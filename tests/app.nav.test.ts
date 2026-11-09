// nav.ts against stubs (no DOM needed), from DESIGN.md 2.1a: NAV-08, NAV-15, NAV-17, NAV-18, NAV-19, NAV-20, NAV-21.
// aria-expanded on #nav-toggle is the only state. The button label is "Nav" (owner decision); nav.ts does not set it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type L = (e: any) => void;
class Node_ {
  attrs = new Map<string, string>();
  listeners = new Map<string, L[]>();
  parent: Node_ | null = null;
  focused = 0;
  hash = '';
  id: string;
  constructor(id = '') { this.id = id; }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  addEventListener(t: string, f: L) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)!).push(f); }
  fire(t: string, e: any) { for (const f of this.listeners.get(t) ?? []) f(e); }
  contains(n: Node_): boolean { for (let c: Node_ | null = n; c; c = c.parent) if (c === this) return true; return false; }
  closest(sel: string): Node_ | null {
    if (sel !== 'a[href]') throw new Error('unexpected selector');
    for (let c: Node_ | null = this; c; c = c.parent) if (c instanceof Anchor) return c;
    return null;
  }
  focus() { this.focused++; }
}
class Anchor extends Node_ {}
(globalThis as any).Node = Node_;
(globalThis as any).Element = Node_;

let toggle: Node_, nav: Node_, link: Anchor, outside: Node_;
let doc: Node_, win: Node_, mq: Node_, headingFocus: number;
const g = globalThis as any;
const def = (n: string, v: unknown) => Object.defineProperty(globalThis, n, { value: v, configurable: true, writable: true });
const loc = { hash: '#/' };
def('location', loc);

const { initNav } = await import('../src/app/nav.ts');

beforeEach(() => {
  toggle = new Node_('nav-toggle'); toggle.setAttribute('aria-expanded', 'false');
  nav = new Node_('site-nav');
  link = new Anchor(); link.parent = nav; link.hash = '#/methods';
  outside = new Node_('main');
  doc = new Node_(); win = new Node_(); mq = new Node_();
  loc.hash = '#/';
  headingFocus = 0;
  def('document', Object.assign(doc, { getElementById: (id: string) => (id === 'nav-toggle' ? toggle : id === 'site-nav' ? nav : null) }));
  def('window', Object.assign(win, { matchMedia: () => mq }));
  initNav({ focusHeading: () => { headingFocus++; } });
});

const open = () => toggle.fire('click', { target: toggle });
const expanded = () => toggle.getAttribute('aria-expanded');
// A click dispatched like the browser does: target listeners first, then it bubbles to document.
const click = (target: Node_) => { const e = { target }; if (nav.contains(target)) nav.fire('click', e); if (toggle === target) toggle.fire('click', e); doc.fire('click', e); };

test('missing toggle or nav: initNav does nothing and does not throw', () => {
  def('document', Object.assign(new Node_(), { getElementById: () => null }));
  assert.doesNotThrow(() => initNav({ focusHeading() {} }));
});

test('starts closed; clicking the toggle opens, clicking again closes (NAV-08)', () => {
  assert.equal(expanded(), 'false');
  click(toggle); assert.equal(expanded(), 'true');
  click(toggle); assert.equal(expanded(), 'false');
});

test('Escape from the panel closes it and focuses the toggle (NAV-15)', () => {
  open();
  const e = { key: 'Escape', target: link };
  nav.fire('keydown', e);
  assert.equal(expanded(), 'false');
  assert.equal(toggle.focused, 1);
});

test('Escape from the toggle itself closes it and keeps focus on the toggle', () => {
  open();
  toggle.fire('keydown', { key: 'Escape', target: toggle });
  assert.equal(expanded(), 'false');
  assert.equal(toggle.focused, 1);
});

test('Escape while closed does nothing, and does not steal focus', () => {
  nav.fire('keydown', { key: 'Escape', target: link });
  assert.equal(expanded(), 'false');
  assert.equal(toggle.focused, 0);
});

test('other keys do not close the panel', () => {
  open();
  nav.fire('keydown', { key: 'Tab', target: link });
  toggle.fire('keydown', { key: 'Enter', target: toggle });
  assert.equal(expanded(), 'true');
  assert.equal(toggle.focused, 0);
});

test('a panel link to another route closes it and leaves focus to the router (NAV-17)', () => {
  open();
  click(link);
  assert.equal(expanded(), 'false');
  assert.equal(headingFocus, 0);
});

test('a panel link to the current route closes it and focuses the heading (NAV-18)', () => {
  loc.hash = '#/methods';
  open();
  click(link);
  assert.equal(expanded(), 'false');
  assert.equal(headingFocus, 1);
});

test('a click inside the panel but not on a link keeps it open', () => {
  open();
  click(nav);
  assert.equal(expanded(), 'true');
});

test('a click outside the header closes it (NAV-19)', () => {
  open();
  click(outside);
  assert.equal(expanded(), 'false');
});

test('an outside click while closed leaves it closed', () => {
  click(outside);
  assert.equal(expanded(), 'false');
});

test('hashchange closes it and does not move focus (NAV-20)', () => {
  open();
  win.fire('hashchange', {});
  assert.equal(expanded(), 'false');
  assert.equal(toggle.focused, 0);
  assert.equal(headingFocus, 0);
});

test('crossing the compact breakpoint closes it (NAV-21)', () => {
  open();
  mq.fire('change', {});
  assert.equal(expanded(), 'false');
});

test('it can reopen after being closed by any route', () => {
  open(); win.fire('hashchange', {}); open();
  assert.equal(expanded(), 'true');
});
