/** Flattened, query-shaped read models returned by repositories for listing/detail screens. */
import type { BookingStatus, PaymentStatus, SeatCategory, ShowStatus } from '../domain/enums.js';

export interface MovieFilter {
  q?: string;
  genre?: string;
  language?: string;
  includeInactive?: boolean;
}

export interface ShowListing {
  id: number;
  movieId: number;
  startTime: Date;
  endTime: Date;
  basePrice: number;
  status: ShowStatus;
  screenId: number;
  screenName: string;
  theatreId: number;
  theatreName: string;
  city: string;
  availableSeats: number;
  totalSeats: number;
}

export interface ShowFilter {
  from?: Date;
  to?: Date;
  city?: string;
  theatreId?: number;
}

export interface ShowDetails extends ShowListing {
  movieTitle: string;
  movieLanguage: string;
  movieCertificate: string;
  durationMinutes: number;
  theatreAddress: string;
}

export interface BookingSummary {
  id: number;
  reference: string;
  userId: number;
  userEmail: string;
  status: BookingStatus;
  totalAmount: number;
  subtotal: number;
  priceBreakdown: { label: string; amount: number }[];
  expiresAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  showId: number;
  showStartTime: Date;
  movieId: number;
  movieTitle: string;
  theatreName: string;
  city: string;
  screenName: string;
  seats: { showSeatId: number; label: string; category: SeatCategory; price: number }[];
  paymentStatus: PaymentStatus | null;
  paymentMethod: string | null;
  transactionRef: string | null;
}

export interface SeatCreate {
  rowLabel: string;
  seatNumber: number;
  category: SeatCategory;
}

export interface AdminStats {
  totals: { movies: number; theatres: number; screens: number; upcomingShows: number; users: number };
  bookingsByStatus: Record<string, number>;
  revenue: number;
  refunded: number;
  topMovies: { movieId: number; title: string; confirmedBookings: number; revenue: number }[];
}
