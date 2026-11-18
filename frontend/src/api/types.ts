/** Response DTOs of the BookMySeat REST API (mirrors backend presenters/read models). */
export type Role = 'CUSTOMER' | 'ADMIN';
export type SeatCategory = 'REGULAR' | 'PREMIUM' | 'RECLINER';
export type SeatStatus = 'AVAILABLE' | 'LOCKED' | 'BOOKED';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
export type PaymentMethod = 'CARD' | 'UPI' | 'WALLET';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  token: string;
  user: User;
}

export interface Movie {
  id: number;
  title: string;
  description: string;
  durationMinutes: number;
  language: string;
  genre: string;
  certificate: string;
  releaseDate: string;
  posterUrl: string | null;
  isActive: boolean;
}

export interface Screen {
  id: number;
  theatreId: number;
  name: string;
  capacity: number;
}

export interface Theatre {
  id: number;
  name: string;
  city: string;
  address: string;
  screens: Screen[];
}

export interface ShowListing {
  id: number;
  movieId: number;
  startTime: string;
  endTime: string;
  basePrice: number;
  status: string;
  screenId: number;
  screenName: string;
  theatreId: number;
  theatreName: string;
  city: string;
  availableSeats: number;
  totalSeats: number;
}

export interface ShowDetails extends ShowListing {
  movieTitle: string;
  movieLanguage: string;
  movieCertificate: string;
  durationMinutes: number;
  theatreAddress: string;
}

export interface SeatView {
  seatId: number;
  showSeatId: number;
  row: string;
  number: number;
  label: string;
  category: SeatCategory;
  status: SeatStatus;
  price: number;
}

export interface SeatMap {
  show: ShowDetails;
  rows: { row: string; seats: SeatView[] }[];
  summary: Record<SeatStatus, number>;
  categoryPrices: Record<SeatCategory, number>;
  serverTime: string;
}

export interface Booking {
  id: number;
  reference: string;
  userId: number;
  userEmail: string;
  status: BookingStatus;
  totalAmount: number;
  subtotal: number;
  priceBreakdown: { label: string; amount: number }[];
  expiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  showId: number;
  showStartTime: string;
  movieId: number;
  movieTitle: string;
  theatreName: string;
  city: string;
  screenName: string;
  seats: { showSeatId: number; label: string; category: SeatCategory; price: number }[];
  paymentStatus: 'SUCCESS' | 'FAILED' | 'REFUNDED' | null;
  paymentMethod: PaymentMethod | null;
  transactionRef: string | null;
  cancellable: boolean;
  holdSecondsRemaining: number;
}

export interface NotificationItem {
  id: number;
  type: string;
  channel: string;
  subject: string;
  message: string;
  createdAt: string;
}

export interface AdminStats {
  totals: { movies: number; theatres: number; screens: number; upcomingShows: number; users: number };
  bookingsByStatus: Record<string, number>;
  revenue: number;
  refunded: number;
  topMovies: { movieId: number; title: string; confirmedBookings: number; revenue: number }[];
}
