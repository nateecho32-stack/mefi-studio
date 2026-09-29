// Gives the portable build's executable Studio's own identity. The runtime is
// Electron's electron.exe renamed, so without this Windows shows Electron's
// icon, and Task Manager, the file's Properties and SmartScreen show
// "Electron" by "GitHub, Inc.". Code signing (docs/code-signing.md) also
// requires the product name and version on the file it signs, so the stamp
// is written before anything signs the build.
//
// resedit is a dev dependency, loaded only when a real Windows executable is
// stamped: packaging tests run with placeholder files, and the shipped app
// never imports this module.

let resedit = null;
async function loadResedit() {
  if (resedit) return resedit;
  try {
    resedit = await import("resedit");
  } catch (error) {
    throw new Error(`resedit is missing, so the executable cannot be stamped - run: npm install (${error.message})`);
  }
  return resedit;
}

// "MZ": the DOS header every Windows executable starts with.
export function isWindowsExecutable(bytes) {
  return bytes.length > 64 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

// Windows' binary version has four 16-bit parts; a prerelease suffix only
// shows in the ProductVersion string.
export function versionParts(version) {
  const parts = String(version).split(/[-+]/)[0].split(".").map((part) => Number.parseInt(part, 10));
  return [0, 1, 2, 3].map((index) => (Number.isInteger(parts[index]) && parts[index] >= 0 ? Math.min(parts[index], 0xffff) : 0));
}

// The "Copyright (c) <year> <holder>" line of an MIT LICENSE, or null.
export function copyrightLine(licenseText) {
  const match = /^Copyright\s.+$/m.exec(String(licenseText || ""));
  return match ? match[0].trim() : null;
}

// Returns a new executable: the input with Studio's version strings and,
// when `icon` (an .ico file's bytes) is given, Studio's icon in place of
// every icon group. The input must be unsigned: stamping a signed file would
// break its signature, and signing happens after this.
export async function stampExecutable(bytes, { productName, version, fileName, description = productName, company = "", copyright = "", icon = null }) {
  if (!isWindowsExecutable(bytes)) throw new Error("not a Windows executable");
  if (!productName || !version || !fileName) throw new Error("stampExecutable needs productName, version and fileName");
  const ResEdit = await loadResedit();
  const exe = ResEdit.NtExecutable.from(bytes, { ignoreCert: true });
  if (hasSignature(ResEdit, exe)) throw new Error("the executable is already signed; stamp it before signing");
  const resources = ResEdit.NtExecutableResource.from(exe);

  const [major, minor, patch, build] = versionParts(version);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!infos.length) {
    const created = ResEdit.Resource.VersionInfo.createEmpty();
    created.lang = 1033;
    infos.push(created);
  }
  for (const info of infos) {
    // These also write the version strings, so the strings below come after.
    info.setFileVersion(major, minor, patch, build);
    info.setProductVersion(major, minor, patch, build);
    const languages = info.getAvailableLanguages();
    if (!languages.length) languages.push({ lang: info.lang || 1033, codepage: 1200 });
    for (const language of languages) {
      info.setStringValues(language, {
        CompanyName: company,
        FileDescription: description,
        FileVersion: `${major}.${minor}.${patch}.${build}`,
        InternalName: fileName.replace(/\.exe$/i, ""),
        LegalCopyright: copyright,
        OriginalFilename: fileName,
        ProductName: productName,
        ProductVersion: String(version),
      });
    }
    info.outputToResourceEntries(resources.entries);
  }

  if (icon) {
    const images = ResEdit.Data.IconFile.from(icon).icons.map((item) => item.data);
    if (!images.length) throw new Error("the icon file holds no images");
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
    if (!groups.length) groups.push({ id: 1, lang: 1033 });
    for (const group of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, images);
  }

  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}

// What Windows will read from an executable: its version strings, binary
// file version, icon sizes and whether it carries a signature. Used by the
// packaging test and by the release signing check.
export async function readExecutableIdentity(bytes) {
  const ResEdit = await loadResedit();
  const exe = ResEdit.NtExecutable.from(bytes, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(exe);
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const language = info?.getAvailableLanguages()[0];
  const fixed = info?.fixedInfo;
  return {
    strings: language ? info.getStringValues(language) : {},
    fileVersion: fixed ? [fixed.fileVersionMS >>> 16, fixed.fileVersionMS & 0xffff, fixed.fileVersionLS >>> 16, fixed.fileVersionLS & 0xffff].join(".") : null,
    icons: ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries).flatMap((group) => group.icons.map((entry) => ({ width: entry.width || 256, height: entry.height || 256 }))),
    signed: hasSignature(ResEdit, exe),
  };
}

// An Authenticode signature is not a section: it sits after the image, named
// by the header's certificate directory.
function hasSignature(ResEdit, exe) {
  return exe.newHeader.optionalHeaderDataDirectory.get(ResEdit.Format.ImageDirectoryEntry.Certificate).size > 0;
}
