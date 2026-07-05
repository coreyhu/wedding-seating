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
describe('matchAmenity', () => {
  it('matches exact names and keywords in both scripts', () => {
    expect(matchAmenity(prepareQuery('Bar'))?.id).toBe('bar');
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
