export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface V1LibraryDocument {
  readonly id: string;
  readonly data: JsonObject;
}

export interface V1LibrarySnapshot {
  readonly schemaVersion: 1;
  readonly collection: 'library';
  readonly documents: readonly V1LibraryDocument[];
}

export type SlideClassification = 'round' | 'question' | 'legacy';
export type MediaKind = 'image' | 'audio' | 'video' | 'unknown';

export interface NormalizedMedia {
  readonly sourceField: string;
  readonly role: 'prompt' | 'answer' | 'background' | 'unknown';
  readonly kind: MediaKind;
  readonly value: JsonValue;
  readonly url?: string;
  readonly domain?: string;
  readonly validUrl?: boolean;
}

export interface NormalizedSlide {
  readonly position: number;
  readonly classification: SlideClassification;
  readonly sourceType: string;
  readonly title: string;
  readonly text: string;
  readonly options: readonly JsonValue[];
  readonly correctAnswer?: JsonValue;
  readonly note?: string;
  readonly media: readonly NormalizedMedia[];
  readonly videoStart?: number;
  readonly videoEnd?: number;
  readonly audioTrigger?: JsonValue;
  readonly raw: JsonObject;
  readonly unknownFields: readonly string[];
}

export interface NormalizedQuiz {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly slides: readonly NormalizedSlide[];
  readonly legacyMetadata: JsonObject;
  readonly unknownFields: readonly string[];
}

export interface MigrationStats {
  readonly quizzes: number;
  readonly slides: number;
  readonly rounds: number;
  readonly questions: number;
  readonly correctAnswers: number;
  readonly images: number;
  readonly audio: number;
  readonly video: number;
}

export interface V2QuestionDocument {
  readonly id: string;
  readonly quizId: string;
  readonly roundId: string;
  readonly data: JsonObject;
}

export interface V2RoundDocument {
  readonly id: string;
  readonly quizId: string;
  readonly data: JsonObject;
  readonly questions: readonly V2QuestionDocument[];
}

export interface V2QuizDocument {
  readonly id: string;
  readonly data: JsonObject;
  readonly rounds: readonly V2RoundDocument[];
}

export interface QuizMigrationReport {
  readonly quizId: string;
  readonly status: 'PASS' | 'FAILED';
  readonly before: MigrationStats;
  readonly after: MigrationStats;
  readonly unknownSlideTypes: readonly string[];
  readonly unknownFields: readonly string[];
  readonly mediaDomains: readonly string[];
  readonly invalidMediaUrls: number;
  readonly errors: readonly string[];
}

export interface MigrationReport {
  readonly status: 'PASS' | 'FAILED';
  readonly mode: 'inspect' | 'validate' | 'dry-run' | 'emulator';
  readonly source: string;
  readonly totalsBefore: MigrationStats;
  readonly totalsAfter: MigrationStats;
  readonly quizzes: readonly QuizMigrationReport[];
  readonly wroteToEmulator: boolean;
}
