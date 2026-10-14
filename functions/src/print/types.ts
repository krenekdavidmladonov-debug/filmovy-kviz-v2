import type { PrintTemplate } from '@filmovy-kviz/quiz-domain';

export type PrintArtifactType = 'team-sheets' | 'answer-key' | 'score-table';

export type PrintQuestionKind =
  | 'choice'
  | 'free'
  | 'pl'
  | 'image'
  | 'audio'
  | 'video';

export interface PrintQuestion {
  number: number;
  kind: PrintQuestionKind;
  answer: string;
  choiceLabel?: string;
}

export interface PrintRound {
  number: number;
  title: string;
  questions: PrintQuestion[];
}

export interface PrintQuiz {
  title: string;
  rounds: PrintRound[];
  printTemplate?: PrintTemplate;
}

export interface PrintEvent {
  title: string;
  quiz: PrintQuiz;
  logo?: { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' };
}

export interface PrintTeam {
  id: string;
  name: string;
}

export type PrintDisposition = 'inline' | 'attachment';
export type TeamSheetMode = 'generic' | 'single' | 'all';

export type PrintOptions =
  | {
      artifactType: 'team-sheets';
      disposition: PrintDisposition;
      mode: TeamSheetMode;
      teams: PrintTeam[];
    }
  | {
      artifactType: 'answer-key';
      disposition: PrintDisposition;
    }
  | {
      artifactType: 'score-table';
      disposition: PrintDisposition;
      teams: PrintTeam[];
    };

export type PrintRequestOptions =
  | { artifactType: 'team-sheets'; disposition: PrintDisposition; mode: 'generic' | 'all' }
  | { artifactType: 'team-sheets'; disposition: PrintDisposition; mode: 'single'; teamId: string }
  | { artifactType: 'answer-key'; disposition: PrintDisposition }
  | { artifactType: 'score-table'; disposition: PrintDisposition };

export interface RenderedPrintArtifact {
  bytes: Uint8Array;
  pageCount: number;
  filename: string;
}

export interface PrintLogMetadata {
  artifactType: PrintArtifactType;
  roundCount: number;
  questionCount: number;
  teamCount: number;
  pageCount: number;
  generationDurationMs: number;
}
