import { Canvg, RenderingContext2D, presets } from "canvg";

/**
 * Canvg doesn't support CSS var() or !important, so we need to
 * resolve --lb-* custom properties and strip !important before
 * passing the SVG string to Canvg for PNG export.
 */

export function resolveCustomProperties(svgString: string): string {
  // Extract custom properties from the root svg's style attribute
  const styleMatch = svgString.match(/style="([^"]*)"/);
  if (!styleMatch) return svgString;

  const propertyMap = new Map<string, string>();
  styleMatch[1]
    .split(";")
    .filter((decl) => decl.includes(":"))
    .forEach((decl) => {
      const colonIndex = decl.indexOf(":");
      const name = decl.slice(0, colonIndex).trim();
      const value = decl.slice(colonIndex + 1).trim();
      if (name.startsWith("--lb-")) {
        propertyMap.set(name, value);
      }
    });

  // Replace var(--lb-*) references with resolved values
  let resolved = Array.from(propertyMap).reduce((svg, [name, value]) => {
    const escapedName = name.replace(/-/g, "\\-");
    const varPattern = new RegExp(`var\\(${escapedName}\\)`, "g");
    return svg.replace(varPattern, value);
  }, svgString);

  // Strip !important - Canvas API does not understand CSS specificity
  resolved = resolved.replace(/\s*!important/g, "");

  return resolved;
}

const offscreenPreset = presets.offscreen();
export async function svgToBlob(
  width: number,
  height: number,
  svgString: string,
  encodeType: string = "image/png"
): Promise<Blob> {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if ("OffscreenCanvas" in window) {
    // Not supported everywhere: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas#browser_compatibility
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No canvas context");
  }
  const resolvedSvg = resolveCustomProperties(svgString);
  const v = Canvg.fromString(ctx as RenderingContext2D, resolvedSvg, {
    ...offscreenPreset,
    // Overwrite the Canvg typescript types here, replace once this Canvg ticket is resolved:
    // https://github.com/canvg/canvg/issues/1754
    createCanvas: offscreenPreset.createCanvas as () => OffscreenCanvas & {
      getContext(contextId: "2d"): OffscreenCanvasRenderingContext2D;
    },
  });

  // Render only first frame, ignoring animations and mouse.
  await v.render();

  let blob;
  if ("OffscreenCanvas" in window) {
    canvas = canvas as OffscreenCanvas;
    blob = await canvas.convertToBlob({
      type: encodeType,
    });
  } else {
    blob = await new Promise<Blob | null>((done, err) => {
      try {
        canvas = canvas as HTMLCanvasElement;
        canvas.toBlob(done, encodeType);
      } catch (error) {
        err(error);
      }
    });
    if (blob === null) {
      throw new Error(
        "No image to copy. This is most likely due to a canvas rendering issue in your browser"
      );
    }
  }
  return blob;
}
export async function toPng(
  width: number,
  height: number,
  svgString: string
): Promise<string> {
  const blob = await svgToBlob(width, height, svgString, "image/png");
  if (!blob) {
    throw new Error("Could not save image file");
  }
  const pngUrl = URL.createObjectURL(blob);

  return pngUrl;
}
