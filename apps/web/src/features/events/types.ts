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
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly registrationPublished: boolean;
  readonly registrationOpensAt?: Date;
  readonly registrationClosesAt?: Date;
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
  readonly registrationPublished: boolean;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly registrationOpensAt?: Date;
  readonly registrationClosesAt?: Date;
  readonly revision: number;
}

export interface RegistrationRecord {
  readonly id: string;
  readonly eventId: string;
  readonly teamName: string;
  readonly memberCount: number;
  readonly contactEmail: string | null;
  readonly source?: 'manual' | 'online';
  readonly revision?: number;
  readonly status: 'accepted' | 'cancelled';
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly cancelledAt?: Date;
}

export interface RegistrationMutationResponse {
  readonly eventId: string;
  readonly registrationId: string;
  readonly teamName: string;
  readonly memberCount: number;
  readonly contactEmail: string;
  readonly status: 'accepted' | 'cancelled';
  readonly managementToken?: string;
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
