/**
 * Parses /opencli-<platform> <args> into a {poi, mode} pair, or surfaces
 * an "ask the user" choice list when input is ambiguous.
 *
 * Slash markdown stays thin and shells out to this parser via
 * `tours parse-slash-args` so the rules are unit-testable in TS instead
 * of buried in markdown.
 */

export type SlashMode = 'scan' | 'pricing' | 'all';

export interface ParseOk { kind: 'ok'; poi: string; mode: SlashMode; }
export interface ParseAsk {
  kind: 'ask';
  question: string;
  choices: { id: string; label: string }[];
}
export interface ParseError { kind: 'error'; message: string; }
export type ParseResult = ParseOk | ParseAsk | ParseError;

const MODE_ALIASES: Record<string, SlashMode> = {
  scan: 'scan',
  detail: 'scan',
  enrich: 'scan',
  discover: 'scan',
  pricing: 'pricing',
  price: 'pricing',
  all: 'all',
};

function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

export function parseSlashArgs(input: string): ParseResult {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return askForBoth();

  const lastTok = tokens[tokens.length - 1].toLowerCase();
  const modeMaybe = MODE_ALIASES[lastTok];

  if (modeMaybe) {
    const poi = tokens.slice(0, -1).join(' ').trim();
    if (!poi) return askForBoth();
    return { kind: 'ok', poi, mode: modeMaybe };
  }

  // Last token unrecognised. Two cases:
  //   - Looks like a typo'd mode word (short alphabetic) AND there's a POI
  //     before it -> error with the typo
  //   - Otherwise -> mode genuinely omitted, ask
  const looksLikeModeAttempt = lastTok.length <= 12 && /^[a-z]+$/.test(lastTok);
  if (looksLikeModeAttempt && tokens.length >= 2) {
    return {
      kind: 'error',
      message: `Unknown mode "${lastTok}". Valid: scan | pricing | all (alias: detail = scan).`,
    };
  }

  const poi = tokens.join(' ').trim();
  return {
    kind: 'ask',
    question: `Which mode for "${poi}"?`,
    choices: [
      { id: 'scan',    label: 'scan -- discover + enrich (no pricing writes)' },
      { id: 'pricing', label: 'pricing -- refresh pinned activities only' },
      { id: 'all',     label: 'all -- scan then pin top 5 then pricing in one shot' },
    ],
  };
}

function askForBoth(): ParseAsk {
  return {
    kind: 'ask',
    question: 'Which POI and mode?',
    choices: [
      { id: 'list-pois', label: 'List configured POIs (node dist/cli.js list-pois)' },
      { id: 'free-text', label: 'Type the POI as a quoted phrase, e.g. "mt fuji" pricing' },
    ],
  };
}
