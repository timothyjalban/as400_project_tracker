class Config {
  // API Configuration
  // CHANGE THIS to your computer's IP address when running locally
  // To find your IP: Open PowerShell and type 'ipconfig'
  // Look for "IPv4 Address" under your WiFi adapter
  static const String apiBaseUrl = 'http://10.113.86.85:8000';

  // For deployed version, use your public URL:
  // static const String apiBaseUrl = 'https://your-app.pythonanywhere.com';

  static const Duration apiTimeout = Duration(seconds: 30);

  // The Or-Pac quote automation drives a real browser and typically takes
  // 1-2 minutes per door item (plus login/cart/download overhead); the app
  // waits for it rather than firing-and-forgetting, so this needs a much
  // longer timeout than normal API calls, scaled to how many doors are on
  // the quote.
  static Duration orepacQuoteTimeoutFor(int itemCount) =>
      Duration(minutes: 3 + (itemCount * 2));

  // App Configuration
  static const String appName = 'Order App';
  static const String appVersion = '1.0.0';

  // Feature Flags
  static const bool enablePhotoUpload = true;
  static const bool enableDraftSaving = true;
  static const int maxPhotos = 5;
  static const int maxPhotoSizeMB = 5;
}
