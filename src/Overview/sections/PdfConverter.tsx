import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { FileImage } from "lucide-react";
import ConverterView, {
  type DpiChoice,
  type ExpandHelpers,
  type NewTile,
} from "./ConverterView";
import { TOOLTIPS } from "../../lib/tooltips";
import { setEffieMood } from "../../components/CompanionWidget/moodStore";

interface RenderedPdf {
  pages: { path: string; page: number; width: number; height: number }[];
  total: number;
}

const PAGE_GUARD_THRESHOLD = 50;

function filenameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export default function PdfConverter() {
  const expandPaths = useCallback(
    async (paths: string[], dpi: DpiChoice, { onStatus, sourceDpi }: ExpandHelpers): Promise<NewTile[]> => {
      const out: NewTile[] = [];
      for (const pdf of paths) {
        const prevDpi = sourceDpi(pdf);
        if (prevDpi === dpi) {
          toast.info(`${filenameFromPath(pdf)} already in batch`);
          continue;
        }
        const stem = filenameFromPath(pdf).replace(/\.pdf$/i, "");
        const replacing = prevDpi !== undefined;
        onStatus(`Rendering ${stem} @ ${dpi} DPI…`);
        try {
          const result = await invoke<RenderedPdf>("render_pdf_pages", {
            pdfPath: pdf,
            dpi,
            password: null,
          });
          if (result.total > PAGE_GUARD_THRESHOLD) {
            toast.warning(`${stem}: ${result.total} pages — large import, may be slow on low-end PCs`);
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
        } catch (e) {
          const msg = String(e);
          setEffieMood("error");
          if (msg.includes("PDF_PASSWORD_REQUIRED")) {
            toast.error(`${stem} is password-protected — password prompt lands in Phase 3`);
          } else {
            toast.error(`${stem}: ${msg}`);
          }
        } finally {
          onStatus(null);
        }
      }
      return out;
    },
    []
  );

  return (
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
  );
}
