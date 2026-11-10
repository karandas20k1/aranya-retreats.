'use client';

import { FormEvent, useState } from 'react';
import { ArrowRight } from 'lucide-react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type AuthResponse = { accessToken: string; refreshToken: string; user: { firstName: string; lastName: string; email: string; roles: string[] } };

function destination(roles: string[]) {
  if (roles.includes('SUPER_ADMIN')) return '/admin';
  if (roles.some((role) => ['MANAGER', 'RECEPTIONIST', 'HOUSEKEEPER', 'MAINTENANCE'].includes(role))) return '/staff';
  if (roles.includes('CUSTOMER')) return '/resort';
  return null;
}

export default function Home() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const body = mode === 'login'
      ? { email: form.get('email'), password: form.get('password') }
      : { firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), password: form.get('password') };
    try {
      const response = await fetch(`${apiBase}/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? (mode === 'login' ? 'Sign in failed.' : 'Could not create your account.'));
      const next = data as AuthResponse;
      const route = destination(next.user.roles);
      if (!route) throw new Error('This account does not have access to the resort website. Contact the resort administrator.');
      if (next.user.roles.includes('CUSTOMER')) {
        sessionStorage.setItem('aranya-customer-session', JSON.stringify(next));
        sessionStorage.removeItem('aranya-staff-session');
      } else {
        sessionStorage.setItem('aranya-staff-session', JSON.stringify(next));
        sessionStorage.removeItem('aranya-customer-session');
      }
      window.location.assign(route);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the server.'); }
    finally { setBusy(false); }
  }

  return <main className="auth-gateway">
    <section className="auth-gateway-card">
      <a className="wordmark gateway-wordmark" href="/resort">ARANYA<span>WILD, AT YOUR OWN PACE</span></a>
      <div className="section-kicker">ARANYA RETREATS · GUEST & STAFF ACCESS</div>
      <h1>{mode === 'login' ? <>Welcome <em>back.</em></> : <>Your next <em>escape.</em></>}</h1>
      <p>{mode === 'login' ? 'Sign in with your assigned email and password. We’ll take you to the right place.' : 'Create a guest account to manage your reservations and stays.'}</p>
      <form className="gateway-form" onSubmit={submit}>
        {mode === 'register' && <div className="gateway-name-fields"><label>FIRST NAME<input name="firstName" autoComplete="given-name" maxLength={80} required /></label><label>LAST NAME<input name="lastName" autoComplete="family-name" maxLength={80} required /></label></div>}
        <label>EMAIL<input name="email" type="email" autoComplete="email" required /></label>
        <label>PASSWORD<input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />{mode === 'register' && <small>At least 8 characters.</small>}</label>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <button disabled={busy}>{busy ? 'PLEASE WAIT…' : mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'} <ArrowRight size={15} /></button>
      </form>
      <button className="gateway-switch" type="button" onClick={() => { setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'NEW GUEST? CREATE AN ACCOUNT' : 'ALREADY HAVE AN ACCOUNT? SIGN IN'}</button>
      <p className="gateway-staff-note">Staff accounts are created by the resort administrator.</p>
      <a className="gateway-explore" href="/resort">EXPLORE ARANYA RETREATS</a>
    </section>
  </main>;
}
