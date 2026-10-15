declare module '*print-center-fixture.mjs' {
  interface PrintIdentity {
    email: string;
    password: string;
    dispose(): Promise<void>;
  }
  export function printCenterFixture(teamCount?: number, roundCount?: number): Promise<PrintIdentity & {
    eventId: string;
    snapshotId: string;
    snapshotData(): Promise<Record<string, unknown> | undefined>;
    unprepare(): Promise<void>;
  }>;
  export function printModeratorIdentity(): Promise<PrintIdentity>;
}
