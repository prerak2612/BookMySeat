import type { Clock } from '../common/Clock.js';
import type { ReportingRepository } from '../repositories/interfaces.js';
import type { AdminStats } from '../repositories/readModels.js';

/** Read-only dashboard metrics for administrators. */
export class AdminService {
  constructor(
    private readonly reporting: ReportingRepository,
    private readonly clock: Clock,
  ) {}

  stats(): Promise<AdminStats> {
    return this.reporting.stats(this.clock.now());
  }
}
