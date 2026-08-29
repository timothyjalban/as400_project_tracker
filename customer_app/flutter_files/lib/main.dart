import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/home_screen.dart';
import 'services/storage_service.dart';
import 'config.dart';
import 'theme/app_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize storage service
  final storageService = StorageService();
  await storageService.init();

  runApp(
    MultiProvider(
      providers: [
        Provider<StorageService>.value(value: storageService),
      ],
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: Config.appName,
      debugShowCheckedModeBanner: false,
      // Apply Material 3 light theme
      theme: AppTheme.lightTheme,
      // Apply Material 3 dark theme
      darkTheme: AppTheme.darkTheme,
      // Use system theme mode (automatically switches based on device settings)
      themeMode: ThemeMode.system,
      home: const HomeScreen(),
    );
  }
}
