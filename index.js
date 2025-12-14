import { VirtualDisk } from "./src/VirtualDisk.js";
import { FileSystem } from "./src/FileSystem.js";

const BLOCK_SIZE = 64;
const BLOCK_COUNT = 100;
const INODE_COUNT = 10;

try {
  const disk = new VirtualDisk(BLOCK_SIZE, BLOCK_COUNT);
  const fs = new FileSystem(disk);

  console.log("\n>>> 1. FORMAT & ROOT CHECK");
  fs.mkfs(INODE_COUNT);
  fs.ls();

  console.log("\n>>> 2. CREATING DIRECTORY TREE");

  fs.mkdir("usr");
  fs.mkdir("usr/bin");
  fs.mkdir("home");
  fs.mkdir("home/user");

  fs.cd("usr");
  fs.ls();

  console.log("\n>>> 3. NAVIGATION TEST");

  fs.cd("/");
  fs.cd("home/user");
  fs.cd("../..");
  fs.cd("usr/./bin");

  console.log("\n>>> 4. FILE OPERATIONS WITH PATHS");

  fs.create("/home/user/notes.txt");

  let fd = fs.open("/home/user/notes.txt");
  fs.write(fd, "Nested Data Works!");
  fs.close(fd);

  fd = fs.open("../../home/user/notes.txt");
  const data = fs.read(fd, 100);
  console.log(`Output: "${data.toString()}"`);
  fs.close(fd);

  console.log("\n>>> 5. HARD LINKS & PATHS");

  fs.link("/home/user/notes.txt", "link_to_notes");

  fs.ls();
  fs.stat("link_to_notes");

  fs.unlink("/home/user/notes.txt");
  fs.stat("link_to_notes");

  console.log("\n>>> 6. RMDIR TEST");

  fs.cd("/");

  try {
    fs.rmdir("usr");
  } catch (e) {
    console.log(`Expected error: ${e.message}`);
  }

  fs.unlink("/usr/bin/link_to_notes");

  fs.rmdir("/usr/bin");
  console.log("Removed /usr/bin");

  fs.cd("usr");
  fs.ls();
} catch (error) {
  console.error("System error");
}
