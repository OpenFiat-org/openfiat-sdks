/** Error type thrown by the OpenFiat SDK. */
export class OpenFiatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenFiatError";
  }
}
