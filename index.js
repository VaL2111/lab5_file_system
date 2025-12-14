import { VirtualDisk } from "./src/VirtualDisk.js";
import { FileSystem } from "./src/FileSystem.js";

const BLOCK_SIZE = 64;
const BLOCK_COUNT = 100;
const INODE_COUNT = 20;

try {
  const disk = new VirtualDisk(BLOCK_SIZE, BLOCK_COUNT);
  const fs = new FileSystem(disk);

  console.log(">>> Створення дерева директорій");

  fs.mkfs(INODE_COUNT);

  fs.mkdir("usr");
  fs.mkdir("usr/bin");
  fs.mkdir("home");
  fs.mkdir("home/user");

  fs.create("/home/user/document.txt");
  let fd = fs.open("/home/user/document.txt");
  fs.write(fd, "Original content");
  fs.close(fd);

  fs.ls();

  console.log("\n>>> Навігація (cd) та відносні шляхи");

  fs.cd("usr/bin");
  fs.cd("../../home");

  fs.ls();

  console.log("\n>>> Символічні посилання на файли");

  fs.symlink("user/document.txt", "my_doc_link");

  fs.ls();

  fd = fs.open("my_doc_link");
  const data = fs.read(fd, 50);
  console.log(`Вивід: "${data.toString()}"`);
  fs.close(fd);

  console.log("\n>>> Символічні посилання на директорії та рекурсивний перехід (cd)");

  fs.cd("/");

  fs.symlink("/usr/bin", "goto_bin");

  fs.cd("goto_bin");

  fs.create("check.bin");

  fs.cd("/usr/bin");
  fs.ls();

  console.log("\n>>> Логіка видалення");

  try {
    fs.unlink("/usr");
  } catch (e) {
    console.log(`Очікується помилка: ${e.message}`);
  }

  try {
    fs.rmdir("/usr");
  } catch (e) {
    console.log(`Очікується помилка: ${e.message}`);
  }

  fs.unlink("/goto_bin");

  fs.cd("/usr/bin");

  console.log("\n>>> Виявлення нескінченних циклів");

  fs.cd("/");
  fs.mkdir("loop_test");
  fs.cd("loop_test");

  fs.symlink("LinkB", "LinkA");
  fs.symlink("LinkA", "LinkB");

  try {
    fs.open("LinkA");
  } catch (e) {
    console.log(`Очікується помилка: ${e.message}`);
  }
} catch (error) {
  console.error("System error", error.message);
}
