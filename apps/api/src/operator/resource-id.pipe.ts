import { BadRequestException, type PipeTransform } from '@nestjs/common';

export class ResourceIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value)) {
      throw new BadRequestException('Invalid resource ID');
    }
    return value;
  }
}
