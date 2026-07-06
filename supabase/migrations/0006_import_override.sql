-- Import override: the sheet IS the guest list. Guests absent from the payload
-- are DELETED (previously left unseated), so re-imports can't accumulate ghost
-- rows or duplicate-looking name variants. Returns {imported, new, deleted}.
create or replace function import_seating(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_new int; v_imported int; v_deleted int; v_expected int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  set constraints guests_one_per_seat deferred;

  update tables t set
    label_en = coalesce(nullif(trim(x.label_en), ''), format('Table %s', t.table_no)),
    label_zh = coalesce(nullif(trim(x.label_zh), ''), format('%s号桌', t.table_no))
  from jsonb_to_recordset(payload->'tables') as x(table_no int, label_en text, label_zh text)
  where x.table_no = t.table_no;

  insert into guests (name_en, name_zh)
  select distinct trim(coalesce(g->>'name_en', '')), trim(coalesce(g->>'name_zh', ''))
  from jsonb_array_elements(payload->'guests') g
  on conflict on constraint guests_identity do nothing;
  get diagnostics v_new = row_count;

  -- clear all assignments, then reassign exactly per the sheet
  update guests set table_no = null, seat_no = null where table_no is not null;

  update guests gu
  set table_no = (x->>'table_no')::int, seat_no = (x->>'seat_no')::int
  from jsonb_array_elements(payload->'guests') x
  where gu.name_en = trim(coalesce(x->>'name_en', ''))
    and gu.name_zh = trim(coalesce(x->>'name_zh', ''));
  get diagnostics v_imported = row_count;

  select jsonb_array_length(payload->'guests') into v_expected;
  if v_imported <> v_expected then
    raise exception 'seat assignment mismatch: % of % guests matched', v_imported, v_expected;
  end if;

  -- the sheet is authoritative: anyone not in it is removed entirely
  delete from guests g
  where not exists (
    select 1 from jsonb_array_elements(payload->'guests') x
    where g.name_en = trim(coalesce(x->>'name_en', ''))
      and g.name_zh = trim(coalesce(x->>'name_zh', ''))
  );
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('imported', v_imported, 'new', v_new, 'deleted', v_deleted);
end $$;

revoke execute on function import_seating(jsonb) from public, anon, authenticated;
grant execute on function import_seating(jsonb) to authenticated;
