import type { IPIIScrubber } from '../ports/pii-scrubber.interface';

export class NoOpPIIScrubber implements IPIIScrubber {
  scrub(content: string): string {
    return content;
  }
}
