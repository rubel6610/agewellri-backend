import fs from "fs";
import path from "path";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Safely resolve a relative file URL or path to its absolute filesystem path inside the uploads directory.
 * Returns null if the path is invalid or attempts to escape the uploads root.
 */
export function resolveUploadFilePath(fileUrlOrPath?: string | null): string | null {
  if (!fileUrlOrPath || typeof fileUrlOrPath !== "string") return null;

  let cleanPath = fileUrlOrPath.trim();

  // If it's a full URL, extract the path part after /uploads/
  if (cleanPath.includes("/uploads/")) {
    cleanPath = cleanPath.substring(cleanPath.indexOf("/uploads/") + "/uploads/".length);
  } else if (cleanPath.startsWith("/uploads")) {
    cleanPath = cleanPath.replace(/^\/?uploads\/?/, "");
  } else if (cleanPath.startsWith("uploads/")) {
    cleanPath = cleanPath.replace(/^uploads\/?/, "");
  }

  // Remove leading slashes and query strings
  cleanPath = cleanPath.split("?")[0].replace(/^\/+/, "");

  if (!cleanPath) return null;

  const absolutePath = path.resolve(UPLOADS_ROOT, cleanPath);

  // Security check: ensure path is strictly within UPLOADS_ROOT
  if (!absolutePath.startsWith(UPLOADS_ROOT)) {
    console.warn(`[fileStorage] Blocked attempted path traversal: ${fileUrlOrPath}`);
    return null;
  }

  return absolutePath;
}

/**
 * Delete a single uploaded file from the uploads directory asynchronously.
 */
export async function deleteUploadedFile(fileUrlOrPath?: string | null): Promise<boolean> {
  const absolutePath = resolveUploadFilePath(fileUrlOrPath);
  if (!absolutePath) return false;

  try {
    if (fs.existsSync(absolutePath)) {
      await fs.promises.unlink(absolutePath);
      console.log(`🗑️ [fileStorage] Successfully deleted attachment file: ${path.relative(process.cwd(), absolutePath)}`);
      return true;
    }
    return false;
  } catch (err: any) {
    console.warn(`⚠️ [fileStorage] Failed to delete file at ${absolutePath}:`, err.message);
    return false;
  }
}

/**
 * Delete multiple uploaded files from the uploads directory asynchronously in parallel.
 */
export async function deleteUploadedFiles(fileUrlsOrPaths: (string | null | undefined)[]): Promise<number> {
  if (!fileUrlsOrPaths || fileUrlsOrPaths.length === 0) return 0;

  const uniquePaths = Array.from(
    new Set(
      fileUrlsOrPaths
        .map(resolveUploadFilePath)
        .filter((p): p is string => Boolean(p))
    )
  );

  let deletedCount = 0;
  await Promise.all(
    uniquePaths.map(async (filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          console.log(`🗑️ [fileStorage] Successfully deleted attachment file: ${path.relative(process.cwd(), filePath)}`);
          deletedCount++;
        }
      } catch (err: any) {
        console.warn(`⚠️ [fileStorage] Failed to delete file at ${filePath}:`, err.message);
      }
    })
  );

  return deletedCount;
}
