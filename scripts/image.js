const fsPromises = require("fs/promises");
const path = require("path");
const sizeOf = require("image-size");
const CWebp = require("cwebp").CWebp;
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const {
  searchFiles,
  getDirectories,
  getFileExtension,
  deleteFiles,
} = require("./utils/file");
const { naturalCompare, padNumber } = require("./utils/string");
const { pLimit } = require("./utils/pool");

const ENLARGE_WORKERS_COUNT = 2;
const COMPRESS_WORKERS_COUNT = 3;
const WAIFU2X_BIN_PATH = path.join(
  process.cwd(),
  "./scripts/static/waifu2x/waifu2x-ncnn-vulkan.exe"
);
const ENLARGED_FILE_PREFIX = "hentie2110";
const IDEAL_WIDTH = 2048;
const IDEAL_HEIGHT = 2732;

async function compressFile(filePath) {
  const fileExtension = getFileExtension(filePath);
  const newFilePath = filePath.replace(fileExtension, "webp");
  const { width, height } = sizeOf(filePath);
  const encoder = new CWebp(filePath);
  if (width > IDEAL_WIDTH) {
    encoder.resize(IDEAL_WIDTH, 0);
  }
  encoder.quality(100);
  await encoder.write(newFilePath);
}

async function enlargeFile(filePath, index) {
  const fileExtension = getFileExtension(filePath);
  const fileDirectory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const { width, height } = sizeOf(filePath);
  const targetFileName = `${ENLARGED_FILE_PREFIX}_${padNumber(index)}`;

  if (width < IDEAL_WIDTH) {
    // Need to enlarge the image
    const absoluteTargetFilePath = path.resolve(
      process.cwd(),
      fileDirectory,
      `${targetFileName}.png`
    );
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    const scale = width < IDEAL_WIDTH / 2 ? 4 : 2;
    console.log(
      `Enlarging image ${fileName} with Waifu2x at scale x${scale}...`
    );
    try {
      await exec(
        `${WAIFU2X_BIN_PATH} -i "${absoluteFilePath}" -o "${absoluteTargetFilePath}" -n 0 -s ${scale} -t 512 -m models-cunet -g 0 -j 2:2:2 -f png`
      );
      await fsPromises.access(absoluteTargetFilePath);
    } catch (err) {
      console.error(
        `Failed to enlarge image ${fileName} with Waifu2x at scale x${scale}!`,
        err
      );
      throw err;
    }
  } else {
    // Simply copy the image
    console.log(`Duplicating image ${fileName}...`);
    const targetFilePath = path.join(
      fileDirectory,
      `./${targetFileName}.${fileExtension}`
    );
    await fsPromises.copyFile(filePath, targetFilePath);
  }
}

async function processTitle(titleDirPath) {
  const titleName = path.basename(titleDirPath);
  console.log(`Processing title '${titleName}'...`);

  const filePaths = await searchFiles(`${titleDirPath}/*.{png,jpg,jpeg}`);

  // Folder is either empty or has already been processed previously
  if (filePaths.length === 0) {
    console.log(`No images founder under title '${titleName}'!`);
    return;
  }

  // Sort file paths in natural order
  filePaths.sort(naturalCompare);

  // Enlarge images with Waifu2x if needed
  console.log(`Enlarging images (if needed) under title '${titleName}'...`);
  let hasEnlargeError = false;
  const enlargePoolLimit = pLimit(ENLARGE_WORKERS_COUNT);
  const enlargeTasks = filePaths.map((filePath, index) =>
    enlargePoolLimit(() => enlargeFile(filePath, index + 1))
  );
  try {
    await Promise.all(enlargeTasks);
  } catch (err) {
    hasEnlargeError = true;
  }

  const enlargedFilePaths = await searchFiles(
    `${titleDirPath}/${ENLARGED_FILE_PREFIX}_*.{png,jpg,jpeg}`
  );

  if (hasEnlargeError) {
    console.error(`Failed to enlarge all images under title '${titleName}'!`);
    await deleteFiles(enlargedFilePaths);
    return;
  }

  // Sort enlarged file paths in natural order
  enlargedFilePaths.sort(naturalCompare);

  // Compress enlarged images to WebP format and resize to ideal size
  console.log(
    `Compressing & resizing enlarged images under title '${titleName}'...`
  );
  let hasCompressError = false;
  const compressPoolLimit = pLimit(COMPRESS_WORKERS_COUNT);
  const compressTasks = enlargedFilePaths.map((filePath) =>
    compressPoolLimit(() => compressFile(filePath))
  );
  try {
    await Promise.all(compressTasks);
  } catch (err) {
    hasCompressError = true;
  }

  const compressedFilePaths = await searchFiles(`${titleDirPath}/*.webp`);

  if (hasCompressError) {
    console.error(
      `Failed to compress & resize all enlarged images under title '${titleName}'!`
    );
    await deleteFiles([...enlargedFilePaths, ...compressedFilePaths]);
    return;
  }

  // Delete original & enlarged images
  console.log(`Cleaning up old images under title '${titleName}'...`);
  await deleteFiles([...filePaths, ...enlargedFilePaths]);

  console.log(`Processed title '${titleName}' successfully!`);
}

(async () => {
  console.log("Scanning titles...");
  const directories = await getDirectories("content/");

  for (const dir of directories) {
    await processTitle(`content/${dir}`);
  }
})();
