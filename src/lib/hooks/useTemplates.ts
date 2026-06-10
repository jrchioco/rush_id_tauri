import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SvgTemplate } from "../../types";

export function useTemplates(): {
  templates: SvgTemplate[];
  keyCount: number;
  loading: boolean;
} {
  const [templates, setTemplates] = useState<SvgTemplate[]>([]);
  const [keyCount, setKeyCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = 0;
    const checkDone = () => {
      if (++settled === 2) setLoading(false);
    };
    invoke<SvgTemplate[]>("get_svg_templates")
      .then(setTemplates)
      .catch(console.error)
      .finally(checkDone);
    invoke<number>("get_key_count")
      .then(setKeyCount)
      .catch(console.error)
      .finally(checkDone);
  }, []);

  return { templates, keyCount, loading };
}
