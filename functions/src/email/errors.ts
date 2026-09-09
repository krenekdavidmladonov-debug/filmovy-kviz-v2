export type DeliveryErrorCode = 'rate-limited' | 'provider-unavailable' | 'network-unavailable' | 'credentials-invalid' | 'configuration-invalid' | 'outcome-unknown' | 'attempts-exhausted' | 'delivery-unavailable';

// Safe allowlisted diagnostics only; never retain a nested provider exception/body.
export class EmailDeliveryError extends Error {
  constructor(readonly code: DeliveryErrorCode, readonly retryable: boolean) {
    super(code);
    this.name = 'EmailDeliveryError';
  }
}
