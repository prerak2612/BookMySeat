import { Entity } from './Entity.js';
import { PaymentMethod, PaymentStatus } from './enums.js';

export interface PaymentProps {
  id: number;
  bookingId: number;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  gateway: string;
  transactionRef: string | null;
  failureReason: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  refundedAt: Date | null;
}

export class Payment extends Entity {
  readonly bookingId: number;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly gateway: string;
  readonly transactionRef: string | null;
  readonly failureReason: string | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: Date;
  #status: PaymentStatus;
  #refundedAt: Date | null;

  constructor(props: PaymentProps) {
    super(props.id);
    this.bookingId = props.bookingId;
    this.amount = props.amount;
    this.method = props.method;
    this.gateway = props.gateway;
    this.transactionRef = props.transactionRef;
    this.failureReason = props.failureReason;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
    this.#status = props.status;
    this.#refundedAt = props.refundedAt;
  }

  get status(): PaymentStatus {
    return this.#status;
  }
  get refundedAt(): Date | null {
    return this.#refundedAt;
  }

  markRefunded(now: Date): void {
    if (this.#status !== PaymentStatus.SUCCESS) throw new Error(`Only successful payments can be refunded (was ${this.#status})`);
    this.#status = PaymentStatus.REFUNDED;
    this.#refundedAt = now;
  }
}

export type NewPayment = Omit<PaymentProps, 'id' | 'createdAt' | 'refundedAt'>;
