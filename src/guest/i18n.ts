export type Locale = 'en' | 'zh';

const STRINGS = {
  title: { en: 'Find your seat', zh: '查找您的座位' },
  placeholder: { en: 'Your name…', zh: '请输入您的姓名…' },
  emptyState: { en: "Can't find your name? Ask our planner.", zh: '找不到您的名字？请咨询我们的策划师。' },
  noSeat: { en: 'no seat assigned yet', zh: '尚未安排座位' },
  connectionTrouble: { en: 'Connection trouble', zh: '网络异常' },
  retry: { en: 'Retry', zh: '重试' },
  toggle: { en: '中文', zh: 'EN' }, // the language you'd switch TO
  credits: { en: 'Made with ♥ by Lindsey Tam & Corey Hu', zh: 'Lindsey Tam 与 Corey Hu 用 ♥ 制作' },
} as const;
export type StringKey = keyof typeof STRINGS;

let locale: Locale = 'en';
const subscribers: Array<() => void> = [];

// Some in-app webviews (and privacy-hardened browsers) throw on localStorage
// access entirely — not just quota errors on setItem, but getItem too — when
// cookies/storage are blocked. Guard both directions so localization still
// works (falling back to navigator.language / an in-memory-only locale)
// instead of the whole module's startup call chain throwing.
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable — locale stays in-memory */ }
}

export function detectLocale(): Locale {
  const saved = safeGet('locale');
  if (saved === 'en' || saved === 'zh') return saved;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export const getLocale = (): Locale => locale;
export function setLocale(l: Locale): void {
  if (locale !== l) safeSet('locale', l); // skip only the redundant persist
  locale = l;
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  document.title = STRINGS.title[l];
  subscribers.forEach(cb => cb());
}
export const onLocaleChange = (cb: () => void): void => { subscribers.push(cb); };
export const t = (key: StringKey): string => STRINGS[key][locale];
export const seatText = (n: number): string => (locale === 'zh' ? `${n}号位` : `Seat ${n}`);
export const pickLabel = (en: string | null, zh: string | null): string =>
  (locale === 'zh' ? zh || en : en || zh) || '';
