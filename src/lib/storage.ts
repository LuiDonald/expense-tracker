import { useEffect, useState } from "react";
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
 * The bucket is PRIVATE. `photo_url` keeps the object's canonical URL
 * (".../object/public/receipt-photos/<path>") purely as a stable identifier —
 * it no longer opens on its own. To display or scan a photo, turn it into a
 * short-lived signed URL with `getReceiptPhotoUrl` / `useReceiptPhotoUri`.
 */

/** Extract the object path from one of our bucket URLs, or null if it isn't one. */
export function storagePathFromUrl(photoUrl: string | null): string | null {
  if (!photoUrl || isLocalPhoto(photoUrl)) return null;
  const marker = `/${PHOTO_BUCKET}/`;
  const idx = photoUrl.indexOf(marker);
  if (idx === -1) return null;
  const path = photoUrl.slice(idx + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const signedCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolve a stored photo reference to something an <Image> (or the receipt
 * scanner) can load. Local URIs and non-bucket URLs are returned unchanged;
 * bucket photos get a cached signed URL. Returns null if signing fails
 * (e.g. the photo isn't yours).
 */
export async function getReceiptPhotoUrl(
  photoUrl: string | null
): Promise<string | null> {
  if (!photoUrl) return null;
  const path = storagePathFromUrl(photoUrl);
  if (!path || !isSupabaseConfigured || !supabase) return photoUrl;

  const cached = signedCache.get(path);
  // Reuse until 5 minutes before expiry.
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.url;

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.warn("Could not sign receipt photo URL:", error?.message);
    return null;
  }
  signedCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

/** Hook form of `getReceiptPhotoUrl` for rendering. `loading` is true while signing. */
export function useReceiptPhotoUri(photoUrl: string | null): {
  uri: string | null;
  loading: boolean;
} {
  const needsSigning = !!storagePathFromUrl(photoUrl) && isSupabaseConfigured;
  const [state, setState] = useState<{ for: string | null; uri: string | null }>(
    { for: null, uri: null }
  );

  useEffect(() => {
    if (!needsSigning) return;
    let cancelled = false;
    void getReceiptPhotoUrl(photoUrl).then((uri) => {
      if (!cancelled) setState({ for: photoUrl, uri });
    });
    return () => {
      cancelled = true;
    };
  }, [photoUrl, needsSigning]);

  if (!needsSigning) return { uri: photoUrl, loading: false };
  if (state.for !== photoUrl) return { uri: null, loading: true };
  return { uri: state.uri, loading: false };
}

/**
 * Upload a local receipt image to Supabase Storage and return its canonical
 * bucket URL (an identifier — see `getReceiptPhotoUrl` to display it).
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

  const path = storagePathFromUrl(photoUrl);
  if (!path) return; // not in our bucket
  signedCache.delete(path);

  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) console.warn("Failed to delete old receipt photo:", error.message);
}
