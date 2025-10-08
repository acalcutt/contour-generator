// Add these helper functions for sparse tile support

interface SparseTileResult {
  imageData: ImageData;
  mimeType: string;
}

/**
 * Calculate parent tile coordinates
 */
function getParentTile(z: number, x: number, y: number): { z: number; x: number; y: number } | null {
  if (z === 0) return null;
  return {
    z: z - 1,
    x: Math.floor(x / 2),
    y: Math.floor(y / 2),
  };
}

/**
 * Calculate the offset and scaling needed to extract a child tile from a parent
 */
function getChildTileRegion(
  childZ: number,
  childX: number,
  childY: number,
  parentZ: number,
  tileSize: number
): { offsetX: number; offsetY: number; scale: number } {
  const zoomDiff = childZ - parentZ;
  const tilesPerParent = Math.pow(2, zoomDiff);
  
  // Calculate which quadrant/region of the parent tile contains the child
  const xOffset = childX % tilesPerParent;
  const yOffset = childY % tilesPerParent;
  
  // Size of each child region within the parent
  const regionSize = tileSize / tilesPerParent;
  
  return {
    offsetX: xOffset * regionSize,
    offsetY: yOffset * regionSize,
    scale: tilesPerParent,
  };
}

/**
 * Crop and scale a region from a parent tile to create a child tile
 */
async function cropAndScaleTile(
  parentImageData: ImageData,
  offsetX: number,
  offsetY: number,
  scale: number,
  targetSize: number
): Promise<ImageData> {
  const sourceSize = targetSize / scale;
  
  // Create a canvas for the operation
  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Create temporary canvas for source image
  const sourceCanvas = new OffscreenCanvas(parentImageData.width, parentImageData.height);
  const sourceCtx = sourceCanvas.getContext('2d');
  
  if (!sourceCtx) {
    throw new Error('Failed to get source canvas context');
  }
  
  // Put the parent image data onto the source canvas
  sourceCtx.putImageData(parentImageData, 0, 0);
  
  // Use high-quality scaling (similar to Lanczos/bilinear interpolation)
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Draw the cropped and scaled region
  ctx.drawImage(
    sourceCanvas,
    offsetX, offsetY,           // Source x, y
    sourceSize, sourceSize,     // Source width, height
    0, 0,                       // Destination x, y
    targetSize, targetSize      // Destination width, height
  );
  
  return ctx.getImageData(0, 0, targetSize, targetSize);
}

/**
 * Fetch a sparse tile by looking for parent tiles and upscaling
 */
async function fetchSparseTile(
  z: number,
  x: number,
  y: number,
  tileSize: number,
  fetcher: TileFetcher,
  urlPattern: string,
  verbose: boolean = false
): Promise<SparseTileResult | null> {
  let currentZ = z;
  let currentX = x;
  let currentY = y;
  
  // Try to find a parent tile at progressively lower zoom levels
  while (currentZ >= 0) {
    const parent = getParentTile(currentZ, currentX, currentY);
    if (!parent) break;
    
    currentZ = parent.z;
    currentX = parent.x;
    currentY = parent.y;
    
    // Build URL for parent tile
    const parentUrl = urlPattern
      .replace('{z}', currentZ.toString())
      .replace('{x}', currentX.toString())
      .replace('{y}', currentY.toString());
    
    if (verbose) {
      console.log(
        `[SparseTile] Attempting to fetch parent tile z${currentZ}/${currentX}/${currentY} for child z${z}/${x}/${y}`
      );
    }
    
    try {
      const result = await fetcher(parentUrl, new AbortController());
      
      if (result.data) {
        // Successfully fetched parent tile, now crop and scale it
        if (verbose) {
          console.log(
            `[SparseTile] Found parent tile at z${currentZ}/${currentX}/${currentY}, upscaling to z${z}/${x}/${y}`
          );
        }
        
        // Convert Blob to ImageData
        const bitmap = await createImageBitmap(result.data);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }
        
        ctx.drawImage(bitmap, 0, 0);
        const parentImageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        
        // Calculate crop region
        const region = getChildTileRegion(z, x, y, currentZ, tileSize);
        
        // Crop and scale
        const childImageData = await cropAndScaleTile(
          parentImageData,
          region.offsetX,
          region.offsetY,
          region.scale,
          tileSize
        );
        
        return {
          imageData: childImageData,
          mimeType: result.mimeType || 'image/png',
        };
      }
    } catch (error) {
      // Parent tile not found, continue searching at lower zoom levels
      if (verbose) {
        console.log(`[SparseTile] Parent tile not found at z${currentZ}, trying lower zoom`);
      }
    }
  }
  
  // No parent tile found at any zoom level
  return null;
}

/**
 * Convert ImageData to Blob
 */
async function imageDataToBlob(imageData: ImageData, format: string): Promise<Blob> {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Map format to MIME type
  const mimeTypeMap: { [key: string]: string } = {
    png: 'image/png',
    webp: 'image/webp',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
  };
  
  const mimeType = mimeTypeMap[format] || 'image/png';
  
  return await canvas.convertToBlob({ type: mimeType });
}

export type { SparseTileResult };
export { fetchSparseTile, imageDataToBlob, getParentTile, getChildTileRegion, cropAndScaleTile };