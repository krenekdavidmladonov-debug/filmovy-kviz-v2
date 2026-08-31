export class MigrationInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MigrationInputError';
  }
}

export class MigrationValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MigrationValidationError';
  }
}

export class MigrationSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MigrationSafetyError';
  }
}
