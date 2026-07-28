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

export interface Material {
  id: number;
  name: string;
  unit: string;
  current_stock: number;
  low_stock_threshold: number;
  linked_tab: string | null;
  deduct_per_export: number;
  created_at: string;
  updated_at: string;
}

export interface MaterialsSummary {
  total: number;
  low_count: number;
}

export interface Sale {
  id: number;
  source: string;
  tab: string | null;
  amount: number;
  quantity: number;
  note: string | null;
  activity_log_id: number | null;
  created_at: string;
}

export interface SalesSummary {
  today_total: number;
  today_count: number;
}

export interface ServicePrice {
  tab: string;
  price: number;
  updated_at: string;
}
