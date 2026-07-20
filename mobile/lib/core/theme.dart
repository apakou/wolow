import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Brand palette ported from src/app/globals.css.
/// Brand: Dark Purple #5B21B6 - Pink #EC4899 - Orange #FB923C.
abstract final class WolowColors {
  static const background = Color(0xFF140A26);
  static const backgroundTop = Color(0xFF1B0E33); // page gradient start
  static const foreground = Color(0xFFEDE9F6);
  static const surface = Color(0xFF1E1235);
  static const surfaceLight = Color(0xFF2E1C52);
  static const surfaceLighter = Color(0xFF3D2768); // pressed/hover surface
  static const border = Color(0xFF2E1C52);
  static const muted = Color(0xFF9B8FBD);
  static const accent = Color(0xFF5B21B6);
  static const secondary = Color(0xFFEC4899);
  static const highlight = Color(0xFFFB923C);
  static const ink = Color(0xFF1A0B2E); // text on white feature cards

  static const accentGradient = LinearGradient(
    colors: [accent, secondary],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const pageGradient = LinearGradient(
    colors: [backgroundTop, background],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );
}

ThemeData buildWolowTheme() {
  final base = ThemeData(
    brightness: Brightness.dark,
    useMaterial3: true,
    colorScheme: const ColorScheme.dark(
      surface: WolowColors.background,
      onSurface: WolowColors.foreground,
      primary: WolowColors.accent,
      onPrimary: Colors.white,
      secondary: WolowColors.secondary,
      onSecondary: Colors.white,
      surfaceContainerHighest: WolowColors.surfaceLight,
      outline: WolowColors.border,
      error: Color(0xFFF87171),
    ),
    scaffoldBackgroundColor: WolowColors.background,
  );

  // Web pairing: Baloo 2 for brand/display, Geist for body text.
  final body = GoogleFonts.geistTextTheme(base.textTheme).apply(
    bodyColor: WolowColors.foreground,
    displayColor: WolowColors.foreground,
  );
  final textTheme = body.copyWith(
    displayLarge: GoogleFonts.baloo2(textStyle: body.displayLarge),
    displayMedium: GoogleFonts.baloo2(textStyle: body.displayMedium),
    displaySmall: GoogleFonts.baloo2(textStyle: body.displaySmall),
    headlineLarge: GoogleFonts.baloo2(textStyle: body.headlineLarge),
    headlineMedium: GoogleFonts.baloo2(textStyle: body.headlineMedium),
    headlineSmall: GoogleFonts.baloo2(textStyle: body.headlineSmall),
    titleLarge: GoogleFonts.baloo2(textStyle: body.titleLarge),
  );

  return base.copyWith(
    textTheme: textTheme,
    appBarTheme: const AppBarTheme(
      backgroundColor: WolowColors.background,
      foregroundColor: WolowColors.foreground,
      elevation: 0,
      centerTitle: false,
    ),
    dividerTheme: const DividerThemeData(color: WolowColors.border, thickness: 1),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: WolowColors.surface,
      selectedItemColor: WolowColors.foreground,
      unselectedItemColor: WolowColors.muted,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: WolowColors.accent,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: WolowColors.surface,
      hintStyle: const TextStyle(color: WolowColors.muted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: WolowColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: WolowColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: WolowColors.accent, width: 2),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: WolowColors.surfaceLight,
      contentTextStyle: TextStyle(color: WolowColors.foreground),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
