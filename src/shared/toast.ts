export function toast(msg: string, opts: { retry?: () => void } = {}): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (opts.retry) {
    const b = document.createElement('button');
    b.textContent = 'Retry · 重试';
    b.onclick = () => { el.remove(); opts.retry!(); };
    el.append(b);
  }
  document.body.append(el);
  if (!opts.retry) setTimeout(() => el.remove(), 4000);
}
