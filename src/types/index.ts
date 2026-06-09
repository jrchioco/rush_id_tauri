export interface SvgTemplate {
  key: string;
  path: string;
  name: string;
}

export interface LogEntry {
  time: string;
  text: string;
}

export type LabelMode = "off" | "name" | "name-sig";

export type { FontChoice } from "../lib/utils";
