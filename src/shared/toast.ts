export function dismissToast(): void {
  document.querySelector('.toast')?.remove();
}

export function toast(msg: string, opts: { retry?: () => void; retryLabel?: string } = {}): void {
  dismissToast();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (opts.retry) {
    const b = document.createElement('button');
    b.textContent = opts.retryLabel ?? 'Retry';
    b.onclick = () => { el.remove(); opts.retry!(); };
    el.append(b);
  }
  document.body.append(el);
  if (!opts.retry) setTimeout(() => el.remove(), 4000);
}
