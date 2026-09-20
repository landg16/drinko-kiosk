/** Frames JSON objects out of a byte stream by brace matching: the board pretty-prints replies with no terminator,
 *  so line splitting cannot work. Bytes outside an object are dropped. */
export class JsonObjectExtractor {
  private buffer = '';
  private depth = 0;
  private inString = false;
  private escaped = false;
  private start = -1;

  constructor(private readonly maxBufferLength = 64 * 1024) {}

  /** Feed a chunk; returns every JSON object text completed by it, in order. */
  feed(chunk: string): string[] {
    const objects: string[] = [];
    let i = this.buffer.length; // resume where the previous scan stopped
    this.buffer += chunk;

    while (i < this.buffer.length) {
      const char = this.buffer[i];
      if (this.start === -1) {
        if (char === '{') {
          this.buffer = this.buffer.slice(i);
          i = 0;
          this.start = 0;
          this.depth = 1;
          this.inString = false;
          this.escaped = false;
        }
        i++;
        continue;
      }
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.inString = false;
      } else if (char === '"') {
        this.inString = true;
      } else if (char === '{') {
        this.depth++;
      } else if (char === '}' && --this.depth === 0) {
        objects.push(this.buffer.slice(0, i + 1));
        this.buffer = this.buffer.slice(i + 1);
        i = 0;
        this.start = -1;
        continue;
      }
      i++;
    }

    if (this.start === -1) this.buffer = '';
    else if (this.buffer.length > this.maxBufferLength) this.reset();
    return objects;
  }

  reset(): void {
    this.buffer = '';
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.start = -1;
  }
}
