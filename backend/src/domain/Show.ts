import { Entity } from './Entity.js';
import { ShowStatus } from './enums.js';

export interface ShowProps {
  id: number;
  movieId: number;
  screenId: number;
  startTime: Date;
  endTime: Date;
  basePrice: number;
  status: ShowStatus;
}

/** Association: a Show links one Movie to one Screen for a time slot. */
export class Show extends Entity {
  readonly movieId: number;
  readonly screenId: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly basePrice: number;
  readonly status: ShowStatus;

  constructor(props: ShowProps) {
    super(props.id);
    if (props.endTime <= props.startTime) throw new Error('Show must end after it starts');
    this.movieId = props.movieId;
    this.screenId = props.screenId;
    this.startTime = props.startTime;
    this.endTime = props.endTime;
    this.basePrice = props.basePrice;
    this.status = props.status;
  }

  /** Bookings are accepted only for scheduled shows that have not started yet. */
  isBookableAt(now: Date): boolean {
    return this.status === ShowStatus.SCHEDULED && this.startTime.getTime() > now.getTime();
  }

  minutesUntilStart(now: Date): number {
    return (this.startTime.getTime() - now.getTime()) / 60_000;
  }

  isWeekend(): boolean {
    const day = this.startTime.getDay();
    return day === 0 || day === 6;
  }
}
