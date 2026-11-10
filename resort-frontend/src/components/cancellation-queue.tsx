'use client';

import { useCallback, useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Cancellation = {
  id: string; status: string; reason: string | null; decisionNote: string | null; requestedAt: string;
  booking: { confirmationNumber: string; status: string; checkIn: string; checkOut: string; amountPaid: number; currency: string; guestProfile: { firstName: string; lastName: string; email: string | null }; payments: { refunds: { status: string; amount: number; currency: string }[] }[] };
  requestedBy: { firstName: string; lastName: string } | null;
};

export function CancellationQueue({ token, roles }: { token: string; roles: string[] }) {
  const [requests, setRequests] = useState<Cancellation[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const canDecide = roles.some((role) => ['SUPER_ADMIN', 'MANAGER'].includes(role));
  const refresh = useCallback(async () => {
    const response = await fetch(`${apiBase}/admin/cancellations`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? 'Could not load cancellation requests.');
    setRequests(data as Cancellation[]);
  }, [token]);
  useEffect(() => { refresh().catch((cause: Error) => setError(cause.message)); }, [refresh]);

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    const note = window.prompt(decision === 'APPROVE' ? 'Optional note for the guest:' : 'Reason for declining this request:');
    if (note === null) return;
    setBusyId(id); setError('');
    try {
      const response = await fetch(`${apiBase}/admin/cancellations/${id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ decision, note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not update this request.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setBusyId(''); }
  }

  return <section className="frontdesk-list cancellation-queue">
    <div className="frontdesk-heading"><div className="section-kicker">GUEST REQUESTS</div><h2>Cancellation review</h2></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {requests.length ? requests.map((item) => <article className="frontdesk-booking" key={item.id}>
      <div><strong>{item.booking.guestProfile.firstName} {item.booking.guestProfile.lastName}</strong><small>{item.booking.confirmationNumber}{item.booking.guestProfile.email ? ` · ${item.booking.guestProfile.email}` : ''}</small></div>
      <div><span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status}</span><small>{new Date(item.booking.checkIn).toLocaleDateString()} – {new Date(item.booking.checkOut).toLocaleDateString()}</small></div>
      <div><small>PAID</small><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: item.booking.currency, maximumFractionDigits: 0 }).format(item.booking.amountPaid)}</strong></div>
      <div className="cancellation-reason"><small>GUEST REASON</small><span>{item.reason || 'No reason provided'}</span>{item.decisionNote && <small>STAFF NOTE · {item.decisionNote}</small>}{item.booking.payments.flatMap((payment) => payment.refunds).map((refund, index) => <small key={index}>REFUND · {refund.status} · {new Intl.NumberFormat('en-IN', { style: 'currency', currency: refund.currency, maximumFractionDigits: 0 }).format(refund.amount)}</small>)}</div>
      {canDecide && item.status === 'PENDING' && <div className="frontdesk-actions"><button disabled={busyId === item.id} onClick={() => void decide(item.id, 'APPROVE')}>{busyId === item.id ? 'PLEASE WAIT…' : 'APPROVE & REFUND'}</button><button className="mode-switch" disabled={busyId === item.id} onClick={() => void decide(item.id, 'REJECT')}>DECLINE</button></div>}
    </article>) : <p className="admin-note">No cancellation requests have been submitted.</p>}
  </section>;
}
