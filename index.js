import { VirtualDisk } from "./src/VirtualDisk.js";
import { FileSystem } from "./src/FileSystem.js";

const BLOCK_SIZE = 64;
const BLOCK_COUNT = 100;
const INODE_COUNT = 10;

try {
  const disk = new VirtualDisk(BLOCK_SIZE, BLOCK_COUNT);
  const fs = new FileSystem(disk);

  fs.mkfs(INODE_COUNT);

  fs.ls();

  fs.mkdir("my_folder");

  fs.ls();
} catch (error) {
  console.error("System error");
}
