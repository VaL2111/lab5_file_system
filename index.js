import { VirtualDisk } from "./src/VirtualDisk.js";
import { FileSystem } from "./src/FileSystem.js";

const BLOCK_SIZE = 64;
const BLOCK_COUNT = 100;
const INODE_COUNT = 10;

try {
  const disk = new VirtualDisk(BLOCK_SIZE, BLOCK_COUNT);
  const fs = new FileSystem(disk);

  console.log(">>> Creating files and folders");
  fs.mkfs(INODE_COUNT);

  fs.mkdir("documents");
  fs.create("/documents/secret.txt");

  let fd = fs.open("/documents/secret.txt");
  fs.write(fd, "TOP SECRET DATA");
  fs.close(fd);

  console.log("\n>>> Simple symlink test");
  fs.symlink("/documents/secret.txt", "my_link");

  fs.ls();
  fs.stat("my_link");

  fd = fs.open("my_link");
  const data = fs.read(fd, 100);
  console.log(`Output: "${data.toString()}"`);
  fs.close(fd);

  if (data.toString() !== "TOP SECRET DATA") {
    throw new Error("Symlink read failed!");
  }

  console.log("\n>>> Directory symlink and navigation");
  fs.symlink("/documents", "goto_docs");

  fs.cd("goto_docs");
  fs.ls();

  fs.cd("..");

  console.log("\n>>> Chained symlinks");
  fs.symlink("my_link", "link_to_link");

  fd = fs.open("link_to_link");
  const dataChain = fs.read(fd, 100);
  console.log(`Output: "${dataChain.toString()}"`);
  fs.close(fd);

  console.log("\n>>> Broken link");
  fs.symlink("/nowhere/ghost.txt", "broken_link");
  console.log(" -> Created link to non-existent file");

  try {
    fs.open("broken_link");
    console.error("Error: Should have failed!");
  } catch (e) {
    console.log(`Expected error: ${e.message}`);
  }

  console.log("\n>>> Infinite Recursion");
  fs.mkdir("loops");
  fs.cd("loops");

  fs.symlink("link_B", "link_A");
  fs.symlink("link_A", "link_B");

  console.log(" -> Created infinite loop: link_A <-> link_B");

  try {
    fs.open("link_A");
    console.error("Error: Loop not detected");
  } catch (e) {
    console.log(`Expected error: ${e.message}`);
  }
} catch (error) {
  console.error("System error");
}
