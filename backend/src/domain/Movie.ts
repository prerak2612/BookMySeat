import { Entity } from './Entity.js';

export interface MovieProps {
  id: number;
  title: string;
  description: string;
  durationMinutes: number;
  language: string;
  genre: string;
  certificate: string;
  releaseDate: string; // ISO date (YYYY-MM-DD)
  posterUrl: string | null;
  isActive: boolean;
}

export class Movie extends Entity {
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly language: string;
  readonly genre: string;
  readonly certificate: string;
  readonly releaseDate: string;
  readonly posterUrl: string | null;
  readonly isActive: boolean;

  constructor(props: MovieProps) {
    super(props.id);
    if (props.durationMinutes <= 0) throw new Error('Movie duration must be positive');
    this.title = props.title;
    this.description = props.description;
    this.durationMinutes = props.durationMinutes;
    this.language = props.language;
    this.genre = props.genre;
    this.certificate = props.certificate;
    this.releaseDate = props.releaseDate;
    this.posterUrl = props.posterUrl;
    this.isActive = props.isActive;
  }

  /** A show for this movie occupies the screen for the runtime plus a cleaning buffer. */
  occupiedMinutes(cleaningBufferMinutes = 15): number {
    return this.durationMinutes + cleaningBufferMinutes;
  }
}
