/** Minimal XML well-formedness check for generated SVG (tag balance + single root). */
export function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let consumed = 0;
  let roots = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml)) !== null) {
    if (xml.slice(consumed, match.index).includes('<')) {
      throw new Error(
        `Malformed markup near index ${consumed}: ${xml.slice(consumed, consumed + 60)}`,
      );
    }
    consumed = match.index + match[0].length;
    const [, closing, name = '', , selfClosing] = match;
    if (stack.length === 0 && !closing) roots++;
    if (closing) {
      const open = stack.pop();
      if (open !== name) throw new Error(`Mismatched </${name}>, expected </${open ?? '(none)'}>`);
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  if (xml.slice(consumed).trim().length > 0) throw new Error('Trailing content after root element');
  if (stack.length > 0) throw new Error(`Unclosed tags: ${stack.join(', ')}`);
  if (roots !== 1) throw new Error(`Expected exactly one root element, found ${roots}`);
}
