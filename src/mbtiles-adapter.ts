// mbtiles-adapter.ts

import mbtiles from "@mapbox/mbtiles";
import { promisify } from "util";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

// The getTile method is often asynchronous and callback-based, so promisify it.
// The correct way to promisify might depend on the exact library structure.
// Let's assume getTile is a method on the opened MBTiles object.
// If the library provides an async open method, that would be better.

/**
 * Opens an MBTiles file and returns its handle and metadata.
 * @param FilePath The path to the MBTiles file.
 * @returns An object containing the MBTiles handle and its metadata.
 */
export function openMBTiles(FilePath: string): { handle: any; metadata?: { format?: string } } {
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }
  try {
    // *** CORRECTED USAGE: Use mbtiles.open() ***
    // The 'open' method typically returns the handle and potentially metadata.
    // Check the documentation for the exact return structure.
    // A common pattern is:
    const mbtilesHandle = mbtiles.open(FilePath);

    // If mbtiles.open() itself doesn't directly give metadata, you might need to call getInfo.
    // Let's assume for now that open() gives you a handle.
    // The getInfo call within the open function might be the source of the error if it's expecting something else.

    // The original code was trying to use MapboxTileSource, which is likely not the primary export or intended way.
    // Let's assume mbtiles.open() provides the handle.

    // You still need a way to get metadata and the format.
    // If mbtiles.open() returns metadata directly, great. If not, we'll need to use getInfo.
    // Let's refine the getMBTilesInfoSync to be more robust if getInfo is on the handle.

    const metadata = getMBTilesInfoSync(mbtilesHandle); // Call getInfo on the obtained handle

    return { handle: mbtilesHandle, metadata };

  } catch (error: any) {
    console.error(`Failed to open MBTiles file ${FilePath}: ${error.message}`);
    throw error;
  }
}

// Synchronous helper to get MBTiles info.
function getMBTilesInfoSync(mbtilesHandle: any): { format?: string } | undefined {
    try {
        // Check if getInfo is a method of the handle
        if (typeof mbtilesHandle.getInfo === 'function') {
            const info = mbtilesHandle.getInfo(); // getInfo is synchronous
            return info;
        } else {
            console.warn("MBTiles handle does not have a getInfo method.");
            return undefined;
        }
    } catch (e) {
        console.warn("Could not retrieve MBTiles metadata (format), falling back to png for blank tiles.", e);
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
    // The getTile method is likely on the handle itself.
    const tileData = await getMbtilesTileAsync(mbtilesHandle, z, x, y);

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
