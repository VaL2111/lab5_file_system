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

    this.MAX_SYMLINK_DEPTH = 8;
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

  mkdir(path) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }
    console.log(`mkdir ${path}`);

    const { parentInodeId, name } = this._resolvePathToParent(path);

    const freeInodeIndex = this.inodes.findIndex(
      (inode, idx) => idx > 0 && inode.type === this.FILE_TYPE.FREE,
    );
    if (freeInodeIndex === -1) {
      throw new Error("No free inodes");
    }

    if (this._findInodeIdByNameInDir(parentInodeId, name) !== null) {
      throw new Error(`Entry '${name}' already exists`);
    }

    const newDirInode = this.inodes[freeInodeIndex];
    newDirInode.type = this.FILE_TYPE.DIRECTORY;
    newDirInode.nlink = 2;
    newDirInode.size = 0;
    newDirInode.blockMap = [];

    this._addDirectoryEntry(parentInodeId, name, freeInodeIndex);
    this.inodes[parentInodeId].nlink++;

    this._addDirectoryEntry(freeInodeIndex, ".", freeInodeIndex);
    this._addDirectoryEntry(freeInodeIndex, "..", parentInodeId);

    console.log(`Created directory '${name}'`);
  }

  rmdir(path) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }
    console.log(`rmdir ${path}`);

    const { parentInodeId, name } = this._resolvePathToParent(path);

    if (name === "." || name === "..") {
      throw new Error("Cannot remove '.' or '..'");
    }

    const targetInodeId = this._findInodeIdByNameInDir(parentInodeId, name);
    if (targetInodeId === null) {
      throw new Error(`Directory '${path}' not found`);
    }

    const targetInode = this.inodes[targetInodeId];
    if (targetInode.type !== this.FILE_TYPE.DIRECTORY) {
      throw new Error(`'${path}' is not a directory`);
    }

    const entries = this._getDirectoryEntries(targetInodeId);
    if (entries.length > 2) {
      throw new Error(`Directory not empty`);
    }

    this._removeDirectoryEntry(parentInodeId, name);
    this.inodes[parentInodeId].nlink--;
    this._deleteFileData(targetInodeId);

    console.log(`Directory '${name}' removed`);
  }

  cd(path) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }
    console.log(`cd ${path}`);

    const { parentInodeId, name } = this._resolvePathToParent(path);
    let targetInodeId;

    if (name === ".") {
      targetInodeId = parentInodeId;
    } else {
      targetInodeId = this._findInodeIdByNameInDir(parentInodeId, name);
    }

    if (targetInodeId === null) {
      throw new Error(`Directory '${path}' not found`);
    }

    const inode = this.inodes[targetInodeId];

    if (inode.type === this.FILE_TYPE.SYMLINK) {
      const linkTarget = this._readSymlink(targetInodeId);

      if (linkTarget.startsWith("/")) {
        return this.cd(linkTarget);
      } else {
        const pathParts = path.split("/");
        pathParts.pop();
        const dirPath = pathParts.join("/");

        const newPath = (dirPath ? dirPath + "/" : "") + linkTarget;
        return this.cd(newPath);
      }
    }
    if (inode.type !== this.FILE_TYPE.DIRECTORY) {
      throw new Error(`'${path}' is not a directory`);
    }
    this.cwd = targetInodeId;
  }

  create(path) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    const { parentInodeId, name } = this._resolvePathToParent(path);

    if (name.length > this.FILENAME_MAX) {
      throw new Error("Filename too long");
    }

    const freeInodeIndex = this.inodes.findIndex(
      (inode, idx) => idx > 0 && inode.type === 0,
    );
    if (freeInodeIndex === -1) {
      throw new Error("No free inodes");
    }

    if (this._findInodeIdByNameInDir(parentInodeId, name) !== null) {
      throw new Error(`File '${name}' already exists`);
    }

    const newInode = this.inodes[freeInodeIndex];
    newInode.type = this.FILE_TYPE.REGULAR;
    newInode.nlink = 1;
    newInode.size = 0;
    newInode.bitmap = [];

    this._addDirectoryEntry(parentInodeId, name, freeInodeIndex);

    console.log(`Created file '${name}' at inode ${freeInodeIndex}`);
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

  stat(path) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    if (path === "/") {
      const root = this.inodes[this.ROOT_INODE_INDEX];
      console.log(`[STAT] '/': id=0, type=dir, nlink=${root.nlink}`);
      return root;
    }

    const { parentInodeId, name } = this._resolvePathToParent(path);
    const inodeId = this._findInodeIdByNameInDir(parentInodeId, name);

    if (inodeId === null) {
      throw new Error(`File '${path}' not found`);
    }

    const inode = this.inodes[inodeId];
    const typeStr = inode.type === 2 ? "dir" : inode.type === 3 ? "sym" : "reg";

    console.log(
      `[STAT] '${path}': id=${inodeId}, type=${typeStr}, nlink=${inode.nlink}, size=${inode.size}`,
    );
    return inode;
  }

  open(path, depth = 0) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    if (depth > this.MAX_SYMLINK_DEPTH) {
      throw new Error("Too many levels of symbolic links");
    }

    const { parentInodeId, name } = this._resolvePathToParent(path);
    const inodeId = this._findInodeIdByNameInDir(parentInodeId, name);

    if (inodeId === null) {
      throw new Error(`File '${path}' not found`);
    }

    const inode = this.inodes[inodeId];

    if (inode.type === this.FILE_TYPE.REGULAR) {
      let fd = this.openFiles.indexOf(null);
      if (fd === -1) {
        fd = this.openFiles.length;
        this.openFiles.push(null);
      }
      this.openFiles[fd] = { inodeIndex: inodeId, cursor: 0 };
      console.log(`Open '${path}' -> fd=${fd}`);
      return fd;
    }

    if (inode.type === this.FILE_TYPE.SYMLINK) {
      const linkTarget = this._readSymlink(inodeId);

      if (linkTarget.startsWith("/")) {
        return this.open(linkTarget, depth + 1);
      }

      const pathParts = path.split("/");
      pathParts.pop();
      const dirPath = pathParts.join("/");

      const newPath = (dirPath ? dirPath + "/" : "") + linkTarget;

      return this.open(newPath, depth + 1);
    }
    throw new Error(`Cannot open directory '${path}' as a file`);
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

  link(srcPath, destPath) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    console.log(`link ${srcPath} -> ${destPath}`);

    const src = this._resolvePathToParent(srcPath);
    const srcInodeId = this._findInodeIdByNameInDir(
      src.parentInodeId,
      src.name,
    );

    if (srcInodeId === null) {
      throw new Error(`Source file '${srcPath}' not found`);
    }

    const srcInode = this.inodes[srcInodeId];
    if (srcInode.type === this.FILE_TYPE.DIRECTORY) {
      throw new Error(`Cannot create hard link to directory '${srcPath}'`);
    }

    const dest = this._resolvePathToParent(destPath);

    if (dest.name.length > this.FILENAME_MAX) {
      throw new Error("Filename too long");
    }

    if (this._findInodeIdByNameInDir(dest.parentInodeId, dest.name) !== null) {
      throw new Error(`Destination '${destPath}' already exists`);
    }

    srcInode.nlink++;
    this._addDirectoryEntry(dest.parentInodeId, dest.name, srcInodeId);

    console.log(
      `Hard link created. Inode ${srcInodeId} nlink=${srcInode.nlink}`,
    );
  }

  unlink(path) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    console.log(`unlink ${path}`);

    const { parentInodeId, name } = this._resolvePathToParent(path);
    if (name === "." || name === "..") {
      throw new Error("Cannot unlink '.' or '..'");
    }

    const inodeId = this._findInodeIdByNameInDir(parentInodeId, name);
    if (inodeId === null) {
      throw new Error(`File '${path}' not found`);
    }

    const inode = this.inodes[inodeId];
    if (inode.type === this.FILE_TYPE.DIRECTORY) {
      throw new Error(`Cannot unlink directory '${path}'. Use rmdir.`);
    }

    this._removeDirectoryEntry(parentInodeId, name);

    inode.nlink--;
    console.log(`Unlinked. Inode ${inodeId} nlink is now ${inode.nlink}`);

    if (inode.nlink <= 0) {
      if (this._isFileOpen(inodeId)) {
        console.log(`File is still open. Data will be deleted on close.`);
      } else {
        this._deleteFileData(inodeId);
      }
    }
  }

  truncate(name, newSize) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

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

  symlink(targetStr, linkPath) {
    if (!this.isMounted) {
      throw new Error("FS not mounted");
    }

    console.log(`symlink ${targetStr} -> ${linkPath}`);

    if (targetStr.length > this.disk.blockSize) {
      throw new Error("Symlink target path too long");
    }

    const { parentInodeId, name } = this._resolvePathToParent(linkPath);
    if (this._findInodeIdByNameInDir(parentInodeId, name) !== null) {
      throw new Error(`Entry '${name}' already exists`);
    }

    const freeInodeIndex = this.inodes.findIndex(
      (inode, idx) => idx > 0 && inode.type === this.FILE_TYPE.FREE,
    );
    if (freeInodeIndex === -1) {
      throw new Error("No free inodes");
    }

    const linkInode = this.inodes[freeInodeIndex];
    linkInode.type = this.FILE_TYPE.SYMLINK;
    linkInode.nlink = 1;
    linkInode.size = targetStr.length;
    linkInode.blockMap = [];

    const blockIndex = this._allocateBlock();
    linkInode.blockMap.push(blockIndex);

    const buffer = Buffer.alloc(this.disk.blockSize);
    buffer.write(targetStr, 0, "utf8");
    this.disk.writeBlock(blockIndex, buffer);

    this._addDirectoryEntry(parentInodeId, name, freeInodeIndex);
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

  _resolvePathToParent(path) {
    let currentInodeId = this.cwd;
    if (path.startsWith("/")) {
      currentInodeId = this.ROOT_INODE_INDEX;
    }

    let parts = path.split("/").filter((p) => p.length > 0);
    let symlinkDepth = 0;

    if (parts.length === 0) {
      return { parentInodeId: currentInodeId, name: "." };
    }

    let fileName = parts.pop();

    while (parts.length > 0) {
      const part = parts.shift();
      const nextInodeId = this._findInodeIdByNameInDir(currentInodeId, part);

      if (nextInodeId === null) {
        throw new Error(`Directory '${part}' not found`);
      }

      const inode = this.inodes[nextInodeId];

      if (inode.type === this.FILE_TYPE.SYMLINK) {
        if (symlinkDepth >= this.MAX_SYMLINK_DEPTH) {
          throw new Error("Too many levels of symbolic links"); //
        }
        symlinkDepth++;

        const linkContent = this._readSymlink(nextInodeId);
        const linkParts = linkContent.split("/").filter((p) => p.length > 0);

        if (linkContent.startsWith("/")) {
          currentInodeId = this.ROOT_INODE_INDEX;
        }

        parts = linkParts.concat(parts);
        continue;
      }
      if (inode.type !== this.FILE_TYPE.DIRECTORY) {
        throw new Error(`'${part}' is not a directory`);
      }
      currentInodeId = nextInodeId;
    }
    return { parentInodeId: currentInodeId, name: fileName };
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

  _readSymlink(inodeId) {
    const inode = this.inodes[inodeId];
    if (inode.type !== this.FILE_TYPE.SYMLINK) {
      throw new Error(`Inode ${inodeId} is not a symlink`);
    }
    const blockIdx = inode.blockMap[0];
    const buffer = this.disk.readBlock(blockIdx);
    return buffer.toString("utf8").replace(/\0/g, "");
  }
}
