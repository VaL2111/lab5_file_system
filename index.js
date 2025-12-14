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

  fs.create("file.txt");

  fs.create("notes.doc");

  fs.ls();

  fs.stat("file.txt");

  console.log("--------------------------");

  let fd = fs.open("file.txt");

  const bytesWritten = fs.write(fd, "Hello World!");
  console.log(`Записано байтів: ${bytesWritten}`);

  fs.seek(fd, 0);

  let buf = fs.read(fd, 100);
  console.log(`Вивід: "${buf.toString()}"`);

  fs.seek(fd, 6);

  fs.write(fd, "NodeJS");

  fs.seek(fd, 0);

  buf = fs.read(fd, 100);
  console.log(`Вивід: "${buf.toString()}"`);

  fs.close(fd);

  fs.stat("file.txt");

  console.log("--------------------------");

  fs.truncate("file.txt", 100);
  fs.stat("file.txt");

  fs.truncate("file.txt", 5);
  fs.stat("file.txt");

  fd = fs.open("file.txt");
  console.log(`Вивід: "${fs.read(fd, 100).toString()}"`);
  fs.close(fd);

  console.log("--------------------------");

  fs.create("data.bin");

  fs.link("data.bin", "data_link.bin");

  fs.ls();

  fs.stat("data.bin");

  fs.unlink("data.bin");

  fs.stat("data_link.bin");

  console.log("--------------------------");

  let fdLink = fs.open("data_link.bin");

  fs.unlink("data_link.bin");

  fs.write(fdLink, "Saved Data");

  fs.close(fdLink);

} catch (error) {
  console.error("System error");
}
