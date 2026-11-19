/** Small, pure SVG helpers shared by renderers. */

export function svgDocument(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" overflow="visible">${body}</svg>`
  );
}

/** Encodes an SVG document as a base64 `data:` URI string (works in Node ≥ 18 and in webviews). */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${base64Utf8(svg)}`;
}

export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Percent-encoded (non-base64) variant, used by the rendering spike for comparison. */
export function svgToUtf8DataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

export function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * SMIL `values` for an Impact Pulse jitter: alternating offsets that decay to rest, ending at 0,0.
 * Deterministic, so identical inputs give identical SVGs (callers add a nonce for uniqueness).
 */
export function shakeValues(amplitude: number, steps = 8): string {
  const values: string[] = [];
  for (let i = 0; i < steps; i++) {
    const decay = 1 - i / steps;
    const sign = i % 2 === 0 ? 1 : -1;
    const x = sign * amplitude * decay;
    const y = -sign * amplitude * 0.5 * decay * (i % 3 === 0 ? 1 : -1);
    values.push(`${fmt(x)},${fmt(y)}`);
  }
  values.push('0,0');
  return values.join(';');
}

/** An `animateTransform` translate jitter, or '' when there's no shake. */
export function shakeAnimation(
  shake: { amplitude: number; durationMs: number } | undefined,
): string {
  if (!shake || shake.amplitude <= 0 || shake.durationMs <= 0) return '';
  return (
    `<animateTransform attributeName="transform" type="translate" values="${shakeValues(shake.amplitude)}" ` +
    `dur="${Math.round(shake.durationMs)}ms" fill="freeze"/>`
  );
}
