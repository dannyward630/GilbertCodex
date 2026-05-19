export function readFileAsDataUrl(file: File, failureMessage = "Could not read this file.") {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const rejectRead = () => reject(new Error(failureMessage));

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      rejectRead();
    });
    reader.addEventListener("error", rejectRead);
    reader.addEventListener("abort", rejectRead);
    reader.readAsDataURL(file);
  });
}
