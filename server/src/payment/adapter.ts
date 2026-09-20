export interface PaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
}

export type PaymentResult = { ok: true; reference: string } | { ok: false; reason: string };

/** Implemented by the mock today; Keepz QR or a bank POS terminal later. */
export interface PaymentAdapter {
  readonly kind: string;
  charge(request: PaymentRequest): Promise<PaymentResult>;
}
