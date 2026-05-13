export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      !["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(error?.code) ||
      !specifier.startsWith(".") ||
      /\.[cm]?[tj]sx?$/.test(specifier)
    ) {
      throw error;
    }

    for (const extension of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch {
        continue;
      }
    }

    throw error;
  }
}
