export class Inode {
  constructor() {
    this.type = 0;
    this.nlink = 0;
    this.size = 0;

    this.blockMap = [];
  }
}
