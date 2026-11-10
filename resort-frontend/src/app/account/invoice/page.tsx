'use client';

import { useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Invoice = {
  invoiceNumber: string; issuedAt: string; currency: string; subtotal: number; discountAmount: number; taxAmount: number; totalAmount: number;
  confirmationNumber: string; status: string; checkIn: string; checkOut: string;
  property: { name: string; email: string | null; phone: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null; countryCode: string };
  guest: { firstName: string; lastName: string; email: string | null };
  items: { name: string; quantity: number; nights: number; unitPrice: number; total: number }[];
  payments: { amount: number; currency: string; status: string; paidAt: string | null }[];
};
type Session = { accessToken: string };
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);

export default function InvoicePage() {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const confirmationNumber = new URLSearchParams(window.location.search).get('confirmationNumber');
    const saved = sessionStorage.getItem('aranya-customer-session');
    if (!confirmationNumber || !saved) { setError('Sign in to the guest account that made this reservation, then open its invoice again.'); setLoading(false); return; }
    let session: Session;
    try { session = JSON.parse(saved) as Session; } catch { setError('Your guest session has expired. Please sign in again.'); setLoading(false); return; }
    fetch(`${apiBase}/bookings/${encodeURIComponent(confirmationNumber)}/invoice`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load this invoice.'); return data as Invoice; })
      .then(setInvoice).catch((cause: Error) => setError(cause.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="invoice-page"><p>Loading invoice…</p></main>;
  if (error || !invoice) return <main className="invoice-page"><a className="admin-back" href="/resort">← BACK TO ARANYA</a><p className="admin-error" role="alert">{error || 'Invoice unavailable.'}</p></main>;
  const address = [invoice.property.addressLine1, invoice.property.addressLine2, invoice.property.city, invoice.property.state, invoice.property.postalCode, invoice.property.countryCode].filter(Boolean).join(', ');

  return <main className="invoice-page">
    <div className="invoice-toolbar"><a className="admin-back" href="/resort">← BACK TO ARANYA</a><button className="signout-button" onClick={() => window.print()}>PRINT / SAVE AS PDF</button></div>
    <article className="invoice-sheet">
      <header className="invoice-heading"><div><div className="section-kicker">ARANYA RETREATS · GUEST INVOICE</div><h1>Stay <em>statement.</em></h1></div><div className="invoice-number"><small>INVOICE</small><strong>{invoice.invoiceNumber}</strong><small>ISSUED {new Date(invoice.issuedAt).toLocaleDateString('en-IN')}</small></div></header>
      <div className="invoice-parties"><section><small>FROM</small><strong>{invoice.property.name}</strong>{address && <span>{address}</span>}{invoice.property.email && <span>{invoice.property.email}</span>}{invoice.property.phone && <span>{invoice.property.phone}</span>}</section><section><small>BILLED TO</small><strong>{invoice.guest.firstName} {invoice.guest.lastName}</strong>{invoice.guest.email && <span>{invoice.guest.email}</span>}<span>Reservation {invoice.confirmationNumber}</span></section></div>
      <div className="invoice-stay"><div><small>CHECK IN</small><strong>{new Date(invoice.checkIn).toLocaleDateString('en-IN')}</strong></div><div><small>CHECK OUT</small><strong>{new Date(invoice.checkOut).toLocaleDateString('en-IN')}</strong></div><div><small>BOOKING STATUS</small><strong>{invoice.status.replaceAll('_', ' ')}</strong></div></div>
      <table className="invoice-table"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>RATE / NIGHT</th><th>AMOUNT</th></tr></thead><tbody>{invoice.items.map((item, index) => <tr key={`${item.name}-${index}`}><td>{item.name}<small>{item.nights} night{item.nights === 1 ? '' : 's'}</small></td><td>{item.quantity}</td><td>{money(item.unitPrice, invoice.currency)}</td><td>{money(item.total, invoice.currency)}</td></tr>)}</tbody></table>
      <div className="invoice-totals"><div><span>Subtotal</span><strong>{money(invoice.subtotal, invoice.currency)}</strong></div>{invoice.discountAmount > 0 && <div><span>Discount</span><strong>−{money(invoice.discountAmount, invoice.currency)}</strong></div>}<div><span>Tax</span><strong>{money(invoice.taxAmount, invoice.currency)}</strong></div><div className="invoice-grand-total"><span>Total</span><strong>{money(invoice.totalAmount, invoice.currency)}</strong></div></div>
      <section className="invoice-payments"><small>PAYMENT RECORD</small>{invoice.payments.length ? invoice.payments.map((payment, index) => <div key={index}><span>{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('en-IN') : 'Payment'} · {payment.status.replaceAll('_', ' ')}</span><strong>{money(payment.amount, payment.currency)}</strong></div>) : <p>No completed payment has been recorded yet.</p>}</section>
      <footer className="invoice-footer">Thank you for choosing {invoice.property.name}. Please contact the resort if you have a question about this invoice.</footer>
    </article>
  </main>;
}
