import mbtiles from "@mapbox/mbtiles";
import { promisify } from "util";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

// Helper for promisifying mbtiles.MBTiles constructor and its methods.
// We need to promisify both the constructor and potentially getInfo if it's callback-based.
// Looking at node-mbtiles, it seems both constructor and getTile/getInfo are callback-based.

// Promisify the constructor itself.
// The constructor takes path, options, and a callback.
const MBTilesConstructor = promisify(function(FilePath: string, options: any, callback: (err: any, mbtilesHandle: any) => void) {
    new mbtiles.MBTiles(FilePath, options, callback);
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
export async function openMBTiles(FilePath: string): Promise<{ handle: any; metadata?: { format?: string } }> { // Return a Promise
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }
  try {
    // Await the promisified constructor
    // The constructor itself might be async and return the handle directly or via callback
    // The promisify of the constructor should yield a function that returns a Promise.
    const mbtilesHandle = await MBTilesConstructor(FilePath, { readOnly: true }); // Assuming readOnly mode is appropriate

    // Now, get metadata. getInfo is usually callback-based.
    const getInfoAsync = promisify(mbtilesHandle.getInfo);
    const info = await getInfoAsync();

    let metadata: { format?: string } | undefined = undefined;
    if (info && info.format) {
      metadata = { format: info.format };
    } else {
      console.warn("Could not retrieve MBTiles format from metadata, falling back to png for blank tiles.");
    }

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
    // We already promisified getTileAsync above
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
