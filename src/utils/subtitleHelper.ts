import type { StremioSubtitle } from '../types/stremio';

export interface SubtitleCue {
  id?: string;
  start: number;
  end: number;
  text: string;
}

export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2].replace(',', '.')) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1].replace(',', '.')) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(timeStr.replace(',', '.')) || 0;
}

export function parseSubtitlesToCues(content: string): SubtitleCue[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    let timingIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timingIndex = i;
        break;
      }
    }

    if (timingIndex === -1) continue;

    const timingLine = lines[timingIndex];
    const [startRaw, endRaw] = timingLine.split('-->');
    if (!startRaw || !endRaw) continue;

    const startSec = parseTimeToSeconds(startRaw.trim().split(/\s+/)[0]);
    const endSec = parseTimeToSeconds(endRaw.trim().split(/\s+/)[0]);

    if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) continue;

    const textLines = lines.slice(timingIndex + 1).map((l) => l.trim()).filter(Boolean);
    if (textLines.length === 0) continue;

    const cleanText = textLines
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]+\}/g, '');

    cues.push({
      start: startSec,
      end: endSec,
      text: cleanText,
    });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function srtToVtt(srt: string): string {
  // Strip UTF-8 BOM if present
  let clean = srt.replace(/^\uFEFF/, '').trim();
  if (clean.startsWith('WEBVTT')) {
    return clean;
  }
  const normalized = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${converted}`;
}

export function formatLanguageName(langCode: string): string {
  const code = langCode.toLowerCase().trim();
  switch (code) {
    case 'por':
    case 'pob':
    case 'pt':
    case 'pt-br':
    case 'ptbr':
      return 'Português (Brasil) 🇧🇷';
    case 'eng':
    case 'en':
      return 'Inglês (English) 🇺🇸';
    case 'spa':
    case 'es':
      return 'Espanhol (Español) 🇪🇸';
    case 'fre':
    case 'fra':
    case 'fr':
      return 'Francês (Français) 🇫🇷';
    case 'ger':
    case 'deu':
    case 'de':
      return 'Alemão (Deutsch) 🇩🇪';
    case 'ita':
    case 'it':
      return 'Italiano 🇮🇹';
    case 'jpn':
    case 'ja':
      return 'Japonês (日本語) 🇯🇵';
    case 'kor':
    case 'ko':
      return 'Coreano (한국어) 🇰🇷';
    case 'rus':
    case 'ru':
      return 'Russo (Русский) 🇷🇺';
    default:
      return code.toUpperCase();
  }
}

export interface GroupedSubtitleOption {
  sub: StremioSubtitle;
  optionNumber: number;
  displayTitle: string;
  releaseTag: string;
  sourceTag: string;
  isHearingImpaired: boolean;
  langGroup: string;
}

export function parseSubtitleDetails(
  sub: StremioSubtitle,
  indexInGroup: number
): GroupedSubtitleOption {
  const fileName = sub.subtitleFileName || '';
  const rawLang = sub.lang || 'eng';
  const langName = formatLanguageName(rawLang);

  // Extract release group or format tag
  let releaseTag = '';
  const groupMatch = fileName.match(/-(FLUX|NTG|ION10|CMRG|EVO|FGT|RARBG|MeGusta|GOSSIP|EDITH)/i);
  if (groupMatch) {
    releaseTag = groupMatch[1].toUpperCase();
  } else if (/web-?dl|amzn/i.test(fileName)) {
    releaseTag = 'WEB-DL';
  } else if (/bluray|bdrip/i.test(fileName)) {
    releaseTag = 'BluRay';
  } else if (/hdtv/i.test(fileName)) {
    releaseTag = 'HDTV';
  }

  // Check if Hearing Impaired
  const isHearingImpaired = /hearing|impaired|\bcc\b|hi\./i.test(fileName);

  // Source addon tag
  let sourceTag = 'OpenSubtitles v3';
  const addonMatch = fileName.match(/\[(.*?)\]$/);
  if (addonMatch) {
    sourceTag = addonMatch[1];
  }

  return {
    sub,
    optionNumber: indexInGroup + 1,
    displayTitle: `${langName} • Opção #${indexInGroup + 1}`,
    releaseTag,
    sourceTag,
    isHearingImpaired,
    langGroup: rawLang.toLowerCase(),
  };
}

/**
 * Fallback curated subtitles for testing/offline scenarios
 */
export function getFallbackSubtitles(): StremioSubtitle[] {
  return [
    {
      id: 'sub-pt-br-1',
      lang: 'por',
      url: '',
      subtitleFileName: 'Português (Brasil) - Oficial [OpenSubtitles]',
    },
    {
      id: 'sub-pt-br-2',
      lang: 'por',
      url: '',
      subtitleFileName: 'Português (Brasil) - Sincronizada [Hearing Impaired]',
    },
    {
      id: 'sub-eng-1',
      lang: 'eng',
      url: '',
      subtitleFileName: 'English [Original Full Subs]',
    },
    {
      id: 'sub-spa-1',
      lang: 'spa',
      url: '',
      subtitleFileName: 'Español (Latinoamérica)',
    },
  ];
}
