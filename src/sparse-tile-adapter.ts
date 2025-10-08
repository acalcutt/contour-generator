// Add these helper functions for sparse tile support

interface SparseTileResult {
  imageData: ImageData;
  mimeType: string;
}

type ResamplingMethod = 'nearest' | 'bilinear' | 'bicubic';

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
 * Cubic interpolation kernel (Catmull-Rom / bicubic)
 */
function cubicKernel(x: number): number {
  const absX = Math.abs(x);
  if (absX <= 1) {
    return 1.5 * absX * absX * absX - 2.5 * absX * absX + 1;
  } else if (absX < 2) {
    return -0.5 * absX * absX * absX + 2.5 * absX * absX - 4 * absX + 2;
  }
  return 0;
}

/**
 * Bicubic interpolation for a single pixel
 */
function bicubicInterpolate(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const dx = x - xi;
  const dy = y - yi;
  
  let value = 0;
  
  // 4x4 kernel
  for (let m = -1; m <= 2; m++) {
    for (let n = -1; n <= 2; n++) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, xi + n));
      const sy = Math.max(0, Math.min(sourceHeight - 1, yi + m));
      const idx = (sy * sourceWidth + sx) * 4 + channel;
      const pixel = sourceData[idx];
      
      value += pixel * cubicKernel(n - dx) * cubicKernel(m - dy);
    }
  }
  
  return Math.max(0, Math.min(255, value));
}

/**
 * Bilinear interpolation for a single pixel
 */
function bilinearInterpolate(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
): number {
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const x2 = Math.min(x1 + 1, sourceWidth - 1);
  const y2 = Math.min(y1 + 1, sourceHeight - 1);
  
  const dx = x - x1;
  const dy = y - y1;
  
  const idx11 = (y1 * sourceWidth + x1) * 4 + channel;
  const idx21 = (y1 * sourceWidth + x2) * 4 + channel;
  const idx12 = (y2 * sourceWidth + x1) * 4 + channel;
  const idx22 = (y2 * sourceWidth + x2) * 4 + channel;
  
  const v11 = sourceData[idx11];
  const v21 = sourceData[idx21];
  const v12 = sourceData[idx12];
  const v22 = sourceData[idx22];
  
  const v1 = v11 * (1 - dx) + v21 * dx;
  const v2 = v12 * (1 - dx) + v22 * dx;
  
  return v1 * (1 - dy) + v2 * dy;
}

/**
 * Nearest neighbor interpolation
 */
function nearestInterpolate(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  const sx = Math.max(0, Math.min(sourceWidth - 1, xi));
  const sy = Math.max(0, Math.min(sourceHeight - 1, yi));
  const idx = (sy * sourceWidth + sx) * 4 + channel;
  return sourceData[idx];
}

/**
 * Crop and scale a region from a parent tile to create a child tile with custom resampling
 */
async function cropAndScaleTile(
  parentImageData: ImageData,
  offsetX: number,
  offsetY: number,
  scale: number,
  targetSize: number,
  resamplingMethod: ResamplingMethod = 'bicubic'
): Promise<ImageData> {
  const sourceSize = targetSize / scale;
  
  // For canvas-based resampling (fastest but lower quality)
  if (resamplingMethod === 'nearest' && scale <= 2) {
    const canvas = new OffscreenCanvas(targetSize, targetSize);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    
    const sourceCanvas = new OffscreenCanvas(parentImageData.width, parentImageData.height);
    const sourceCtx = sourceCanvas.getContext('2d');
    
    if (!sourceCtx) {
      throw new Error('Failed to get source canvas context');
    }
    
    sourceCtx.putImageData(parentImageData, 0, 0);
    
    ctx.imageSmoothingEnabled = false;
    
    ctx.drawImage(
      sourceCanvas,
      offsetX, offsetY,
      sourceSize, sourceSize,
      0, 0,
      targetSize, targetSize
    );
    
    return ctx.getImageData(0, 0, targetSize, targetSize);
  }
  
  // Custom interpolation implementation
  const sourceData = parentImageData.data;
  const sourceWidth = parentImageData.width;
  const sourceHeight = parentImageData.height;
  
  const outputData = new Uint8ClampedArray(targetSize * targetSize * 4);
  
  const scaleX = sourceSize / targetSize;
  const scaleY = sourceSize / targetSize;
  
  // Select interpolation function
  const interpolate = resamplingMethod === 'bicubic' 
    ? bicubicInterpolate 
    : resamplingMethod === 'bilinear'
    ? bilinearInterpolate
    : nearestInterpolate;
  
  // Resample each pixel
  for (let ty = 0; ty < targetSize; ty++) {
    for (let tx = 0; tx < targetSize; tx++) {
      // Map target coordinates to source coordinates
      const sx = offsetX + tx * scaleX;
      const sy = offsetY + ty * scaleY;
      
      // Check bounds
      if (sx < 0 || sx >= sourceWidth || sy < 0 || sy >= sourceHeight) {
        const outIdx = (ty * targetSize + tx) * 4;
        outputData[outIdx] = 0;
        outputData[outIdx + 1] = 0;
        outputData[outIdx + 2] = 0;
        outputData[outIdx + 3] = 255;
        continue;
      }
      
      const outIdx = (ty * targetSize + tx) * 4;
      
      // Interpolate each channel (R, G, B, A)
      outputData[outIdx] = interpolate(sourceData, sourceWidth, sourceHeight, sx, sy, 0);
      outputData[outIdx + 1] = interpolate(sourceData, sourceWidth, sourceHeight, sx, sy, 1);
      outputData[outIdx + 2] = interpolate(sourceData, sourceWidth, sourceHeight, sx, sy, 2);
      outputData[outIdx + 3] = interpolate(sourceData, sourceWidth, sourceHeight, sx, sy, 3);
    }
  }
  
  return new ImageData(outputData, targetSize, targetSize);
}

/**
 * Fetch a sparse tile by looking for parent tiles and upscaling
 */
async function fetchSparseTile(
  z: number,
  x: number,
  y: number,
  tileSize: number,
  fetcher: any,
  urlPattern: string,
  resamplingMethod: ResamplingMethod = 'bicubic',
  verbose: boolean = false,
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
            `[SparseTile] Found parent tile at z${currentZ}/${currentX}/${currentY}, upscaling to z${z}/${x}/${y} using ${resamplingMethod} resampling`
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
        
        // Crop and scale with specified resampling method
        const childImageData = await cropAndScaleTile(
          parentImageData,
          region.offsetX,
          region.offsetY,
          region.scale,
          tileSize,
          resamplingMethod
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

export type { SparseTileResult, ResamplingMethod };
export { fetchSparseTile, imageDataToBlob, getParentTile, getChildTileRegion, cropAndScaleTile };
