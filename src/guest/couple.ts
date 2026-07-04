import { normalizeEn, type PreparedQuery } from '../logic/search';

interface Partner { name_en: string; name_zh: string }

export const COUPLE: { partners: Partner[]; message: Record<'en' | 'zh', string> } = {
  partners: [
    { name_en: 'Corey Hu', name_zh: '' },    // name_zh optional: '' never matches
    { name_en: 'Lindsey Tam', name_zh: '' }, // Chinese names not chosen yet
  ],
  message: {
    en: 'You found us! Come say hi at the sweetheart table 🌿',
    zh: '被你找到啦！快来甜心桌打个招呼 🌿',
  },
};

export function matchesCouple(p: PreparedQuery): boolean {
  if (p.kind === 'too-short') return false;
  return COUPLE.partners.some(partner =>
    p.kind === 'en'
      ? p.q === normalizeEn(partner.name_en)
      : partner.name_zh !== '' && p.q === partner.name_zh.replace(/\s+/g, ''));
}
