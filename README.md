# Contour Generator

Generates contour tiles in Mapbox Vector Tile (MVT) format from terrain raster-dem data using [maplibre-contour](https://github.com/onthegomap/maplibre-contour). It allows `maplibre-contour` to work with PMTiles (local or HTTP) when the `demUrl` is prefixed with `pmtiles://` and outputs to local MVT tiles.

This script outputs tile files in the ```<outputDir>/z/x/y.pbf``` format and generates a ```<outputDir>/metadata.json``` file. These files can be imported using [mbutil](https://github.com/mapbox/mbutil). For example, to import the tiles into an mbtiles file using mbutil, the syntax would be: ```python3 mb-util --image_format=pbf <outputDir> output.mbtiles```.

# Script Parameters
Generates contour tiles based on specified function and parameters.
```
Docker Usage: docker run -it -v $(pwd):/data wifidb/contour-generator <function> [options]
Local Usage: npm run generate-contours -- <function> [options]

Functions:
  pyramid    generates contours for a parent tile and all child tiles up to a specified max zoom level.
  zoom       generates a list of parent tiles at a specifed zoom level, then runs pyramid on each of them in parallel
  bbox       generates a list of parent tiles that cover a bounding box, then runs pyramid on each of them in parallel

General Options
  --demUrl <string>          The URL of the DEM source. (pmtiles://<http or local file path> or https://<zxyPattern>)
  --encoding <string>        The encoding of the source DEM tiles (e.g., 'terrarium', 'mapbox'). (default: mapbox)
  --sourceMaxZoom <number>   The maximum zoom level of the source DEM. (default: 8)
  --increment <number>       The contour increment value to extract. Use 0 for default thresholds.
  --outputMaxZoom <number>   The maximum zoom level of the output tile pyramid. (default: 8)
  --outputDir <string>       The output directory where tiles will be stored. (default: ./output)
  --processes <number>       The number of parallel processes to use. (default: 8)

Additional Required Options for 'pyramid':
  --x <number>               The X coordinate of the parent tile.
  --y <number>               The Y coordinate of the parent tile.
  --z <number>               The Z coordinate of the parent tile.

Additional Required Options for 'zoom':
  --outputMinZoom <number>   The minimum zoom level of the output tile pyramid. (default: 5)

Additional Required Options for 'bbox':
  --minx <number>            The minimum X coordinate of the bounding box.
  --miny <number>            The minimum Y coordinate of the bounding box.
  --maxx <number>            The maximum X coordinate of the bounding box.
  --maxy <number>            The maximum Y coordinate of the bounding box.
  --outputMinZoom <number>   The minimum zoom level of the output tile pyramid. (default: 5)

  -v|--verbose               Enable verbose output
  -h|--help                  Show this usage statement
```

# Use with Docker
This image is published to Docker Hub as [wifidb/contour-generator](https://hub.docker.com/r/wifidb/contour-generator).

The docker image wifidb/contour-generator can be used for generating tiles in different ways

# Docker Examples:

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

# Install Locally on linux
```
git clone https://github.com/acalcutt/contour-generator.git
cd contour-generator
npm install
```

# Local Examples:

pyramid function (Run Locally w/pmtiles https source):
```
# View Help
 npm run generate-contours -- pyramid --help

# Example
 npm run generate-contours -- pyramid \
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
 npm run generate-contours -- zoom --help

# Downlad the test data into your local directory
 wget https://github.com/acalcutt/contour_generator/releases/download/test_data/JAXA_2024_terrainrgb_z0-Z7_webp.pmtiles

#Example
 npm run generate-contours --  zoom \
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
 npm run generate-contours -- bbox --help

# Example
 npm run generate-contours -- bbox \
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

# Test Data License Information
AWS mapzen terrarium tiles: https://registry.opendata.aws/terrain-tiles/
JAXA AW3D30: https://earth.jaxa.jp/en/data/policy/