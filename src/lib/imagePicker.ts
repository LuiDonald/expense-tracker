import * as ImagePicker from "expo-image-picker";

/**
 * Pick an existing photo (receipt) from the device library.
 * Returns a local URI, or null if cancelled.
 */
export async function pickImageFromLibrary(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.8,
  });

  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
}

/**
 * Pick several receipt photos at once (Android, iOS 14+, web).
 * Returns local URIs in the order given, or [] if cancelled.
 */
export async function pickImagesFromLibrary(): Promise<string[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    quality: 0.8,
  });

  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map((a) => a.uri);
}

/**
 * Open the camera to snap a new receipt photo. Returns a local URI, or null.
 */
export async function takePhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
  });

  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
}
