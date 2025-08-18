import MBTiles from "@mapbox/mbtiles";
import { promisify } from "util";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

/**
 * Opens an MBTiles file and returns its handle and metadata.
 * @param FilePath The path to the MBTiles file.
 * @returns A Promise resolving to an object containing the MBTiles handle and its metadata.
 */
export function openMBTiles(FilePath: string): Promise<{ handle: any; metadata?: { format?: string } }> {
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }

  return new Promise((resolve, reject) => {
    // Use the constructor pattern as per your example.
    // The constructor takes path, options, and a callback.
    // We need to wrap this callback-based constructor in a Promise.
    try {
      // Pass readOnly: true mode for safety when just reading.
      // The constructor might also need a callback for async setup.
      new MBTiles(FilePath + '?mode=ro', async (err: any, mbtilesHandle: any) => { // Add ?mode=ro for read-only
        if (err) {
          console.error(`Failed to open MBTiles file ${FilePath}: ${err.message}`);
          return reject(err);
        }

        // Now, get metadata. getInfo is typically asynchronous and uses a callback.
        // We need to promisify it to use await.
        const getInfoAsync = promisify(mbtilesHandle.getInfo);
        try {
          const info = await getInfoAsync();
          let metadata: { format?: string } | undefined = undefined;
          if (info && info.format) {
            metadata = { format: info.format };
          } else {
            console.warn("Could not retrieve MBTiles format from metadata, falling back to png for blank tiles.");
          }
          // Resolve with the handle and the extracted metadata
          resolve({ handle: mbtilesHandle, metadata });
        } catch (e) {
          console.warn("Error retrieving MBTiles metadata (format), falling back to png for blank tiles.", e);
          // Resolve with handle but no metadata format, as it failed
          resolve({ handle: mbtilesHandle, metadata: undefined });
        }
      });
    } catch (error: any) { // Catch errors from constructor initialization itself if not handled by callback
      console.error(`Error during MBTiles constructor for ${FilePath}: ${error.message}`);
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
    // Promisify getTile if it's callback-based.
    // Assuming getTile is a method on the handle.
    const getTileAsync = promisify(mbtilesHandle.getTile);
    const tileData = await getTileAsync(z, x, y);

    if (!tileData || !tileData.data) {
      return { data: undefined, contentType: undefined };
    }
    // Return the contentType from the headers.
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
