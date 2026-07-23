-- Small, explicit guest-list mutations for the authenticated host view. Direct
-- writes remain unavailable; both operations retain the admin allowlist gate.
create or replace function add_guest(p_name_en text, p_name_zh text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name_en text := trim(coalesce(p_name_en, ''));
  v_name_zh text := trim(coalesce(p_name_zh, ''));
  v_guest_id uuid;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if v_name_en = '' and v_name_zh = '' then
    raise exception 'Enter an English or Chinese name';
  end if;

  insert into guests (name_en, name_zh)
  values (v_name_en, v_name_zh)
  on conflict on constraint guests_identity do nothing
  returning id into v_guest_id;

  if v_guest_id is null then raise exception 'Guest already exists'; end if;
  return v_guest_id;
end $$;

create or replace function remove_guest(p_guest_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  delete from guests where id = p_guest_id;
  if not found then raise exception 'Unknown guest'; end if;
end $$;

revoke execute on function add_guest(text, text) from public, anon, authenticated;
grant execute on function add_guest(text, text) to authenticated;
revoke execute on function remove_guest(uuid) from public, anon, authenticated;
grant execute on function remove_guest(uuid) to authenticated;
