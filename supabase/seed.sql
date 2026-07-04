insert into tables (table_no, label_en, label_zh)
select n, format('Table %s', n), format('%s号桌', n) from generate_series(1, 12) n;

insert into guests (name_en, name_zh, table_no, seat_no) values
  ('Carol Zhao',  '赵卡罗',   1, 1),
  ('Kevin Hu',    '胡凯文',   1, 2),
  ('Eric Dang',   '邓艾瑞',   1, 3),
  ('James Dang',  '邓杰姆斯', 1, 4),
  ('Victoria Li', '李维多',   2, 1),
  ('Eric Liu',    '刘艾瑞',   2, 2),
  ('Tiger Chen',  '陈泰格',   null, null),
  ('José García', '',         null, null),
  ('',            '王奶奶',   3, 1);
