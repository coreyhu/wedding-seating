import { addGuest, listGuests, removeGuest, updateGuestName } from '../shared/api';
import { toast } from '../shared/toast';
import type { Guest } from '../shared/types';

const nameOf = (guest: Guest): string => [guest.name_en, guest.name_zh].filter(Boolean).join(' · ');

export function mountGuestList(el: HTMLElement, onDone: () => Promise<void>): void {
  const form = document.createElement('form');
  form.className = 'guest-form';
  const intro = document.createElement('p');
  intro.textContent = 'Add, edit, or remove a guest from the current list.';
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
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-guest';
      edit.textContent = 'Edit';
      edit.onclick = () => {
        const editForm = document.createElement('form');
        editForm.className = 'guest-edit-form';
        const enInput = document.createElement('input');
        enInput.name = 'name-en';
        enInput.placeholder = 'English name';
        enInput.autocomplete = 'name';
        enInput.value = guest.name_en;
        const zhInput = document.createElement('input');
        zhInput.name = 'name-zh';
        zhInput.placeholder = '中文名';
        zhInput.autocomplete = 'name';
        zhInput.value = guest.name_zh;
        const actions = document.createElement('div');
        actions.className = 'guest-list-actions';
        const save = document.createElement('button');
        save.type = 'submit';
        save.textContent = 'Save';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'cancel-edit-guest';
        cancel.textContent = 'Cancel';
        cancel.onclick = render;
        actions.append(save, cancel);
        editForm.append(enInput, zhInput, actions);
        editForm.addEventListener('submit', async event => {
          event.preventDefault();
          save.disabled = true;
          cancel.disabled = true;
          try {
            await updateGuestName(guest.id, enInput.value, zhInput.value);
            toast('Guest name updated');
            await reload();
            await onDone();
          } catch (error) {
            save.disabled = false;
            cancel.disabled = false;
            toast(error instanceof Error ? error.message : 'Could not update guest name');
          }
        });
        row.replaceChildren(editForm);
        enInput.focus();
      };
      const actions = document.createElement('div');
      actions.className = 'guest-list-actions';
      actions.append(edit, remove);
      row.append(details, actions);
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
