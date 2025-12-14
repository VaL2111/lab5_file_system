import { Inode } from "./Inode.js";
import { Buffer } from "node:buffer";

export class FileSystem {
  constructor(disk) {
    this.disk = disk;
    this.inodes = [];
    this.bitmap = [];
    this.isMounted = false;

    this.ROOT_INODE_INDEX = 0;

    this.FILE_TYPE = {
      FREE: 0,
      REGULAR: 1,
      DIRECTORY: 2,
      SYMLINK: 3,
    };

    this.DIR_ENTRY_SIZE = 32;
    this.FILENAME_MAX = 28;

    this.openFiles = [];

    this.cwd = this.ROOT_INODE_INDEX;
  }

  mkfs(numInodes) {
    this.bitmap = new Array(this.disk.blockCount).fill(false);
    this.inodes = [];

    for (let i = 0; i < numInodes; i++) {
      this.inodes.push(new Inode());
    }

    const root = this.inodes[this.ROOT_INODE_INDEX];
    root.type = this.FILE_TYPE.DIRECTORY;
    root.nlink = 1;
    root.size = 0;

    this.isMounted = true;
    this.cwd = this.ROOT_INODE_INDEX;

    this._addDirectoryEntry(this.ROOT_INODE_INDEX, ".", this.ROOT_INODE_INDEX);
    this._addDirectoryEntry(this.ROOT_INODE_INDEX, "..", this.ROOT_INODE_INDEX);
    root.nlink += 2;

    console.log("File System initialized");
  }

  mkdir(name) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    console.log(`mkdir ${name}`);

    const freeInodeIndex = this.inodes.findIndex(
      (inode, idx) => idx > 0 && inode.type === this.FILE_TYPE.FREE,
    );
    if (freeInodeIndex === -1) {
      throw new Error("No free inodes");
    }

    if (this._findInodeIdByNameInDir(this.cwd, name) !== null) {
      throw new Error(`Entry '${name}' already exists`);
    }

    const newDirInode = this.inodes[freeInodeIndex];
    newDirInode.type = this.FILE_TYPE.DIRECTORY;
    newDirInode.nlink = 2;
    newDirInode.size = 0;
    newDirInode.blockMap = [];

    this._addDirectoryEntry(this.cwd, name, freeInodeIndex);

    this.inodes[this.cwd].nlink++;

    this._addDirectoryEntry(freeInodeIndex, ".", freeInodeIndex);
    this._addDirectoryEntry(freeInodeIndex, "..", this.cwd);

    console.log(`Created directory '${name}'`);
  }

  create(fileName) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }
    if (fileName.length > this.FILENAME_MAX) {
      throw new Error("Filename too long");
    }

    const freeInodeIndex = this.inodes.findIndex(
      (inode, idx) => idx > 0 && inode.type === 0,
    );
    if (freeInodeIndex === -1) {
      throw new Error("No free inodes");
    }

    const newInode = this.inodes[freeInodeIndex];
    newInode.type = 1;
    newInode.nlink = 1;
    newInode.size = 0;
    newInode.bitmap = [];

    this._addDirectoryEntry(this.ROOT_INODE_INDEX, fileName, freeInodeIndex);

    console.log(`Created file '${fileName}' with inode ${freeInodeIndex}`);
  }

  ls() {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    console.log(`ls (cwd=${this.cwd})`);

    const entries = this._getDirectoryEntries(this.cwd);
    if (entries.length === 0) {
      console.log("empty");
      return;
    }

    entries.forEach((entry) => {
      const inode = this.inodes[entry.inodeId];
      let typeStr;
      if (inode.type === 1) typeStr = "REG";
      if (inode.type === 2) typeStr = "DIR";
      if (inode.type === 3) typeStr = "SYM";

      console.log(
        `${entry.name.padEnd(10)} [inode: ${entry.inodeId}, type: ${typeStr}, nlink: ${inode.nlink}]`,
      );
    });
  }

  stat(name) {
    if (!this.isMounted) throw new Error("FS not mounted");

    const inodeId = this._findInodeIdByNameInDir(this.cwd, name);
    if (inodeId === null) {
      throw new Error(`File '${name}' not found`);
    }

    const inode = this.inodes[inodeId];
    const typeStr = inode.type === 2 ? "dir" : "reg";

    console.log(
      `[STAT] '${name}': id=${inodeId}, type=${typeStr}, nlink=${inode.nlink}, size=${inode.size}, blocks=${inode.blockMap.length}`,
    );
    return inode;
  }

  open(name) {
    if (!this.isMounted) throw new Error("FS not mounted");

    const inodeId = this._findInodeIdByNameInDir(this.cwd, name);
    if (inodeId === null) {
      throw new Error(`File '${name}' not found`);
    }

    const inode = this.inodes[inodeId];
    if (inode.type !== 1) {
      throw new Error(`Cannot open directory '${name}' as a file`);
    }

    let fd = this.openFiles.indexOf(null);

    if (fd === -1) {
      fd = this.openFiles.length;
      this.openFiles.push(null);
    }

    this.openFiles[fd] = {
      inodeIndex: inodeId,
      cursor: 0,
    };

    console.log(`Open '${name}' -> fd=${fd}`);
    return fd;
  }

  close(fd) {
    if (!this.openFiles[fd]) {
      throw new Error(`Invalid file descriptor: ${fd}`);
    }

    const inodeId = this.openFiles[fd].inodeIndex;
    console.log(`Close fd=${fd}`);

    this.openFiles[fd] = null;

    const inode = this.inodes[inodeId];
    if (inode.nlink <= 0 && !this._isFileOpen(inodeId)) {
      this._deleteFileData(inodeId);
    }
  }

  seek(fd, offset) {
    if (!this.openFiles[fd]) throw new Error(`Invalid fd: ${fd}`);

    console.log(`Seek fd=${fd} offset=${offset}`);
    this.openFiles[fd].cursor = offset;
  }

  write(fd, data) {
    if (!this.openFiles[fd]) throw new Error(`Invalid fd: ${fd}`);

    if (typeof data === "string") {
      data = Buffer.from(data, "utf8");
    }

    const fileEntry = this.openFiles[fd];
    const inode = this.inodes[fileEntry.inodeIndex];

    let bytesWritten = 0;
    let bytesRemaining = data.length;

    console.log(`Write fd=${fd} bytes=${data.length}`);

    while (bytesRemaining > 0) {
      const logicalBlockIndex = Math.floor(
        fileEntry.cursor / this.disk.blockSize,
      );
      const offsetInBlock = fileEntry.cursor % this.disk.blockSize;
      const bytesToProcess = Math.min(
        bytesRemaining,
        this.disk.blockSize - offsetInBlock,
      );
      let physicalBlockIndex = inode.blockMap[logicalBlockIndex];

      if (physicalBlockIndex === undefined || physicalBlockIndex === -1) {
        physicalBlockIndex = this._allocateBlock();
        inode.blockMap[logicalBlockIndex] = physicalBlockIndex;
      }

      const blockBuffer = this.disk.readBlock(physicalBlockIndex);
      data.copy(
        blockBuffer,
        offsetInBlock,
        bytesWritten,
        bytesWritten + bytesToProcess,
      );
      this.disk.writeBlock(physicalBlockIndex, blockBuffer);

      bytesWritten += bytesToProcess;
      bytesRemaining -= bytesToProcess;
      fileEntry.cursor += bytesToProcess;
    }

    if (fileEntry.cursor > inode.size) {
      inode.size = fileEntry.cursor;
    }

    return bytesWritten;
  }

  read(fd, length) {
    if (!this.openFiles[fd]) throw new Error(`Invalid fd: ${fd}`);

    const fileEntry = this.openFiles[fd];
    const inode = this.inodes[fileEntry.inodeIndex];

    const bytesAvailable = inode.size - fileEntry.cursor;
    const bytesToRead = Math.min(length, bytesAvailable);

    if (bytesToRead <= 0) {
      return Buffer.alloc(0);
    }

    const resultBuffer = Buffer.alloc(bytesToRead);
    let bytesRead = 0;
    let bytesRemaining = bytesToRead;

    console.log(`Read fd=${fd} request=${length} actual=${bytesToRead}`);

    while (bytesRemaining > 0) {
      const logicalBlockIndex = Math.floor(
        fileEntry.cursor / this.disk.blockSize,
      );
      const offsetInBlock = fileEntry.cursor % this.disk.blockSize;
      const bytesToProcess = Math.min(
        bytesRemaining,
        this.disk.blockSize - offsetInBlock,
      );

      const physicalBlockIndex = inode.blockMap[logicalBlockIndex];

      if (physicalBlockIndex !== undefined && physicalBlockIndex !== -1) {
        const blockBuffer = this.disk.readBlock(physicalBlockIndex);
        blockBuffer.copy(
          resultBuffer,
          bytesRead,
          offsetInBlock,
          offsetInBlock + bytesToProcess,
        );
      } else {
        resultBuffer.fill(0, bytesRead, bytesRead + bytesToProcess);
      }

      bytesRead += bytesToProcess;
      bytesRemaining -= bytesToProcess;
      fileEntry.cursor += bytesToProcess;
    }

    return resultBuffer;
  }

  link(srcName, destName) {
    if (!this.isMounted) throw new Error("FS not mounted");
    if (destName.length > this.FILENAME_MAX) {
      throw new Error("Filename too long");
    }

    console.log(`Link ${srcName} -> ${destName}`);

    const inodeId = this._findInodeIdByNameInDir(this.cwd, srcName);
    if (inodeId === null) {
      throw new Error(`Source file '${srcName}' not found`);
    }

    if (this._findInodeIdByNameInDir(this.cwd, destName) !== null) {
      throw new Error(`Destination '${destName}' already exists`);
    }

    const inode = this.inodes[inodeId];

    inode.nlink++;

    this._addDirectoryEntry(this.ROOT_INODE_INDEX, destName, inodeId);

    console.log(`Hard link created. Inode ${inodeId} has nlink=${inode.nlink}`);
  }

  unlink(name) {
    if (!this.isMounted) throw new Error("FS not mounted");

    console.log(`Unlink ${name}`);

    const inodeId = this._findInodeIdByNameInDir(this.cwd, name);
    if (inodeId === null) {
      throw new Error(`File '${name}' not found`);
    }

    const inode = this.inodes[inodeId];

    this._removeDirectoryEntry(this.ROOT_INODE_INDEX, name);

    inode.nlink--;
    console.log(`Link removed. Inode ${inodeId} nlink is now ${inode.nlink}`);

    if (inode.nlink <= 0) {
      if (this._isFileOpen(inodeId)) {
        console.log(`File is still open. Data will be deleted on close.`);
      } else {
        this._deleteFileData(inodeId);
      }
    }
  }

  truncate(name, newSize) {
    if (!this.isMounted) throw new Error("FS not mounted");

    console.log(`Truncate ${name} to ${newSize}`);

    const inodeId = this._findInodeIdByNameInDir(this.cwd, name);
    if (inodeId === null) throw new Error(`File '${name}' not found`);

    const inode = this.inodes[inodeId];
    const oldSize = inode.size;

    if (newSize === oldSize) return;

    inode.size = newSize;

    if (newSize < oldSize) {
      const blocksNeeded = Math.ceil(newSize / this.disk.blockSize);

      while (inode.blockMap.length > blocksNeeded) {
        const blockToFree = inode.blockMap.pop();
        if (blockToFree !== undefined && blockToFree !== -1) {
          this.bitmap[blockToFree] = false;
        }
      }
    }
  }

  _addDirectoryEntry(dirInodeIndex, name, childInodeIndex) {
    const dirInode = this.inodes[dirInodeIndex];

    for (let i = 0; i < dirInode.blockMap.length; i++) {
      const blockIdx = dirInode.blockMap[i];
      const buffer = this.disk.readBlock(blockIdx);

      for (
        let offset = 0;
        offset < this.disk.blockSize;
        offset += this.DIR_ENTRY_SIZE
      ) {
        if (buffer[offset] === 0) {
          this._writeEntryToBuffer(buffer, offset, name, childInodeIndex);
          this.disk.writeBlock(blockIdx, buffer);
          return;
        }
      }
    }

    const newBlockIndex = this._allocateBlock();
    dirInode.blockMap.push(newBlockIndex);
    dirInode.size += this.disk.blockSize;

    const newBuffer = Buffer.alloc(this.disk.blockSize);
    this._writeEntryToBuffer(newBuffer, 0, name, childInodeIndex);
    this.disk.writeBlock(newBlockIndex, newBuffer);
  }

  _writeEntryToBuffer(buffer, offset, name, id) {
    buffer.fill(0, offset, offset + this.FILENAME_MAX);
    buffer.write(name, offset, "utf8");
    buffer.writeUInt32LE(id, offset + this.FILENAME_MAX);
  }

  _getDirectoryEntries(parentInodeIndex) {
    const dirInode = this.inodes[parentInodeIndex];
    if (dirInode.type !== this.FILE_TYPE.DIRECTORY) {
      throw new Error("Inode is not a directory");
    }

    const entries = [];

    for (const blockIdx of dirInode.blockMap) {
      const buffer = this.disk.readBlock(blockIdx);

      for (
        let offset = 0;
        offset < this.disk.blockSize;
        offset += this.DIR_ENTRY_SIZE
      ) {
        if (buffer[offset] !== 0) {
          const inodeId = buffer.readUInt32LE(offset + this.FILENAME_MAX);
          const name = buffer
            .toString("utf8", offset, offset + this.FILENAME_MAX)
            .replace(/\0/g, "");

          entries.push({ name, inodeId });
        }
      }
    }
    return entries;
  }

  _findInodeIdByNameInDir(parentInodeIndex, targetName) {
    const dirInode = this.inodes[parentInodeIndex];
    if (dirInode.type !== this.FILE_TYPE.DIRECTORY) {
      return null;
    }

    for (const blockIdx of dirInode.blockMap) {
      const buffer = this.disk.readBlock(blockIdx);
      for (
        let offset = 0;
        offset < this.disk.blockSize;
        offset += this.DIR_ENTRY_SIZE
      ) {
        if (buffer[offset] !== 0) {
          const name = buffer
            .toString("utf8", offset, offset + this.FILENAME_MAX)
            .replace(/\0/g, "");

          if (name === targetName) {
            return buffer.readUInt32LE(offset + this.FILENAME_MAX);
          }
        }
      }
    }
    return null;
  }

  _removeDirectoryEntry(dirInodeIndex, nameToRemove) {
    const dirInode = this.inodes[dirInodeIndex];

    for (const blockIdx of dirInode.blockMap) {
      const buffer = this.disk.readBlock(blockIdx);

      for (
        let offset = 0;
        offset < this.disk.blockSize;
        offset += this.DIR_ENTRY_SIZE
      ) {
        const inodeId = buffer.readUInt32LE(offset + this.FILENAME_MAX);

        if (inodeId > 0) {
          const name = buffer
            .toString("utf8", offset, offset + this.FILENAME_MAX)
            .replace(/\0/g, "");
          if (name === nameToRemove) {
            buffer.fill(0, offset, offset + this.DIR_ENTRY_SIZE);
            this.disk.writeBlock(blockIdx, buffer);
            return;
          }
        }
      }
    }
  }

  _deleteFileData(inodeId) {
    const inode = this.inodes[inodeId];

    for (const blockIdx of inode.blockMap) {
      this.bitmap[blockIdx] = false;
    }

    inode.type = 0;
    inode.nlink = 0;
    inode.size = 0;
    inode.blockMap = [];
  }

  _isFileOpen(inodeId) {
    return this.openFiles.some((file) => file && file.inodeIndex === inodeId);
  }

  _allocateBlock() {
    const freeIndex = this.bitmap.indexOf(false);

    if (freeIndex === -1) {
      throw new Error("File system error: no free blocks left");
    }

    this.bitmap[freeIndex] = true;

    const zeros = Buffer.alloc(this.disk.blockSize);
    this.disk.writeBlock(freeIndex, zeros);

    return freeIndex;
  }
}
