import mbtiles from "@mapbox/mbtiles";
import { promisify } from "util";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

const getMbtilesTileAsync = promisify(function(mbtilesHandle: any, z: number, x: number, y: number, callback: (err: any, tile: any) => void) {
    mbtilesHandle.getTile(z, x, y, callback);
});

/**
 * Opens an MBTiles file and returns its handle and metadata.
 * @param FilePath The path to the MBTiles file.
 * @returns An object containing the MBTiles handle and its metadata.
 */
export function openMBTiles(FilePath: string): { handle: any; metadata?: { format?: string } } { // Explicitly type metadata
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }
  try {
    const mbtilesHandle = new mbtiles.MapboxTileSource(FilePath);

    // Synchronously get info to extract metadata
    const metadata = getMBTilesInfoSync(mbtilesHandle);

    return { handle: mbtilesHandle, metadata }; // Return handle AND metadata

  } catch (error: any) {
    console.error(`Failed to open MBTiles file ${FilePath}: ${error.message}`);
    throw error;
  }
}

// Synchronous helper to get MBTiles info.
function getMBTilesInfoSync(mbtilesHandle: any): { format?: string } | undefined {
    try {
        const info = mbtilesHandle.getInfo(); // getInfo is synchronous and returns an object with metadata
        return info; // Return the whole info object
    } catch (e) {
        console.warn("Could not retrieve MBTiles metadata, falling back to png for blank tiles.", e);
        return undefined; // Return undefined if info retrieval fails
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
  mbtilesHandle: any, // This is the handle, not the full object with metadata
  z: number,
  x: number,
  y: number,
): Promise<{ data: Buffer | undefined; contentType: string | undefined }> {
  try {
    const tileData = await getMbtilesTileAsync(mbtilesHandle, z, x, y);

    if (!tileData || !tileData.data) {
      return { data: undefined, contentType: undefined };
    }
    // Return the contentType from the headers. This is the actual MIME type of the tile.
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