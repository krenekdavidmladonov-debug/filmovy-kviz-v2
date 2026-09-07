export type PrintArtifactType = 'team-sheets' | 'answer-key' | 'score-table';
export type TeamSheetMode = 'generic' | 'single' | 'all';

export interface PrintTeam {
  readonly name: string;
}

export type PrintOptions =
  | {
      readonly artifactType: 'team-sheets';
      readonly disposition: 'inline' | 'attachment';
      readonly mode: TeamSheetMode;
      readonly teams: readonly PrintTeam[];
    }
  | {
      readonly artifactType: 'answer-key';
      readonly disposition: 'inline' | 'attachment';
    }
  | {
      readonly artifactType: 'score-table';
      readonly disposition: 'inline' | 'attachment';
      readonly teams: readonly PrintTeam[];
    };

export interface PrintArtifactBlob {
  readonly blob: Blob;
  readonly filename: string;
}
