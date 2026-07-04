export type Locale = 'en' | 'zh';

const STRINGS = {
  title: { en: 'Find your seat', zh: '查找您的座位' },
  placeholder: { en: 'Your name…', zh: '请输入您的姓名…' },
  emptyState: { en: "Can't find your name? Ask at the welcome table.", zh: '找不到您的名字？请到迎宾台咨询。' },
  noSeat: { en: 'no seat assigned yet', zh: '尚未安排座位' },
  connectionTrouble: { en: 'Connection trouble', zh: '网络异常' },
  retry: { en: 'Retry', zh: '重试' },
  toggle: { en: '中文', zh: 'EN' }, // the language you'd switch TO
} as const;
export type StringKey = keyof typeof STRINGS;

let locale: Locale = 'en';
const subscribers: Array<() => void> = [];

export function detectLocale(): Locale {
  const saved = localStorage.getItem('locale');
  if (saved === 'en' || saved === 'zh') return saved;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export const getLocale = (): Locale => locale;
export function setLocale(l: Locale): void {
  if (locale !== l) localStorage.setItem('locale', l); // skip only the redundant persist
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
