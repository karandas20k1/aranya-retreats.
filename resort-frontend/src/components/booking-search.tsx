'use client';

import { FormEvent, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';

type AvailableRoom = {
  id: string;
  name: string;
  description: string;
  bedConfiguration: string;
  maxOccupancy: number;
  basePrice: number;
  currency: string;
  availableRooms: number;
  estimatedTotal: number;
  imageUrl: string | null;
};

type AvailabilityResponse = { nights: number; rooms: AvailableRoom[] };
type BookingConfirmation = { confirmationNumber: string; status: string; totalAmount: number; discountAmount?: number; currency: string; paymentStatus: string };
type CheckoutResponse = { keyId: string; orderId: string; amount: number; currency: string; confirmationNumber: string };
type RazorpayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
declare global { interface Window { Razorpay?: new (options: { key: string; order_id: string; amount: number; currency: string; name: string; description: string; handler: (result: RazorpayResult) => void; modal: { ondismiss: () => void } }) => { open: () => void } } }
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function BookingSearch() {
  const [checkIn, setCheckIn] = useState('2026-12-12');
  const [checkOut, setCheckOut] = useState('2026-12-15');
  const [guests, setGuests] = useState('2');
  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null);
  const [nights, setNights] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [holding, setHolding] = useState('');
  const [holdMessage, setHoldMessage] = useState('');
  const [holdReference, setHoldReference] = useState('');
  const [guestSaved, setGuestSaved] = useState(false);
  const [guestSaving, setGuestSaving] = useState(false);
  const [promotionCode, setPromotionCode] = useState('');
  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [bookingCreating, setBookingCreating] = useState(false);
  const [paymentStarting, setPaymentStarting] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setRooms(null);
    try {
      const query = new URLSearchParams({ checkIn, checkOut, guests });
      const response = await fetch(`${apiUrl}/availability?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not check availability.');
      const result = data as AvailabilityResponse;
      setNights(result.nights);
      setRooms(result.rooms);
      document.getElementById('stay')?.scrollIntoView({ behavior: 'smooth' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the booking service.');
    } finally {
      setLoading(false);
    }
  }

  async function holdRoom(roomTypeId: string) {
    setHolding(roomTypeId);
    setHoldMessage('');
    try {
      const response = await fetch(`${apiUrl}/booking-holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomTypeId, checkIn, checkOut, guests: Number(guests) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not hold this room.');
      setHoldReference(data.reference);
      setPromotionCode('');
      setGuestSaved(false);
      setBooking(null);
      setHoldMessage(`Room held until ${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(data.expiresAt))} · Reference ${data.reference}.`);
      const result = await fetch(`${apiUrl}/availability?${new URLSearchParams({ checkIn, checkOut, guests })}`).then((res) => res.json()) as AvailabilityResponse;
      setRooms(result.rooms);
    } catch (cause) {
      setHoldMessage(cause instanceof Error ? cause.message : 'Could not reach the booking service.');
    } finally {
      setHolding('');
    }
  }

  async function confirmBooking() {
    if (!holdReference) return;
    setBookingCreating(true);
    setHoldMessage('');
    try {
      const response = await fetch(`${apiUrl}/booking-holds/${holdReference}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promotionCode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not create the booking.');
      setBooking(data as BookingConfirmation);
      setHoldMessage('Your reservation is recorded. Payment is still pending.');
    } catch (cause) {
      setHoldMessage(cause instanceof Error ? cause.message : 'Could not reach the booking service.');
    } finally {
      setBookingCreating(false);
    }
  }

  async function payForBooking() {
    if (!booking) return;
    setPaymentStarting(true); setHoldMessage('');
    try {
      const orderResponse = await fetch(`${apiUrl}/payments/${booking.confirmationNumber}/order`, { method: 'POST' });
      const order = await orderResponse.json() as CheckoutResponse & { message?: string };
      if (!orderResponse.ok) throw new Error(order.message ?? 'Could not start checkout.');
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Could not load Razorpay Checkout.')); document.body.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not load.');
      const checkout = new window.Razorpay({ key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency, name: 'Aranya Retreats', description: `Reservation ${order.confirmationNumber}`, modal: { ondismiss: () => setPaymentStarting(false) }, handler: async (result) => {
        try {
          const response = await fetch(`${apiUrl}/payments/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
          const verified = await response.json(); if (!response.ok) throw new Error(verified.message ?? 'Payment verification failed.');
          setBooking((current) => current ? { ...current, status: 'CONFIRMED', paymentStatus: 'SUCCESS' } : current);
          setHoldMessage(`Payment verified. Your booking ${verified.confirmationNumber} is confirmed.`);
        } catch (cause) { setHoldMessage(cause instanceof Error ? cause.message : 'Payment verification failed.'); }
        finally { setPaymentStarting(false); }
      } });
      checkout.open();
    } catch (cause) { setHoldMessage(cause instanceof Error ? cause.message : 'Could not reach the payment service.'); setPaymentStarting(false); }
  }

  async function saveGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!holdReference) return;
    setGuestSaving(true);
    setHoldMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiUrl}/booking-holds/${holdReference}/guest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), phone: form.get('phone') }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not save guest details.');
      setGuestSaved(true);
      setHoldMessage(`Guest details saved for ${data.guest.firstName} ${data.guest.lastName}. Your room hold is still active; payment setup is the next step.`);
    } catch (cause) {
      setHoldMessage(cause instanceof Error ? cause.message : 'Could not reach the booking service.');
    } finally {
      setGuestSaving(false);
    }
  }

  return <>
    <form className="booking-bar" onSubmit={search}>
      <label>CHECK IN<input type="date" aria-label="Check in" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} required /></label>
      <label>CHECK OUT<input type="date" aria-label="Check out" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} required /></label>
      <label>GUESTS<select aria-label="Guests" value={guests} onChange={(event) => setGuests(event.target.value)}>{[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} {count === 1 ? 'guest' : 'guests'}</option>)}</select></label>
      <button type="submit" disabled={loading}>{loading ? 'CHECKING' : 'EXPLORE STAYS'}{loading ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={16} />}</button>
    </form>
    {error && <p className="booking-message error" role="alert">{error}</p>}
    {rooms && <div className="availability-results" aria-live="polite">
      {holdMessage && <p className="hold-message" role="status">{holdMessage}</p>}
      {holdReference && !guestSaved && <form className="guest-details-form" onSubmit={saveGuest}>
        <h3>Who&apos;s joining us?</h3><p>Share the lead guest&apos;s contact details to continue your reservation.</p>
        <label>FIRST NAME<input name="firstName" autoComplete="given-name" maxLength={80} required /></label>
        <label>LAST NAME<input name="lastName" autoComplete="family-name" maxLength={80} required /></label>
        <label>EMAIL<input name="email" type="email" autoComplete="email" required /></label>
        <label>PHONE<input name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={20} required /></label>
        <button type="submit" disabled={guestSaving}>{guestSaving ? 'SAVING…' : 'SAVE GUEST DETAILS'}</button>
      </form>}
      {guestSaved && !booking && <div className="booking-confirm-step"><span>GUEST DETAILS SAVED</span><label className="promotion-code-field">PROMO CODE (OPTIONAL)<input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} maxLength={32} placeholder="e.g. WELCOME10" /></label><button type="button" disabled={bookingCreating} onClick={() => void confirmBooking()}>{bookingCreating ? 'CREATING RESERVATION…' : 'CONTINUE TO PAYMENT'}</button></div>}
      {booking && <div className="booking-confirmation"><span>{booking.status === 'CONFIRMED' ? 'RESERVATION CONFIRMED' : `RESERVATION CREATED · PAYMENT ${booking.paymentStatus}`}</span><h3>Your reference is {booking.confirmationNumber}</h3>{booking.discountAmount ? <p>Discount applied: {new Intl.NumberFormat('en-IN', { style: 'currency', currency: booking.currency, maximumFractionDigits: 0 }).format(booking.discountAmount)}</p> : null}<p>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: booking.currency, maximumFractionDigits: 0 }).format(booking.totalAmount)} {booking.status === 'CONFIRMED' ? 'paid successfully.' : 'due to confirm your stay.'}</p>{booking.status !== 'CONFIRMED' && <button className="pay-button" type="button" disabled={paymentStarting} onClick={() => void payForBooking()}>{paymentStarting ? 'OPENING CHECKOUT…' : 'PAY SECURELY WITH RAZORPAY'}</button>}</div>}
      <p className="results-caption">{rooms.length ? `${rooms.length} room types available · ${nights} ${nights === 1 ? 'night' : 'nights'}` : 'No rooms are available for those dates.'}</p>
      {rooms.map((room) => <article className="availability-card" key={room.id}>
        {room.imageUrl && <div className="availability-thumb" style={{ backgroundImage: `url('${room.imageUrl}')` }} />}
        <div className="availability-info"><h3>{room.name}</h3><p>{room.bedConfiguration} · up to {room.maxOccupancy} guests · {room.availableRooms} left</p></div>
        <div className="availability-rate"><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: room.currency, maximumFractionDigits: 0 }).format(room.basePrice)}</strong><small>PER NIGHT</small></div>
        <div className="availability-rate total"><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: room.currency, maximumFractionDigits: 0 }).format(room.estimatedTotal)}</strong><small>ESTIMATED TOTAL</small></div>
        <button className="hold-button" type="button" disabled={Boolean(holding)} onClick={() => void holdRoom(room.id)}>{holding === room.id ? 'HOLDING…' : 'HOLD ROOM'}</button>
      </article>)}
      <p className="price-note">Estimated room-only prices use the resort’s nightly rates. Any eligible promo code is applied before payment.</p>
    </div>}
  </>;
}
