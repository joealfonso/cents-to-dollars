// Errors raised by the take pipeline (specs/M2.1-API.md). `code` is stable and meant for the UI to map
// to a state; `message` is for logs.
//   not-wav             bytes are not RIFF/WAVE
//   unsupported-format  a WAV encoding the parser does not read (for example 8-bit PCM or ADPCM)
//   corrupt             a WAV with no usable fmt or data chunk
//   unsupported-type    the container is not one the app decodes
//   decode-failed       the browser decoder rejected the file
//   unsupported-rate    the browser refused the analysis sample rate
//   out-of-memory       an allocation failed
//   analysis-failed     the analysis threw for another reason
//   cancelled           the job was stopped before it finished
//   too-large           the file is over MAX_FILE_BYTES (checked before reading)
//   too-long            the take is over MAX_DURATION_S (checked before the big allocations where possible)

export type TakeErrorCode =
  | 'not-wav'
  | 'unsupported-format'
  | 'corrupt'
  | 'unsupported-type'
  | 'decode-failed'
  | 'unsupported-rate'
  | 'out-of-memory'
  | 'analysis-failed'
  | 'cancelled'
  | 'too-large'
  | 'too-long';

export class TakeError extends Error {
  code: string;
  constructor(code: TakeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TakeError';
    this.code = code;
  }
}
