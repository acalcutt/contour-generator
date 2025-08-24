import sharp from "sharp";
import mlcontour from "maplibre-contour";
import type {
  DemTile,
  Encoding,
  GlobalContourTileOptions,
} from "../node_modules/maplibre-contour/dist/types.d.ts";

// Constants for Encoding
const TERRARIUM_MULT = 256;
const TERRARIUM_OFFSET = 32768;

// Mapbox Encoding Parameters - Now hardcoded to match mlcontour's presumed defaults
// If mlcontour uses these specific values internally for Mapbox encoding:
const MAPBOX_INTERVAL_DEFAULT = 0.1;
const MAPBOX_OFFSET_DEFAULT = -10000;

/**
 * Generates a blank DEM tile image buffer using sharp.
 * @param width Tile width.
 * @param height Tile height.
 * @param elevationValue The elevation value to encode for the blank tile.
 * @param encoding The DEM encoding ('mapbox' or 'terrarium').
 * @param outputFormat The desired output image format ('png', 'webp', or 'jpeg').
 * @returns Promise<Buffer> The image buffer.
 */
export async function createBlankTileImage(
  width: number,
  height: number,
  elevationValue: number,
  encoding: Encoding,
  outputFormat: "png" | "webp" | "jpeg",
): Promise<Buffer> {
  const rgbData = new Uint8Array(width * height * 3); // 3 bytes per pixel (R, G, B)

  let r = 0,
    g = 0,
    b = 0;

  if (encoding === "terrarium") {
    const scaledValue = Math.round(
      (elevationValue + TERRARIUM_OFFSET) * TERRARIUM_MULT,
    );
    const clampedValue = Math.max(0, Math.min(0xffffff, scaledValue)); // Clamp for 24-bit color

    r = (clampedValue >> 16) & 0xff;
    g = (clampedValue >> 8) & 0xff;
    b = clampedValue & 0xff;
  } else {
    // 'mapbox' encoding - using the hardcoded defaults
    const rgbIntValue = Math.round(
      (elevationValue + MAPBOX_OFFSET_DEFAULT) * (1 / MAPBOX_INTERVAL_DEFAULT),
    );
    const clampedRgbIntValue = Math.max(0, Math.min(0xffffff, rgbIntValue)); // Clamp for 24-bit color

    r = (clampedRgbIntValue >> 16) & 0xff;
    g = (clampedRgbIntValue >> 8) & 0xff;
    b = clampedRgbIntValue & 0xff;
  }

  for (let i = 0; i < width * height; i++) {
    rgbData[i * 3] = r;
    rgbData[i * 3 + 1] = g;
    rgbData[i * 3 + 2] = b;
  }

  const image = sharp(Buffer.from(rgbData), {
    raw: {
      width: width,
      height: height,
      channels: 3, // R, G, B
    },
  });

  if (outputFormat === "webp") {
    return image.toFormat("webp", { lossless: true }).toBuffer();
  } else {
    // For PNG and JPEG, use the quality option where applicable
    const quality = outputFormat === "jpeg" ? 80 : undefined;
    return image.toFormat(outputFormat, { quality }).toBuffer();
  }
}

// GetImageData remains the same, as it decodes based on the encoding passed to it
export async function GetImageData(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  if (abortController?.signal?.aborted) {
    throw new Error("Image processing was aborted.");
  }
  try {
    const buffer = await blob.arrayBuffer();
    const image = sharp(Buffer.from(buffer));

    if (abortController?.signal?.aborted) {
      throw new Error("Image processing was aborted.");
    }

    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (abortController?.signal?.aborted) {
      throw new Error("Image processing was aborted.");
    }
    const parsed = mlcontour.decodeParsedImage(
      info.width,
      info.height,
      encoding, // This is the key: mlcontour decodes based on the encoding it receives
      data as any as Uint8ClampedArray,
    );
    if (abortController?.signal?.aborted) {
      throw new Error("Image processing was aborted.");
    }

    return parsed;
  } catch (error) {
    console.error("Error processing image:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("An unknown error has occurred.");
  }
}

export function extractZXYFromUrlTrim(
  url: string,
): { z: number; x: number; y: number } | null {
  const lastSlashIndex = url.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return null;
  }

  const segments = url.split("/");
  if (segments.length <= 3) {
    return null;
  }

  const ySegment = segments[segments.length - 1];
  const xSegment = segments[segments.length - 2];
  const zSegment = segments[segments.length - 3];

  const lastDotIndex = ySegment.lastIndexOf(".");
  const cleanedYSegment =
    lastDotIndex === -1 ? ySegment : ySegment.substring(0, lastDotIndex);

  const z = parseInt(zSegment, 10);
  const x = parseInt(xSegment, 10);
  const y = parseInt(cleanedYSegment, 10);

  if (isNaN(z) || isNaN(x) || isNaN(y)) {
    return null;
  }

  return { z, x, y };
}

export function getOptionsForZoom(
  options: GlobalContourTileOptions,
  zoom: number,
): any {
  const { thresholds, ...rest } = options;

  let levels: number[] = [];
  let maxLessThanOrEqualTo: number = -Infinity;

  Object.entries(thresholds).forEach(([zString, value]) => {
    const z = Number(zString);
    if (z <= zoom && z > maxLessThanOrEqualTo) {
      maxLessThanOrEqualTo = z;
      levels = typeof value === "number" ? [value] : value;
    }
  });

  return {
    levels,
    ...rest,
  };
}
