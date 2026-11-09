// About, #/about. What the site is, who it is for, what it measures, how accurate it is, and privacy.
// No accuracy figures here (DESIGN.md 1.1): the page says how it is tested and links to VALIDATION.md.

import type { Route } from '../router.ts';
import '../../styles/about.css';

const DOC_NOTE = '<span class="about-doc-note" id="about-doc-note">Both open as plain text and only work on the development server.</span>';

const more = (summary: string, body: string) => `
      <details class="disclosure about-more">
        <summary><span class="am-label">${summary}<svg class="am-wave" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path pathLength="1" d="M0 4.00 L2 6.28 L4 6.76 L6 5.19 L8 2.84 L10 1.46 L12 2.02 L14 4.00 L16 5.87 L18 6.26 L20 4.98 L22 3.05 L24 1.92 L26 2.38 L28 4.00 L30 5.53 L32 5.85 L34 4.80 L36 3.22 L38 2.30 L40 2.68 L42 4.00 L44 5.25 L46 5.52 L48 4.66 L50 3.36 L52 2.61 L54 2.92 L56 4.00 L58 5.02 L60 5.24 L62 4.54 L64 3.48 L66 2.86 L68 3.11 L70 4.00 L72 4.84 L74 5.02 L76 4.44 L78 3.57 L80 3.07 L82 3.27 L84 4.00 L86 4.69 L88 4.83 L90 4.36 L92 3.65 L94 3.24 L96 3.40 L98 4.00 L100 4.56 L102 4.68 L104 4.29 L106 3.71 L108 3.37 L110 3.51 L112 4.00 L114 4.46 L116 4.56 L118 4.24 L120 3.77"/></svg></span></summary>
        <div class="about-more-body">${body}</div>
      </details>`;

// Section index: id of the section's h2, and the short chip label.
const TOC: [id: string, label: string][] = [
  ['about-who', 'Who it\'s for'],
  ['about-what', 'What it measures'],
  ['about-accuracy', 'Accuracy'],
  ['about-privacy', 'Privacy'],
  ['about-limits', 'What it isn\'t'],
  ['about-next', 'Coming later'],
];

const html = `
<div class="shell route about">
  <header class="page-header">
    <div class="ph-text">
      <h1 id="about-title" tabindex="-1">About Cents to Dollars</h1>
      <p class="lede">Cents to Dollars shows you what your voice is doing while you sing: the note you are on, how far sharp or flat you are, and your vibrato. It runs in your browser and nothing you sing leaves it.</p>
    </div>
  </header>

  <nav class="about-toc" aria-label="On this page">
    <div class="about-toc-scroll">
      <ul role="list">
        ${TOC.map(([id, label]) => `<li><button type="button" class="about-toc-chip" data-target="${id}">${label}</button></li>`).join('')}
      </ul>
      <span class="about-toc-ink" aria-hidden="true"></span>
    </div>
  </nav>

  <div class="about-grid">
    <section class="sec about-sec" aria-labelledby="about-who">
      <header class="sec-head"><h2 class="sec-title" id="about-who" tabindex="-1">Who it's for</h2></header>
      <div class="sec-body">
        <p class="prose">I built Cents to Dollars for an opera singer, to give her and other singers tools to hear what their voices are doing and get better.</p>
        <p class="prose">Opera is sung without a microphone, and you don't need one here. The app listens through the laptop or phone you already have, from a metre or two away, and the singing screen is made to be read from there.</p>
        <p class="prose">You don't need to know any acoustics to use it. Every reading is in plain words on the screen, and the technical detail is there when you want it.</p>
      </div>
    </section>

    <section class="sec about-sec" aria-labelledby="about-what">
      <header class="sec-head"><h2 class="sec-title" id="about-what" tabindex="-1">What it measures</h2></header>
      <div class="sec-body about-list">
        <div class="about-item">
          <h3>Your note, and how far above or below it you are</h3>
          <p class="prose">The nearest note to what you are singing, and the distance from it in cents. 100 cents is one half step, so 20 cents sharp is a fifth of the way to the next note up. The note is named against your tuning reference, A4 = 440 Hz unless you change it.</p>
          ${more('How the pitch is measured', `
          <p class="prose">The app finds the pitch of your voice about 170 to 190 times a second (every 256 samples, depending on your audio device), using YIN, a standard method for finding the pitch of a voice. Each reading looks at the last 2,048 samples, about 43 to 46 ms of sound. The live view uses each reading as soon as it arrives and never waits for later sound, which keeps it fast but means it can briefly jump an octave.</p>
          <p class="prose">Notes are equal-tempered. Singers often tune by ear rather than to a piano, so a few cents either way is normal.</p>`)}
        </div>
        <div class="about-item">
          <h3>Your vibrato</h3>
          <p class="prose">Speed is how many times a second your pitch swings up and down. Width is how far it swings above and below its middle, in cents. Both come from the last 2.5 seconds of singing, so hold a note for a moment before you read them.</p>
          ${more('How vibrato is measured', `
          <p class="prose">The app takes the longest unbroken stretch of singing in the last 2.5 seconds (at least half a second), removes the slow drift in pitch, and looks for a regular swing between 3 and 9 times a second. Width is half the typical distance from a peak to the next trough, so a swing from 50 cents below to 50 cents above reads as ±50 cents. If there is no clear regular swing, it shows nothing rather than a guess.</p>
          <p class="prose">Fast vibrato reads slightly narrow, because each pitch reading averages pitch over about 20 ms inside that window. No correction is applied.</p>`)}
        </div>
        <div class="about-item">
          <h3>Your ring</h3>
          <p class="prose">How much of your sound sits between 2.5 and 3.5 kHz, compared with the range from 0.05 to 2 kHz, in decibels. That higher range is where the ring of a trained classical voice, often called the singer's formant, tends to show up. A higher number means more energy there. It is a comparison you can watch change, not a score.</p>
        </div>
        <div class="about-item">
          <h3>A picture of your sound</h3>
          <p class="prose">A scrolling chart of your voice from 0 to 4 kHz. Time runs left to right, height is pitch, and <span class="v-paper">darker</span><span class="v-loud">brighter</span> means louder. The line of <span class="v-paper">orange</span><span class="v-loud">pink</span> marks drawn over the chart is the pitch the app measured, so you can check a number against what you see. If a mark sits far above or below the lowest strong band, the app has probably picked the wrong octave for that moment.</p>
        </div>
      </div>
    </section>

    <section class="sec about-sec" aria-labelledby="about-accuracy">
      <header class="sec-head"><h2 class="sec-title" id="about-accuracy" tabindex="-1">How accurate it is</h2></header>
      <div class="sec-body">
        <p class="prose">I test it two ways: on test tones where the right answer is known exactly, and on recordings of real singing, compared with Praat, a program voice researchers use to measure pitch.</p>
        <p class="prose">On test tones, steady and with vibrato, it meets every target I set. On real singing, the live view doesn't yet agree with Praat as often as my target asks, partly because it sometimes jumps an octave for a moment. It hasn't been tested on recordings from the singer it was built for.</p>
        <p class="prose">The full results, including what fails, are in <a class="link" href="/VALIDATION.md" aria-describedby="about-doc-note">VALIDATION.md</a>, and every measurement is defined in <a class="link" href="/MEASUREMENT.md" aria-describedby="about-doc-note">MEASUREMENT.md</a>. ${DOC_NOTE}</p>
        ${more('How it is tested', `
          <p class="prose">Steady tones: pure tones on every note from C3 to C6, plus a few between notes, at two common sample rates. The app's reading is compared with the exact pitch.</p>
          <p class="prose">Vibrato tones: tones with a known vibrato speed and width, from slow and narrow to fast and wide. A case passes when both speed and width are read close to the truth.</p>
          <p class="prose">Real singing: 40 tracks of solo singing from Vocadito, a public research set. For every moment when both the app and Praat hear a pitch, the test checks whether they agree within 10 cents. Praat makes its own octave mistakes, so this measures agreement with a respected tool, not with the truth.</p>`)}
      </div>
    </section>

    <section class="sec about-sec" aria-labelledby="about-privacy">
      <header class="sec-head"><h2 class="sec-title" id="about-privacy" tabindex="-1">Your privacy</h2></header>
      <div class="sec-body">
        <p class="prose">The app only listens after you press Start, and the header shows "Listening" while it does. The sound is measured in your browser as it arrives and then thrown away. Nothing is recorded, saved or uploaded, and there is no account.</p>
        <p class="prose">The only things the site keeps are your tuning reference and whether the space bar starts and stops listening, saved in this browser so they are there next time.</p>
      </div>
    </section>

    <section class="sec about-sec" aria-labelledby="about-limits">
      <header class="sec-head"><h2 class="sec-title" id="about-limits" tabindex="-1">What it isn't</h2></header>
      <div class="sec-body">
        <p class="prose">For practice and study. Not a diagnostic or medical device, and it can't tell you anything about the health of your voice.</p>
        <p class="prose">It doesn't judge your singing either. Sharp and flat describe which way you sit from the equal-tempered note at your tuning reference, not whether you sang it right.</p>
      </div>
    </section>

    <section class="sec about-sec" aria-labelledby="about-next">
      <header class="sec-head"><h2 class="sec-title" id="about-next" tabindex="-1">Coming later</h2></header>
      <div class="sec-body">
        <p class="prose">Voice analysis is the first tool. Next on the list are aural skills practice (intervals and pitch matching), separating your voice from an accompaniment, a register of the works you are learning, and saved sessions with notes. None of these exist yet.</p>
        <p class="prose">Cents to Dollars is made by Joseph Alfonso.</p>
      </div>
    </section>
  </div>
</div>`;

export function aboutRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'about-title');
  wireToc(root);
  return { title: 'About', nav: 'about' };
}

// "On this page": tap a chip to jump to its section (focus moves to the heading); the ink underline
// follows whichever section is being read.
function wireToc(root: HTMLElement) {
  const toc = root.querySelector<HTMLElement>('.about-toc-scroll');
  const ink = root.querySelector<HTMLElement>('.about-toc-ink');
  if (!toc || !ink) return;
  const chips = [...toc.querySelectorAll<HTMLButtonElement>('.about-toc-chip')];
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current = '';
  let lockUntil = 0; // after a tap, the tapped chip stays active while the page scrolls to it

  const setActive = (id: string) => {
    if (id === current) return;
    current = id;
    const chip = chips.find((c) => c.dataset.target === id);
    for (const c of chips) c.toggleAttribute('aria-current', c === chip);
    if (!chip) { ink.style.opacity = '0'; return; }
    ink.style.opacity = '1';
    ink.style.transform = `translateX(${chip.offsetLeft}px) scaleX(${chip.offsetWidth})`;
    // Keep the active chip in view inside the scrolling row, without moving the page.
    const left = chip.offsetLeft - (toc.clientWidth - chip.offsetWidth) / 2;
    toc.scrollTo({ left: Math.max(0, left), behavior: reduce() ? 'auto' : 'smooth' });
  };

  for (const c of chips) {
    c.addEventListener('click', () => {
      const h = root.querySelector<HTMLElement>(`#${c.dataset.target}`);
      const section = h?.closest<HTMLElement>('section');
      if (!h || !section) return;
      section.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
      h.focus({ preventScroll: true });
      setActive(c.dataset.target ?? '');
      lockUntil = performance.now() + 1200;
    });
  }

  // The section whose top most recently crossed the band just under the bar is the current one.
  const seen = new Map<string, boolean>();
  const pick = () => {
    if (performance.now() < lockUntil) return;
    // At the bottom of the page the last short sections can't reach the band, so the lowest one whose
    // heading is on screen wins.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      const last = [...TOC].reverse().find(([id]) => {
        const h = root.querySelector(`#${id}`);
        return h && h.getBoundingClientRect().top < window.innerHeight;
      });
      if (last) { setActive(last[0]); return; }
    }
    const first = TOC.find(([id]) => seen.get(id));
    if (first) setActive(first[0]);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.getAttribute('aria-labelledby') ?? '', e.isIntersecting);
    pick();
  }, { rootMargin: '-80px 0px -55% 0px' });
  window.addEventListener('scroll', () => { if (!root.hidden) pick(); }, { passive: true });
  for (const [id] of TOC) {
    const s = root.querySelector(`section[aria-labelledby="${id}"]`);
    if (s) io.observe(s);
  }
  window.addEventListener('resize', () => { const id = current; current = ''; setActive(id); });
}
