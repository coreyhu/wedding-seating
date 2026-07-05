import { normalizeEn, type PreparedQuery } from '../logic/search';

export interface Amenity {
  id: string;
  emoji: string;
  name: { en: string; zh: string };
  keywords: { en: string[]; zh: string[] };
}

// Curated subset of seatmap.json landmarks worth surfacing to guests.
// sweetheart_table is deliberately excluded — it stays a couple-name easter egg.
export const AMENITIES: Amenity[] = [
  {
    id: 'bar',
    emoji: '🍸',
    name: { en: 'Bar', zh: '酒吧' },
    keywords: { en: ['bar', 'drinks'], zh: ['酒吧', '吧台'] },
  },
  {
    id: 'welcome_table',
    emoji: '💌',
    name: { en: 'Welcome Table', zh: '迎宾台' },
    keywords: { en: ['welcome table', 'welcome'], zh: ['迎宾台', '签到'] },
  },
  {
    id: 'ceremony_seating',
    emoji: '💒',
    name: { en: 'Ceremony', zh: '仪式区' },
    keywords: { en: ['ceremony'], zh: ['仪式', '仪式区', '典礼'] },
  },
  {
    id: 'guest_artist',
    emoji: '🎨',
    name: { en: 'Live Artist', zh: '现场创作' },
    keywords: { en: ['live artist', 'artist'], zh: ['现场创作', '画家'] },
  },
  {
    id: 'restroom',
    emoji: '🚻',
    name: { en: 'Restrooms', zh: '洗手间' },
    keywords: {
      en: ['restroom', 'restrooms', 'bathroom', 'toilet'],
      zh: ['洗手间', '厕所', '卫生间'],
    },
  },
  {
    id: 'gift_table',
    emoji: '🎁',
    name: { en: 'Gifts', zh: '礼品台' },
    keywords: { en: ['gifts', 'gift table'], zh: ['礼品台', '礼金'] },
  },
  {
    id: 'dj',
    emoji: '🎧',
    name: { en: 'DJ', zh: 'DJ台' },
    keywords: { en: ['dj', 'music'], zh: ['DJ台', '音乐'] },
  },
];

const stripZh = (s: string): string => s.replace(/\s+/g, '');

export function matchAmenity(p: PreparedQuery): Amenity | null {
  if (p.kind === 'too-short') return null;
  for (const a of AMENITIES) {
    if (p.kind === 'en') {
      if (p.q === normalizeEn(a.name.en) || a.keywords.en.some(kw => p.q === normalizeEn(kw))) return a;
    } else {
      if (p.q === stripZh(a.name.zh) || a.keywords.zh.some(kw => p.q === stripZh(kw))) return a;
    }
  }
  return null;
}
