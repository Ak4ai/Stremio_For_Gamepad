import type { StremioStream } from '../types/stremio';

export interface ParsedStream {
  stream: StremioStream;
  isPtBr: boolean;
  isDualAudio: boolean;
  isMultiAudio: boolean;
  dubTag?: string; // '🇧🇷 DUBLADO' | '🇧🇷 DUAL ÁUDIO' | '🇧🇷 MULTIDUB' | '🇧🇷 NACIONAL' | '🇧🇷 PT-BR'
  audioBadge?: {
    label: string;
    type: 'dual' | 'multi' | 'ptbr' | 'original';
    isPtBr: boolean;
  };
  resolution: '4K' | '1080p' | '720p' | 'SD';
  resolutionBadge: string; // '4K UHD' | '1080p FHD' | '720p HD' | 'SD'
  isHdr: boolean;
  isDolbyVision: boolean;
  seeds: number | null;
  size: string | null;
  audioInfo: string | null; // e.g. '5.1 Atmos', '5.1 DDP', 'Stereo'
  videoCodec: string | null; // e.g. 'x265', 'HEVC', 'x264', 'AV1'
  addonName: string;
  cleanTitle: string;
}

// Audio claims must stay separate from subtitle languages. Torrentio's mixed
// "Multi Audio / Multi Subs / flags" footer describes a multilingual release;
// a "Multi Subs / flags" footer alone provides no evidence about its audio.
const MULTI_AUDIO = /\b(?:multi[-_.\s]*[áa]udio|multi[-_.\s]*dub(?:bed)?|multiple[-_.\s]*audio|(?:tri|quad|penta)[-_\s]*[áa]udio)\b/i;
const SUBTITLE_MARKER = /\b(?:multi[-_.\s]*subs?|msubs?|subs?|subtitles?|legendas?|legendado|subpack|softsubs?|hardsubs?)\b/i;
const AUDIO_MARKER = /\b(?:[áa]udio|dubbed|dublado|dublada|multidub|dual)\b/i;
const PORTUGUESE = /🇧🇷|🇵🇹|\b(?:pt[-_ ]?br|ptbr|pt|por|pob|portuguese|portugu[eê]s(?:a)?|brazilian|brasil|brazil)\b/i;

function audioText(stream: StremioStream): string {
  return (String(stream.name || '') + '\n' + String(stream.title || ''))
    .split(/\r?\n/)
    .map((line) => {
      // Explicit subtitle metadata always owns the languages following it.
      line = line.replace(/\b(?:subtitles?|legendas?|subs?|leg)\s*[:：][^\n]*/gi, '');
      if (SUBTITLE_MARKER.test(line) && !AUDIO_MARKER.test(line) && !MULTI_AUDIO.test(line)) {
        // Release filenames still contain useful codec/resolution information,
        // but none of this line's language claims can establish dubbed audio.
        return '';
      }
      // With Dual Audio + Multi Subs, flags belong to the subtitles unless the
      // addon explicitly declares Multi Audio or an Audio: language list.
      if (SUBTITLE_MARKER.test(line) && !MULTI_AUDIO.test(line) && !/[áa]udio\s*[:：]/i.test(line)) {
        line = line.replace(/\bmulti[-_.\s]*subs?\b[^\n]*/gi, '');
      }
      return line;
    })
    .join('\n');
}

export function isPortugueseStream(stream: StremioStream): boolean {
  const text = audioText(stream);
  const audioLine = text.match(/(?:[áa]udio|languages?|idiomas?)\s*[:：]\s*([^\n\r]+)/i)?.[1];
  if (audioLine) {
    if (PORTUGUESE.test(audioLine) || /\bbr\b/i.test(audioLine)) return true;
    if (/\b(?:english|eng|en|ingl[eê]s|spanish|spa|espa[nñ]ol|hindi|hin|french|fra|fre|franc[eê]s|german|ger|deu|alem[aã]o|japanese|jpn|japon[eê]s|italian|ita|italiano|russian|rus|russo)\b/i.test(audioLine)) return false;
  }

  // Explicit Portuguese audio takes priority over other languages in a
  // multilingual release. A Portuguese subtitle alone was removed above.
  if (PORTUGUESE.test(text) || /\b(?:dublado|dublada|nacional)\b/i.test(text)) return true;
  if (/\b(?:cinecalidad|castellano|legendado|legenda\s+fixa)\b/i.test(text)) return false;
  if (/\b(?:french|german|italian|russian|hindi|spanish|latino)\.dub(?:bed)?\b/i.test(text)) return false;
  if (/\bdual[-_ ]?audio\b.*?\b(?:hindi|latino|spanish|italian|russian)\b/i.test(text)) return false;
  return /\b(?:brazuca|comando|lapumia|bludv|redecanais|ondebaixa)\b/i.test(text) && /\bdual\b/i.test(text);
}

export function parseStream(stream: StremioStream): ParsedStream {
  const name = stream.name || '';
  const title = stream.title || '';
  const combined = `${name} ${title}`;

  // 1. Detect Audio Properties: Dual Audio, Multi Audio, and Portuguese Dubbing
  const isPtBr = isPortugueseStream(stream);

  const isDualAudio =
    /(?:^|[._\s\[\(-])(?:dual|2[-_\s.]?audios?|2[-_\s.]?áudios?|duplo[-_\s.]?áudio|dual[-_\s.]?audio)(?:$|[._\s\]\)-])/i.test(combined) ||
    /\bdual(?:\s*[-_.]?\s*[\u00e1a]udio)?\b/i.test(combined) ||
    /\bdual\b/i.test(combined) ||
    /\[\s*dual\s*\]/i.test(combined) ||
    /\bdublado\s+(?:e|\+|\/)\s+(?:legendado|original|ingles|inglês)\b/i.test(combined) ||
    /\bdual[-_. ]?(?:lat|audio|ita|spa|rus|eng|fra|deu|jap|por|pt)\b/i.test(combined);

  const isMultiAudio = MULTI_AUDIO.test(audioText(stream));

  let dubTag: string | undefined = undefined;
  let audioBadge: ParsedStream['audioBadge'] = undefined;

  if (isDualAudio && !isMultiAudio) {
    dubTag = isPtBr ? '🇧🇷 DUAL ÁUDIO' : '🎧 DUAL ÁUDIO';
    audioBadge = {
      label: isPtBr ? '🇧🇷 DUAL ÁUDIO' : '🎧 DUAL ÁUDIO',
      type: 'dual',
      isPtBr,
    };
  } else if (isMultiAudio) {
    dubTag = isPtBr ? '🇧🇷 MULTI ÁUDIO' : '🌐 MULTI ÁUDIO';
    audioBadge = {
      label: isPtBr ? '🇧🇷 MULTI ÁUDIO' : '🌐 MULTI ÁUDIO',
      type: 'multi',
      isPtBr,
    };
  } else if (isPtBr) {
    const isNacional = /\bnacional\b/i.test(combined);
    dubTag = isNacional ? '🇧🇷 NACIONAL' : '🇧🇷 DUBLADO';
    audioBadge = {
      label: dubTag,
      type: 'ptbr',
      isPtBr: true,
    };
  } else {
    audioBadge = {
      label: '🌐 Áudio Original',
      type: 'original',
      isPtBr: false,
    };
  }

  // 2. Detect Resolution
  let resolution: '4K' | '1080p' | '720p' | 'SD' = '1080p';
  let resolutionBadge = '1080p FHD';

  if (/2160p|4k|uhd/i.test(combined)) {
    resolution = '4K';
    resolutionBadge = '4K UHD';
  } else if (/1080p|fhd|full[- ]?hd/i.test(combined)) {
    resolution = '1080p';
    resolutionBadge = '1080p FHD';
  } else if (/720p|hd/i.test(combined)) {
    resolution = '720p';
    resolutionBadge = '720p HD';
  } else if (/480p|sd|dvdrip|cam|camrip|telesync/i.test(combined)) {
    resolution = 'SD';
    resolutionBadge = 'SD';
  }

  // 3. HDR & Dolby Vision
  const isDolbyVision = /\b(?:dv|dovi|dolby[- ]?vision)\b/i.test(combined);
  const isHdr = /\b(?:hdr10\+|hdr10|hdr)\b/i.test(combined) || isDolbyVision;
  if (isDolbyVision) {
    resolutionBadge += ' • DV';
  } else if (isHdr) {
    resolutionBadge += ' • HDR';
  }

  // 4. Seeds count
  let seeds: number | null = null;
  const seedMatch = combined.match(/(?:👤|👥|⚙️|⚙|seeds?:?)\s*(\d+)/i) || combined.match(/(\d+)\s*seeds?/i);
  if (seedMatch) {
    seeds = parseInt(seedMatch[1], 10);
  }

  // 5. File size
  let size: string | null = null;
  const sizeMatch =
    combined.match(/(?:💾|📦|size:?)\s*([0-9.]+\s*(?:GB|MB|GiB|MiB))/i) ||
    combined.match(/\[([0-9.]+\s*(?:GB|MB|GiB|MiB))\]/i) ||
    combined.match(/\b([0-9.]+\s*(?:GB|MB|GiB|MiB))\b/i);
  if (sizeMatch) {
    size = sizeMatch[1].trim();
  }

  // 6. Audio Info & Channels
  let audioInfo: string | null = null;
  if (/\batmos\b/i.test(combined)) {
    audioInfo = 'Atmos';
  } else if (/\b7\.1\b/i.test(combined)) {
    audioInfo = '7.1 Surround';
  } else if (/\b(?:5\.1|ddp5\.1|eac3|ac3)\b/i.test(combined)) {
    audioInfo = '5.1 Surround';
  } else if (/\b(?:2\.0|stereo|aac)\b/i.test(combined)) {
    audioInfo = 'Stereo 2.0';
  }

  // 7. Video Codec
  let videoCodec: string | null = null;
  if (/\b(?:hevc|x265|h\.?265)\b/i.test(combined)) {
    videoCodec = 'x265';
  } else if (/\b(?:x264|h\.?264|avc)\b/i.test(combined)) {
    videoCodec = 'x264';
  } else if (/\b(?:av1)\b/i.test(combined)) {
    videoCodec = 'AV1';
  }

  // 8. Addon Name / Provider
  let addonName = 'Torrentio';
  const firstLine = name.split('\n')[0].trim();
  if (firstLine) {
    addonName = firstLine.replace(/\[RD\+\]/i, 'RealDebrid').trim();
  } else if (title.includes('Brazuca')) {
    addonName = 'Brazuca';
  } else if (title.includes('CyberFlix')) {
    addonName = 'CyberFlix';
  }

  // 9. Clean Title for legibility
  // Strip seed and size indicators that clutter the main release name
  const titleLines = title.split('\n');
  let cleanTitle = titleLines[0] || name;
  cleanTitle = cleanTitle
    .replace(/👤\s*\d+/g, '')
    .replace(/💾\s*[0-9.]+\s*(?:GB|MB)/gi, '')
    .replace(/⚙️?\s*.*$/gi, '')
    .trim();

  return {
    stream,
    isPtBr,
    isDualAudio,
    isMultiAudio,
    audioBadge,
    dubTag,
    resolution,
    resolutionBadge,
    isHdr,
    isDolbyVision,
    seeds,
    size,
    audioInfo,
    videoCodec,
    addonName,
    cleanTitle: cleanTitle || name,
  };
}
