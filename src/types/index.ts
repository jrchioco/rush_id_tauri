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

export interface ActivityStats {
  pdf_exports: number;
  print_reminders: number;
  total_pages: number;
  multi_page_batches: number;
}

export interface ActivityEntry {
  id: number;
  event_type: string;
  tab: string;
  page_count: number;
  created_at: string;
}
