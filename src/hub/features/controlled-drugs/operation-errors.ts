/** Only the operation coordinator may establish this before invoking its client.
 * It must never be propagated from a client/receipt/cleanup failure after send. */
export class ControlledOperationNotSentError extends Error {
  constructor() { super("This action was not sent. Your unsubmitted entries are preserved."); this.name = "ControlledOperationNotSentError"; }
}
