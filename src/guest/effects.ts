const GLYPHS = ['✿', '❀', '🌸', '❁'];
const TINTS = ['#7d9480', '#c9a1a8', '#87795a'];

export function burstPetals(container: HTMLElement, opts: { count?: number } = {}): void {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < (opts.count ?? 16); i++) {
      const p = document.createElement('span');
      p.className = 'petal';
      p.textContent = GLYPHS[i % GLYPHS.length]!;
      p.style.left = `${8 + Math.random() * 84}%`;
      p.style.color = TINTS[i % TINTS.length]!;
      p.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 120)}px`);
      p.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
      p.addEventListener('animationend', () => p.remove());
      frag.append(p);
    }
    container.append(frag);
  } catch { /* decorative — must never break search */ }
}
