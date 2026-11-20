import type { AndroidApk } from "../index.js";

/** `package: name='…' versionCode='…' versionName='…'` from `aapt2 dump badging`. */
export function parseBadging(output: string): Pick<AndroidApk, "package" | "versionCode" | "versionName"> {
  const line = output.split(/\r?\n/).find((item) => item.startsWith("package:")) ?? "";
  const field = (name: string) => new RegExp(`\\b${name}='([^']*)'`).exec(line)?.[1];
  const name = field("name"); const code = Number(field("versionCode")); const versionName = field("versionName");
  if (!name || !Number.isSafeInteger(code) || code < 1 || !versionName) throw new Error("Cannot read package, versionCode and versionName from the APK");
  return { package: name, versionCode: code, versionName };
}

