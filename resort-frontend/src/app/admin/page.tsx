'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, DoorOpen, LogOut, Users, Wrench } from 'lucide-react';
import { AdminManagement } from '@/components/admin-management';
import { CancellationQueue } from '@/components/cancellation-queue';
import { AdminExtras, NotificationInbox } from '@/components/admin-extras';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Overview = { property: string; date: string; rooms: number; bookings: number; arrivals: number; departures: number; activeStays: number; guests: number };
type Session = { accessToken: string; refreshToken: string; user: { firstName: string; lastName: string; email: string; roles: string[] } };
type StaffRoom = { id: string; roomNumber: string; roomTypeId: string; roomType: { name: string } };
type StaffBooking = { id: string; confirmationNumber: string; status: string; checkIn: string; checkOut: string; totalAmount: number; currency: string; guestProfile: { firstName: string; lastName: string; email: string | null; phone: string | null }; items: { id: string; roomTypeId: string; roomTypeNameSnapshot: string; quantity: number; roomAssignments: { status: string; room: { roomNumber: string } }[] }[] };

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [rooms, setRooms] = useState<StaffRoom[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const stored = sessionStorage.getItem('aranya-staff-session');
    if (stored) {
      try {
        const saved = JSON.parse(stored) as Session;
        if (saved.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST'].includes(role))) setSession(saved);
        else if (saved.user.roles.some((role) => ['HOUSEKEEPER', 'MAINTENANCE'].includes(role))) router.replace('/staff');
        else if (saved.user.roles.includes('CUSTOMER')) router.replace('/resort');
      } catch { sessionStorage.removeItem('aranya-staff-session'); }
    }
  }, [router]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    fetch(`${apiBase}/admin/overview`, { headers })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load overview.'); return data as Overview; })
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    Promise.all([
      fetch(`${apiBase}/admin/bookings`, { headers }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data as StaffBooking[]; }),
      fetch(`${apiBase}/admin/rooms`, { headers }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data as StaffRoom[]; }),
    ]).then(([bookingData, roomData]) => { if (!cancelled) { setBookings(bookingData); setRooms(roomData); } })
      .catch((cause: Error) => { if (!cancelled) setActionError(cause.message); });
    return () => { cancelled = true; };
  }, [session]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Sign in failed.');
      const next = data as Session;
      if (!next.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST'].includes(role))) throw new Error('This account does not have staff dashboard access.');
      sessionStorage.setItem('aranya-staff-session', JSON.stringify(next)); setSession(next); setPassword('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (session) await fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => undefined);
    sessionStorage.removeItem('aranya-staff-session'); setSession(null); setOverview(null);
  }

  async function bookingAction(booking: StaffBooking, action: 'check-in' | 'check-out') {
    setActionError('');
    try {
      const roomId = selectedRooms[booking.id];
      const item = booking.items[0];
      const response = await fetch(`${apiBase}/admin/bookings/${booking.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.accessToken}` },
        ...(action === 'check-in' ? { body: JSON.stringify({ roomId, bookingItemId: item?.id }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? `Could not ${action} guest.`);
      const nextBookings = await fetch(`${apiBase}/admin/bookings`, { headers: { Authorization: `Bearer ${session?.accessToken}` } }).then((res) => res.json()) as StaffBooking[];
      setBookings(nextBookings);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
  }

  return <main className="admin-shell">
    <header className="admin-header"><a className="wordmark" href="/resort">ARANYA<span>STAFF PORTAL</span></a><a href="/resort" className="admin-back"><ArrowLeft size={15}/> BACK TO SITE</a></header>
    {!session ? <form className="admin-login" onSubmit={signIn}><div className="section-kicker">STAFF ACCESS · ARANYA RETREATS</div><h1>Welcome <em>back.</em></h1><p>Sign in with your resort staff account to open the operations overview.</p><label>EMAIL<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>PASSWORD<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="admin-error" role="alert">{error}</p>}<button disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button></form> : <section className="admin-dashboard"><div className="admin-title"><div><div className="section-kicker">OPERATIONS · {overview?.date ?? 'LOADING'}</div><h1>{overview?.property ?? 'Your resort'} <em>overview.</em></h1><p>Good to see you, {session.user.firstName}.</p></div><div className="admin-header-actions"><NotificationInbox token={session.accessToken} /><button className="signout-button" onClick={() => void signOut()}><LogOut size={15}/> SIGN OUT</button></div></div><a className="ops-link" href="/staff">OPEN HOUSEKEEPING & MAINTENANCE <Wrench size={15}/></a>{error && <p className="admin-error">{error}</p>}{overview ? <><div className="admin-stats"><article><span><DoorOpen size={17}/> ACTIVE ROOMS</span><strong>{overview.rooms}</strong></article><article><span><CalendarDays size={17}/> CURRENT BOOKINGS</span><strong>{overview.bookings}</strong></article><article><span><Users size={17}/> GUEST PROFILES</span><strong>{overview.guests}</strong></article></div><div className="admin-today"><h2>Today at a glance</h2><div><span>Arrivals <strong>{overview.arrivals}</strong></span><span>Departures <strong>{overview.departures}</strong></span><span>Guests in house <strong>{overview.activeStays}</strong></span></div></div></> : <p>Loading resort overview…</p>}<section className="frontdesk-list"><div className="frontdesk-heading"><div className="section-kicker">FRONT DESK</div><h2>Recent reservations</h2></div>{actionError && <p className="admin-error">{actionError}</p>}{bookings.length ? bookings.map((booking) => { const item = booking.items[0]; const assignedRoom = item?.roomAssignments.find((assignment) => assignment.status === 'CHECKED_IN')?.room.roomNumber; const roomOptions = rooms.filter((room) => room.roomTypeId === item?.roomTypeId); return <article className="frontdesk-booking" key={booking.id}><div><strong>{booking.guestProfile.firstName} {booking.guestProfile.lastName}</strong><small>{booking.confirmationNumber} · {item?.roomTypeNameSnapshot ?? 'Room'}</small></div><div><span className={`status-pill status-${booking.status.toLowerCase()}`}>{booking.status.replaceAll('_', ' ')}</span><small>{new Date(booking.checkIn).toLocaleDateString()} – {new Date(booking.checkOut).toLocaleDateString()}</small></div>{booking.status === 'CONFIRMED' && item?.quantity === 1 ? <div className="frontdesk-actions"><select aria-label={`Room for ${booking.confirmationNumber}`} value={selectedRooms[booking.id] ?? ''} onChange={(event) => setSelectedRooms({ ...selectedRooms, [booking.id]: event.target.value })}><option value="">Assign room</option>{roomOptions.map((room) => <option key={room.id} value={room.id}>{room.roomNumber} · {room.roomType.name}</option>)}</select><button disabled={!selectedRooms[booking.id]} onClick={() => void bookingAction(booking, 'check-in')}>CHECK IN</button></div> : booking.status === 'CHECKED_IN' ? <div className="frontdesk-actions"><span className="assigned-room">Room {assignedRoom ?? 'assigned'}</span><button onClick={() => void bookingAction(booking, 'check-out')}>CHECK OUT</button></div> : <span className="frontdesk-total">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: booking.currency, maximumFractionDigits: 0 }).format(booking.totalAmount)}</span>}</article>; }) : <p className="admin-note">No reservations yet.</p>}</section><CancellationQueue token={session.accessToken} roles={session.user.roles} /><AdminManagement token={session.accessToken} roles={session.user.roles} /><AdminExtras token={session.accessToken} /><p className="admin-note">Room allocation and check-in controls are available for confirmed reservations.</p></section>}
  </main>;
}
