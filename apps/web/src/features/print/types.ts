export type PrintArtifactType = 'team-sheets' | 'answer-key' | 'score-table';
export type TeamSheetMode = 'generic' | 'single' | 'all';

export interface PrintTeam {
  readonly id: string;
  readonly name: string;
}

export type PrintOptions =
  | {
      readonly artifactType: 'team-sheets';
      readonly disposition: 'inline' | 'attachment';
      readonly mode: TeamSheetMode;
      readonly teamId?: string;
    }
  | {
      readonly artifactType: 'answer-key';
      readonly disposition: 'inline' | 'attachment';
    }
  | {
      readonly artifactType: 'score-table';
      readonly disposition: 'inline' | 'attachment';
    };

export interface PrintArtifactBlob {
  readonly blob: Blob;
  readonly filename: string;
}
