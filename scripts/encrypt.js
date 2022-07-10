const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { pipeline } = require("stream/promises");
const crypto = require("crypto");
const sizeOf = require("image-size");
const CWebp = require("cwebp").CWebp;

const {
  searchFiles,
  getDirectories,
  getFileExtension,
  deleteFiles,
} = require("./utils/file");
const { naturalCompare, padNumber, reverse } = require("./utils/string");
const { KEY_HEX, IV_HEX } = require("../config");

const KEY = Buffer.from(KEY_HEX, "hex");
const IV = Buffer.from(IV_HEX, "hex");

async function encryptTitle(titleDirPath) {
  const titleName = path.basename(titleDirPath);
  console.log(`Encrypting title '${titleName}'...`);

  const filePaths = await searchFiles(`${titleDirPath}/*.{png,jpg,jpeg,webp}`);

  // Folder is empty without images
  if (filePaths.length === 0) {
    console.log(`No images founder under title '${titleName}'!`);
    return;
  }

  // Sort image file paths in natural order
  filePaths.sort(naturalCompare);

  // Clean up existing encrypted files for title that has been re-processed
  console.log(`Cleaning up old encrypted files under title '${titleName}'...`);
  const trackedFilePaths = await searchFiles(
    `${titleDirPath}/*.{gnp,gpj,gepj,pbew}`
  );
  await deleteFiles(trackedFilePaths);

  // Create thumbnail
  console.log(`Creating thumbnail image for title '${titleName}'...`);
  const thumbnailPath = `${titleDirPath}/thumbnail.webp`;
  const encoder = new CWebp(filePaths[0]);
  encoder.resize(650, 0);
  encoder.quality(100);
  await encoder.write(thumbnailPath);

  // Encrypt thumbnail
  console.log(`Encrypting thumbnail image for title '${titleName}'...`);
  const { width: thumbnailWidth, height: thumbnailHeight } =
    sizeOf(thumbnailPath);
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY, IV);
  const input = fs.createReadStream(thumbnailPath);
  const output = fs.createWriteStream(
    `${titleDirPath}/thumbnail-${thumbnailWidth}-${thumbnailHeight}.pbew`
  );
  await pipeline(input, cipher, output);

  // Encrypt pages
  console.log(`Encrypting pages for title '${titleName}'...`);
  const dimensionsList = [];
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    if (filePath.endsWith("thumbnail.webp")) {
      continue;
    }
    const { width, height } = sizeOf(filePath);
    const cipher = crypto.createCipheriv("aes-256-cbc", KEY, IV);
    const input = fs.createReadStream(filePath);
    const fileExtension = getFileExtension(filePath);
    const output = fs.createWriteStream(
      `${titleDirPath}/${padNumber(i + 1)}.${reverse(fileExtension)}`
    );
    await pipeline(input, cipher, output);
    dimensionsList.push([width, height]);
  }

  // Create JSON file containing metadata of title
  console.log(`Creating metadata JSON for title '${titleName}'...`);
  await fsPromises.writeFile(
    `${titleDirPath}/index.json`,
    JSON.stringify({
      dimensions: dimensionsList,
      name: titleName,
    })
  );
}

(async () => {
  console.log("Scanning titles...");
  const directories = await getDirectories("content/");

  for (const dir of directories) {
    await encryptTitle(`content/${dir}`);
  }
})();
