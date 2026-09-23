import imageCompression from "browser-image-compression";

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * If the file is an image, it compresses it to a maximum of 200KB.
 * Otherwise, it returns the original file.
 * Throws an error if the final file (after any compression) exceeds 5MB.
 */
export async function processAndValidateFile(file: File): Promise<File> {
  let finalFile = file;

  // SVG images generally shouldn't be compressed via raster compression
  if (file.type.startsWith("image/") && !file.type.includes("svg")) {
    const options = {
      maxSizeMB: 0.2, // 200 KB limit
      maxWidthOrHeight: 1280,
      useWebWorker: true,
    };
    try {
      const compressedBlob = await imageCompression(file, options);
      finalFile = new File([compressedBlob], file.name, {
        type: file.type,
        lastModified: Date.now(),
      });
    } catch (error) {
      console.error("Image compression failed:", error);
      // Fallback to original file if compression fails
      finalFile = file;
    }
  }

  if (finalFile.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File "${finalFile.name}" exceeds the 5MB size limit.`);
  }

  return finalFile;
}
