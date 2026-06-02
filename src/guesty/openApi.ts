import { guestyFetch } from './client';
import { shapeReservation, ReservationResult } from '../shapers/reservation';

// TODO: Verify the exact Open API reservations endpoint path.
// This may be /reservations, /reservations/v3, or /reservations-v3.
// Check your Guesty Open API docs for the active version.
const RESERVATIONS_PATH = '/reservations';

export async function lookupReservation(params: {
  confirmationCode?: string;
  phone?: string;
  email?: string;
}): Promise<ReservationResult> {
  const query = new URLSearchParams();
  if (params.confirmationCode) query.set('confirmationCode', params.confirmationCode);
  if (params.phone) query.set('phone', params.phone);
  if (params.email) query.set('guestEmail', params.email);

  const raw = await guestyFetch('open_api', 'GET', `${RESERVATIONS_PATH}?${query.toString()}`);
  return shapeReservation(raw);
}
