import { beforeEach, expect, it, vi } from 'vitest';
import { burstPetals } from './effects';

beforeEach(() => { document.body.innerHTML = '<div id="c"></div>'; });
const c = () => document.querySelector<HTMLElement>('#c')!;

it('spawns the requested number of petals and removes them on animationend', () => {
  burstPetals(c(), { count: 5 });
  const petals = c().querySelectorAll('.petal');
  expect(petals).toHaveLength(5);
  petals.forEach(p => p.dispatchEvent(new Event('animationend')));
  expect(c().querySelectorAll('.petal')).toHaveLength(0);
});
it('no-ops under prefers-reduced-motion', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  burstPetals(c());
  expect(c().querySelectorAll('.petal')).toHaveLength(0);
  vi.unstubAllGlobals();
});
it('never throws, even on a detached container', () => {
  expect(() => burstPetals(document.createElement('div'))).not.toThrow();
});
