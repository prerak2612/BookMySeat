/** Entity -> JSON DTO mappers. Keeps response shapes stable and independent of domain internals. */
import type { Movie } from '../../domain/Movie.js';
import type { Screen } from '../../domain/Screen.js';
import type { Theatre } from '../../domain/Theatre.js';
import type { Show } from '../../domain/Show.js';

export const movieDto = (m: Movie) => ({
  id: m.id,
  title: m.title,
  description: m.description,
  durationMinutes: m.durationMinutes,
  language: m.language,
  genre: m.genre,
  certificate: m.certificate,
  releaseDate: m.releaseDate,
  posterUrl: m.posterUrl,
  isActive: m.isActive,
});

export const screenDto = (s: Screen, withSeats = false) => ({
  id: s.id,
  theatreId: s.theatreId,
  name: s.name,
  capacity: s.capacity,
  ...(withSeats
    ? { seats: s.seats.map((seat) => ({ id: seat.id, row: seat.rowLabel, number: seat.seatNumber, label: seat.label, category: seat.category })) }
    : {}),
});

export const theatreDto = (t: Theatre, withSeats = false) => ({
  id: t.id,
  name: t.name,
  city: t.city,
  address: t.address,
  screens: t.screens.map((s) => screenDto(s, withSeats)),
});

export const showDto = (s: Show) => ({
  id: s.id,
  movieId: s.movieId,
  screenId: s.screenId,
  startTime: s.startTime,
  endTime: s.endTime,
  basePrice: s.basePrice,
  status: s.status,
});
