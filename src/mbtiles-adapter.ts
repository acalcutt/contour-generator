import MBTiles from "@mapbox/mbtiles";
import { existsSync } from "fs";

export const mbtilesTester = /^mbtiles:\/\//i;

/**
 * Opens an MBTiles file and returns its handle and metadata.
 * @param FilePath The path to the MBTiles file.
 * @returns A Promise resolving to an object containing the MBTiles handle and its metadata.
 */
export async function openMBTiles(
  FilePath: string,
): Promise<{ handle: any; metadata?: { format?: string } }> {
  if (!existsSync(FilePath)) {
    throw new Error(`MBTiles file not found at: ${FilePath}`);
  }

  return new Promise((resolve, reject) => {
    // Use the constructor with just the file path and callback - no options object
    new MBTiles(FilePath, (err: any, mbtilesHandle: any) => {
      if (err) {
        console.error(
          `Failed to open MBTiles file ${FilePath}: ${err.message}`,
        );
        reject(err);
        return;
      }

      // Get metadata using the handle's getInfo method
      mbtilesHandle.getInfo((infoErr: any, info: any) => {
        if (infoErr) {
          console.warn(
            `Could not retrieve MBTiles info for ${FilePath}: ${infoErr.message}`,
          );
          // Still resolve with the handle, but without metadata
          resolve({ handle: mbtilesHandle, metadata: undefined });
          return;
        }

        let metadata: { format?: string } | undefined = undefined;
        if (info && info.format) {
          metadata = { format: info.format };
        } else {
          console.warn(
            "Could not retrieve MBTiles format from metadata, falling back to png for blank tiles.",
          );
        }

        resolve({ handle: mbtilesHandle, metadata });
      });
    });
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
  return new Promise((resolve, reject) => {
    mbtilesHandle.getTile(z, x, y, (err: any, tileData: any, headers: any) => {
      if (err) {
        if (
          err.message &&
          (err.message.includes("Tile does not exist") ||
            err.message.includes("no such row"))
        ) {
          resolve({ data: undefined, contentType: undefined });
          return;
        }
        console.error("Error fetching MBTiles tile:", err);
        reject(err);
        return;
      }

      if (!tileData) {
        resolve({ data: undefined, contentType: undefined });
        return;
      }

      const contentType = headers?.["Content-Type"] || headers?.contentType;
      resolve({ data: tileData, contentType });
    });
  });
}
