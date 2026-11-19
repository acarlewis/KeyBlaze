/**
 * Developer-only rendering spike (Phase 2). Validates the decoration + animated-SVG approach in a
 * real editor: data vs file URIs, vertical overflow, centring, empty-line anchoring, and whether
 * typing on a line restarts its animation. Removed once these questions are answered.
 */
import * as vscode from 'vscode';
import { anchorRange, attachmentMargin } from '../render/geometry';
import { svgDocument, svgToDataUri, svgToUtf8DataUri } from '../render/svg';
import { editorLineHeight } from '../services/EditorMetrics';
import type { Logger } from '../utils/logger';

const RUN_MS = 10_000;
const LIFETIME_MS = 15_000;

function spikeSvg(label: string, size: number): string {
  const c = size / 2;
  const small = size < 40;
  const body =
    `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" fill="none" stroke="#ff8a00" stroke-dasharray="4 3"/>` +
    `<line x1="${c}" y1="0" x2="${c}" y2="${size}" stroke="#ff8a00" stroke-opacity="0.5"/>` +
    `<line x1="0" y1="${c}" x2="${size}" y2="${c}" stroke="#ff8a00" stroke-opacity="0.5"/>` +
    `<circle cx="${c}" cy="${c}" r="2" fill="none" stroke="#ffd23f" stroke-width="2">` +
    `<animate attributeName="r" from="2" to="${c - 3}" dur="${RUN_MS}ms" fill="freeze"/></circle>` +
    `<rect x="0" y="${size - 5}" width="0" height="5" fill="#ff5e3a">` +
    `<animate attributeName="width" from="0" to="${size}" dur="${RUN_MS}ms" fill="freeze"/></rect>` +
    (small
      ? ''
      : `<text x="6" y="18" font-family="sans-serif" font-size="16" font-weight="bold" fill="#ff8a00">${label}</text>`);
  return svgDocument(size, size, body);
}

interface Variant {
  readonly label: string;
  readonly line: string;
  readonly size: number;
  readonly uri: (svg: string) => Promise<vscode.Uri>;
  readonly column: number;
}

export async function runRenderingSpike(
  context: vscode.ExtensionContext,
  logger: Logger,
): Promise<void> {
  const storage = vscode.Uri.joinPath(context.globalStorageUri, 'spike');
  await vscode.workspace.fs.createDirectory(storage);

  const dataUri = (svg: string): Promise<vscode.Uri> =>
    Promise.resolve(vscode.Uri.parse(svgToDataUri(svg)));
  const utf8Uri = (svg: string): Promise<vscode.Uri> =>
    Promise.resolve(vscode.Uri.parse(svgToUtf8DataUri(svg)));
  const fileUri = async (svg: string): Promise<vscode.Uri> => {
    const uri = vscode.Uri.joinPath(storage, `spike-${Date.now()}.svg`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
    return uri;
  };

  const variants: Variant[] = [
    {
      label: 'A',
      size: 0,
      column: 1,
      uri: dataUri,
      line: 'A ▸ small base64 data: image, one line tall. Visible? Centred on the caret column (just after "A")?',
    },
    {
      label: 'B',
      size: 160,
      column: 1,
      uri: dataUri,
      line: 'B ▸ tall (160px) base64 data: image. Does the dashed box extend above AND below this line, or is it clipped?',
    },
    {
      label: 'C',
      size: 160,
      column: 1,
      uri: fileUri,
      line: 'C ▸ tall file: URI image. Visible? Same as B?',
    },
    {
      label: 'D',
      size: 160,
      column: 0,
      uri: dataUri,
      line: 'D ▸ the line BELOW is empty (empty range at column 0). Is an image shown there?',
    },
    {
      label: 'E',
      size: 160,
      column: 1,
      uri: utf8Uri,
      line: 'E ▸ tall percent-encoded (non-base64) data: image. Visible?',
    },
    {
      label: 'F',
      size: 160,
      column: 1,
      uri: dataUri,
      line: 'F ▸ RESTART TEST: type at the END of this line while bar F fills. Does the bar or ring jump back to the start?',
    },
  ];

  const header = [
    'KeyBlaze rendering spike. Each lettered box animates for 10 s (ring grows, bar fills) and is removed after 15 s.',
    'The crosshair centre should sit on the caret column and the vertical middle of its line. The text must not shift.',
    'Run "KeyBlaze: Run Rendering Spike (Developer)" again to restart. Close this tab without saving when done.',
    '',
  ];
  const lines = [...header];
  const anchors: { variant: Variant; line: number }[] = [];
  for (const variant of variants) {
    lines.push('', '', '', '');
    lines.push(variant.line);
    const lineIndex = lines.length - 1;
    if (variant.label === 'D') {
      lines.push('');
      anchors.push({ variant, line: lineIndex + 1 });
    } else {
      anchors.push({ variant, line: lineIndex });
    }
    lines.push('', '', '', '');
  }

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'plaintext',
  });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const lineHeight = editorLineHeight(doc);

  const types: vscode.TextEditorDecorationType[] = [];
  for (const { variant, line } of anchors) {
    const size = variant.size > 0 ? variant.size : lineHeight;
    try {
      const svg = spikeSvg(variant.label, size);
      const uri = await variant.uri(svg);
      const type = vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      });
      types.push(type);
      const r = anchorRange({ line, character: variant.column });
      editor.setDecorations(type, [
        {
          range: new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character),
          renderOptions: {
            after: {
              contentIconPath: uri,
              width: `${size}px`,
              height: `${size}px`,
              margin: attachmentMargin(size, size, lineHeight),
            },
          },
        },
      ]);
      logger.info(
        `Spike ${variant.label}: decoration set (scheme=${uri.scheme}, size=${size}px, lineHeight=${lineHeight}px, ` +
          `uri=${uri.toString().slice(0, 48)}…)`,
      );
    } catch (err) {
      logger.error(`Spike ${variant.label}: failed`, err);
    }
  }

  logger.show();
  setTimeout(() => {
    for (const t of types) t.dispose();
    void vscode.workspace.fs
      .delete(storage, { recursive: true, useTrash: false })
      .then(undefined, () => undefined);
  }, LIFETIME_MS);
}
