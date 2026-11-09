// Octave-guard parameter sweep on Vocadito. dev = tracks 1-20 (used to choose octaveRatio), test = 21-40 (held out).
//   node tools/octave_sweep.ts <dev|test> <octaveMinDip> <octaveRatio...>   e.g. dev 0.08 0 0.3
import { readFileSync } from 'node:fs';
import { readWav } from './wav.ts';
import { FrameAnalyzer } from '../src/dsp/analyzer.ts';
const root='./';
const [split, minDipArg, ...ratios] = process.argv.slice(2); const minDip = Number(minDipArg);
const ids = Array.from({length:40},(_,i)=>i+1).filter(i => split==='dev' ? i<=20 : split==='test' ? i>20 : true);
const wavs = ids.map(i=>[i, readWav(`${root}datasets/vocadito/Audio/vocadito_${i}.wav`)] as const);
const refs = ids.map(i=>readFileSync(`${root}datasets/vocadito/Annotations/F0/vocadito_${i}_f0.csv`,'utf8').trim().split('\n').map((l: string)=>l.split(',').map(Number)));
for (const r of ratios.map(Number)) {
  let refV=0, hit=0, oct=0, fa=0, unv=0;
  wavs.forEach(([i,w],k)=>{
    const fr = new FrameAnalyzer({sampleRate:w.sampleRate, octaveRatio:r, octaveMinDip:minDip}).run(w.samples,false);
    const ref = refs[k]; let j=0;
    for (const f of fr) {
      while (j+1<ref.length && Math.abs(ref[j+1][0]-f.t) < Math.abs(ref[j][0]-f.t)) j++;
      const rf = ref[j][1];
      if (rf>0) { refV++; if (f.voiced) { const e=Math.abs(1200*Math.log2(f.f0/rf)); if (e<=50) hit++; if (e>600) oct++; } }
      else { unv++; if (f.voiced) fa++; }
    }
  });
  console.log(`${split} minDip=${minDip} ratio=${r} RPA=${(hit/refV).toFixed(4)} octaveErrFrames=${oct} VFA=${(fa/unv).toFixed(4)}`);
}
