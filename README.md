# Contour Generator

This tool generates contour lines from terrain raster-dem and outputs them as Mapbox Vector Tiles (MVT). It uses [maplibre-contour](https://github.com/onthegomap/maplibre-contour) and supports various raster-dem sources, including PMTiles (local or HTTP), MBTiles (local) when the `demUrl` is prefixed accordingly. The output is a set of MVT tiles in a standard `z/x/y.pbf` directory structure, along with a `metadata.json` file. These tiles can be easily imported into an MBTiles file using tools like `mbutil` (e.g., `mb-util --image_format=pbf <outputDir> output.mbtiles`).

# Installation and Usage

You can install and use `contour-generator` in several ways:

*   **Globally via npm:** This is the most convenient way to use the command-line interface directly.
    ```bash
    npm install -g contour-generator
    ```
    Once installed globally, you can execute the command as:
    ```bash
    contour-generator <function> [options]
    ```

*   **Locally from source:** If you have cloned the repository or downloaded the source.
    ```bash
    git clone https://github.com/acalcutt/contour-generator.git
    cd contour-generator
    npm install
    ```
    After installation, you can run the script using:
    ```bash
    node . <function> [options]
    ```

*   **Via Docker:** For isolated execution without local dependencies.
    ```bash
    docker run --rm -v $(pwd):/data wifidb/contour-generator <function> [options]
    ```

# Script Parameters

Generates contour tiles based on specified function and parameters.

## Functions:

*   `pyramid`: Generates contours for a parent tile and all child tiles up to a specified max zoom level.
*   `zoom`: Generates a list of parent tiles at a specified zoom level, then runs pyramid on each of them in parallel.
*   `bbox`: Generates a list of parent tiles that cover a bounding box, then runs pyramid on each of them in parallel.

## General Options

*   `--demUrl <string>`: The URL of the DEM source (e.g., `pmtiles://<http or local file path>`, `mbtiles://<local file path>`, or a tile URL pattern like `https://<zxyPattern>`).
*   `--encoding <string>`: The encoding of the source DEM tiles (e.g., `'terrarium'`, `'mapbox'`). (default: `mapbox`)
*   `--sourceMaxZoom <number>`: The maximum zoom level of the source DEM. (default: `8`)
*   `--increment <number>`: The contour increment value to extract. Use `0` for default thresholds.
*   `--outputMaxZoom <number>`: The maximum zoom level of the output tile pyramid. (default: `8`)
*   `--outputDir <string>`: The output directory where tiles will be stored. (default: `./output`)
*   `--processes <number>`: The number of parallel processes to use. (default: `8`)
*   `--blankTileNoDataValue <number>`: The elevation value to use for blank tiles when a DEM tile is missing. (default: `0`)
*   `--blankTileSize <number>`: The pixel dimension of the tiles (e.g., 256 or 512). (default: `512`)
*   `--blankTileFormat <string>`: The image format for generated blank tiles (`'png'`, `'webp'`, or `'jpeg'`). This is used as a fallback if the source format cannot be determined. (default: `png`)
*   `-v, --verbose`: Enable verbose output.
*   `-h, --help`: Show this usage statement.

## Function-Specific Options

### For `pyramid`:

*   `--x <number>`: The X coordinate of the parent tile. (Required)
*   `--y <number>`: The Y coordinate of the parent tile. (Required)
*   `--z <number>`: The Z coordinate of the parent tile. (Required)

### For `zoom`:

*   `--outputMinZoom <number>`: The minimum zoom level of the output tile pyramid. (default: `5`)

### For `bbox`:

*   `--minx <number>`: The minimum X coordinate of the bounding box. (Required)
*   `--miny <number>`: The minimum Y coordinate of the bounding box. (Required)
*   `--maxx <number>`: The maximum X coordinate of the bounding box. (Required)
*   `--maxy <number>`: The maximum Y coordinate of the bounding box. (Required)
*   `--outputMinZoom <number>`: The minimum zoom level of the output tile pyramid. (default: `5`)

# Install globally via npm
```
npm install -g contour-generator
```

# Global npm Examples:

pyramid function (Run Locally w/pmtiles https source):
```
# View Help
 contour-generator pyramid --help

# Example
 contour-generator pyramid \
  --z 9 \
  --x 272 \
  --y 179 \
  --demUrl "pmtiles://https://acalcutt.github.io/contour_generator/test_data/terrain-tiles.pmtiles" \
  --sourceMaxZoom 12 \
  --encoding mapbox \
  --increment 0 \
  --outputDir "./output_pyramid" \
  --outputMaxZoom 15 \
  -v

  #Test View Area #9/47.2542/11.5426
```

zoom function (Run Locally w/pmtiles local source):
```
# View Help
 contour-generator zoom --help

# Downlad the test data into your local directory
 wget https://github.com/acalcutt/contour_generator/releases/download/test_data/JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles

#Example
 contour-generator  zoom \
  --demUrl "pmtiles://./JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles" \
  --outputDir "./output_zoom" \
  --sourceMaxZoom 7 \
  --encoding mapbox \
  --outputMinZoom 5 \
  --outputMaxZoom 7 \
  --increment 100 \
  --processes 8 \
  -v

  # Test View Area #5/47.25/11.54 
  # Note: some "No tile returned for" messages are normal with this JAXA dataset since there are areas without tiles
```

bbox function (Run Locally w/zxyPattern source):
```
# View Help
 contour-generator bbox --help

# Example
 contour-generator bbox \
  --minx -73.51 \
  --miny 41.23 \
  --maxx -69.93 \
  --maxy 42.88 \
  --demUrl "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png" \
  --sourceMaxZoom 15 \
  --encoding terrarium \
  --increment 50 \
  --outputMinZoom 5 \
  --outputMaxZoom 10 \
  --outputDir "./output_bbox" \
  -v

  # Test View Area #5/44.96/-73.35
```

# Install Locally from git
```
git clone https://github.com/acalcutt/contour-generator.git
cd contour-generator
npm install
```

# Local Examples:

pyramid function (Run Locally w/pmtiles https source):
```
# View Help
 node . pyramid --help

# Example
 node . pyramid \
  --z 9 \
  --x 272 \
  --y 179 \
  --demUrl "pmtiles://https://acalcutt.github.io/contour_generator/test_data/terrain-tiles.pmtiles" \
  --sourceMaxZoom 12 \
  --encoding mapbox \
  --increment 0 \
  --outputDir "./output_pyramid" \
  --outputMaxZoom 15 \
  -v

  #Test View Area #9/47.2542/11.5426
```

zoom function (Run Locally w/pmtiles local source):
```
# View Help
 node . zoom --help

# Downlad the test data into your local directory
 wget https://github.com/acalcutt/contour_generator/releases/download/test_data/JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles

#Example
 node .  zoom \
  --demUrl "pmtiles://./JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles" \
  --outputDir "./output_zoom" \
  --sourceMaxZoom 7 \
  --encoding mapbox \
  --outputMinZoom 5 \
  --outputMaxZoom 7 \
  --increment 100 \
  --processes 8 \
  -v

  # Test View Area #5/47.25/11.54 
  # Note: some "No tile returned for" messages are normal with this JAXA dataset since there are areas without tiles
```

bbox function (Run Locally w/zxyPattern source):
```
# View Help
 node . bbox --help

# Example
 node . bbox \
  --minx -73.51 \
  --miny 41.23 \
  --maxx -69.93 \
  --maxy 42.88 \
  --demUrl "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png" \
  --sourceMaxZoom 15 \
  --encoding terrarium \
  --increment 50 \
  --outputMinZoom 5 \
  --outputMaxZoom 10 \
  --outputDir "./output_bbox" \
  -v

  # Test View Area #5/44.96/-73.35
```

# Use with Docker

This image is published to Docker Hub as [wifidb/contour-generator](https://hub.docker.com/r/wifidb/contour-generator).

The docker image wifidb/contour-generator can be used for generating tiles in different ways.

## Docker Examples:

pyramid function (using Docker w/pmtiles https source):
```
# View Help
 docker run -it -v $(pwd):/data wifidb/contour-generator pyramid --help

# Example
 docker run -it -v $(pwd):/data wifidb/contour-generator \
    pyramid \
    --z 9 \
    --x 272 \
    --y 179 \
    --demUrl "pmtiles://https://acalcutt.github.io/contour_generator/test_data/terrain-tiles.pmtiles" \
    --sourceMaxZoom 12 \
    --encoding mapbox \
    --increment 0 \
    --outputDir "/data/output_pyramid" \
    --outputMaxZoom 15 \
    -v
  
  # Test View Area #9/47.2542/11.5426
```

zoom function (using Docker w/pmtiles local source):
```
# View Help
 docker run -it -v $(pwd):/data wifidb/contour-generator zoom --help

# Downlad example test data into your local directory
 wget https://github.com/acalcutt/contour_generator/releases/download/test_data/JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles

# Example
 docker run -it -v $(pwd):/data wifidb/contour-generator \
    zoom \
    --demUrl "pmtiles:///data/JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles" \
    --outputDir "/data/output_zoom" \
    --sourceMaxZoom 7 \
    --encoding mapbox \
    --outputMinZoom 5 \
    --outputMaxZoom 7 \
    --increment 100 \
    --processes 8 \
    --blankTileNoDataValue 0 \
    --blankTileSize 512 \
    --blankTileFormat webp \
    -v
  
  # Test View Area #5/47.25/11.54
  # Note: some "No tile returned for" messages are normal with this JAXA dataset since there are areas without tiles
```

bbox function (using Docker w/zxyPattern source):
```
# View Help
 docker run -it -v $(pwd):/data wifidb/contour-generator bbox --help

# Example
 docker run -it -v $(pwd):/data wifidb/contour-generator \
    bbox \
    --minx -73.51 \
    --miny 41.23 \
    --maxx -69.93 \
    --maxy 42.88 \
    --demUrl "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png" \
    --sourceMaxZoom 15 \
    --encoding terrarium \
    --increment 50 \
    --outputMinZoom 5 \
    --outputMaxZoom 10 \
    --outputDir "/data/output_bbox" \
    -v

  # Test View Area #5/44.96/-73.35
```

Important Notes:

The -v ```$(pwd):/data``` part of the docker run command maps your local working directory ```$(pwd)``` to ```/data``` inside the Docker container. Therefore, your DEM file must be located in the ```/data``` directory inside of the docker image, and the output directory must also be in the ```/data``` directory.

# Test Data License Information
AWS mapzen terrarium tiles: https://registry.opendata.aws/terrain-tiles/
JAXA AW3D30: https://earth.jaxa.jp/en/data/policy/