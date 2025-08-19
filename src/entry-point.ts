import { Command } from "commander";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { bboxToTiles } from "./bbox_to_tiles";

// --- Types ---
type BaseOptions = {
  demUrl: string;
  encoding: "mapbox" | "terrarium";
  sourceMaxZoom: number;
  increment: number;
  outputMaxZoom: number;
  outputDir: string;
  processes: number;
  verbose: boolean;
  blankTileNoDataValue: number;
  blankTileSize: number;
  blankTileFormat: string;
};

type PyramidOptions = BaseOptions & {
  x: number;
  y: number;
  z: number;
};

type ZoomOptions = BaseOptions & {
  outputMinZoom: number;
};

type BboxOptions = BaseOptions & {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  outputMinZoom: number;
};


// --- Helper Functions ---

/**
 * Helper function to validate encoding
 */
function validateEncoding(
  encoding: string,
): asserts encoding is "mapbox" | "terrarium" {
  if (encoding !== "mapbox" && encoding !== "terrarium") {
    throw new Error(
      `Encoding must be either "mapbox" or "terrarium", got ${encoding}`,
    );
  }
}

/**
 * Function to create metadata.json
 */
async function createMetadata(
  outputDir: string,
  outputMinZoom: number,
  outputMaxZoom: number,
): Promise<void> {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const metadata = {
    name: `Contour_z${outputMinZoom}_Z${outputMaxZoom}`,
    type: "baselayer",
    description: new Date().toISOString(),
    version: "1",
    format: "pbf",
    minzoom: outputMinZoom.toString(),
    maxzoom: outputMaxZoom.toString(),
    json: JSON.stringify({
      vector_layers: [
        {
          id: "contours",
          fields: {
            ele: "Number",
            level: "Number",
          },
          minzoom: outputMinZoom,
          maxzoom: outputMaxZoom,
        },
      ],
    }),
    bounds: "-180.000000,-85.051129,180.000000,85.051129",
  };

  writeFileSync(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
  console.log(`metadata.json has been created in ${outputDir}`);
}

/**
 * Function to process a single tile by spawning a child process.
 */
async function processTile(options: PyramidOptions): Promise<void> {
  if (options.verbose) {
    console.log(
      `[Tile ${options.z}-${options.x}-${options.y}] Starting... outputMaxZoom: ${options.outputMaxZoom}`,
    );
  }

  validateEncoding(options.encoding);

  return new Promise((resolve, reject) => {
    const commandArgs = [
      "run",
      "generate-contour-tile-pyramid",
      "--", // Separator for npm run arguments
      "--x",
      options.x.toString(),
      "--y",
      options.y.toString(),
      "--z",
      options.z.toString(),
      "--demUrl",
      options.demUrl,
      "--encoding",
      options.encoding,
      "--sourceMaxZoom",
      options.sourceMaxZoom.toString(),
      "--increment",
      options.increment.toString(),
      "--outputMaxZoom",
      options.outputMaxZoom.toString(),
      "--outputDir",
      options.outputDir,
      "--blankTileNoDataValue",
      options.blankTileNoDataValue.toString(),
      "--blankTileSize",
      options.blankTileSize.toString(),
      "--blankTileFormat",
      options.blankTileFormat,
    ];

    // Spawn the child process
    const workerProcess = spawn("npm", commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const processPrefix = `[Tile ${options.z}-${options.x}-${options.y}] `;

    // Buffering for verbose output to prevent flooding the console and consuming excessive memory
    let stdoutBuffer = "";
    let stderrBuffer = "";

    workerProcess.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      // Process buffered data line by line if verbose
      if (options.verbose) {
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        lines.forEach(line => console.log(processPrefix + line.trim()));
      }
    });

    workerProcess.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      // Process buffered data line by line if verbose
      if (options.verbose) {
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || '';
        lines.forEach(line => console.error(processPrefix + line.trim()));
      }
    });

    workerProcess.on("close", (code) => {
      // Flush any remaining buffered data if verbose
      if (options.verbose) {
        if (stdoutBuffer) console.log(processPrefix + stdoutBuffer.trim());
        if (stderrBuffer) console.error(processPrefix + stderrBuffer.trim());
      }

      if (code === 0) {
        if (options.verbose) {
          console.log(processPrefix + "Finished successfully.");
        }
        resolve();
      } else {
        // Reject with a more informative error, including stderr content
        reject(new Error(`${processPrefix}Exited with code ${code}. Last stderr: "${stderrBuffer.trim()}"`));
      }
    });

    workerProcess.on("error", (err) => {
      reject(new Error(`${processPrefix}Failed to start process: ${err.message}`));
    });
  });
}

/**
 * Manages a pool of worker processes to execute tasks concurrently,
 * ensuring no more than `maxProcesses` are running at any time.
 * @param coordinates - Array of [z, x, y] tuples representing tiles to process.
 * @param options - Base options to pass to each tile processing job.
 * @param maxProcesses - The maximum number of parallel processes to run.
 */
async function processTilesInParallel(
  coordinates: Array<[number, number, number]>,
  options: BaseOptions,
  maxProcesses: number,
): Promise<void> {
  const totalTiles = coordinates.length;
  if (totalTiles === 0) {
    console.log("[Main] No tiles to process.");
    return;
  }

  let currentIndex = 0;
  let completedCount = 0;
  const activeWorkers: Promise<void>[] = [];

  console.log(`[Main] Starting to process ${totalTiles} tiles with up to ${maxProcesses} parallel processes.`);

  return new Promise((resolve, reject) => {
    const scheduleNextTile = () => {
      // If all tasks are assigned and all active workers have finished, we are done.
      if (currentIndex >= totalTiles && activeWorkers.length === 0) {
        console.log(`[Main] All ${totalTiles} tiles processed.`);
        return resolve();
      }

      // While we have tasks left and the number of active workers is below the limit
      while (currentIndex < totalTiles && activeWorkers.length < maxProcesses) {
        const [z, x, y] = coordinates[currentIndex];
        const tileOptions: PyramidOptions = {
          ...options,
          z,
          x,
          y,
        };

        currentIndex++;

        if (options.verbose) {
          console.log(`[Main] Assigning tile ${z}-${x}-${y} to worker. (${currentIndex}/${totalTiles} assigned)`);
        }

        // Create a promise for this tile's processing
        const tilePromise = processTile(tileOptions)
          .then(() => {
            completedCount++;
            if (options.verbose) {
              console.log(`[Main] Tile ${z}-${x}-${y} completed. (${completedCount}/${totalTiles} done)`);
            }
          })
          .catch((error) => {
            console.error(`[Main] Error processing tile ${z}-${x}-${y}:`, error);
            reject(error);
          })
          .finally(() => {
            // Remove this worker from the active pool
            const index = activeWorkers.indexOf(tilePromise);
            if (index > -1) {
              activeWorkers.splice(index, 1);
            }
            // Try to schedule the next available tile
            scheduleNextTile();
          });

        activeWorkers.push(tilePromise);
      }
    };

    // Start the initial batch of workers
    scheduleNextTile();
  });
}

// --- Command Handlers ---

async function runPyramid(options: Required<PyramidOptions>): Promise<void> {
  await processTile(options);
  await createMetadata(options.outputDir, options.z, options.outputMaxZoom);
}

async function runZoom(options: ZoomOptions): Promise<void> {
  if (options.verbose) {
    console.log(`[Main] Source: ${options.demUrl}`);
    console.log(`[Main] Output Dir: ${options.outputDir}`);
    console.log(`[Main] Zoom Levels: ${options.outputMinZoom} to ${options.outputMaxZoom}`);
    console.log(`[Main] Starting tile generation.`);
  }

  const coordinates: Array<[number, number, number]> = [];
  const tilesInDimension = Math.pow(2, options.outputMinZoom);
  for (let y = 0; y < tilesInDimension; y++) {
    for (let x = 0; x < tilesInDimension; x++) {
      coordinates.push([options.outputMinZoom, x, y]);
    }
  }

  await processTilesInParallel(coordinates, options, options.processes);

  if (options.verbose) {
    console.log(`[Main] Finished processing all tiles at zoom level ${options.outputMinZoom}.`);
  }

  await createMetadata(
    options.outputDir,
    options.outputMinZoom,
    options.outputMaxZoom,
  );
}

async function runBbox(options: BboxOptions): Promise<void> {
  const coordinates = bboxToTiles(
    options.minx,
    options.miny,
    options.maxx,
    options.maxy,
    options.outputMinZoom,
  );

  if (options.verbose) {
    console.log(`[Main] Source: ${options.demUrl}`);
    console.log(`[Main] Output Dir: ${options.outputDir}`);
    console.log(`[Main] Bounding Box: ${options.minx},${options.miny},${options.maxx},${options.maxy}`);
    console.log(`[Main] Starting tile generation.`);
  }

  await processTilesInParallel(coordinates, options, options.processes);

  if (options.verbose) {
    console.log("Main: Finished processing all tiles in bounding box.");
  }

  await createMetadata(
    options.outputDir,
    options.outputMinZoom,
    options.outputMaxZoom,
  );
}

// --- Main Program Setup ---
async function main(): Promise<void> {
  const program = new Command();

  program
    .name("contour-generator")
    .description("Generates contours from DEM tiles.");

  // --- Define common option configurations ---
  const commonOptionConfigs = [
    {
      type: 'required',
      args: ['--demUrl <string>', 'The URL of the DEM source.'],
    },
    {
      type: 'option',
      args: ['--encoding <string>', 'The encoding of the source DEM (e.g., "terrarium", "mapbox").', 'mapbox'],
    },
    {
      type: 'option',
      args: ['--sourceMaxZoom <number>', 'The maximum zoom level of the source DEM.', Number, 8],
    },
    {
      type: 'option',
      args: ['--increment <number>', 'The contour increment value to extract.', Number, 0],
    },
    {
      type: 'option',
      args: ['--outputMaxZoom <number>', 'The maximum zoom level of the output tile pyramid.', Number, 8],
    },
    {
      type: 'option',
      args: ['--outputDir <string>', 'The output directory where tiles will be stored.', './output'],
    },
    {
      type: 'option',
      args: ['--processes <number>', 'The number of parallel processes to use.', Number, 8],
    },
    // --- Blank Tile Options ---
    {
      type: 'option',
      args: ['--blankTileNoDataValue <number>', 'The elevation value to use for blank tiles when a DEM tile is missing.', Number, 0],
    },
    {
      type: 'option',
      args: ['--blankTileSize <number>', 'The pixel dimension of the tiles (e.g., 256 or 512).', Number, 512],
    },
    {
      type: 'option',
      args: ['--blankTileFormat <string>', 'The image format for generated blank tiles (\'png\', \'webp\', or \'jpeg\').', 'png'],
    },
    // --- Verbose Option ---
    {
      type: 'option',
      args: ['-v, --verbose', 'Enable verbose output', false],
    },
  ];

  // --- Pyramid Command ---
  const pyramidCmd = program
    .command("pyramid")
    .description("Generates contours for a specific tile and its children.")
    .requiredOption(
      "--x <number>",
      "The X coordinate of the parent tile.",
      Number,
    )
    .requiredOption(
      "--y <number>",
      "The Y coordinate of the parent tile.",
      Number,
    )
    .requiredOption(
      "--z <number>",
      "The Z coordinate of the parent tile.",
      Number,
    );

  // --- Zoom Command ---
  const zoomCmd = program
    .command("zoom")
    .description(
      "Generates a list of parent tiles at a specified zoom level and runs pyramid on each. This command assumes you have the entire world at the specified zoom levels.",
    )
    .option(
      "--outputMinZoom <number>",
      "The minimum zoom level of the output tile pyramid.",
      Number,
      5,
    );

  // --- Bbox Command ---
  const bboxCmd = program
    .command("bbox")
    .description(
      "Generates a list of parent tiles covering a bounding box and runs pyramid on each.",
    )
    .requiredOption(
      "--minx <number>",
      "The minimum X coordinate of the bounding box.",
      Number,
    )
    .requiredOption(
      "--miny <number>",
      "The minimum Y coordinate of the bounding box.",
      Number,
    )
    .requiredOption(
      "--maxx <number>",
      "The maximum X coordinate of the bounding box.",
      Number,
    )
    .requiredOption(
      "--maxy <number>",
      "The maximum Y coordinate of the bounding box.",
      Number,
    )
    .option(
      "--outputMinZoom <number>",
      "The minimum zoom level of the output tile pyramid.",
      Number,
      5,
    );

  // Helper function to apply options to commands
  const applyCommonOptions = (command: Command.Command, configs: typeof commonOptionConfigs) => {
    for (const config of configs) {
      const { type, args } = config;
      if (type === 'required') {
        command.requiredOption(...args as any);
      } else {
        command.option(...args as any);
      }
    }
  };

  // Apply common options to each command
  applyCommonOptions(pyramidCmd, commonOptionConfigs);
  applyCommonOptions(zoomCmd, commonOptionConfigs);
  applyCommonOptions(bboxCmd, commonOptionConfigs);

  // --- Set up action handlers (after options are defined) ---
  pyramidCmd.action(async (options: PyramidOptions) => {
    await runPyramid(options);
  });

  zoomCmd.action(async (options: ZoomOptions) => {
    await runZoom(options);
  });

  bboxCmd.action(async (options: BboxOptions) => {
    await runBbox(options);
  });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error("An unhandled error occurred:", err);
  process.exit(1);
});
