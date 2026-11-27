// Just what milkdrop.ts uses of Butterchurn (https://github.com/jberg/butterchurn), which ships no types.
declare module 'butterchurn' {
  export interface ButterchurnAudioLevels {
    timeByteArray: Uint8Array;
    timeByteArrayL: Uint8Array;
    timeByteArrayR: Uint8Array;
  }
  export interface ButterchurnVisualizer {
    loadPreset(preset: object, blendTime: number): void;
    setRendererSize(width: number, height: number): void;
    render(opts: { audioLevels: ButterchurnAudioLevels; elapsedTime: number }): void;
  }
  export function createVisualizer(audioContext: AudioContext | null, canvas: HTMLCanvasElement,
                                   opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number }): ButterchurnVisualizer;
  const butterchurn: { createVisualizer: typeof createVisualizer };
  export default butterchurn;
}
