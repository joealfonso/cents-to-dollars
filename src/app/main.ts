// App entry (DESIGN.md 7.2). Fonts, theme switch, mic indicator, skip link, routes.

import './fonts.ts';
import '../styles/links.css';
import { initTheme } from './theme.ts';
import { createRouter, type Route, type RouteName } from './router.ts';
import { overviewRoute } from './views/overview.ts';
import { toolsRoute } from './views/tools.ts';
import { voiceRoute } from './views/voice.ts';
import { fileRoute } from './views/file.ts';
import { methodsRoute } from './views/methods.ts';
import { aboutRoute } from './views/about.ts';
import { notFoundRoute } from './views/notfound.ts';
import { legacyRoute } from './views/legacy.ts';

initTheme();

function section(name: RouteName): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-route="${name}"]`);
  if (!el) throw new Error(`index.html has no <section data-route="${name}">`);
  return el;
}

const routes: Record<RouteName, Route> = {
  overview: overviewRoute(section('overview')),
  tools: toolsRoute(section('tools')),
  voice: voiceRoute(section('voice')),
  file: fileRoute(section('file')),
  methods: methodsRoute(section('methods')),
  about: aboutRoute(section('about')),
  notfound: notFoundRoute(section('notfound')),
  legacy: legacyRoute(section('legacy')),
};

// Dropped files (M2-DESIGN.md 1.6): left alone, the browser opens a dropped file in the tab, which leaves the
// app and stops a running mic session. Every route cancels that default; only #/file (views/file.ts) reads
// the file. Other routes ignore it with no message.
const carriesFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => { if (carriesFiles(e)) e.preventDefault(); });
}

const router = createRouter(routes);
router.start();

// Skip link: move focus to the route's h1 without changing the hash (a "#main" hash would be Not found).
document.getElementById('skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  router.focusHeading();
});

// Mic indicator: html[data-live] is set by whoever owns the microphone (today the legacy page, later live.ts).
// The role="status" region stays in the DOM; only its text changes, so the change is announced.
const mic = document.getElementById('mic-indicator');
function syncMic() {
  if (!mic) return;
  const on = document.documentElement.dataset.live === 'on';
  const text = mic.querySelector('.mic-text');
  if (text && text.textContent !== (on ? 'Mic on' : '')) text.textContent = on ? 'Mic on' : '';
}
new MutationObserver(syncMic).observe(document.documentElement, { attributes: true, attributeFilter: ['data-live'] });
syncMic();
