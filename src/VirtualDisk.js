import { Buffer } from "node:buffer";

export class VirtualDisk {
  constructor(blockSize, blockCount) {
    this.blockSize = blockSize;
    this.blockCount = blockCount;

    const totalSize = blockSize * blockCount;

    this.diskBuffer = Buffer.alloc(totalSize);
  }

  writeBlock(blockIndex, data) {
    this._validateBlockIndex(blockIndex);

    if (!Buffer.isBuffer(data)) {
      throw new Error("Disk error: data must be a buffer");
    }

    if (data.length > this.blockSize) {
      throw new Error(`Disk error: data size exceeds block size`);
    }

    const offset = blockIndex * this.blockSize;

    this.diskBuffer.fill(0, offset, offset + this.blockSize);
    data.copy(this.diskBuffer, offset);
  }

  readBlock(blockIndex) {
    this._validateBlockIndex(blockIndex);

    const offset = blockIndex * this.blockSize;

    const blockData = Buffer.alloc(this.blockSize);
    this.diskBuffer.copy(blockData, 0, offset, offset + this.blockSize);

    return blockData;
  }

  _validateBlockIndex(blockIndex) {
    if (blockIndex < 0 || blockIndex >= this.blockCount) {
      throw new Error(`Disk error: block index ${blockIndex} is out of bounds`);
    }
  }
}
