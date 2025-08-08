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
// Global Variables
// --------------------------------------------------
let pmtilesInstance: any | undefined;
let mbtilesReader: any | undefined;
let manager: mlcontour.LocalDemManager | undefined; // Declare manager in the outer scope

const demManagerOptions: any = {
  cacheSize: 100,
  encoding: encoding as Encoding,
  maxzoom: numsourceMaxZoom,
  timeoutMs: 10000,
  decodeImage: GetImageData,
};

// --------------------------------------------------
// Functions
// --------------------------------------------------

function getAllTiles(tile: Tile, outputMaxZoom: number): Tile[] {
  let allTiles: Tile[] = [tile];

  function getTileList(currentTile: Tile) {
    const children: Tile[] = getChildren(currentTile).filter(
      (child) => child[2] <= outputMaxZoom,
    );
    allTiles = allTiles.concat(children);
    for (const childTile of children) {
      const childZoom = childTile[2];
      if (childZoom < outputMaxZoom) {
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
  const filePath: string = path.join(dirPath, `${y}.pbf`);

  let tileContourOptions = contourOptions;
  if ("thresholds" in contourOptions && contourOptions.thresholds) {
    tileContourOptions = getOptionsForZoom(contourOptions, z);
  }

  // Manager is now accessible here
  if (!manager || !manager.fetchContourTile) {
    throw new Error("mlcontour DemManager or fetchContourTile is not initialized correctly.");
  }

  return manager
    .fetchContourTile(z, x, y, tileContourOptions, new AbortController())
    .then((result) => {
      return new Promise<void>((resolve, reject) => {
        mkdir(dirPath, { recursive: true }, (err) => {
          if (err) {
            console.error(`Error creating directory ${dirPath}: ${err.message}`);
            reject(err);
            return;
          }
          if (result && result.arrayBuffer) {
            writeFileSync(filePath, Buffer.from(result.arrayBuffer));
            console.log(`Wrote contour tile: ${filePath}`);
            resolve();
          } else {
            console.warn(`No contour tile data generated for ${z}/${x}/${y}`);
            resolve();
          }
        });
      });
    })
    .catch((error) => {
      console.error(`Error processing tile ${z}/${x}/${y}: ${error.message || error}`);
    });
}

async function processQueue(
  queue: Tile[],
  batchSize: number = 25,
): Promise<void> {
  const totalTiles = queue.length;
  console.log(`Processing a queue of ${totalTiles} tiles.`);
  for (let i = 0; i < totalTiles; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    const batchNum = i / batchSize + 1;
    const totalBatches = Math.ceil(totalTiles / batchSize);

    console.log(
      `Processing batch ${batchNum} of ${totalBatches}. Starting with tile ${batch[0][2]}/${batch[0][0]}/${batch[0][1]}.`,
    );
    try {
      await Promise.all(batch.map(processTile));
      console.log(
        `Finished batch ${batchNum} of ${totalBatches}.`,
      );
    } catch (error) {
      console.error(`Error processing batch ${batchNum}: ${error}`);
    }
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

// --------------------------------------------------
// Main Execution Flow
// --------------------------------------------------

let sourceDataType: "pmtiles" | "mbtiles" | "url";

if (pmtilesTester.test(demUrl)) {
  sourceDataType = "pmtiles";
  console.log("Detected PMTiles source.");
} else if (mbtilesTester.test(demUrl)) {
  sourceDataType = "mbtiles";
  console.log("Detected MBTiles source.");
} else {
  sourceDataType = "url";
  console.log("Detected regular tile URL source.");
}

// Function to set up the DemManager's getTile function AFTER mbtilesReader is open
const setupDemManagerGetTile = async (
  sourceUrl: string,
  sourceType: "pmtiles" | "mbtiles" | "url"
): Promise<void> => { // This function now returns a Promise<void>
  if (sourceType === "pmtiles") {
    const pmtilesPath = sourceUrl.replace(pmtilesTester, "");
    pmtilesInstance = openPMtiles(pmtilesPath);

    demManagerOptions.demUrlPattern = "/{z}/{x}/{y}"; // Dummy pattern
    demManagerOptions.getTile = async (url: string, _abortController: AbortController) => {
      if (!pmtilesInstance) {
        throw new Error("PMTiles instance not initialized.");
      }
      const zxy = extractZXYFromUrlTrim(url);
      if (!zxy) {
        throw new Error(`Could not extract zxy from ${url} for PMTiles`);
      }
      const zxyTile = await getPMtilesTile(pmtilesInstance, zxy.z, zxy.x, zxy.y);
      if (!zxyTile || !zxyTile.data) {
        console.warn(`No tile data returned from PMTiles for ${url}`);
        return undefined;
      }
      const blob = new Blob([zxyTile.data]);
      return { data: blob, expires: undefined, cacheControl: undefined };
    };
  } else if (sourceType === "mbtiles") {
      mbtilesReader = await openMbtiles(sourceUrl);

      demManagerOptions.demUrlPattern = "/{z}/{x}/{y}";
      demManagerOptions.getTile = async (url: string, _abortController: AbortController) => {
        const zxy = extractZXYFromUrlTrim(url);
        if (!zxy) {
          throw new Error(`Could not extract zxy from ${url} for MBTiles`);
        }
        return mbtilesReader.getTile(zxy.z, zxy.x, zxy.y);
      };
      console.log("MBTiles reader and getTile function configured.");

  } else {
    console.log("Using regular tile URL source.");
    demManagerOptions.demUrlPattern = sourceUrl;
  }
};


// Execute the setup function and then the main processing
setupDemManagerGetTile(demUrl, sourceDataType)
  .then(async () => {
    // Instantiate the mlcontour DemManager HERE, after getTile is configured
    manager = new mlcontour.LocalDemManager(demManagerOptions);

    const tilesToProcess: Tile[] = getAllTiles([numX, numY, numZ], numoutputMaxZoom);

    tilesToProcess.sort((a, b) => {
      if (a[2] !== b[2]) return a[2] - b[2];
      if (a[0] !== b[0]) return a[0] - b[0];
      return a[1] - b[1];
    });

    await processQueue(tilesToProcess);

    console.log(`Successfully generated contour tiles for pyramid starting at ${z}/${x}/${y}.`);
  })
  .catch((error) => {
    console.error(`An error occurred during processing: ${error.message}`);
    process.exit(1);
  })
  .finally(() => {
    if (mbtilesReader && mbtilesReader.close) {
      mbtilesReader.close().then(() => {
        console.log("MBTiles connection closed.");
      }).catch((err: any) => {
        console.error(`Error closing MBTiles connection: ${err.message || err}`);
      });
    }
  });