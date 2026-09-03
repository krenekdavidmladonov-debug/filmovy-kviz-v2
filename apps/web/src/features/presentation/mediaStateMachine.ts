export type MediaLifecycle =
  | 'IDLE'
  | 'PREPARING'
  | 'READY'
  | 'PLAYING'
  | 'STOPPING'
  | 'FINISHED'
  | 'ERROR';

export interface MediaMachineState {
  readonly lifecycle: MediaLifecycle;
  readonly generation: number;
  readonly error?: string;
}

export type MediaMachineEvent =
  | { readonly type: 'prepare'; readonly generation: number }
  | { readonly type: 'ready'; readonly generation: number }
  | { readonly type: 'play'; readonly generation: number }
  | { readonly type: 'playing'; readonly generation: number }
  | { readonly type: 'stop'; readonly generation: number }
  | { readonly type: 'finished'; readonly generation: number }
  | { readonly type: 'error'; readonly generation: number; readonly message: string }
  | { readonly type: 'reset'; readonly generation: number };

export const initialMediaMachineState: MediaMachineState = { lifecycle: 'IDLE', generation: 0 };

export function reduceMediaMachine(state: MediaMachineState, event: MediaMachineEvent): MediaMachineState {
  if (event.generation < state.generation) return state;
  if (event.type === 'reset') return { lifecycle: 'IDLE', generation: event.generation };
  if (event.type === 'prepare') return { lifecycle: 'PREPARING', generation: event.generation };
  if (event.type === 'ready') return { lifecycle: 'READY', generation: event.generation };
  if (event.type === 'play') return { lifecycle: 'PREPARING', generation: event.generation };
  if (event.type === 'playing') return { lifecycle: 'PLAYING', generation: event.generation };
  if (event.type === 'stop') return { lifecycle: 'STOPPING', generation: event.generation };
  if (event.type === 'finished') return { lifecycle: 'FINISHED', generation: event.generation };
  return { lifecycle: 'ERROR', generation: event.generation, error: event.message };
}
