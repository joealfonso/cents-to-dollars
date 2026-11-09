// The whole font set, self-hosted through @fontsource (DESIGN.md 1.5). Import fonts from here only.
// Latin subset, only the weights the type tokens use. Every file sets font-display: swap.
// The Newsreader variable package has no Latin-only entry point: opsz.css and opsz-italic.css declare
// latin, latin-ext and vietnamese faces with unicode-range, so the browser downloads only the Latin file
// for Latin text.

// Paper
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';

// Loud
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-black/latin-400.css';
