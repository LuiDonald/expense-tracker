import { Platform } from "react-native";
import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { supabase, isSupabaseConfigured } from "./supabase";

export const PHOTO_BUCKET = "receipt-photos";

/**
 * A "local" photo is one that hasn't been uploaded yet — a device file URI
 * (file://), a web blob/data URL, etc. Anything already served over http(s)
 * is assumed to live in Supabase Storage (or be a remote sample image).
 */
export function isLocalPhoto(uri: string | null): boolean {
  if (!uri) return false;
  return !/^https?:\/\//i.test(uri);
}

function extAndType(uri: string): { ext: string; contentType: string } {
  const match = /\.(\w+)(?:\?.*)?$/.exec(uri);
  const ext = (match?.[1] ?? "jpg").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
  };
  return { ext, contentType: map[ext] ?? "image/jpeg" };
}

/**
 * Upload a local receipt image to Supabase Storage and return its public URL.
 * Works on both web (Blob) and native (base64 -> ArrayBuffer).
 *
 * Throws if Supabase isn't configured — callers should guard with
 * `isSupabaseConfigured` (in demo mode we just keep the local URI).
 */
export async function uploadReceiptPhoto(localUri: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured");
  }

  const { ext, contentType } = extAndType(localUri);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  let body: ArrayBuffer | Blob;
  if (Platform.OS === "web") {
    // On web the URI is a blob:/data: URL we can fetch directly.
    const res = await fetch(localUri);
    body = await res.blob();
  } else {
    // On native, reading as base64 then decoding is the reliable path
    // (fetch().blob() on file:// has historically uploaded empty files).
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    body = decode(base64);
  }

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, body, { contentType, upsert: false });

  if (error) throw new Error(`Photo upload failed: ${error.message}`);

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Best-effort deletion of a previously uploaded receipt photo. Silently ignores
 * anything that isn't one of our Storage objects (e.g. sample images).
 */
export async function deleteReceiptPhoto(photoUrl: string | null): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !photoUrl) return;

  const marker = `/${PHOTO_BUCKET}/`;
  const idx = photoUrl.indexOf(marker);
  if (idx === -1) return; // not in our bucket

  const path = photoUrl.slice(idx + marker.length);
  if (!path) return;

  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) console.warn("Failed to delete old receipt photo:", error.message);
}
