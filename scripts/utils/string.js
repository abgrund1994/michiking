function naturalCompare(s1, s2) {
  return s1.localeCompare(s2, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function reverse(str) {
  return str.split("").reverse().join("");
}

function padNumber(n, padCount = 3) {
  return String(n).padStart(padCount, "0");
}

module.exports = {
  naturalCompare,
  reverse,
  padNumber,
};
