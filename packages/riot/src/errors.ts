export class LiveClientUnavailableError extends Error {
  constructor(message = "League Live Client Data API is not reachable") {
    super(message);
    this.name = "LiveClientUnavailableError";
  }
}

export class LiveClientHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly bodyPreview: string
  ) {
    super(`Live Client API returned HTTP ${statusCode}`);
    this.name = "LiveClientHttpError";
  }
}
