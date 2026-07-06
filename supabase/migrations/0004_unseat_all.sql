create or replace function unseat_all()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare v_count integer;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update guests set table_no = null, seat_no = null where table_no is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function unseat_all() from public, anon, authenticated;
grant execute on function unseat_all() to authenticated;
