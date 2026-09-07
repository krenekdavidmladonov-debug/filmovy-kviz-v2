export const registrationStatuses = ['scheduled', 'open', 'paused', 'full', 'closed'] as const;
export type RegistrationStatus = typeof registrationStatuses[number];

export const eventLifecycleStatuses = [
  'draft', 'scheduled', 'ready', 'live', 'finalizing', 'completed', 'cancelled', 'archived',
] as const;
export type EventLifecycleStatus = typeof eventLifecycleStatuses[number];

export interface EventVenueInput {
  readonly name: string;
  readonly publicLocation: string;
}

export interface EventConfigurationInput {
  readonly title: string;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly venue: EventVenueInput;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
}

export interface EventScoringConfiguration {
  readonly unitScale: 2;
  readonly rankingMode: 'dense';
  readonly started: boolean;
}

export interface QuizAssignment {
  readonly quizId: string;
  readonly quizRevision: number;
  readonly snapshotId: string;
  readonly quizTitle: string;
  readonly roundCount: number;
  readonly questionCount: number;
  readonly lockedAt: unknown;
}

export interface EventMutationResponse {
  readonly eventId: string;
  readonly revision: number;
  readonly lifecycleStatus: EventLifecycleStatus;
  readonly registrationStatus: RegistrationStatus;
  readonly snapshotId?: string;
  readonly preflight?: {
    readonly status: 'READY' | 'READY_WITH_WARNINGS';
    readonly blockerCount: 0;
    readonly warningCount: number;
  };
}

export interface PublicEventProjectionInput {
  readonly title: string;
  readonly startsAt: unknown;
  readonly timeZone: string;
  readonly venue: EventVenueInput;
  readonly registrationStatus: RegistrationStatus;
  readonly registrationPublished: boolean;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly registrationOpensAt: unknown;
  readonly registrationClosesAt: unknown;
  readonly revision: number;
  readonly updatedAt: unknown;
}
