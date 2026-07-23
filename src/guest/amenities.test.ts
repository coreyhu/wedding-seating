import { describe, expect, it } from 'vitest';
import { AMENITIES, matchAmenity } from './amenities';
import { prepareQuery } from '../logic/search';
import seatmap from '../generated/seatmap.json';

it('every amenity id exists in the generated landmarks (SVG contract guard)', () => {
  for (const a of AMENITIES) expect(seatmap.landmarks).toHaveProperty(a.id);
});
it('excludes the sweetheart table (easter egg stays secret)', () => {
  expect(AMENITIES.some(a => a.id === 'sweetheart_table')).toBe(false);
});
it('taglines: five amenities carry bilingual taglines, ceremony/restroom do not', () => {
  const withTag = ['bar', 'welcome_table', 'guest_artist', 'gift_table', 'dj'];
  for (const id of withTag) {
    const a = AMENITIES.find(x => x.id === id)!;
    expect(a.tagline?.en?.length).toBeGreaterThan(0);
    expect(a.tagline?.zh?.length).toBeGreaterThan(0);
  }
  expect(AMENITIES.find(x => x.id === 'ceremony_seating')!.tagline).toBeUndefined();
  expect(AMENITIES.find(x => x.id === 'restroom')!.tagline).toBeUndefined();
});
describe('matchAmenity', () => {
  it('matches exact names and keywords in both scripts', () => {
    expect(matchAmenity(prepareQuery('Bar'))?.id).toBe('bar');
    expect(matchAmenity(prepareQuery('现场画家'))?.id).toBe('guest_artist');
    expect(matchAmenity(prepareQuery('bathroom'))?.id).toBe('restroom');
    expect(matchAmenity(prepareQuery('洗手间'))?.id).toBe('restroom');
    expect(matchAmenity(prepareQuery('厕所'))?.id).toBe('restroom');
  });
  it('never hijacks guest names (exact only, too-short never)', () => {
    expect(matchAmenity(prepareQuery('barb'))).toBeNull();
    expect(matchAmenity(prepareQuery('ba'))).toBeNull();
    expect(matchAmenity({ kind: 'too-short' })).toBeNull();
  });
});
