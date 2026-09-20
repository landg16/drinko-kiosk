import { sleep } from '../util/sleep';
import type { PaymentAdapter, PaymentRequest, PaymentResult } from './adapter';

export interface MockPaymentOptions {
  /** roughly how long the client's card-tap animation runs */
  delayMs?: number;
  outcome?: 'success' | 'decline';
}

export class MockPaymentAdapter implements PaymentAdapter {
  readonly kind = 'mock';

  constructor(private readonly options: MockPaymentOptions = {}) {}

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    await sleep(this.options.delayMs ?? 2500);
    if (this.options.outcome === 'decline') return { ok: false, reason: 'declined (mock)' };
    return { ok: true, reference: `mock-${request.orderId.slice(0, 8)}-${Date.now()}` };
  }
}
