'use client';

import { useCallback, useEffect, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type CustomerSession = { accessToken: string; refreshToken: string; user: { firstName: string; lastName: string; email: string; roles: string[] } };
type Reservation = { confirmationNumber: string; status: string; checkIn: string; checkOut: string; totalAmount: number; currency: string; items: { roomTypeNameSnapshot: string; quantity: number }[]; cancellationRequests?: { status: string; reason: string | null; decisionNote: string | null }[] };
type Notice = { id: string; subject: string | null; templateKey: string; status: string; createdAt: string; readAt: string | null };

export function CustomerAccountMenu() {
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const stored = sessionStorage.getItem('aranya-customer-session');
    if (!stored) return;
    try { setSession(JSON.parse(stored) as CustomerSession); }
    catch { sessionStorage.removeItem('aranya-customer-session'); }
  }, []);

  const loadReservations = useCallback(async () => {
    if (!session) return;
    const response = await fetch(`${apiBase}/auth/bookings`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? 'Could not load your reservations.');
    setReservations(data as Reservation[]);
  }, [session]);

  const loadNotifications = useCallback(async () => {
    if (!session) return;
    const response = await fetch(`${apiBase}/notifications`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? 'Could not load your notifications.');
    setNotices(data as Notice[]);
  }, [session]);

  useEffect(() => {
    if (open && session) Promise.all([loadReservations(), loadNotifications()]).catch((cause: Error) => setError(cause.message));
  }, [open, session, loadReservations, loadNotifications]);

  async function requestCancellation(confirmationNumber: string) {
    if (!session) return;
    const reason = window.prompt('Why would you like to cancel? (Optional)');
    if (reason === null) return;
    setBusy(confirmationNumber); setError('');
    try {
      const response = await fetch(`${apiBase}/bookings/${encodeURIComponent(confirmationNumber)}/cancellation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify({ reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not request cancellation.');
      await loadReservations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setBusy(''); }
  }

  async function signOut() {
    if (session?.refreshToken) await fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => undefined);
    sessionStorage.removeItem('aranya-customer-session');
    setSession(null); setReservations([]); setOpen(false);
  }

  async function markNotificationRead(id: string) {
    if (!session) return;
    const response = await fetch(`${apiBase}/notifications/${id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (response.ok) setNotices((items) => items.map((notice) => notice.id === id ? { ...notice, readAt: new Date().toISOString() } : notice));
  }

  return <div className="customer-account-menu">
    <button className="customer-account-trigger" aria-expanded={open} aria-label={session ? `Account for ${session.user.firstName}` : 'Sign in or create an account'} onClick={() => { setOpen((value) => !value); setError(''); }}>
      <UserRound size={16}/><span>{session ? session.user.firstName.toUpperCase() : 'MY ACCOUNT'}</span>
    </button>
    {open && <section className="customer-account-panel" aria-label="Customer account">
      {session ? <>
        <div className="customer-account-heading"><div><div className="section-kicker">YOUR ARANYA ACCOUNT</div><h2>Welcome, <em>{session.user.firstName}.</em></h2><p>{session.user.email}</p></div><button className="customer-account-close" aria-label="Close account menu" onClick={() => setOpen(false)}>×</button></div>
        <div className="customer-reservations-heading">YOUR RESERVATIONS</div>
        {error && <p className="customer-account-error" role="alert">{error}</p>}
        {notices.length > 0 && <div className="customer-notifications"><small>RECENT UPDATES</small>{notices.slice(0, 4).map((notice) => <button className={notice.readAt ? 'is-read' : ''} key={notice.id} onClick={() => !notice.readAt && void markNotificationRead(notice.id)}><span>{notice.subject ?? notice.templateKey.replaceAll('.', ' ')}</span><small>{new Date(notice.createdAt).toLocaleDateString()}</small></button>)}</div>}
        {reservations.length ? <div className="customer-reservations">{reservations.map((stay) => {
          const latest = stay.cancellationRequests?.[0];
          const canCancel = ['CONFIRMED', 'PENDING_PAYMENT'].includes(stay.status) && new Date(stay.checkIn).setHours(0, 0, 0, 0) >= new Date().setHours(0, 0, 0, 0) && (!latest || latest.status === 'REJECTED');
          return <article className="customer-reservation" key={stay.confirmationNumber}>
            <div className="customer-reservation-top"><strong>{stay.items.map((item) => item.roomTypeNameSnapshot).join(', ') || 'Resort stay'}</strong><span>{stay.status.replaceAll('_', ' ')}</span></div>
            <small>{stay.confirmationNumber} · {new Date(stay.checkIn).toLocaleDateString()} – {new Date(stay.checkOut).toLocaleDateString()}</small>
            {latest?.status === 'PENDING' && <small className="customer-cancellation-status">Cancellation request awaiting review</small>}
            <div className="customer-reservation-actions"><a href={`/account/invoice?confirmationNumber=${encodeURIComponent(stay.confirmationNumber)}`}>VIEW INVOICE</a>{canCancel && <button disabled={busy === stay.confirmationNumber} onClick={() => void requestCancellation(stay.confirmationNumber)}>{busy === stay.confirmationNumber ? 'PLEASE WAIT…' : 'REQUEST CANCELLATION'}</button>}</div>
          </article>;
        })}</div> : <p className="customer-account-empty">No reservations are linked to this email yet.</p>}
        <button className="customer-account-signout" onClick={() => void signOut()}><LogOut size={14}/> SIGN OUT</button>
      </> : <div className="customer-account-guest"><div className="section-kicker">WELCOME TO ARANYA</div><h2>Your stays,<br/><em>all together.</em></h2><p>Sign in or create a guest account to see your reservations and invoices.</p><a href="/">SIGN IN / CREATE ACCOUNT</a></div>}
    </section>}
  </div>;
}
