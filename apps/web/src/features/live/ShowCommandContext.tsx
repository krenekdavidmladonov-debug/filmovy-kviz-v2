import { createContext, useContext } from 'react';
import type { LiveControlState } from './types';
import type { ShowCue, ShowPreferences } from '@filmovy-kviz/quiz-domain';

export type ShowAudioCue = 'intro' | 'interim' | 'suspense' | 'reveal' | 'winner';
export interface RevisionedResult { revision: number; replayed?: boolean; versionId?: string; showCue?: ShowCue }
export interface ShowCommandCoordinator {
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly preferences?: ShowPreferences;
  execute<T extends RevisionedResult>(action: (session: LiveControlState, revision: number) => Promise<T>): Promise<T>;
  prepareAudio(): number;
  playAudio(cue: ShowAudioCue, result: RevisionedResult, ticket: number): Promise<void>;
  stopAudio(): void;
}
export const ShowCommandContext = createContext<ShowCommandCoordinator | null>(null);
export function useShowCommands() { return useContext(ShowCommandContext); }
