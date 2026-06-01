import type { Area } from "react-easy-crop";

export function cropImage(imgSrc: string, area: Area, rotation = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rotRad = (rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rotRad));
      const sin = Math.abs(Math.sin(rotRad));
      const rotW = Math.ceil(img.width * cos + img.height * sin);
      const rotH = Math.ceil(img.width * sin + img.height * cos);

      const rotCanvas = document.createElement("canvas");
      rotCanvas.width = rotW;
      rotCanvas.height = rotH;
      const rotCtx = rotCanvas.getContext("2d")!;
      rotCtx.translate(rotW / 2, rotH / 2);
      rotCtx.rotate(rotRad);
      rotCtx.translate(-img.width / 2, -img.height / 2);
      rotCtx.drawImage(img, 0, 0);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = area.width;
      canvas.height = area.height;
      ctx.drawImage(
        rotCanvas,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        area.width,
        area.height,
      );
      canvas.toBlob((b) => {
        if (!b) {
          reject(new Error("Canvas toBlob failed"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(b);
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imgSrc;
  });
}
