import { Images } from "lucide-react";
import ConverterView from "./ConverterView";
import { TOOLTIPS } from "../../lib/tooltips";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

function filenameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export default function BatchConverter() {
  return (
    <ConverterView
      headerIcon={Images}
      title="Batch Image Converter"
      subtitle="Drag in WebP, JPEG, or PNG — convert all checked to one target format."
      browseTip={TOOLTIPS.converterBrowse}
      browseFilterName="Images"
      browseExtensions={IMAGE_EXTS}
      fileAccept=".png,.jpg,.jpeg,.webp"
      dropzoneTip={TOOLTIPS.converterDropzone}
      dropzoneHeading="Drop images here"
      dropzoneSub="PNG, JPEG, WebP — mixed formats allowed"
      noSupportedError="No supported images (PNG, JPEG, WebP)"
      footerHint="End-to-end via Rust image crate — failures stay checked for retry"
      showDpi={false}
      isAccepted={(p) => IMAGE_EXTS.includes(p.split(".").pop()?.toLowerCase() ?? "")}
      expandPaths={async (paths) =>
        paths.map((p) => ({ path: p, filename: filenameFromPath(p) }))
      }
    />
  );
}
