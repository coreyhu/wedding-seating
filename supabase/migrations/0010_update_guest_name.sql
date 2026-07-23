-- Editing a name must not require broad table-write access: the host can only
-- change a guest's bilingual display names, while their seating stays intact.
create or replace function update_guest_name(p_guest_id uuid, p_name_en text, p_name_zh text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name_en text := trim(coalesce(p_name_en, ''));
  v_name_zh text := trim(coalesce(p_name_zh, ''));
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if v_name_en = '' and v_name_zh = '' then
    raise exception 'Enter an English or Chinese name';
  end if;

  update guests
  set name_en = v_name_en, name_zh = v_name_zh
  where id = p_guest_id;
  if not found then raise exception 'Unknown guest'; end if;
exception
  when unique_violation then raise exception 'Guest already exists';
end $$;

revoke execute on function update_guest_name(uuid, text, text) from public, anon, authenticated;
grant execute on function update_guest_name(uuid, text, text) to authenticated;
