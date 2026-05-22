export interface SvgTemplate {
  key: string;
  path: string;
  name: string;
}

export interface AppConfig {
  printer_name: string;
  input_folder_path: string;
  output_folder_path: string;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
