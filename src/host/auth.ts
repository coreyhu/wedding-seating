import { hasSession, signIn, signOut } from '../shared/api';
import { toast } from '../shared/toast';

export function requireAuth(onReady: () => void): void {
  void (async () => {
    // hasSession() can throw (hardened api.ts). Treat a failed check as
    // "not authenticated" — fall back to the login form — rather than
    // leaving #app blank, and surface the error via toast.
    let authed = false;
    try {
      authed = await hasSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not check session');
    }
    if (authed) return ready(onReady);
    const app = document.querySelector('#app')!;
    app.innerHTML = `
      <form class="login">
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <button>Sign in</button>
      </form>`;
    app.querySelector('form')!.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      try {
        await signIn(String(f.get('email')), String(f.get('password')));
        ready(onReady);
      } catch (err) { toast(err instanceof Error ? err.message : 'Sign-in failed'); }
    });
  })();
}

function ready(onReady: () => void): void {
  const out = document.createElement('button');
  out.textContent = 'Sign out';
  out.className = 'signout';
  out.onclick = async () => {
    // signOut() can throw (hardened api.ts); only reload on confirmed
    // success so a failed sign-out surfaces instead of silently no-op'ing.
    try {
      await signOut();
      location.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sign-out failed');
    }
  };
  document.querySelector('.topbar')!.append(out);
  onReady();
}
