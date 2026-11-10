'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Check, LogOut, Wrench } from 'lucide-react';
import { NotificationInbox } from '@/components/admin-extras';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type StaffSession = { accessToken: string; refreshToken: string; user: { roles: string[]; firstName: string } };
type HouseTask = { id: string; taskType: string; status: string; notes: string | null; room: { roomNumber: string; roomType: { name: string } } };
type MaintenanceTask = { id: string; title: string; description: string; priority: string; status: string; room: { roomNumber: string; roomType: { name: string } } };
type OperationsRoom = { id: string; roomNumber: string; operationalStatus: string; roomType: { name: string } };

export default function StaffOperationsPage() {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [housekeeping, setHousekeeping] = useState<HouseTask[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceTask[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rooms, setRooms] = useState<OperationsRoom[]>([]);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('aranya-staff-session');
    if (stored) { try { setSession(JSON.parse(stored) as StaffSession); } catch { setError('Please sign in again from the staff portal.'); } }
    else setError('Sign in at the staff portal first, then open this operations page.');
  }, []);

  useEffect(() => {
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    if (session.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'HOUSEKEEPER'].includes(role))) {
      fetch(`${apiBase}/operations/housekeeping`, { headers }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.message); return d as HouseTask[]; }).then(setHousekeeping).catch((e: Error) => setError(e.message));
    }
    if (session.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'].includes(role))) {
      fetch(`${apiBase}/operations/maintenance`, { headers }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.message); return d as MaintenanceTask[]; }).then(setMaintenance).catch((e: Error) => setError(e.message));
    }
    if (session.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'HOUSEKEEPER', 'MAINTENANCE'].includes(role))) {
      fetch(`${apiBase}/operations/rooms`, { headers }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.message); return d as OperationsRoom[]; }).then(setRooms).catch((e: Error) => setError(e.message));
    }
  }, [session]);

  async function createMaintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session) return;
    setReporting(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiBase}/operations/maintenance`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify({ roomId: form.get('roomId'), title: form.get('title'), description: form.get('description'), priority: form.get('priority') }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not report maintenance issue.');
      event.currentTarget.reset();
      const headers = { Authorization: `Bearer ${session.accessToken}` };
      const [tasks, updatedRooms] = await Promise.all([fetch(`${apiBase}/operations/maintenance`, { headers }).then((r) => r.json()) as Promise<MaintenanceTask[]>, fetch(`${apiBase}/operations/rooms`, { headers }).then((r) => r.json()) as Promise<OperationsRoom[]>]);
      setMaintenance(tasks); setRooms(updatedRooms);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setReporting(false); }
  }

  async function completeTask(id: string) {
    setBusy(id); setError('');
    try {
      const response = await fetch(`${apiBase}/operations/housekeeping/${id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.accessToken}` }, body: JSON.stringify({}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not complete task.');
      setHousekeeping((items) => items.map((task) => task.id === id ? { ...task, status: 'COMPLETED' } : task));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); } finally { setBusy(''); }
  }

  async function setMaintenanceStatus(task: MaintenanceTask, status: string) {
    setBusy(task.id); setError('');
    try {
      const response = await fetch(`${apiBase}/operations/maintenance/${task.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.accessToken}` }, body: JSON.stringify({ status }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not update request.');
      setMaintenance((items) => items.map((item) => item.id === task.id ? { ...item, status } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); } finally { setBusy(''); }
  }

  async function signOut() {
    if (session?.refreshToken) await fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => undefined);
    sessionStorage.removeItem('aranya-staff-session');
    window.location.assign('/');
  }

  return <main className="admin-shell"><header className="admin-header"><a className="wordmark" href="/resort">ARANYA<span>OPERATIONS</span></a>{session?.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST'].includes(role)) && <a className="admin-back" href="/admin"><ArrowLeft size={15}/> ADMIN / FRONT DESK</a>}{session && <div className="admin-header-actions"><NotificationInbox token={session.accessToken} /><button className="signout-button" onClick={() => void signOut()}><LogOut size={15}/> SIGN OUT</button></div>}{!session && <a className="admin-back" href="/"><ArrowLeft size={15}/> SIGN IN</a>}</header><section className="admin-dashboard"><div className="section-kicker">RESORT OPERATIONS</div><h1>Today&apos;s <em>work.</em></h1>{error && <p className="admin-error" role="alert">{error}</p>}{session && <p className="admin-note">Signed in as {session.user.firstName} · {session.user.roles.join(', ')}</p>}
    {session?.user.roles.includes('RECEPTIONIST') && <section className="ops-section"><h2>Front desk</h2><p className="admin-note">Your assigned account also has reservation and front desk access.</p><a className="ops-link" href="/admin">OPEN FRONT DESK PORTAL</a></section>}
    {session?.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'HOUSEKEEPER'].includes(role)) && <section className="ops-section"><h2><Check size={18}/> Housekeeping</h2>{housekeeping.length ? housekeeping.map((task) => <article className="ops-card" key={task.id}><div><strong>Room {task.room.roomNumber} · {task.room.roomType.name}</strong><small>{task.taskType.replaceAll('_', ' ')} · {task.notes ?? 'Standard cleaning'}</small></div><span className={`status-pill status-${task.status.toLowerCase()}`}>{task.status.replaceAll('_', ' ')}</span>{task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && <button disabled={busy === task.id} onClick={() => void completeTask(task.id)}>{busy === task.id ? 'SAVING…' : 'MARK CLEAN'}</button>}</article>) : <p className="admin-note">No housekeeping tasks are open.</p>}</section>}
    {session?.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'].includes(role)) && <section className="ops-section"><h2><Wrench size={18}/> Maintenance</h2>{session.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'RECEPTIONIST'].includes(role)) && <form className="maintenance-report" onSubmit={createMaintenance}><h3>Report an issue</h3><label>ROOM<select name="roomId" required defaultValue=""><option value="" disabled>Choose a room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.roomNumber} · {room.roomType.name}{room.operationalStatus === 'MAINTENANCE' ? ' (already under maintenance)' : ''}</option>)}</select></label><label>TITLE<input name="title" maxLength={120} required placeholder="e.g. Air conditioning issue" /></label><label>DESCRIPTION<textarea name="description" maxLength={2000} required rows={3} /></label><label>PRIORITY<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><button disabled={reporting}>{reporting ? 'REPORTING…' : 'CREATE REQUEST'}</button></form>}{maintenance.length ? maintenance.map((task) => <article className="ops-card" key={task.id}><div><strong>Room {task.room.roomNumber} · {task.title}</strong><small>{task.priority} priority · {task.description}</small></div><span className={`status-pill status-${task.status.toLowerCase()}`}>{task.status.replaceAll('_', ' ')}</span>{!['COMPLETED', 'CANCELLED'].includes(task.status) && <select value={task.status} disabled={busy === task.id} onChange={(event) => void setMaintenanceStatus(task, event.target.value)}><option value="OPEN">OPEN</option><option value="ASSIGNED">ASSIGNED</option><option value="IN_PROGRESS">IN PROGRESS</option><option value="COMPLETED">COMPLETED</option><option value="CANCELLED">CANCELLED</option></select>}</article>) : <p className="admin-note">No maintenance requests are open.</p>}</section>}
    </section></main>;
}
