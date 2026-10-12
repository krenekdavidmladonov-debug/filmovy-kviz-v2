import { createContext } from 'react';
/** Only used by the authenticated event preview. Public projection keeps its session contract. */
export const SnapshotMediaContext = createContext<string | undefined>(undefined);
