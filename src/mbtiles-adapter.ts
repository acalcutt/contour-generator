import sqlite3 from "sqlite3";
import path from "path";

// Define a common interface for what mlcontour expects from a tile fetcher
interface MlContourTileAdapterResult {
  data: Blob;
  expires: undefined;
  cacheControl: undefined;
}

// Define the shape of our MBTiles reader object
interface MbtilesReader {
  getTile: (z: number, x: number, y: number) => Promise<MlContourTileAdapterResult | undefined>;
  close: () => Promise<void>;
}

// --- MBTiles Specific Constants ---
export const mbtilesTester = /^mbtiles:\/\//i; // New tester for MBTiles

// Function to open an MBTiles file and return a reader
export async function openMbtiles(mbtilesUrl: string): Promise<MbtilesReader> {
  // Extract the file path from the URL. Remove the 'mbtiles://' prefix.
  const filePath = mbtilesUrl.replace(mbtilesTester, "");

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        return reject(`Failed to open MBTiles file: ${err.message}`);
      }

      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tiles';", (err, row) => {
        if (err || !row) {
          db.close();
          return reject('MBTiles file does not contain a "tiles" table.');
        }

        resolve({
          getTile: async (z: number, x: number, y: number): Promise<MlContourTileAdapterResult | undefined> => {
            return new Promise((resolveTile, rejectTile) => {
              const query = `SELECT tile_data, tile_media_type FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`;

              db.get(query, [z, x, y], (err, row) => {
                if (err) {
                  console.error(`Error querying MBTiles for tile (${z}/${x}/${y}): ${err.message}`);
                  return resolveTile(undefined);
                }

                if (row && row.tile_data) {
                  const blob = new Blob([row.tile_data], {
                    type: row.tile_media_type || "application/octet-stream",
                  });
                  resolveTile({
                    data: blob,
                    expires: undefined,
                    cacheControl: undefined,
                  });
                } else {
                  resolveTile(undefined);
                }
              });
            });
          },
          close: async () => {
            return new Promise<void>((resolveClose, rejectClose) => {
              db.close((err) => {
                if (err) {
                  rejectClose(`Error closing MBTiles database: ${err.message}`);
                } else {
                  resolveClose();
                }
              });
            });
          },
        });
      });
    });
  });
}