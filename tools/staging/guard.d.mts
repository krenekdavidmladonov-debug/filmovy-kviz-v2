export const STAGING_PROJECT: string;
export const STAGING_APP: string;
export const STAGING_URL: string;
export function assertStagingProject(project: unknown): string;
export function assertStagingEnvironment(env: Record<string, string | undefined>): void;
