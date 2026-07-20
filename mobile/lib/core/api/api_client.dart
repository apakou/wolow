import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../env.dart';

/// Typed error for non-2xx API responses. Mirrors the Next.js API contract:
/// 401 unauthorized, 403 forbidden/blocked, 404 not found, 409 conflict
/// (slug taken / key rotation), 413 payload too large, 422 validation,
/// 429 rate limited.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.body, this.retryAfter});

  final int statusCode;
  final String message;
  final Map<String, dynamic>? body;

  /// Seconds from the Retry-After header on 429s.
  final int? retryAfter;

  bool get isRateLimited => statusCode == 429;
  bool get isConflict => statusCode == 409;
  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Network-level failure (offline, DNS, timeout) as opposed to an HTTP error.
class ApiNetworkException implements Exception {
  ApiNetworkException(this.cause);
  final Object cause;

  @override
  String toString() => 'ApiNetworkException: $cause';
}

/// HTTP client for the Next.js business-logic API.
///
/// Injects `Authorization: Bearer <access_token>` from the current Supabase
/// session. supabase_flutter keeps the token refreshed; requests without a
/// session are sent unauthenticated (some GETs are public).
class ApiClient {
  ApiClient({http.Client? inner, String? baseUrl, SupabaseClient? supabase})
      : _inner = inner ?? http.Client(),
        _baseUrl = (baseUrl ?? Env.apiBaseUrl).replaceAll(RegExp(r'/+$'), ''),
        _supabase = supabase;

  final http.Client _inner;
  final String _baseUrl;
  final SupabaseClient? _supabase;

  SupabaseClient get _client => _supabase ?? Supabase.instance.client;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$_baseUrl$path').replace(
        queryParameters: (query == null || query.isEmpty) ? null : query,
      );

  Map<String, String> _headers({bool hasBody = false}) {
    final token = _client.auth.currentSession?.accessToken;
    return {
      if (hasBody) 'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) =>
      _send('GET', path, query: query);

  Future<dynamic> post(String path, {Object? body}) =>
      _send('POST', path, body: body);

  Future<dynamic> patch(String path, {Object? body}) =>
      _send('PATCH', path, body: body);

  Future<dynamic> put(String path, {Object? body}) =>
      _send('PUT', path, body: body);

  Future<dynamic> delete(String path, {Object? body}) =>
      _send('DELETE', path, body: body);

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    final request = http.Request(method, _uri(path, query));
    request.headers.addAll(_headers(hasBody: body != null));
    if (body != null) request.body = jsonEncode(body);

    http.Response response;
    try {
      final streamed = await _inner
          .send(request)
          .timeout(const Duration(seconds: 20));
      response = await http.Response.fromStream(streamed);
    } catch (e) {
      throw ApiNetworkException(e);
    }

    dynamic decoded;
    if (response.body.isNotEmpty) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    final map = decoded is Map<String, dynamic> ? decoded : null;
    throw ApiException(
      response.statusCode,
      (map?['error'] as String?) ?? 'Request failed',
      body: map,
      retryAfter: int.tryParse(response.headers['retry-after'] ?? ''),
    );
  }

  void close() => _inner.close();
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient();
  ref.onDispose(client.close);
  return client;
});
