import { Command } from "commander";
import { writeFileSync, mkdir, existsSync } from "fs";
import sharp from "sharp";
import { default as mlcontour } from "../node_modules/maplibre-contour/dist/index.mjs";
import {
  extractZXYFromUrlTrim,
  GetImageData,
  getOptionsForZoom,
  createBlankTileImage,
} from "./mlcontour-adapter";
import { getPMtilesTile, openPMtiles, pmtilesTester } from "./pmtiles-adapter";
// Import MBTiles adapter functions, tester, AND the metadata structure from openMBTiles
import { openMBTiles, getMBTilesTile, mbtilesTester } from "./mbtiles-adapter";

import { getChildren } from "@mapbox/tilebelt";
import path from "path";
import type { Encoding } from "../node_modules/maplibre-contour/dist/types";
import { type PMTiles } from "pmtiles";

type Tile = [number, number, number];

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
    "The URL of the DEM source (e.g., 'pmtiles://...', 'mbtiles://...', or a tile URL pattern like 'http://example.com/{z}/{x}/{y}').",
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
  // --- Blank Tile Options Group ---
  .option(
    "--blankTileNoDataValue <number>",
    "The elevation value to use for blank tiles when a DEM tile is missing.",
    "0", // Default no-data value, adjust as needed
  )
  .option(
    "--blankTileSize <number>",
    "The pixel dimension of the tiles (e.g., 256 or 512).",
    "512", // Default tile size
  )
  .option(
    "--blankTileFormat <string>",
    "The image format for generated blank tiles ('png', 'webp', or 'jpeg'). This is used as a fallback if the source format cannot be determined.",
    "png", // Default format for blank tiles
  )
  .parse(process.argv);

const options = program.opts();
const {
  x,
  y,
  z,
  demUrl,
  encoding,
  blankTileNoDataValue,
  sourceMaxZoom,
  increment,
  outputMaxZoom,
  outputDir,
  blankTileSize,
  blankTileFormat,
} = options;

const numX = Number(x);
const numY = Number(y);
const numZ = Number(z);
const numblankTileNoDataValue = Number(blankTileNoDataValue);
const numsourceMaxZoom = Number(sourceMaxZoom);
const numIncrement = Number(increment);
const numoutputMaxZoom = Number(outputMaxZoom);
const numblankTileSize = Number(blankTileSize);

const validBlankTileFormats = ["png", "webp", "jpeg"];
if (!validBlankTileFormats.includes(blankTileFormat)) {
    console.error(`Invalid value for --blankTileFormat: ${blankTileFormat}. Must be one of: ${validBlankTileFormats.join(', ')}`);
    process.exit(1);
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
// Functions for Tile Pyramid Generation
// --------------------------------------------------

function getAllTiles(tile: Tile, outputMaxZoom: number): Tile[] {
  let allTiles: Tile[] = [tile];

  function getTileList(currentTile: Tile) {
    const children: Tile[] = getChildren(currentTile)
      .filter((child) => child[2] <= outputMaxZoom);

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

// --------------------------------------------------
// Tile Fetching Adapters (Initialization and Fetcher Definitions)
// --------------------------------------------------

let pmtilesSource: PMTiles | undefined;
// mbtilesSource now correctly stores the result of openMBTiles
let mbtilesSource: { handle: any; metadata?: { format?: string } } | undefined;

interface TileFetcherResult {
    data: Blob | undefined;
    mimeType: string | undefined; // MIME type of the fetched/generated data
    expires: undefined;
    cacheControl: undefined;
}

interface TileFetcher {
    (url: string, abortController: AbortController): Promise<TileFetcherResult>;
}

const pmtilesFetcher: TileFetcher = async (url: string, _abortController: AbortController) => {
  if (!pmtilesSource) {
    throw new Error("PMTiles not initialized.");
  }

  const $zxy = extractZXYFromUrlTrim(url);
  if (!$zxy) {
    throw new Error(`Could not extract zxy from ${url}`);
  }

  const { data: zxyTileData, mimeType: pmtilesMimeType } = await getPMtilesTile(pmtilesSource, $zxy.z, $zxy.x, $zxy.y);

  if (!zxyTileData) {
    console.warn(`DEM tile not found for ${url} (z:${$zxy.z}, x:${$zxy.x}, y:${$zxy.y}). Generating blank tile.`);
    const sourceMimeType = pmtilesMimeType || `image/${blankTileFormat}`;
    const formatForBlank = sourceMimeType.split('/')[1] || blankTileFormat;

    const blankTileBuffer = await createBlankTileImage(
      numblankTileSize,
      numblankTileSize,
      numblankTileNoDataValue,
      encoding as Encoding,
      formatForBlank as any
    );
    return { data: new Blob([blankTileBuffer], { type: sourceMimeType }), mimeType: sourceMimeType, expires: undefined, cacheControl: undefined };
  }

  const mimeType = pmtilesMimeType || 'image/png';
  return { data: new Blob([zxyTileData], { type: mimeType }), mimeType: mimeType, expires: undefined, cacheControl: undefined };
};

const mbtilesFetcher: TileFetcher = async (url: string, abortController: AbortController) => {
  if (!mbtilesSource) {
    throw new Error("MBTiles not initialized.");
  }

  const $zxy = extractZXYFromUrlTrim(url);
  if (!$zxy) {
    throw new Error(`Could not extract zxy from ${url}`);
  }

  try {
    const tileData = await getMBTilesTile(mbtilesSource.handle, $zxy.z, $zxy.x, $zxy.y);

    if (!tileData || !tileData.data) {
      console.warn(`DEM tile not found for ${url} (z:${$zxy.z}, x:${$zxy.x}, y:${$zxy.y}). Generating blank tile.`);
      const sourceFormat = mbtilesSource.metadata?.format || blankTileFormat;

      const blankTileBuffer = await createBlankTileImage(
        numblankTileSize,
        numblankTileSize,
        numblankTileNoDataValue,
        encoding as Encoding,
        sourceFormat as any
      );
      const blobType = `image/${sourceFormat}`;
      return { data: new Blob([blankTileBuffer], { type: blobType }), mimeType: blobType, expires: undefined, cacheControl: undefined };
    }

    let blobType = 'image/png'; // Default
    if (tileData.contentType) {
        blobType = tileData.contentType;
    }
    return { data: new Blob([tileData.data], { type: blobType }), mimeType: blobType, expires: undefined, cacheControl: undefined };

  } catch (error: any) {
    if (error.message.includes("Tile does not exist") || error.message.includes("no such row")) {
        console.warn(`DEM tile not found for ${url} (z:${$zxy.z}, x:${$zxy.x}, y:${$zxy.y}). Generating blank tile.`);
        const sourceFormat = mbtilesSource.metadata?.format || blankTileFormat;

        const blankTileBuffer = await createBlankTileImage(
            numblankTileSize,
            numblankTileSize,
            numblankTileNoDataValue,
            encoding as Encoding,
            sourceFormat as any
        );
        const blobType = `image/${sourceFormat}`;
        return { data: new Blob([blankTileBuffer], { type: blobType }), mimeType: blobType, expires: undefined, cacheControl: undefined };
    } else {
        throw error;
    }
  }
};


// --------------------------------------------------
// DEM Manager Setup
// --------------------------------------------------

let currentFetcher: TileFetcher | undefined;
let demUrlPattern: string | undefined;

async function initializeSources() {
  if (pmtilesTester.test(demUrl)) {
    const pmtilesPath = demUrl.replace(pmtilesTester, "");
    pmtilesSource = openPMtiles(pmtilesPath);
    currentFetcher = pmtilesFetcher;
    demUrlPattern = "/{z}/{x}/{y}";
  } else if (mbtilesTester.test(demUrl)) {
    const mbtilesPath = demUrl.replace(mbtilesTester, "");
    if (!existsSync(mbtilesPath)) {
      console.error(`MBTiles file not found at: ${mbtilesPath}`);
      process.exit(1);
    }
    // Await the result of openMBTiles because it's now asynchronous
    mbtilesSource = await openMBTiles(mbtilesPath); // This returns { handle, metadata }
    currentFetcher = mbtilesFetcher;
    demUrlPattern = "/{z}/{x}/{y}";
  } else {
    demUrlPattern = demUrl;
    currentFetcher = undefined;
  }
}

// Call the initialization function and wait for it to complete
await initializeSources();

const demManagerOptions = {
  cacheSize: 100,
  encoding: encoding as Encoding,
  maxzoom: numsourceMaxZoom,
  timeoutMs: 10000,
  decodeImage: GetImageData,
  demUrlPattern: demUrlPattern,
  getTile: currentFetcher,
};

const manager = demUrlPattern ? new mlcontour.LocalDemManager(demManagerOptions) : null;

// --------------------------------------------------
// Tile Processing Function (using the manager)
// --------------------------------------------------

async function processTile(v: Tile): Promise<void> {
  if (!manager) {
      throw new Error("LocalDemManager is not initialized. Check DEM URL.");
  }

  const z: number = v[2];
  const x: number = v[0];
  const y: number = v[1];
  const dirPath: string = path.join(outputDir, `${z}`, `${x}`);
  const filePath: string = path.join(dirPath, `${y}.pbf`);

  if (existsSync(filePath)) {
    return Promise.resolve();
  }

  let tileOptions = contourOptions;
  if ("thresholds" in contourOptions) {
    tileOptions = getOptionsForZoom(contourOptions, z);
  }

  try {
      const tile = await manager.fetchContourTile(z, x, y, tileOptions, new AbortController());
      const tileBuffer = Buffer.from(tile.arrayBuffer);

      await new Promise<void>((resolve, reject) => {
        mkdir(dirPath, { recursive: true }, (err) => {
          if (err) {
            reject(err);
            return;
          }
          writeFileSync(filePath, tileBuffer);
          resolve();
        });
      });
  } catch (error: any) {
      console.error(`Error processing tile ${z}/${x}/${y}: ${error.message}`);
  }
}


async function processQueue(
  queue: Tile[],
  batchSize: number = 25,
): Promise<void> {
  for (let i = 0; i < queue.length; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    console.log(
      `Processing batch ${i / batchSize + 1} of ${Math.ceil(queue.length / batchSize)} for source tile ${z}/${x}/${y}`,
    );
    await Promise.all(batch.map(processTile));
    console.log(
      `Completed batch ${i / batchSize + 1} of ${Math.ceil(queue.length / batchSize)} for source tile ${z}/${x}/${y}`,
    );
  }
}

// --------------------------------------------------
// Main Execution Logic
// --------------------------------------------------

const children: Tile[] = getAllTiles([numX, numY, numZ], numoutputMaxZoom);

children.sort((a, b) => {
  if (a[2] !== b[2]) return a[2] - b[2];
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
});

if (!existsSync(outputDir)) {
  console.log(`Creating output directory: ${outputDir}`);
  mkdir(outputDir, { recursive: true }, (err) => {
    if (err) {
      console.error(`Failed to create output directory ${outputDir}: ${err.message}`);
      process.exit(1);
    }
  });
}

if (manager) {
  processQueue(children).then(() => {
    console.log(`All contour tiles for pyramid originating from ${z}/${x}/${y} have been written!`);
  }).catch(error => {
    console.error(`An error occurred during the tile generation process: ${error.message}`);
    process.exit(1);
  });
} else {
    console.error("Failed to initialize DEM manager. Check DEM URL and ensure it's a supported format (PMTiles, MBTiles, or a tile URL pattern).");
    process.exit(1);
}
