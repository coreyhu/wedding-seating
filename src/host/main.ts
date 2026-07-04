import { requireAuth } from './auth';

requireAuth(() => { document.querySelector('#app')!.textContent = 'authed'; });
