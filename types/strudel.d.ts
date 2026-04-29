declare module "@strudel/web" {
  export const Pattern: {
    prototype: Record<string, unknown>;
  };
  export function initStrudel(config?: unknown): Promise<unknown>;
  export function initAudio(config?: unknown): Promise<unknown>;
  export function getAudioContext(): AudioContext;
  export function evaluate(code: string): Promise<unknown>;
  export function hush(): void;
  export function registerWidgetType(type: string): void;
  export function samples(sampleMap: string, baseUrl?: string, options?: unknown): Promise<unknown>;
}

declare module "@strudel/draw";
