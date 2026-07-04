import { beforeEach, expect, it, vi } from 'vitest';
import { detectLocale, getLocale, onLocaleChange, pickLabel, seatText, setLocale, t } from './i18n';

beforeEach(() => { localStorage.clear(); setLocale('en'); });

it('detect: localStorage wins over navigator', () => {
  localStorage.setItem('locale', 'zh');
  vi.stubGlobal('navigator', { language: 'en-US' });
  expect(detectLocale()).toBe('zh');
});
it('detect: zh-prefixed navigator language → zh, else en', () => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  expect(detectLocale()).toBe('zh');
  vi.stubGlobal('navigator', { language: 'fr-FR' });
  expect(detectLocale()).toBe('en');
});
it('t() and seatText follow the locale; setLocale persists and notifies', () => {
  const cb = vi.fn();
  onLocaleChange(cb);
  expect(t('title')).toBe('Find your seat');
  expect(seatText(5)).toBe('Seat 5');
  setLocale('zh');
  expect(t('title')).toBe('查找您的座位');
  expect(seatText(5)).toBe('5号位');
  expect(localStorage.getItem('locale')).toBe('zh');
  expect(cb).toHaveBeenCalled();
  expect(getLocale()).toBe('zh');
});
it('pickLabel picks by locale with cross-fallback', () => {
  expect(pickLabel('Fern', '蕨')).toBe('Fern');
  setLocale('zh');
  expect(pickLabel('Fern', '蕨')).toBe('蕨');
  expect(pickLabel('Fern', '')).toBe('Fern');
  expect(pickLabel(null, null)).toBe('');
});
