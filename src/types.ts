export interface VideoFile {
  id: string;
  file: File;
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
  thumbnail?: string;
}

export interface VideoGroup {
  id: string;
  name: string;
  videoIds: string[];
}

export type OutputFormat = 'mp4' | 'mkv' | 'avi' | 'webm';
export type Resolution = 'original' | '1080p' | '720p' | '480p';
export type Quality = 'high' | 'medium' | 'low';
export type TransitionType = 'none' | 'fade' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideright' | 'circlecrop';

export interface ProcessingOptions {
  format: OutputFormat;
  resolution: Resolution;
  quality: Quality;
  transition: TransitionType;
  transitionDuration: number;
}
