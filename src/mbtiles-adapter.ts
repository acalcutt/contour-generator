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

// Type for the 'tiles' table rows
interface MbtilesTileRow {
  data: Buffer;
}

// Type for the 'metadata' table rows
interface MbtilesMetadataRow {
  name: string;
  value: string;
}

// --- MBTiles Specific Constants ---
export const mbtilesTester = /^mbtiles:\/\//i;

// Mapping from MBTiles format to MIME type
const mbtilesFormatToMimeType: { [key: string]: string } = {
  "pbf": "application/vnd.mapbox-vector-tile",
  "jpg": "image/jpeg",
  "jpeg": "image/jpeg", // Add alias if needed
  "png": "image/png",
  "webp": "image/webp",
  // Add other formats you might encounter if the spec implies they can be used as strings
};

// Helper function to get the format from metadata
async function getMbtilesFormat(db: sqlite3.Database): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const query = `SELECT value FROM metadata WHERE name = 'format'`;
    db.get(query, [], (err: Error | null, row: MbtilesMetadataRow | undefined) => {
      if (err) {
        console.error(`Error fetching MBTiles format: ${err.message}`);
        return reject(err);
      }
      if (row) {
        resolve(row.value);
      } else {
        console.warn("MBTiles metadata 'format' not found.");
        resolve(undefined);
      }
    });
  });
}

// Function to open an MBTiles file and return a reader
export async function openMbtiles(mbtilesUrl: string): Promise<MbtilesReader> {
  const filePath = path.normalize(mbtilesUrl.replace(mbtilesTester, ""));
  console.log(filePath);

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error(`Failed to open MBTiles file at ${filePath}: ${err.message}`);
        return reject(`Failed to open MBTiles file: ${err.message}`);
      }

      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tiles';", (err, row: { name: string } | undefined) => {
        if (err) {
          console.error(`Error checking for 'tiles' table: ${err.message}`);
          db.close();
          return reject(`Error verifying MBTiles structure: ${err.message}`);
        }
        if (!row) {
          db.close();
          return reject('MBTiles file does not contain a "tiles" table.');
        }

        getMbtilesFormat(db)
          .then((mbtilesFormatString) => { // Renamed to avoid confusion with MIME type
            // Map the MBTiles format string to a proper MIME type
            const mimeType = mbtilesFormatString
              ? mbtilesFormatToMimeType[mbtilesFormatString.toLowerCase()] || "application/octet-stream"
              : "application/octet-stream"; // Default if no format found

            if (mbtilesFormatString && !mbtilesFormatToMimeType[mbtilesFormatString.toLowerCase()]) {
              console.warn(`MBTiles format "${mbtilesFormatString}" not mapped to a known MIME type. Using default.`);
            }

            resolve({
              getTile: async (z: number, x: number, y: number): Promise<MlContourTileAdapterResult | undefined> => {
                return new Promise((resolveTile) => {
                  const query = `SELECT data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`;

                  db.get(query, [z, x, y], (err: Error | null, row: MbtilesTileRow | undefined) => {
                    if (err) {
                      console.error(`Error querying MBTiles for tile (${z}/${x}/${y}): ${err.message}`);
                      return resolveTile(undefined);
                    }

                    if (row && row.data) {
                      // Use the correctly mapped MIME type
                      const blob = new Blob([row.data], {
                        type: mimeType,
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
                      console.error(`Error closing MBTiles database: ${err.message}`);
                      rejectClose(`Error closing MBTiles database: ${err.message}`);
                    } else {
                      resolveClose();
                    }
                  });
                });
              },
            });
          })
          .catch(reject);
      });
    });
  });
}