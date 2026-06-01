export function readFileAsDataUrl(
  filePath: string,
): Promise<{ dataUrl: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    import("@tauri-apps/plugin-fs").then(({ readFile }) => {
      readFile(filePath)
        .then((bytes) => {
          let binary = "";
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const base64 = btoa(binary);
          resolve({
            dataUrl: `data:${mimeType};base64,${base64}`,
            fileName: filePath.split("/").pop() ?? filePath,
          });
        })
        .catch(reject);
    }).catch(reject);
  });
}
