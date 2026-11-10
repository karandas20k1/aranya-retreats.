'use client';

import { FormEvent, useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Props = { token: string; roles: string[] };
type Category = { id: string; name: string; description: string; basePrice: string; maxOccupancy: number; active: boolean; rooms: { id: string; roomNumber: string; operationalStatus: string; housekeepingStatus: string }[] };
type Staff = { id: string; email: string | null; firstName: string; lastName: string; status: string; userRoles: { role: { key: string; displayName: string } }[] };

export function AdminManagement({ token, roles }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const canManageRooms = roles.some((role) => ['SUPER_ADMIN', 'MANAGER'].includes(role));
  const canManageStaff = roles.includes('SUPER_ADMIN');
  const headers = { Authorization: `Bearer ${token}` };

  async function loadCategories() {
    const response = await fetch(`${apiBase}/admin/room-types`, { headers });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load room types.');
    setCategories(data as Category[]);
  }
  async function loadStaff() {
    const response = await fetch(`${apiBase}/admin/staff`, { headers });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load staff.');
    setStaff(data as Staff[]);
  }
  useEffect(() => {
    if (canManageRooms) void loadCategories().catch((cause: Error) => setMessage(cause.message));
    if (canManageStaff) void loadStaff().catch((cause: Error) => setMessage(cause.message));
  }, [token, canManageRooms, canManageStaff]);

  async function submitRoomType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const roomNumbers = String(form.get('roomNumbers')).split(/[\s,;]+/).filter(Boolean);
    try {
      const response = await fetch(`${apiBase}/admin/room-types`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), description: form.get('description'), bedConfiguration: form.get('bedConfiguration'), maxAdults: Number(form.get('maxAdults')), maxChildren: Number(form.get('maxChildren')), maxOccupancy: Number(form.get('maxOccupancy')), basePrice: Number(form.get('basePrice')), roomNumbers }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not create room type.');
      event.currentTarget.reset(); setMessage(`Created ${data.name} with ${data.roomsCreated} room(s).`); await loadCategories();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setSaving(false); }
  }

  async function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiBase}/admin/staff`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password'), firstName: form.get('firstName'), lastName: form.get('lastName'), role: form.get('role') }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not create staff account.');
      event.currentTarget.reset(); setMessage(`Created staff account for ${data.email}.`); await loadStaff();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setSaving(false); }
  }

  if (!canManageRooms && !canManageStaff) return null;
  return <section className="admin-management"><div className="section-kicker">PROPERTY SETUP</div><h2>Manage your resort</h2>{message && <p className="management-message" role="status">{message}</p>}
    {canManageRooms && <details open><summary>Room categories, rooms & rates</summary><form className="management-form" onSubmit={submitRoomType}><label>CATEGORY NAME<input name="name" required maxLength={100} placeholder="Garden Cottage" /></label><label>BED CONFIGURATION<input name="bedConfiguration" required placeholder="1 king bed" /></label><label>MAX ADULTS<input name="maxAdults" type="number" min="1" max="20" defaultValue="2" required /></label><label>MAX CHILDREN<input name="maxChildren" type="number" min="0" max="19" defaultValue="0" required /></label><label>TOTAL OCCUPANCY<input name="maxOccupancy" type="number" min="1" max="20" defaultValue="2" required /></label><label>BASE RATE / NIGHT (INR)<input name="basePrice" type="number" min="1" step="0.01" required placeholder="6500" /></label><label className="wide">DESCRIPTION<textarea name="description" required rows={2} /></label><label className="wide">ROOM NUMBERS <small>Separate room numbers with commas, spaces, or new lines.</small><textarea name="roomNumbers" required rows={2} placeholder="101, 102, 103" /></label><button disabled={saving}>{saving ? 'SAVING…' : 'CREATE CATEGORY'}</button></form><div className="category-list">{categories.map((category) => <article key={category.id}><div><strong>{category.name}</strong><small>{category.maxOccupancy} guests · {category.rooms.length} rooms · ₹{Number(category.basePrice).toLocaleString('en-IN')} / night</small></div><span>{category.rooms.map((room) => `${room.roomNumber} (${room.operationalStatus.toLowerCase()})`).join(' · ')}</span></article>)}</div></details>}
    {canManageStaff && <details><summary>Staff accounts</summary><form className="management-form" onSubmit={submitStaff}><label>FIRST NAME<input name="firstName" required /></label><label>LAST NAME<input name="lastName" required /></label><label>EMAIL<input name="email" type="email" required /></label><label>TEMPORARY PASSWORD<input name="password" type="password" minLength={8} required /><small>At least 8 characters. Share it securely with the staff member.</small></label><label>ROLE<select name="role" defaultValue="RECEPTIONIST"><option value="MANAGER">Manager</option><option value="RECEPTIONIST">Receptionist</option><option value="HOUSEKEEPER">Housekeeper</option><option value="MAINTENANCE">Maintenance</option></select></label><button disabled={saving}>{saving ? 'SAVING…' : 'CREATE STAFF ACCOUNT'}</button></form><div className="category-list">{staff.map((member) => <article key={member.id}><div><strong>{member.firstName} {member.lastName}</strong><small>{member.email} · {member.status}</small></div><span>{member.userRoles.map(({ role }) => role.displayName).join(', ')}</span></article>)}</div></details>}
  </section>;
}
