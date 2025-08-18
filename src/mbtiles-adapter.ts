import MBTiles from "@mapbox/mbtiles"; // Import the constructor directly

import { promisify } from "util";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

// Helper for promisifying methods if they are callback-based.
// We need to promisify the constructor AND its methods like getTile/getInfo.

// Promisify the constructor itself.
// The constructor takes path, options, and a callback.
// We need to promisify the constructor itself if it's callback-based.
const MBTilesConstructor = promisify(function(FilePath: string, options: any, callback: (err: any, mbtilesHandle: any) => void) {
    // Use the constructor directly from the imported MBTiles
    new MBTiles(FilePath, options, callback);
});

// Promisify getTile if it's callback-based.
const getMbtilesTileAsync = promisify(function(mbtilesHandle: any, z: number, x: number, y: number, callback: (err: any, tile: any) => void) {
    mbtilesHandle.getTile(z, x, y, callback);
});

/**
 * Opens an MBTiles file and returns its handle and metadata.
 * @param FilePath The path to the MBTiles file.
 * @returns A Promise resolving to an object containing the MBTiles handle and its metadata.
 */
export function openMBTiles(FilePath: string): Promise<{ handle: any; metadata?: { format?: string } }> {
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }

  return new Promise(async (resolve, reject) => { // Make the promise executor async to use await inside
    try {
      // Call the promisified constructor to get the handle
      const mbtilesHandle = await MBTilesConstructor(FilePath, { readOnly: true }); // Assuming readOnly mode

      // Now, get metadata. getInfo is typically asynchronous and uses a callback.
      const getInfoAsync = promisify(mbtilesHandle.getInfo);
      const info = await getInfoAsync();

      let metadata: { format?: string } | undefined = undefined;
      if (info && info.format) {
        metadata = { format: info.format };
      } else {
        console.warn("Could not retrieve MBTiles format from metadata, falling back to png for blank tiles.");
      }

      resolve({ handle: mbtilesHandle, metadata });

    } catch (error: any) { // Catch errors from constructor initialization or getInfo
      console.error(`Failed to open MBTiles file ${FilePath}: ${error.message}`);
      reject(error);
    }
  });
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
