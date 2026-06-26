export interface SvgTemplate {
  key: string;
  path: string;
  name: string;
}

export interface LogEntry {
  time: string;
  text: string;
}

export type { FontChoice, LabelMode } from "../lib/utils";
