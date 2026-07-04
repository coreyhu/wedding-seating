export const ROMANIZATION_VARIANTS: Record<string, string[]> = {
  xiao: ['hsiao'], tan: ['tam'], wu: ['ng', 'woo'], gao: ['kao'], zeng: ['tseng'],
  cai: ['tsai', 'choi'], liu: ['lau'], zhang: ['chang', 'cheung'], wang: ['wong'],
  huang: ['wong'], li: ['lee'], zhao: ['chao', 'chiu'], xie: ['hsieh', 'tse'],
  lin: ['lam'], chen: ['chan'], zhou: ['chou', 'chow'], zhu: ['chu'], xu: ['hsu'],
  guo: ['kuo', 'kwok'], ye: ['yeh', 'yip'], he: ['ho'], mai: ['mak'], deng: ['teng'],
  qiu: ['chiu'], jiang: ['chiang'], song: ['sung'], yang: ['yeung'], luo: ['lo', 'law'],
  du: ['tu'], feng: ['fung'], zheng: ['cheng'], wei: ['wai'], lu: ['loo'], shi: ['shih'],
  cui: ['tsui'], sun: ['suen'], yao: ['yiu'], liang: ['leung'], chow: ['zhou'],
};
const CAP = 8;

export function candidatesFromSyllables(sylls: string[]): string[] {
  if (!sylls.length) return [];
  const orderings: string[][] = [sylls.slice(1).concat(sylls[0]!), sylls];
  if (sylls.length >= 4) orderings.push(sylls.slice(2).concat(sylls.slice(0, 2)));
  const out: string[] = [];
  const push = (arr: string[]) => {
    const s = arr.join('');
    if (s.length >= 2 && !out.includes(s) && out.length < CAP) out.push(s);
  };
  for (const o of orderings) push(o);
  for (const o of orderings)
    for (let i = 0; i < o.length; i++)
      for (const v of ROMANIZATION_VARIANTS[o[i]!] ?? [])
        push([...o.slice(0, i), v, ...o.slice(i + 1)]);
  if (sylls.length === 1) { // single char: allow bare syllable + variants even if short
    const s = sylls[0]!;
    if (!out.includes(s)) out.unshift(s);
    for (const v of ROMANIZATION_VARIANTS[s] ?? []) if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, CAP);
}

export async function zhToCandidates(q: string): Promise<string[]> {
  try {
    const { default: pinyin } = await import('tiny-pinyin');
    if (!pinyin.isSupported()) return [];
    const sylls = [...q].map(ch => pinyin.convertToPinyin(ch, '', true).toLowerCase()).filter(Boolean);
    return candidatesFromSyllables(sylls);
  } catch { return []; } // chunk failed to load (bad Wi-Fi) → behave as a plain miss
}
