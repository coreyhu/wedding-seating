import { addGuest, listGuests, removeGuest } from '../shared/api';
import { toast } from '../shared/toast';
import type { Guest } from '../shared/types';

const nameOf = (guest: Guest): string => [guest.name_en, guest.name_zh].filter(Boolean).join(' · ');

export function mountGuestList(el: HTMLElement, onDone: () => Promise<void>): void {
  const form = document.createElement('form');
  form.className = 'guest-form';
  const intro = document.createElement('p');
  intro.textContent = 'Add a guest, or remove one from the current list.';
  const en = document.createElement('input');
  en.name = 'name-en';
  en.placeholder = 'English name';
  en.autocomplete = 'name';
  const zh = document.createElement('input');
  zh.name = 'name-zh';
  zh.placeholder = '中文名';
  const add = document.createElement('button');
  add.type = 'submit';
  add.textContent = 'Add guest';
  form.append(intro, en, zh, add);

  const filter = document.createElement('input');
  filter.className = 'guest-list-filter';
  filter.type = 'search';
  filter.placeholder = 'Filter guest list…';
  filter.autocomplete = 'off';
  const list = document.createElement('div');
  list.className = 'guest-list-rows';
  el.replaceChildren(form, filter, list);

  let guests: Guest[] = [];
  let loading: Promise<void> | null = null;

  const render = (): void => {
    const query = filter.value.trim().toLowerCase();
    const shown = guests.filter(guest => !query ||
      guest.name_en.toLowerCase().includes(query) || guest.name_zh.includes(query));
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'guest-list-empty';
      empty.textContent = guests.length ? 'No matches' : 'No guests yet';
      list.append(empty);
      return;
    }
    for (const guest of shown) {
      const row = document.createElement('div');
      row.className = 'guest-list-row';
      const details = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = nameOf(guest);
      const status = document.createElement('small');
      status.textContent = guest.table_no == null ? 'Unseated' : `Table ${guest.table_no}, seat ${guest.seat_no}`;
      details.append(name, status);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-guest';
      remove.textContent = 'Remove';
      remove.onclick = async () => {
        if (!window.confirm(`Remove ${nameOf(guest)} from the guest list?`)) return;
        remove.disabled = true;
        try {
          await removeGuest(guest.id);
          toast(`Removed ${nameOf(guest)}`);
          await reload();
          await onDone();
        } catch (error) {
          remove.disabled = false;
          toast(error instanceof Error ? error.message : 'Could not remove guest');
        }
      };
      row.append(details, remove);
      list.append(row);
    }
  };

  const reload = async (): Promise<void> => {
    if (loading) return loading;
    loading = (async () => {
      try {
        guests = await listGuests();
        render();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load guest list');
      } finally {
        loading = null;
      }
    })();
    return loading;
  };

  filter.addEventListener('input', render);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    add.disabled = true;
    try {
      await addGuest(en.value, zh.value);
      form.reset();
      toast('Guest added');
      await reload();
      await onDone();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add guest');
    } finally {
      add.disabled = false;
    }
  });

  el.closest('details')?.addEventListener('toggle', event => {
    if ((event.currentTarget as HTMLDetailsElement).open) void reload();
  });
}
