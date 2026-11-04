export type Level = "low" | "moderate" | "high";

export interface PredRow {
  date: string;
  asset: string;
  p: number;
  thr: number;
  high?: number;
}
export interface DriverRow {
  date: string;
  asset: string;
  feature: string;
  category: string;
  contribution: number;
  value?: number;
  label?: string;
}
export interface OutcomeRow {
  date: string;
  asset: string;
  y: number | null;
  bet?: number;
}
export interface SensRow {
  feature: string;
  shift: number;
  p: number;
}

export interface DataFiles {
  predictions?: PredRow[];
  drivers?: DriverRow[];
  outcomes?: OutcomeRow[];
  sensitivity?: SensRow[];
  names?: Partial<Record<FileKind, string>>;
  updatedAt?: string;
}
export type FileKind = "predictions" | "drivers" | "outcomes" | "sensitivity";

export interface Day {
  date: string;
  p: number;
  level: Level;
  y: number | null;
  bet?: number;
}

export interface Alert {
  id: string;
  start: string;
  end: string;
  startIdx: number;
  endIdx: number;
  firstAboveIdx: number;
  duration: number;
  peak: number;
  peakDate: string;
  level: Level;
  active: boolean;
  confirmed: boolean | null;
  /** calendar days from alert start to paired episode onset (confirmed only) */
  warningDays: number | null;
  episodeOnset: string | null;
}

export interface Episode {
  onset: string;
  onsetIdx: number;
  labelStart: string;
  labelEnd: string;
  warned: boolean;
  warningDays: number | null;
  alertId: string | null;
}
