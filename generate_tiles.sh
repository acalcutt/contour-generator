#!/bin/bash

# Default Values
verbose_default=false
increment_default=0
sourceMaxZoom_default=8
encoding_default="mapbox"
outputMaxZoom_default=8
outputMinZoom_default=5
outputDir_default="./output"
processes_default=8

# Function to output usage information
usage_message() {
	echo "Usage: $0 <function> [options]" >&2
	echo "" >&2
	echo "Functions:" >&2
	echo "  pyramid    generates contours for a parent tile and all child tiles up to a specified max zoom level." >&2
	echo "  zoom       generates a list of parent tiles at a specifed zoom level, then runs pyramid on each of them in parallel" >&2
	echo "  bbox       generates a list of parent tiles that cover a bounding box, then runs pyramid on each of them in parallel" >&2
	echo "" >&2
	echo "General Options" >&2
	echo "  --demUrl <string>          The URL of the DEM source. (pmtiles://<http or local file path> or https://<zxyPattern>)" >&2
	echo "  --encoding <string>        The encoding of the source DEM tiles (e.g., 'terrarium', 'mapbox'). (default: ${encoding_default})" >&2
	echo "  --sourceMaxZoom <number>   The maximum zoom level of the source DEM. (default: ${sourceMaxZoom_default})" >&2
	echo "  --increment <number>       The contour increment value to extract. Use 0 for default thresholds." >&2
	echo "  --outputMaxZoom <number>   The maximum zoom level of the output tile pyramid. (default: ${outputMaxZoom_default})" >&2
	echo "  --outputDir <string>       The output directory where tiles will be stored. (default: ${outputDir_default})" >&2
	echo "  --processes <number>       The number of parallel processes to use. (default: ${processes_default})" >&2
	echo "" >&2
	echo "Additional Required Options for 'pyramid':" >&2
	echo "  --x <number>               The X coordinate of the parent tile." >&2
	echo "  --y <number>               The Y coordinate of the parent tile." >&2
	echo "  --z <number>               The Z coordinate of the parent tile." >&2
	echo "" >&2
	echo "Additional Required Options for 'zoom':" >&2
	echo "  --outputMinZoom <number>   The minimum zoom level of the output tile pyramid. (default: ${outputMinZoom_default})" >&2
	echo "" >&2
	echo "Additional Required Options for 'bbox':" >&2
	echo "  --minx <number>            The minimum X coordinate of the bounding box." >&2
	echo "  --miny <number>            The minimum Y coordinate of the bounding box." >&2
	echo "  --maxx <number>            The maximum X coordinate of the bounding box." >&2
	echo "  --maxy <number>            The maximum Y coordinate of the bounding box." >&2
	echo "  --outputMinZoom <number>   The minimum zoom level of the output tile pyramid. (default: ${outputMinZoom_default})" >&2
	echo "" >&2
	echo "  -v|--verbose               Enable verbose output" >&2
	echo "  -h|--help                  Show this usage statement" >&2
	echo "" >&2
}

# Function to parse command line arguments for the 'pyramid' function
parse_args_function_pyramid() {
	local verbose="${verbose_default}"
	local x=""
	local y=""
	local z=""
	local demUrl=""
	local encoding="${encoding_default}"
	local sourceMaxZoom="${sourceMaxZoom_default}"
	local increment=""
	local outputMaxZoom="${outputMaxZoom_default}"
	local outputDir="${outputDir_default}"
	local processes="${processes_default}"

	while [[ $# -gt 0 ]]; do
		case "$1" in
			--x)              x="$2"; shift 2 ;;
			--y)              y="$2"; shift 2 ;;
			--z)              z="$2"; shift 2 ;;
			--demUrl)         demUrl="$2"; shift 2 ;;
			--encoding)       encoding="$2"; shift 2 ;;
			--sourceMaxZoom)  sourceMaxZoom="$2"; shift 2 ;;
			--increment)      increment="$2"; shift 2 ;;
			--outputMaxZoom)  outputMaxZoom="$2"; shift 2 ;;
			--outputDir)      outputDir="$2"; shift 2 ;;
			--processes)      processes="$2"; shift 2 ;;
			-v | --verbose)   verbose=true; shift ;;
			-h | --help)      usage_message; exit 1 ;;
			*)
				echo "Unknown option: $1" >&2
				usage_message
				exit 1
				;;
		esac
	done

	# Check if all required values are provided
	if [[ -z "${x}" || -z "${y}" || -z "${z}" || -z "${demUrl}" || -z "${increment}" ]]; then
		usage_message
		echo "Error: --x, --y, --z, --demUrl, and --increment are required for function pyramid." >&2
		exit 1
	fi

	# check for valid encoding
	if [[ "${encoding}" != "mapbox" && "${encoding}" != "terrarium" ]]; then
		usage_message
		echo "Error: --encoding must be either 'mapbox' or 'terrarium'." >&2
		exit 1 # Return non-zero on error
	fi

	echo "${x} ${y} ${z} ${demUrl} ${encoding} ${sourceMaxZoom} ${increment} ${outputMaxZoom} ${outputDir} ${verbose} ${processes}"
	return 0
}

# Function to parse command line arguments for the 'zoom' function
parse_args_function_zoom() {
	local demUrl=""
	local encoding="${encoding_default}"
	local sourceMaxZoom="${sourceMaxZoom_default}"
	local increment="${increment_default}"
	local outputMinZoom="${outputMinZoom_default}"
	local outputMaxZoom="${outputMaxZoom_default}"
	local outputDir="${outputDir_default}"
	local processes="${processes_default}"
	local verbose="${verbose_default}"

	while [[ $# -gt 0 ]]; do
		case "$1" in
			--demUrl)         demUrl="$2"; shift 2 ;;
			--encoding)       encoding="$2"; shift 2 ;;
			--sourceMaxZoom)  sourceMaxZoom="$2"; shift 2 ;;
			--increment)      increment="$2"; shift 2 ;;
			--outputMinZoom)  outputMinZoom="$2"; shift 2 ;;
			--outputMaxZoom)  outputMaxZoom="$2"; shift 2 ;;
			--outputDir)      outputDir="$2"; shift 2 ;;
			--processes)      processes="$2"; shift 2 ;;
			-v | --verbose)   verbose=true; shift ;;
			-h | --help)      usage_message; exit 1 ;; # Show usage and exit
			*)
				echo "Unknown option: $1" >&2
				usage_message
				exit 1
				;; # Return non-zero on error
		esac
	done

	# Check if demUrl is provided
	if [[ -z "${demUrl}" ]]; then
		usage_message
		echo "Error: --demUrl is required." >&2
		exit 1 # Return non-zero on error
	fi

	# Check if encoding is valid
	if [[ "${encoding}" != "mapbox" && "${encoding}" != "terrarium" ]]; then
		usage_message
		echo "Error: --encoding must be either 'mapbox' or 'terrarium'." >&2
		exit 1 # Return non-zero on error
	fi

	# Return the values as a single string
	echo "${outputMinZoom} ${demUrl} ${outputDir} ${increment} ${sourceMaxZoom} ${encoding} ${outputMaxZoom} ${verbose} ${processes}"
	return 0 # return zero for success
}

# Function to parse command line arguments for the 'bbox' function
parse_args_function_bbox() {
	local minx=""
	local miny=""
	local maxx=""
	local maxy=""
	local demUrl=""
	local encoding="${encoding_default}"
	local sourceMaxZoom="${sourceMaxZoom_default}"
	local increment="${increment_default}"
	local outputMinZoom="${outputMinZoom_default}"
	local outputMaxZoom="${outputMaxZoom_default}"
	local outputDir="${outputDir_default}"
	local verbose="${verbose_default}"
	local processes="${processes_default}"

	while [[ $# -gt 0 ]]; do
			case "$1" in
			--minx)           minx="$2"; shift 2 ;;
			--miny)           miny="$2"; shift 2 ;;
			--maxx)           maxx="$2"; shift 2 ;;
			--maxy)           maxy="$2"; shift 2 ;;
			--demUrl)         demUrl="$2"; shift 2 ;;
			--encoding)       encoding="$2"; shift 2 ;;
			--sourceMaxZoom)  sourceMaxZoom="$2"; shift 2 ;;
			--increment)      increment="$2"; shift 2 ;;
			--outputMinZoom)  outputMinZoom="$2"; shift 2 ;;
			--outputMaxZoom)  outputMaxZoom="$2"; shift 2 ;;
			--outputDir)      outputDir="$2"; shift 2 ;;
			--processes)      processes="$2"; shift 2 ;;
			-h | --help)      usage_message; exit 1 ;; # Show usage and exit
			-v | --verbose)   verbose=true; shift ;;
			*)
				echo "Unknown option: $1" >&2
				usage_message
				exit 1
				;; # Return non-zero on error
		esac
	done

	if [[ -z "${minx}" || -z "${miny}" || -z "${maxx}" || -z "${maxy}" || -z "${demUrl}" ]]; then
		echo "Error: --minx, --miny, --maxx, --maxy, and --demUrl are required for function bbox." >&2
		usage_message
		exit 1
	fi

	# Check if encoding is valid
	if [[ "${encoding}" != "mapbox" && "${encoding}" != "terrarium" ]]; then
		usage_message
		echo "Error: --encoding must be either 'mapbox' or 'terrarium'." >&2
		exit 1 # Return non-zero on error
	fi

	# Return the values as a single string
	echo "${outputMinZoom} ${demUrl} ${outputDir} ${increment} ${sourceMaxZoom} ${encoding} ${outputMaxZoom} ${verbose} ${processes} ${minx} ${miny} ${maxx} ${maxy}"
	return 0 # return zero for success
}

# Function to generate all tiles at and above a zoom level
process_tile() {
	local programOptions="$0"
	local zoom_level="$1"
	local x_coord="$2"
	local y_coord="$3"

	read -r outputMinZoom demUrl outputDir increment sourceMaxZoom encoding outputMaxZoom verbose processes <<<"${programOptions}"

	if [[ "${verbose}" = "true" ]]; then
		echo "process_tile: [START] Processing tile - Zoom: ${zoom_level}, X: ${x_coord}, Y: ${y_coord}, outputMaxZoom: ${outputMaxZoom}"
	fi

	npx tsx ./src/generate-contour-tile-pyramid.ts \
		--x "${x_coord}" \
		--y "${y_coord}" \
		--z "${zoom_level}" \
		--demUrl "${demUrl}" \
		--encoding "${encoding}" \
		--sourceMaxZoom "${sourceMaxZoom}" \
		--increment "${increment}" \
		--outputMaxZoom "${outputMaxZoom}" \
		--outputDir "${outputDir}"

	if [[ "${verbose}" = "true" ]]; then
		echo "process_tile: [END] Finished processing ${zoom_level}-${x_coord}-${y_coord}"
	fi
}
export -f process_tile

# Function to generate tile coordinates and output them as a single space delimited string variable.
generate_tile_coordinates() {
	local zoom_level="$1"
	local tiles_in_dimension
	tiles_in_dimension=$(echo "2^${zoom_level}" | bc)

	local output=""

	for ((y = 0; y < tiles_in_dimension; y++)); do
		for ((x = 0; x < tiles_in_dimension; x++)); do
			output+="${zoom_level} ${x} ${y} "
		done
	done

	echo -n "${output}"
	return
}

# Function to convert a bounding box to tile coordinates
bbox_to_tiles() {
	local minx="$1"
	local miny="$2"
	local maxx="$3"
	local maxy="$4"
	local zoom="$5"

	local tiles
	tiles=$(npx tsx ./src/bbox_to_tiles.js "${minx}" "${miny}" "${maxx}" "${maxy}" "${zoom}")
	echo "${tiles}"
}
export -f bbox_to_tiles

# Function to run the 'pyramid' command.
run_function_pyramid() {
	local programOptions="$1"
	read -r x y z demUrl encoding sourceMaxZoom increment outputMaxZoom outputDir verbose processes <<<"${programOptions}"

	if [[ "${verbose}" = "true" ]]; then
		echo "process_tile: [START] Processing tile - Zoom: ${z}, X: ${x}, Y: ${y}, outputMaxZoom: ${outputMaxZoom}"
	fi

	npx tsx ./src/generate-coutour-tile-pyramid.ts --x "${x}" --y "${y}" --z "${z}" --demUrl "${demUrl}" --encoding "${encoding}" --sourceMaxZoom "${sourceMaxZoom}" --increment "${increment}" --outputMaxZoom "${outputMaxZoom}" --outputDir "${outputDir}"

	if [[ "${verbose}" = "true" ]]; then
		echo "process_tile: [END] Finished processing ${z}-${x}-${y}"
	fi

	create_metadata "${outputDir}" "${z}" "${outputMaxZoom}"
}

# Function to run the 'zoom' command.
run_function_zoom() {
	local programOptions="$1"
	read -r outputMinZoom demUrl outputDir increment sourceMaxZoom encoding outputMaxZoom verbose processes <<<"${programOptions}"

	echo "Source File: ${demUrl}"
	echo "Source Max Zoom: ${sourceMaxZoom}"
	echo "Source Encoding: ${encoding}"
	echo "Output Directory: ${outputDir}"
	echo "Output Min Zoom: ${outputMinZoom}"
	echo "Output Max Zoom: ${outputMaxZoom}"
	echo "Contour Increment: ${increment}"
	echo "Main: [START] Processing tiles."

	# Capture the return value using a pipe.
	tile_coords_str=$(generate_tile_coordinates "${outputMinZoom}")

	if [[ $? -eq 0 ]]; then
		if [[ "${verbose}" = "true" ]]; then
			echo "Main: [INFO] Starting tile processing for zoom level ${outputMinZoom}"
		fi
		#Ensure xargs only runs if it doesn't receive a signal
		trap_return() {
			if [[ $? -ne 0 ]]; then
				echo "Exiting..." >&2
				exit 1
			fi
		}
		trap trap_return INT TERM
		echo "${tile_coords_str}" | xargs -P "${processes}" -n 3 bash -c 'process_tile "$1" "$2" "$3"' "${programOptions}"
		if [[ "${verbose}" = "true" ]]; then
			echo "Main: [INFO] Finished tile processing for zoom level ${outputMinZoom}"
		fi
	else
		echo "Error generating tiles" >&2
		exit 1
	fi

	echo "Main: [END] Finished processing all tiles at zoom level ${outputMinZoom}."
	create_metadata "${outputDir}" "${outputMinZoom}" "${outputMaxZoom}"
}

# Function to run the 'bbox' command.
run_function_bbox() {
	local programOptions="$1"
	read outputMinZoom demUrl outputDir increment sourceMaxZoom encoding outputMaxZoom verbose processes minx miny maxx maxy <<<"${programOptions}"

	echo "Source File: ${demUrl}"
	echo "Source Max Zoom: ${sourceMaxZoom}"
	echo "Source Encoding: ${encoding}"
	echo "Output Directory: ${outputDir}"
	echo "Output Min Zoom: ${outputMinZoom}"
	echo "Output Max Zoom: ${outputMaxZoom}"
	echo "Contour Increment: ${increment}"
	echo "Main: [START] Processing tiles."

	tile_coords_str=$(bbox_to_tiles "${minx}" "${miny}" "${maxx}" "${maxy}" "${outputMinZoom}")

	if [[ $? -eq 0 ]]; then
		if [[ "${verbose}" = "true" ]]; then
			echo "Main: [INFO] Starting tile processing for bounding box"
		fi
		#Ensure xargs only runs if it doesn't receive a signal
		trap_return() {
			if [[ $? -ne 0 ]]; then
				echo "Exiting..." >&2
				exit 1
			fi
		}
		trap trap_return INT TERM
		echo "${tile_coords_str}" | xargs -P "${processes}" -n 3 bash -c 'process_tile "$1" "$2" "$3"' "${programOptions}"
		if [[ "${verbose}" = "true" ]]; then
			echo "Main: [INFO] Finished tile processing for bounding box"
		fi
	else
		echo "Error generating tiles" >&2
		exit 1
	fi

	echo "Main: [END] Finished processing all tiles in bounding box."
	create_metadata "${outputDir}" "${outputMinZoom}" "${outputMaxZoom}"
}

# Function to create the metadata.json file
create_metadata() {
	local outputDir="$1"
	local outputMinZoom="$2"
	local outputMaxZoom="$3"

	local metadata_file="${outputDir}/metadata.json"
	local metadata_name="Contour_z${outputMinZoom}_Z${outputMaxZoom}"
	local description
	description=$(date +"%Y-%m-%d %H:%M:%S")

	local json_content='{
	"name": "'"${metadata_name}"'",
	"type": "baselayer",
	"description": "'"${description}"'",
	"version": "1",
	"format": "pbf",
	"minzoom": "'"${outputMinZoom}"'",
	"maxzoom": "'"${outputMaxZoom}"'",
	"json": "{\"vector_layers\":[{\"id\":\"contours\",\"fields\":{\"ele\":\"Number\",\"level\":\"Number\"},\"minzoom\":'"${outputMinZoom}"',\"maxzoom\":'"${outputMaxZoom}"'}]}",
	"bounds": "-180.000000,-85.051129,180.000000,85.051129"
}'

	echo "${json_content}" >"${metadata_file}"
	echo "metadata.json has been created in ${outputDir}"
}
export -f create_metadata

# --- Main Script ---
if [[ $# -eq 0 ]]; then
	usage_message
	exit 1
fi

function="$1"
shift

# Trap SIGINT and SIGTERM signals
trap 'kill $(jobs -p); exit 1' INT TERM

case "${function}" in
"pyramid")
	programOptions=$(parse_args_function_pyramid "$@")
	ret="$?" # capture exit status
	if [[ "${ret}" -ne 0 ]]; then
		# Error message will already be handled above
		exit "${ret}"
	fi
	run_function_pyramid "${programOptions}"
	;;
"zoom")
	programOptions=$(parse_args_function_zoom "$@")
	ret="$?" # capture exit status
	if [[ "${ret}" -ne 0 ]]; then
		# Error message will already be handled above
		exit "${ret}"
	fi
	run_function_zoom "${programOptions}"
	;;
"bbox")
	programOptions=$(parse_args_function_bbox "$@")
	ret="$?" # capture exit status
	if [[ "${ret}" -ne 0 ]]; then
		# Error message will already be handled above
		exit "${ret}"
	fi
	run_function_bbox "${programOptions}"
	;;
*)
	echo "Invalid function: ${function}" >&2
	usage_message
	exit 1
	;;
esac
