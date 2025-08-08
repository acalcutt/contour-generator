import { Command } from "commander";
import { writeFileSync, mkdir } from "fs";
import { default as mlcontour } from "../node_modules/maplibre-contour/dist/index.mjs";
import {
  extractZXYFromUrlTrim,
  GetImageData,
  getOptionsForZoom,
} from "./mlcontour-adapter";
// Import the new mbtiles adapter and tester correctly
import { openMbtiles, mbtilesTester } from "./mbtiles-adapter";
import { getPMtilesTile, openPMtiles, pmtilesTester } from "./pmtiles-adapter";
import { getChildren } from "@mapbox/tilebelt";
import path from "path";
import type { Encoding } from "../node_modules/maplibre-contour/dist/types";
// Note: PMTiles type import might need adjustment if you are using the @types package
// import type { PMTiles } from "pmtiles"; // Or 'pmtiles' depending on installation

type Tile = [number, number, number]; // [x, y, z]

const program = new Command();
program
  .name("generate-countour-tile-pyramid")
  .description(
    "Generates a pyramid of contour tiles from a source DEM using the mlcontour library.",
  )
  .requiredOption("--x <number>", "The X coordinate of the tile.")
  .requiredOption("--y <number>", "The Y coordinate of the tile.")
  .requiredOption("--z <number>", "The Z coordinate of the tile.")
  .requiredOption(
    "--demUrl <string>",
    "The URL of the DEM source (e.g., 'pmtiles://...', 'mbtiles://...', or a regular tile URL pattern).",
  )
  .option(
    "--encoding <string>",
    "The encoding of the source DEM tiles (e.g., 'terrarium', 'mapbox').",
    (value) => {
      if (value !== "mapbox" && value !== "terrarium") {
        throw new Error(
          "Invalid value for --encoding, must be 'mapbox' or 'terrarium'",
        );
      }
      return value;
    },
    "mapbox", // default value
  )
  .option(
    "--sourceMaxZoom <number>",
    "The maximum zoom level of the source DEM.",
    "8", // default value as a string
  )
  .option("--increment <number>", "The contour increment value to extract.")
  .option(
    "--outputMaxZoom <number>",
    "The maximum zoom level of the output tile pyramid.",
    "8", // default value as a string
  )
  .requiredOption(
    "--outputDir <string>",
    "The output directory where tiles will be stored.",
  )
  .parse(process.argv);

const options = program.opts();
const { x, y, z, demUrl, encoding, sourceMaxZoom, increment, outputMaxZoom, outputDir } =
  options;
const numX = Number(x);
const numY = Number(y);
const numZ = Number(z);
const numsourceMaxZoom = Number(sourceMaxZoom);
const numIncrement = Number(increment);
const numoutputMaxZoom = Number(outputMaxZoom);

// --------------------------------------------------
// Functions
// --------------------------------------------------

function getAllTiles(tile: Tile, outputMaxZoom: number): Tile[] {
  let allTiles: Tile[] = [tile];

  function getTileList(currentTile: Tile) {
    // getChildren returns [x, y, z] tiles that are children of the currentTile
    const children: Tile[] = getChildren(currentTile).filter(
      (child) => child[2] <= outputMaxZoom, // Only include children within the desired output max zoom
    );
    allTiles = allTiles.concat(children);
    for (const childTile of children) {
      const childZoom = childTile[2];
      if (childZoom < outputMaxZoom) {
        // Recursively get children for tiles that are not at the max zoom level yet
        getTileList(childTile);
      }
    }
  }

  getTileList(tile);
  return allTiles;
}

async function processTile(tileCoords: Tile): Promise<void> {
  const [x, y, z] = tileCoords;
  const dirPath: string = path.join(outputDir, `${z}`, `${x}`);
  const filePath: string = path.join(dirPath, `${y}.pbf`); // Output contour tiles are typically pbf

  // Get contour generation options, potentially based on zoom level if thresholds are used
  let tileContourOptions = contourOptions;
  if ("thresholds" in contourOptions && contourOptions.thresholds) { // Check if thresholds exist and are not null/undefined
    tileContourOptions = getOptionsForZoom(contourOptions, z);
  }

  // Ensure the manager and its getTile method are properly set up before calling fetchContourTile
  if (!manager || !manager.fetchContourTile) {
    throw new Error("mlcontour DemManager or fetchContourTile is not initialized correctly.");
  }

  // The mlcontour library expects the tile data via a getTile function provided to the DemManager.
  // This getTile function will be called by fetchContourTile for the source DEM data.
  // We've already configured manager.getTile below.
  return manager
    .fetchContourTile(z, x, y, tileContourOptions, new AbortController())
    .then((result) => { // result from fetchContourTile is MlContourTileAdapterResult
      return new Promise<void>((resolve, reject) => {
        mkdir(dirPath, { recursive: true }, (err) => {
          if (err) {
            console.error(`Error creating directory ${dirPath}: ${err.message}`);
            reject(err);
            return;
          }
          // The result.data is a Blob, which needs to be converted to something writable (like ArrayBuffer)
          // mlcontour typically returns result.arrayBuffer for the contour tile data itself.
          // Let's assume result.arrayBuffer is the pbf data for the CONTOUR tile.
          if (result && result.arrayBuffer) {
            writeFileSync(filePath, Buffer.from(result.arrayBuffer));
            console.log(`Wrote contour tile: ${filePath}`);
            resolve();
          } else {
            console.warn(`No contour tile data generated for ${z}/${x}/${y}`);
            resolve(); // Resolve even if no data, to continue processing other tiles
          }
        });
      });
    })
    .catch((error) => {
      console.error(`Error processing tile ${z}/${x}/${y}: ${error.message || error}`);
      // Decide if you want to throw to stop processing or just log and continue
      // throw error; // Uncomment to stop on first error
    });
}

async function processQueue(
  queue: Tile[],
  batchSize: number = 25,
): Promise<void> {
  for (let i = 0; i < queue.length; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    console.log(
      `Processing batch ${i / batchSize + 1} of ${Math.ceil(queue.length / batchSize)} of tile ${z}/${x}/${y}`,
    );
    await Promise.all(batch.map(processTile));
    console.log(
      `Processed batch ${i / batchSize + 1} of ${Math.ceil(queue.length / batchSize)} of tile ${z}/${x}/${y}`,
    );
  }
}

// --------------------------------------------------
// mlcontour options/defaults
// --------------------------------------------------

const contourOptions = {
  multiplier: 1,
  ...(numIncrement
    ? { levels: [numIncrement] }
    : {
        thresholds: {
          1: [600, 3000],
          4: [300, 1500],
          8: [150, 750],
          9: [80, 400],
          10: [40, 200],
          11: [20, 100],
          12: [10, 50],
          14: [5, 25],
          16: [1, 5],
        },
      }),
  contourLayer: "contours",
  elevationKey: "ele",
  levelKey: "level",
  extent: 4096,
  buffer: 1,
};

// --- Main Script Logic ---

let pmtilesInstance: any | undefined; // PMTiles instance (type is complex and often 'any' in examples)
let mbtilesReader: any | undefined; // To store the MBTiles reader object returned by openMbtiles

const demManagerOptions: any = {
  cacheSize: 100,
  encoding: encoding as Encoding,
  maxzoom: numsourceMaxZoom,
  timeoutMs: 10000,
  decodeImage: GetImageData, // Function to decode DEM tiles
};

// Check which type of DEM source is being used
if (pmtilesTester.test(demUrl)) {
  console.log("Using PMTiles source.");
  const pmtilesPath = demUrl.replace(pmtilesTester, "");
  pmtilesInstance = openPMtiles(pmtilesPath); // Open PMTiles instance

  // Configure how mlcontour's DemManager should fetch tiles.
  // For PMTiles, we can tell it a URL pattern and provide our own getTile function.
  demManagerOptions.demUrlPattern = "/{z}/{x}/{y}"; // A dummy pattern for PMTiles, as getTile handles fetching
  demManagerOptions.getTile = async (url: string, _abortController: AbortController) => {
    if (!pmtilesInstance) {
      throw new Error("PMTiles instance not initialized.");
    }
    const zxy = extractZXYFromUrlTrim(url); // Extract z, x, y from the URL
    if (!zxy) {
      throw new Error(`Could not extract zxy from ${url} for PMTiles`);
    }
    const zxyTile = await getPMtilesTile(pmtilesInstance, zxy.z, zxy.x, zxy.y);
    if (!zxyTile || !zxyTile.data) {
      console.warn(`No tile data returned from PMTiles for ${url}`);
      return undefined; // Return undefined if tile is not found
    }
    // Create a Blob from the tile data. The type is usually inferred or not critical here for DEM.
    const blob = new Blob([zxyTile.data]);
    return { data: blob, expires: undefined, cacheControl: undefined }; // Return in the expected format
  };

} else if (mbtilesTester.test(demUrl)) { // Use the imported mbtilesTester
  console.log("Using MBTiles source.");
  // The demUrl itself is the path for mbtiles
  try {
    // Open the MBTiles file using our new adapter.
    // The openMbtiles function returns an object with getTile and close methods.
    mbtilesReader = await openMbtiles(demUrl);

    // Configure mlcontour's DemManager to use our MBTiles reader.
    // We provide a generic URL pattern, as our getTile function will parse the URL and use the MBTiles reader.
    demManagerOptions.demUrlPattern = "/{z}/{x}/{y}";
    demManagerOptions.getTile = async (url: string, _abortController: AbortController) => {
      const zxy = extractZXYFromUrlTrim(url); // Use our robust ZXY extractor
      if (!zxy) {
        throw new Error(`Could not extract zxy from ${url} for MBTiles`);
      }
      // Call the getTile method from our mbtilesReader, passing the extracted ZXY.
      // This will return the Blob in the correct MIME type.
      return mbtilesReader.getTile(zxy.z, zxy.x, zxy.y);
    };

  } catch (error: any) { // Use 'any' for error type for broader compatibility
    console.error(`Failed to initialize MBTiles reader: ${error.message}`);
    process.exit(1); // Exit if MBTiles can't be opened.
  }

} else {
  // Handle regular tile URL patterns (e.g., "https://example.com/tiles/{z}/{x}/{y}.png")
  console.log("Using regular tile URL source.");
  demManagerOptions.demUrlPattern = demUrl;
  // For regular tile URLs, mlcontour's default fetcher might work if the URL pattern is directly usable.
  // If the pattern requires custom fetching (e.g., authentication), you'd add a custom getTile here similar to PMTiles/MBTiles.
}

// Instantiate the mlcontour DemManager with the configured options
const manager = new mlcontour.LocalDemManager(demManagerOptions);

// Determine all tiles needed for the pyramid, starting from the given tile and going up to outputMaxZoom
const tilesToProcess: Tile[] = getAllTiles([numX, numY, numZ], numoutputMaxZoom);

// Sort tiles for potentially better cache usage or sequential processing order
tilesToProcess.sort((a, b) => {
  if (a[2] !== b[2]) return a[2] - b[2]; // Sort by zoom level (ascending)
  if (a[0] !== b[0]) return a[0] - b[0]; // Sort by x coordinate
  return a[1] - b[1]; // Sort by y coordinate
});

// Process the queue of tiles
processQueue(tilesToProcess)
  .then(() => {
    console.log(`Successfully generated contour tiles for pyramid starting at ${z}/${x}/${y}.`);
  })
  .finally(() => {
    // Clean up resources: close MBTiles connection if it was opened
    if (mbtilesReader && mbtilesReader.close) {
      mbtilesReader.close().then(() => {
        console.log("MBTiles connection closed.");
      }).catch((err: any) => { // Use 'any' for error type
        console.error(`Error closing MBTiles connection: ${err.message || err}`);
      });
    }
    // You might also want to close PMTiles instance if it's kept open
    // if (pmtilesInstance && pmtilesInstance.close) { ... }
  });
