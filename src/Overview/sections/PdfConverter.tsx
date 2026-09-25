import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { FileImage } from "lucide-react";
import ConverterView, {
  type DpiChoice,
  type ExpandHelpers,
  type NewTile,
} from "./ConverterView";
import { ThemedModal } from "../../components/ThemedModal";
import { TOOLTIPS } from "../../lib/tooltips";
import { setEffieMood } from "../../components/CompanionWidget/moodStore";

interface RenderedPdf {
  pages: { path: string; page: number; width: number; height: number }[];
  total: number;
  capped: boolean;
}

const PAGE_GUARD_THRESHOLD = 50;

function filenameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export default function PdfConverter() {
  const [pwStem, setPwStem] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");
  const pwResolveRef = useRef<((pw: string | null) => void) | null>(null);
  // Serializes concurrent imports so two password prompts never overlap.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const askPassword = useCallback((stem: string): Promise<string | null> => {
    setPwValue("");
    setPwStem(stem);
    return new Promise<string | null>((resolve) => {
      pwResolveRef.current = resolve;
    });
  }, []);

  const settlePrompt = useCallback((value: string | null) => {
    pwResolveRef.current?.(value);
    pwResolveRef.current = null;
    setPwStem(null);
  }, []);

  const expandInner = useCallback(
    async (paths: string[], dpi: DpiChoice, { onStatus, sourceDpi }: ExpandHelpers): Promise<NewTile[]> => {
      const out: NewTile[] = [];
      let unlisten: (() => void) | null = null;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ done: number; total: number; file: string }>(
          "pdf_render_progress",
          (e) => {
            if (e.payload.total > 1) {
              onStatus(`Rendering ${e.payload.file} @ ${dpi} DPI (${e.payload.done}/${e.payload.total})…`);
            }
          }
        );
      } catch {
        // progress listener is non-critical; static status still shows below
      }
      try {
        for (const pdf of paths) {
          const prevDpi = sourceDpi(pdf);
          if (prevDpi === dpi) {
            toast.info(`${filenameFromPath(pdf)} already in batch`);
            continue;
          }
          const stem = filenameFromPath(pdf).replace(/\.pdf$/i, "");
          const replacing = prevDpi !== undefined;
          let password: string | null = null;
          for (;;) {
            onStatus(`Rendering ${stem} @ ${dpi} DPI…`);
            try {
              const result = await invoke<RenderedPdf>("render_pdf_pages", {
                pdfPath: pdf,
                dpi,
                password,
              });
              if (result.total > PAGE_GUARD_THRESHOLD) {
                toast.warning(`${stem}: ${result.total} pages — large import, may be slow on low-end PCs`);
              }
              if (result.capped) {
                toast.warning(`${stem}: oversized pages fitted to 10000px edge`);
              }
              for (const p of result.pages) {
                out.push({
                  path: p.path,
                  filename: `${stem} p.${p.page}/${result.total}`,
                  source: pdf,
                  dpi,
                  width: p.width,
                  height: p.height,
                  ...(replacing ? { replaceSource: pdf } : {}),
                });
              }
              setEffieMood("success");
              toast.success(
                replacing
                  ? `${stem}: re-rendered @ ${dpi} DPI (replaced ${prevDpi} DPI tiles)`
                  : `${stem}: ${result.total} page(s) → tiles @ ${dpi} DPI`
              );
              break;
            } catch (e) {
              const msg = String(e);
              if (msg.includes("PDF_PASSWORD_REQUIRED") || msg.includes("PDF_PASSWORD_INCORRECT")) {
                if (msg.includes("PDF_PASSWORD_INCORRECT")) {
                  toast.error(`${stem}: wrong password — try again`);
                }
                onStatus(`Waiting for password: ${stem}…`);
                password = await askPassword(stem);
                if (password === null) {
                  toast.info(`${stem} skipped`);
                  break;
                }
                continue;
              }
              setEffieMood("error");
              toast.error(`${stem}: ${msg}`);
              break;
            }
          }
          onStatus(null);
        }
      } finally {
        unlisten?.();
        onStatus(null);
      }
      return out;
    },
    [askPassword]
  );

  const expandPaths = useCallback(
    (paths: string[], dpi: DpiChoice, helpers: ExpandHelpers): Promise<NewTile[]> => {
      const run = chainRef.current.then(() => expandInner(paths, dpi, helpers));
      chainRef.current = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    [expandInner]
  );

  return (
    <>
      <ConverterView
        headerIcon={FileImage}
        title="PDF to Image Converter"
        subtitle="Drag in PDFs — each page becomes a tile, convert all checked to one target format."
        browseTip={TOOLTIPS.pdfConverterBrowse}
        browseFilterName="PDFs"
        browseExtensions={["pdf"]}
        fileAccept=".pdf"
        dropzoneTip={TOOLTIPS.pdfConverterDropzone}
        dropzoneHeading="Drop PDFs here"
        dropzoneSub="Each page expands to one tile"
        noSupportedError="No supported files (PDF)"
        footerHint="Pages render via bundled PDFium — failures stay checked for retry"
        showDpi
        isAccepted={(p) => (p.split(".").pop()?.toLowerCase() ?? "") === "pdf"}
        expandPaths={expandPaths}
      />
      <ThemedModal open={pwStem !== null} onClose={() => settlePrompt(null)}>
        <div className="p-6 w-80">
          <h4 className="text-sm font-bold text-[#e8e4da]">Password required</h4>
          <p className="text-xs font-mono text-[#888] mt-1 truncate" title={pwStem ?? ""}>
            {pwStem}
          </p>
          <input
            type="password"
            autoFocus
            value={pwValue}
            onChange={(e) => setPwValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") settlePrompt(pwValue);
            }}
            placeholder="PDF password"
            className="mt-3 w-full px-3 py-2 rounded-lg bg-[#111110] border border-[#2a2a28] text-sm font-mono text-[#e8e4da] placeholder:text-[#444] focus:border-[#c8881a]/60 outline-none"
          />
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => settlePrompt(pwValue)}
              className="flex-1 px-4 py-2 rounded-lg font-bold text-sm bg-[#c8881a] text-[#0c0c0b] hover:bg-[#e8a030] transition-colors"
            >
              Unlock
            </button>
            <button
              onClick={() => settlePrompt(null)}
              className="px-4 py-2 rounded-lg text-sm font-mono text-[#888] hover:text-[#e8e4da] border border-[#2a2a28] hover:border-[#c8881a]/30 transition-colors"
            >
              Skip file
            </button>
          </div>
        </div>
      </ThemedModal>
    </>
  );
}
