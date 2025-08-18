import MBTiles from "@mapbox/mbtiles";
import { promisify } from "util";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

// Promisify the constructor for opening MBTiles.
// It takes path, options, and a callback.
// The promisified version will take path, options and return a Promise.
const MBTilesConstructorPromise = promisify(function(FilePath: string, options: any, callback: (err: any, mbtilesHandle: any) => void) {
    // Ensure 'new' is used correctly with the imported MBTiles
    new MBTiles(FilePath, options, callback);
});

// Promisify getTile. It takes handle, z, x, y, callback.
// The promisified version will take handle, z, x, y and return a Promise.
const getMbtilesTileAsync = promisify(function(mbtilesHandle: any, z: number, x: number, y: number, callback: (err: any, tile: any) => void) {
    mbtilesHandle.getTile(z, x, y, callback);
});

// Promisify getInfo if it's callback-based.
// It takes a callback. Promisified version takes no arguments and returns a Promise.
const getMbtilesInfoAsync = promisify(function(mbtilesHandle: any, callback: (err: any, info: any) => void) {
    mbtilesHandle.getInfo(callback);
});


/**
 * Opens an MBTiles file and returns its handle and metadata.
 * @param FilePath The path to the MBTiles file.
 * @returns A Promise resolving to an object containing the MBTiles handle and its metadata.
 */
export async function openMBTiles(FilePath: string): Promise<{ handle: any; metadata?: { format?: string } }> {
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }
  try {
    // Await the promisified constructor to get the handle.
    // Pass readOnly: true mode.
    const mbtilesHandle = await MBTilesConstructorPromise(FilePath, { readOnly: true });

    // Now, get metadata. Await the promisified getInfo.
    const info = await getMbtilesInfoAsync(mbtilesHandle); // Pass the handle to the promisified method

    let metadata: { format?: string } | undefined = undefined;
    if (info && info.format) {
      metadata = { format: info.format };
    } else {
      console.warn("Could not retrieve MBTiles format from metadata, falling back to png for blank tiles.");
    }

    // Resolve with the handle and the extracted metadata
    return { handle: mbtilesHandle, metadata };

  } catch (error: any) {
    console.error(`Failed to open MBTiles file ${FilePath}: ${error.message}`);
    throw error;
  }
}

/**
 * Fetches a tile from an MBTiles source.
 * @param mbtilesHandle The MBTiles handle obtained from openMBTiles.
 * @param z Zoom level.
 * @param x X coordinate.
 * @param y Y coordinate.
 * @returns Promise<{data: Buffer | undefined, contentType: string | undefined}>.
 */
export async function getMBTilesTile(
  mbtilesHandle: any,
  z: number,
  x: number,
  y: number,
): Promise<{ data: Buffer | undefined; contentType: string | undefined }> {
  try {
    // Call the promisified getTile method.
    const tileData = await getMbtilesTileAsync(mbtilesHandle, z, x, y);

    if (!tileData || !tileData.data) {
      return { data: undefined, contentType: undefined };
    }
    return { data: tileData.data, contentType: tileData.headers?.contentType };

  } catch (error: any) {
    if (error.message.includes("Tile does not exist") || error.message.includes("no such row")) {
      return { data: undefined, contentType: undefined };
    } else {
      console.error("Error fetching MBTiles tile:", error);
      throw error;
    }
  }
}
