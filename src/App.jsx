import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const ROOMS = [
  { id: 'room-1', name: '1号小教室', capacity: 3, note: '一对一' },
  { id: 'room-2', name: '2号小教室', capacity: 3, note: '一对一' },
  { id: 'room-3', name: '3号小教室', capacity: 3, note: '一对一' },
  { id: 'atelier-1f', name: '3号大教室', capacity: 6, note: '小组课 / 一对一' },
  { id: 'music-6f', name: '6楼音乐部1号教室', capacity: 3, note: '小组课 / 一对一' },
  { id: 'music-6f-3', name: '6楼音乐部3号教室', capacity: 3, note: '小组课 / 一对一' },
]

const TIME_SLOTS = ['10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00', '21:00-22:00']
const PURPOSES = ['小班课', '一对一', '模拟考', '升学指导', '面试练习', '说明会', '其他']

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

const SQL_SETUP = `-- 创建预约表
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

alter publication supabase_realtime add table public.classroom_bookings;`

function pad(n) { return String(n).padStart(2, '0') }
function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
function parseDateKey(key) { const [y,m,d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d }
function getMonday(date) { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); d.setHours(0,0,0,0); return d }
function dayLabel(date) { const w = ['日','月','火','水','木','金','土']; return `${date.getMonth()+1}/${date.getDate()}（${w[date.getDay()]}）` }
function keyOf(date, roomId, slot) { return `${date}__${roomId}__${slot}` }

function downloadCSV(bookings) {
  const header = ['日期','星期','教室','时段','预约人/课程','用途','备注']
  const rows = bookings.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.slot.localeCompare(b.slot)).map(b => {
    const d = parseDateKey(b.date)
    const room = ROOMS.find(r => r.id === b.room_id)?.name || b.room_id
    return [b.date, `星期${'日一二三四五六'[d.getDay()]}`, room, b.slot, b.name, b.purpose, b.memo || '']
  })
  const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `教室预约_${dateKey(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [bookings, setBookings] = useState([])
  const [weekStart, setWeekStart] = useState(getMonday(new Date()))
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()))
  const [selectedRoom, setSelectedRoom] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', purpose: '小班课', memo: '' })
  const [status, setStatus] = useState(supabase ? '连接中' : '未配置数据库')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const weekDays = useMemo(() => Array.from({length: 7}, (_, i) => addDays(weekStart, i)), [weekStart])
  const visibleRooms = useMemo(() => ROOMS.filter(r => selectedRoom === 'all' || r.id === selectedRoom), [selectedRoom])
  const bookingsMap = useMemo(() => new Map(bookings.map(b => [keyOf(b.date, b.room_id, b.slot), b])), [bookings])
  const selectedDateObj = parseDateKey(selectedDate)
  const stats = useMemo(() => {
    const used = bookings.filter(b => b.date === selectedDate).length
    return { total: ROOMS.length * TIME_SLOTS.length, used, free: ROOMS.length * TIME_SLOTS.length - used }
  }, [bookings, selectedDate])
  const dailyBookings = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookings
      .filter(b => b.date === selectedDate)
      .filter(b => selectedRoom === 'all' || b.room_id === selectedRoom)
      .filter(b => !q || [b.name,b.purpose,b.memo,b.slot,ROOMS.find(r=>r.id===b.room_id)?.name].join(' ').toLowerCase().includes(q))
      .sort((a,b)=>a.slot.localeCompare(b.slot)||a.room_id.localeCompare(b.room_id))
  }, [bookings, selectedDate, selectedRoom, search])

  async function fetchBookings() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const { data, error } = await supabase.from('classroom_bookings').select('*').order('date').order('slot')
    if (error) { setError(error.message); setStatus('连接错误') }
    else { setBookings(data || []); setStatus('云端同步中') }
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) return
    fetchBookings()
    const channel = supabase
      .channel('classroom_bookings_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_bookings' }, fetchBookings)
      .subscribe((s) => { if (s === 'SUBSCRIBED') setStatus('云端同步中') })
    return () => { supabase.removeChannel(channel) }
  }, [])

  function openSlot(date, roomId, slot) {
    const existing = bookingsMap.get(keyOf(date, roomId, slot))
    if (existing) {
      setModal({ mode: 'edit', booking: existing, date, roomId, slot })
      setForm({ name: existing.name, purpose: existing.purpose, memo: existing.memo || '' })
    } else {
      setModal({ mode: 'new', date, roomId, slot })
      setForm({ name: '', purpose: '小班课', memo: '' })
    }
  }

  async function saveBooking() {
    if (!supabase) { alert('还没有配置 Supabase 环境变量。'); return }
    if (!form.name.trim()) { alert('请填写预约人或课程名称。'); return }
    setError('')

    if (modal.mode === 'new') {
      const { error } = await supabase.from('classroom_bookings').insert({
        date: modal.date, room_id: modal.roomId, slot: modal.slot,
        name: form.name.trim(), purpose: form.purpose, memo: form.memo.trim()
      })
      if (error) {
        const msg = error.code === '23505' ? '这个教室和时间段已经被别人预约了，请换一个时间。' : error.message
        setError(msg); alert(msg); return
      }
    } else {
      const { error } = await supabase.from('classroom_bookings').update({
        name: form.name.trim(), purpose: form.purpose, memo: form.memo.trim(), updated_at: new Date().toISOString()
      }).eq('id', modal.booking.id)
      if (error) { setError(error.message); alert(error.message); return }
    }
    setModal(null)
    await fetchBookings()
  }

  async function deleteBooking(id) {
    if (!supabase) return
    if (!confirm('确定删除这条预约吗？')) return
    const { error } = await supabase.from('classroom_bookings').delete().eq('id', id)
    if (error) { setError(error.message); alert(error.message); return }
    setModal(null)
    await fetchBookings()
  }


  return <div className="page">
    <header className="hero">
      <div>
        <div className="badge">楽之教育｜教室预约系统</div>
        <h1>多人共享教室预约</h1>
        <p>10:00–22:00，每1小时一个预约格。所有预约保存到 Supabase 云端数据库。</p>
        <div className={`status ${status === '云端同步中' ? 'ok' : 'warn'}`}>{status}</div>
      </div>
      <div className="stats">
        <div><b>{stats.total}</b><span>总时段</span></div>
        <div><b>{stats.used}</b><span>已预约</span></div>
        <div><b>{stats.free}</b><span>空余</span></div>
      </div>
    </header>

    {!supabase && <section className="notice">
      <h2>还没有连接数据库</h2>
      <p>在 Vercel 环境变量中添加 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 后，重新部署即可连接。</p>
      <pre>{SQL_SETUP}</pre>
    </section>}

    {error && <div className="error">系统提示：{error}</div>}

    <section className="toolbar">
      <div className="weekNav">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>上一周</button>
        <button onClick={() => { const t = new Date(); setWeekStart(getMonday(t)); setSelectedDate(dateKey(t)) }}>今天</button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>下一周</button>
      </div>
      <div className="filters">
        <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)}>
          <option value="all">全部教室</option>
          {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索学生、老师、课程、备注" />
        <button onClick={fetchBookings} disabled={!supabase || loading}>{loading ? '刷新中' : '刷新'}</button>
        <button onClick={() => downloadCSV(bookings)}>导出CSV</button>
      </div>
    </section>

    <section className="days">
      {weekDays.map(d => {
        const k = dateKey(d)
        const isSelected = k === selectedDate
        const count = bookings.filter(b=>b.date===k).length
        return <button key={k} className={isSelected ? 'selected' : ''} onClick={()=>setSelectedDate(k)}>
          <strong>{dayLabel(d)}</strong><span>{count} 个预约</span>
        </button>
      })}
    </section>

    <main className="layout">
      <section className="card tableWrap">
        <h2>{dayLabel(selectedDateObj)} 预约表</h2>
        <table>
          <thead><tr><th>时间</th>{visibleRooms.map(room => <th key={room.id}>{room.name}<small> 容纳{room.capacity}人｜{room.note}</small></th>)}</tr></thead>
          <tbody>
            {TIME_SLOTS.map(slot => <tr key={slot}>
              <td className="time">{slot}</td>
              {visibleRooms.map(room => {
                const b = bookingsMap.get(keyOf(selectedDate, room.id, slot))
                return <td key={room.id}>
                  {b ? <button className="booked" onClick={()=>openSlot(selectedDate, room.id, slot)}>
                    <span>{b.purpose}</span><b>{b.name}</b>{b.memo && <em>{b.memo}</em>}
                  </button> : <button className="empty" onClick={()=>openSlot(selectedDate, room.id, slot)}>+ 预约</button>}
                </td>
              })}
            </tr>)}
          </tbody>
        </table>
      </section>

      <aside className="card side">
        <h2>当日预约明细</h2>
        {dailyBookings.length === 0 ? <p className="muted">暂无预约。</p> : dailyBookings.map(b => {
          const room = ROOMS.find(r=>r.id===b.room_id)
          return <div className="detail" key={b.id}>
            <div><b>{b.slot}</b><button onClick={()=>openSlot(b.date,b.room_id,b.slot)}>编辑</button><button onClick={()=>deleteBooking(b.id)}>删除</button></div>
            <strong>{b.name}</strong>
            <p>{room?.name}｜{b.purpose}</p>
            {b.memo && <small>{b.memo}</small>}
          </div>
        })}
      </aside>
    </main>

    {modal && <div className="modalBackdrop" onClick={()=>setModal(null)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>{modal.mode === 'new' ? '新增预约' : '编辑预约'}</h2>
        <p>{modal.date}｜{ROOMS.find(r=>r.id===modal.roomId)?.name}｜{modal.slot}</p>
        <label>预约人 / 课程名称<input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} placeholder="例：张同学数学一对一" /></label>
        <label>用途<select value={form.purpose} onChange={e=>setForm({...form, purpose:e.target.value})}>{PURPOSES.map(p=><option key={p}>{p}</option>)}</select></label>
        <label>备注<textarea rows="4" value={form.memo} onChange={e=>setForm({...form, memo:e.target.value})} placeholder="老师、人数、注意事项等" /></label>
        <div className="modalActions">
          {modal.mode === 'edit' && <button className="danger" onClick={()=>deleteBooking(modal.booking.id)}>删除</button>}
          <span />
          <button onClick={()=>setModal(null)}>取消</button>
          <button className="primary" onClick={saveBooking}>保存</button>
        </div>
      </div>
    </div>}
  </div>
}
