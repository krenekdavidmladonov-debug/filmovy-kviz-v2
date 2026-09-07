export type RegistrationStatus = 'accepted' | 'cancelled';

export interface RegistrationTeam {
  readonly name: string;
  readonly normalizedName: string;
  readonly memberCount: number;
}

export interface RegistrationContact {
  readonly email: string;
}

export interface RegistrationCapacity {
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly maximumTeams: number;
  readonly maximumPeople: number;
}

export interface Registration {
  readonly id: string;
  readonly eventId: string;
  readonly team: RegistrationTeam;
  readonly contact: RegistrationContact;
  readonly status: RegistrationStatus;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly cancelledAt: unknown;
  readonly cancelledBy: string | null;
}

export interface RegistrationInput {
  readonly teamName: string;
  readonly normalizedTeamName: string;
  readonly memberCount: number;
  readonly contactEmail: string;
}
