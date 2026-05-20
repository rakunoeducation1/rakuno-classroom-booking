# 楽之教育｜教室预约系统发布说明

## 1. Supabase 先执行 SQL

进入 Supabase 项目 → SQL Editor → New query → 粘贴下面 SQL → Run：

```sql
create table if not exists public.classroom_bookings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  room_id text not null,
  slot text not null,
  name text not null,
  purpose text not null default '小班课',
  memo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, room_id, slot)
);

alter table public.classroom_bookings enable row level security;

create policy "public read classroom bookings"
on public.classroom_bookings
for select
to anon
using (true);

create policy "public insert classroom bookings"
on public.classroom_bookings
for insert
to anon
with check (true);

create policy "public update classroom bookings"
on public.classroom_bookings
for update
to anon
using (true)
with check (true);

create policy "public delete classroom bookings"
on public.classroom_bookings
for delete
to anon
using (true);

alter publication supabase_realtime add table public.classroom_bookings;
```

如果最后一句提示 already member，代表已经开启过实时同步，可以忽略。

## 2. 在 Vercel 添加环境变量

VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase publishable key 或 anon public key

## 3. Vercel 构建设置

Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install

