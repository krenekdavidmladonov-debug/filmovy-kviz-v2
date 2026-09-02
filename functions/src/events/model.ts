import type {
  EventConfigurationInput,
  EventLifecycleStatus,
  EventScoringConfiguration,
  PublicEventProjectionInput,
  RegistrationStatus,
} from './types.js';

export const defaultScoringConfiguration: EventScoringConfiguration = {
  unitScale: 2,
  rankingMode: 'dense',
  started: false,
};

export function validateEventCapacity(configuration: Pick<
  EventConfigurationInput,
  'teamCapacity' | 'peopleCapacity' | 'teamSizeMin' | 'teamSizeMax'
>): readonly string[] {
  const issues: string[] = [];
  if (!Number.isInteger(configuration.teamCapacity) || configuration.teamCapacity <= 0) {
    issues.push('teamCapacity must be a positive integer.');
  }
  if (!Number.isInteger(configuration.peopleCapacity) || configuration.peopleCapacity <= 0) {
    issues.push('peopleCapacity must be a positive integer.');
  }
  if (!Number.isInteger(configuration.teamSizeMin) || configuration.teamSizeMin <= 0) {
    issues.push('teamSizeMin must be a positive integer.');
  }
  if (!Number.isInteger(configuration.teamSizeMax)
    || configuration.teamSizeMax < configuration.teamSizeMin) {
    issues.push('teamSizeMax must be an integer greater than or equal to teamSizeMin.');
  }
  if (Number.isInteger(configuration.peopleCapacity)
    && Number.isInteger(configuration.teamSizeMax)
    && configuration.teamSizeMax > configuration.peopleCapacity) {
    issues.push('teamSizeMax cannot exceed peopleCapacity.');
  }
  return issues;
}

export function validateEventConfiguration(configuration: EventConfigurationInput): readonly string[] {
  const issues = [...validateEventCapacity(configuration)];
  if (configuration.title.trim() === '') issues.push('title is required.');
  if (configuration.venue.name.trim() === '') issues.push('venue.name is required.');
  if (configuration.venue.publicLocation.trim() === '') issues.push('venue.publicLocation is required.');
  if (Number.isNaN(configuration.startsAt.getTime())) issues.push('startsAt is invalid.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: configuration.timeZone }).format(configuration.startsAt);
  } catch {
    issues.push('timeZone is invalid.');
  }
  return issues;
}

export function buildPublicEventProjection(input: PublicEventProjectionInput): Record<string, unknown> {
  return {
    title: input.title,
    startsAt: input.startsAt,
    timeZone: input.timeZone,
    venueName: input.venue.name,
    publicLocation: input.venue.publicLocation,
    registrationStatus: input.registrationStatus,
    teamSize: { min: input.teamSizeMin, max: input.teamSizeMax },
    availability: input.registrationStatus,
    revision: input.revision,
    updatedAt: input.updatedAt,
  };
}

export function canMutateEvent(lifecycleStatus: EventLifecycleStatus): boolean {
  return lifecycleStatus === 'draft' || lifecycleStatus === 'scheduled' || lifecycleStatus === 'ready';
}

export function canCancelEvent(lifecycleStatus: EventLifecycleStatus): boolean {
  return lifecycleStatus !== 'completed' && lifecycleStatus !== 'cancelled' && lifecycleStatus !== 'archived';
}

export function canArchiveEvent(lifecycleStatus: EventLifecycleStatus): boolean {
  return lifecycleStatus === 'cancelled' || lifecycleStatus === 'completed';
}

export function canLockQuiz(lifecycleStatus: EventLifecycleStatus, scoringStarted: boolean): boolean {
  return !scoringStarted && (lifecycleStatus === 'draft' || lifecycleStatus === 'scheduled' || lifecycleStatus === 'ready');
}

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return value === 'scheduled' || value === 'open' || value === 'paused'
    || value === 'full' || value === 'closed';
}

export function isEventLifecycleStatus(value: unknown): value is EventLifecycleStatus {
  return value === 'draft' || value === 'scheduled' || value === 'ready'
    || value === 'live' || value === 'finalizing' || value === 'completed'
    || value === 'cancelled' || value === 'archived';
}
