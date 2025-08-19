import { Command } from "commander";
import { spawn } from "child_process";
import path from "path";
import { writeFileSync } from "fs";
import { bboxToTiles } from "./bbox_to_tiles";

type BaseOptions = {
  demUrl: string;
  encoding: "mapbox" | "terrarium";
  sourceMaxZoom: number;
  increment: number;
  outputMaxZoom: number;
  outputDir: string;
  processes: number;
  verbose: boolean;
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

/**
 * Helper function to validate encoding
 * @param encoding - The encoding to validate
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
 * @param outputDir - The output directory
 * @param outputMinZoom - The minimum zoom level of the output
 * @param outputMaxZoom - The maximum zoom level of the output
 */
async function createMetadata(
  outputDir: string,
  outputMinZoom: number,
  outputMaxZoom: number,
): Promise<void> {
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
 * Function to process a single tile
 * @param options - The options for processing the tile
 * @returns
 */
async function processTile(options: PyramidOptions): Promise<void> {
  if (options.verbose) {
    console.log(
      `Processing tile - Zoom: ${options.z}, X: ${options.x}, Y: ${options.y}, outputMaxZoom: ${options.outputMaxZoom}`,
    );
  }

  validateEncoding(options.encoding);

  return new Promise((resolve, reject) => {
    const process = spawn("npm", [
      "run",
      "generate-contour-tile-pyramid",
      "--",
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
    ]);
    const processPrefix = `Process ${options.z}-${options.x}-${options.y}: `;
    if (options.verbose) {
      process.stdout.on("data", (data) => {
        console.log(processPrefix + data.toString().trim());
      });
      process.stderr.on("data", (data) => {
        console.log(processPrefix + data.toString().trim());
      });
    }

    process.on("close", (code) => {
      if (code === 0) {
        if (options.verbose) {
          console.log(processPrefix + "Finished processing");
        }
        resolve();
      } else {
        reject(new Error(processPrefix + `exited with code ${code}`));
      }
    });
  });
}
/**
 * Function to process tiles in parallel
 * @param coordinates - The coordinates of the tiles to process
 * @param options - The options for processing the tiles
 * @param processes - The number of parallel processes to use
 */
async function processTilesInParallel(
  coordinates: Array<[number, number, number]>,
  options: BaseOptions,
  processes: number,
): Promise<void> {
  const chunks = coordinates.reduce(
    (acc, curr, i) => {
      const chunkIndex = i % processes;
      acc[chunkIndex] = acc[chunkIndex] || [];
      acc[chunkIndex].push(curr);
      return acc;
    },
    [] as Array<Array<[number, number, number]>>,
  );

  await Promise.all(
    chunks.map((chunk) =>
      Promise.all(
        chunk.map(([z, x, y]) =>
          processTile({
            ...options,
            x,
            y,
            z,
          }),
        ),
      ),
    ),
  );
}

async function runPyramid(options: Required<PyramidOptions>): Promise<void> {
  await processTile(options);
  await createMetadata(options.outputDir, options.z, options.outputMaxZoom);
}

async function runZoom(options: ZoomOptions): Promise<void> {
  if (options.verbose) {
    console.log("Source File:", options.demUrl);
    console.log("Output Directory:", options.outputDir);
    console.log("Output Min Zoom:", options.outputMinZoom);
    console.log("Output Max Zoom:", options.outputMaxZoom);
    console.log("Main: [START] Processing tiles.");
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
    console.log(
      `Main: [END] Finished processing all tiles at zoom level ${options.outputMinZoom}.`,
    );
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
    console.log("Source File:", options.demUrl);
    console.log("Output Directory:", options.outputDir);
    console.log(
      "Bounding Box:",
      `${options.minx},${options.miny},${options.maxx},${options.maxy}`,
    );
    console.log("Main: [START] Processing tiles.");
  }

  await processTilesInParallel(coordinates, options, options.processes);

  if (options.verbose) {
    console.log("Main: [END] Finished processing all tiles in bounding box.");
  }

  await createMetadata(
    options.outputDir,
    options.outputMinZoom,
    options.outputMaxZoom,
  );
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("contour-generator")
    .description("Generates contours from DEM tiles.");

  // --- Define common option configurations ---
  const commonOptionConfigs = [
    {
      type: 'required', // Type of method to use (requiredOption or option)
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
    // Apply common options to pyramidCmd

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
      5, // Default value
    );
    // Apply common options to zoomCmd

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
      5, // Default value
    );
    // Apply common options to bboxCmd


  // Helper function to apply options
  const applyCommonOptions = (command: Command.Command, configs: typeof commonOptionConfigs) => {
    for (const config of configs) {
      const { type, args } = config;
      // Spread the arguments onto the appropriate commander method
      if (type === 'required') {
        command.requiredOption(...args as any); // Using 'any' here because TS struggles with spread for methods with varying arg counts for option/requiredOption
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