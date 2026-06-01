import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SvgTemplate } from "../../types";

export function useTemplates(): {
  templates: SvgTemplate[];
  keyCount: number;
} {
  const [templates, setTemplates] = useState<SvgTemplate[]>([]);
  const [keyCount, setKeyCount] = useState(0);

  useEffect(() => {
    invoke<SvgTemplate[]>("get_svg_templates").then(setTemplates);
    invoke<number>("get_key_count").then(setKeyCount);
  }, []);

  return { templates, keyCount };
}
