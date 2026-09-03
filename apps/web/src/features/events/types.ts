export type RegistrationStatus = 'scheduled' | 'open' | 'paused' | 'full' | 'closed';
export type EventLifecycleStatus = 'draft' | 'scheduled' | 'ready' | 'live' | 'finalizing' | 'completed' | 'cancelled' | 'archived';

export interface EventVenue {
  readonly name: string;
  readonly publicLocation: string;
}

export interface EventQuizAssignment {
  readonly quizId: string;
  readonly quizRevision: number;
  readonly snapshotId: string;
  readonly quizTitle: string;
  readonly roundCount: number;
  readonly questionCount: number;
  readonly lockedAt: Date;
}

export interface EventRecord {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly venue: EventVenue;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly registrationStatus: RegistrationStatus;
  readonly lifecycleStatus: EventLifecycleStatus;
  readonly scoring: { readonly unitScale: 2; readonly rankingMode: 'dense'; readonly started: boolean };
  readonly revision: number;
  readonly quizAssignment?: EventQuizAssignment;
}

export interface PublicEventRecord {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly venueName: string;
  readonly publicLocation: string;
  readonly registrationStatus: RegistrationStatus;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly revision: number;
}

export interface EventFormValues {
  readonly title: string;
  readonly startsAt: string;
  readonly timeZone: string;
  readonly venueName: string;
  readonly publicLocation: string;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
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
