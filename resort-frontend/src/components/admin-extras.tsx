'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Catalog = { roomTypes: { id: string; name: string }[]; ratePlans: { id: string; name: string; currency: string }[]; rates: { id: string; roomTypeId: string; ratePlanId: string; roomType: { name: string }; ratePlan: { name: string }; rateDate: string; amount: number; currency: string; minimumStay: number | null; maximumStay: number | null }[] };
type Promotion = { id: string; code: string; name: string; description: string | null; discountType: string; discountValue: number; startsAt: string; endsAt: string; minimumNights: number; usageLimit: number | null; usageCount: number; active: boolean; roomTypes: { id: string; name: string }[] };
type Audit = { id: string; action: string; entityType: string; entityId: string; after: unknown; createdAt: string; actor: { firstName: string; lastName: string; email: string | null } | null };

function localDateTime(hoursFromNow = 0) {
  const date = new Date(Date.now() + hoursFromNow * 3_600_000 - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function AdminExtras({ token }: { token: string }) {
  const [catalog, setCatalog] = useState<Catalog>({ roomTypes: [], ratePlans: [], rates: [] });
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    const [rateResponse, promoResponse, auditResponse] = await Promise.all([
      fetch(`${apiBase}/admin/rates/catalog`, { headers }), fetch(`${apiBase}/admin/promotions`, { headers }), fetch(`${apiBase}/admin/audit-logs`, { headers }),
    ]);
    const [rateData, promoData, auditData] = await Promise.all([rateResponse.json(), promoResponse.json(), auditResponse.json()]);
    if (!rateResponse.ok) throw new Error(rateData.message ?? 'Could not load rate settings.');
    if (!promoResponse.ok) throw new Error(promoData.message ?? 'Could not load promotions.');
    if (!auditResponse.ok) throw new Error(auditData.message ?? 'Could not load audit history.');
    setCatalog(rateData as Catalog); setPromotions(promoData as Promotion[]); setAudit(auditData as Audit[]);
  }, [token]);

  useEffect(() => { load().catch((cause: Error) => setMessage(cause.message)); }, [load]);

  async function submitRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiBase}/admin/rates/bulk`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ roomTypeId: form.get('roomTypeId'), ratePlanId: form.get('ratePlanId'), startDate: form.get('startDate'), endDate: form.get('endDate'), amount: Number(form.get('amount')), minimumStay: form.get('minimumStay') ? Number(form.get('minimumStay')) : undefined, maximumStay: form.get('maximumStay') ? Number(form.get('maximumStay')) : undefined }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not update rates.');
      setMessage(`Updated ${data.updated} nightly rates.`); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setSaving(false); }
  }

  async function submitPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const roomTypeId = String(form.get('roomTypeId') ?? '');
      const response = await fetch(`${apiBase}/admin/promotions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: form.get('code'), name: form.get('name'), description: form.get('description'), discountType: form.get('discountType'), discountValue: Number(form.get('discountValue')), startsAt: new Date(String(form.get('startsAt'))).toISOString(), endsAt: new Date(String(form.get('endsAt'))).toISOString(), minimumNights: Number(form.get('minimumNights')), usageLimit: form.get('usageLimit') ? Number(form.get('usageLimit')) : null, roomTypeIds: roomTypeId ? [roomTypeId] : [] }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not create promotion.');
      formElement.reset(); setMessage(`Created promotion ${data.code}.`); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setSaving(false); }
  }

  async function togglePromotion(promotion: Promotion) {
    setSaving(true); setMessage('');
    try {
      const response = await fetch(`${apiBase}/admin/promotions/${promotion.id}/active`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !promotion.active }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not update promotion.');
      await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setSaving(false); }
  }

  return <section className="admin-extras"><div className="section-kicker">PRICING & OVERSIGHT</div><h2>Rates, offers & activity</h2>{message && <p className="management-message" role="status">{message}</p>}
    <details open><summary>Nightly rate calendar</summary>
      {catalog.ratePlans.length ? <form className="management-form" onSubmit={submitRate}>
        <label>ROOM CATEGORY<select name="roomTypeId" required>{catalog.roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <label>RATE PLAN<select name="ratePlanId" required>{catalog.ratePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        <label>START DATE<input name="startDate" type="date" required /></label><label>END DATE (EXCLUSIVE)<input name="endDate" type="date" required /></label>
        <label>NIGHTLY RATE<input name="amount" type="number" min="1" step="0.01" required /></label><label>MINIMUM NIGHTS<input name="minimumStay" type="number" min="1" max="30" /></label><label>MAXIMUM NIGHTS<input name="maximumStay" type="number" min="1" max="30" /></label>
        <button disabled={saving}>{saving ? 'SAVING…' : 'SET RATES FOR DATE RANGE'}</button>
      </form> : <p className="admin-note">Create an active rate plan before setting nightly rates.</p>}
      <div className="category-list">{catalog.rates.slice(0, 40).map((rate) => <article key={rate.id}><div><strong>{rate.roomType.name} · {rate.ratePlan.name}</strong><small>{new Date(rate.rateDate).toLocaleDateString()} · {new Intl.NumberFormat('en-IN', { style: 'currency', currency: rate.currency, maximumFractionDigits: 0 }).format(rate.amount)}</small></div><span>{rate.minimumStay ? `Min ${rate.minimumStay} nights` : ''}{rate.maximumStay ? ` · Max ${rate.maximumStay} nights` : ''}</span></article>)}</div>
    </details>
    <details><summary>Promotion codes</summary>
      <form className="management-form" onSubmit={submitPromotion}>
        <label>CODE<input name="code" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="WELCOME10" /></label><label>NAME<input name="name" required maxLength={100} placeholder="Welcome offer" /></label>
        <label>DISCOUNT TYPE<select name="discountType"><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed amount</option></select></label><label>DISCOUNT VALUE<input name="discountValue" type="number" min="0.01" step="0.01" required /></label>
        <label>STARTS<input name="startsAt" type="datetime-local" defaultValue={localDateTime()} required /></label><label>ENDS<input name="endsAt" type="datetime-local" defaultValue={localDateTime(24 * 30)} required /></label>
        <label>MINIMUM NIGHTS<input name="minimumNights" type="number" min="1" max="30" defaultValue="1" required /></label><label>USE LIMIT (OPTIONAL)<input name="usageLimit" type="number" min="1" /></label>
        <label>ROOM CATEGORY (OPTIONAL)<select name="roomTypeId" defaultValue=""><option value="">All room categories</option>{catalog.roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label className="wide">DESCRIPTION<input name="description" maxLength={500} /></label>
        <button disabled={saving}>{saving ? 'SAVING…' : 'CREATE PROMOTION'}</button>
      </form>
      <div className="category-list">{promotions.map((promotion) => <article key={promotion.id}><div><strong>{promotion.code} · {promotion.name}</strong><small>{promotion.discountType === 'PERCENTAGE' ? `${promotion.discountValue}% off` : new Intl.NumberFormat('en-IN', { style: 'currency', currency: catalog.ratePlans[0]?.currency ?? 'INR' }).format(promotion.discountValue)} · {promotion.usageCount}{promotion.usageLimit ? ` / ${promotion.usageLimit}` : ''} uses</small></div><button type="button" disabled={saving} onClick={() => void togglePromotion(promotion)}>{promotion.active ? 'DISABLE' : 'ENABLE'}</button></article>)}</div>
    </details>
    <details><summary>Audit history</summary><div className="category-list">{audit.length ? audit.map((entry) => <article key={entry.id}><div><strong>{entry.action.replaceAll('.', ' ')} · {entry.entityType}</strong><small>{entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : 'System'} · {new Date(entry.createdAt).toLocaleString()}</small></div><span>{entry.entityId.slice(0, 12)}</span></article>) : <p className="admin-note">No audit events recorded yet.</p>}</div></details>
  </section>;
}

type Notice = { id: string; subject: string | null; templateKey: string; payload: unknown; status: string; createdAt: string; readAt: string | null };
export function NotificationInbox({ token }: { token: string }) {
  const [open, setOpen] = useState(false); const [notices, setNotices] = useState<Notice[]>([]); const [error, setError] = useState('');
  const unread = notices.filter((notice) => !notice.readAt).length;
  const load = useCallback(async () => { const response = await fetch(`${apiBase}/notifications`, { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load notifications.'); setNotices(data as Notice[]); }, [token]);
  useEffect(() => { load().catch((cause: Error) => setError(cause.message)); }, [load]);
  async function markRead(id: string) { const response = await fetch(`${apiBase}/notifications/${id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); if (response.ok) setNotices((items) => items.map((notice) => notice.id === id ? { ...notice, readAt: new Date().toISOString() } : notice)); }
  return <div className="notification-inbox"><button className="notification-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>NOTIFICATIONS{unread > 0 && <span>{unread}</span>}</button>{open && <section className="notification-panel"><strong>Recent activity</strong>{error && <p className="admin-error">{error}</p>}{notices.length ? notices.map((notice) => <button className={`notification-item ${notice.readAt ? 'is-read' : ''}`} key={notice.id} onClick={() => !notice.readAt && void markRead(notice.id)}><span>{notice.subject ?? notice.templateKey.replaceAll('.', ' ')}</span><small>{new Date(notice.createdAt).toLocaleString()}</small></button>) : <p className="admin-note">You’re all caught up.</p>}</section>}</div>;
}
