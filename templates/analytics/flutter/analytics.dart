// templates/analytics/flutter/analytics.dart
// 앱 분석 SDK (Flutter). 파일 하나를 lib/ 에 복사하면 된다.
//
// pubspec.yaml 에 추가:
//   dependencies:
//     http: ^1.2.0
//     shared_preferences: ^2.2.0
//
// 사용법 (main() 에서 runApp 전에):
//   WidgetsFlutterBinding.ensureInitialized();
//   await Analytics.init(
//     baseUrl: const String.fromEnvironment('ANALYTICS_URL'),
//     key: const String.fromEnvironment('ANALYTICS_KEY'),
//     appVersion: '1.0.0',
//     debug: kDebugMode,
//   );
//   Analytics.feature('picture_complete', {'picture': 'cat'});
//
// 빌드할 때: flutter build appbundle --dart-define=ANALYTICS_URL=https://내도메인 --dart-define=ANALYTICS_KEY=ak_xxx
//  - 주소나 키가 비어 있으면 아무것도 하지 않는다.
//  - 앱이 앞으로 올 때 session_start 를 자동으로 보낸다 (백그라운드 30분 넘으면 새 세션).
//  - 이벤트는 모아서 보낸다 (20건 또는 30초, 앱이 백그라운드로 갈 때). 실패하면 저장해 두었다 다시 보낸다.
//  - debug: true 면 appVersion 끝에 "-debug" 가 붙어 관리자 화면에서 제외할 수 있다.

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

enum _SendResult { ok, drop, retry }

class Analytics with WidgetsBindingObserver {
  Analytics._();
  static final Analytics _i = Analytics._();

  static const _sessionGap = Duration(minutes: 30);
  static const _flushInterval = Duration(seconds: 30);
  static const _flushThreshold = 20;
  static const _maxBatch = 50;
  static const _maxQueue = 500;
  static const _maxParams = 10;
  static const _retryFirst = Duration(seconds: 15);
  static const _retryMax = Duration(minutes: 15);

  bool _enabled = false;
  String _endpoint = '';
  String _key = '';
  String _appVersion = '';
  String _installId = '';
  String _sessionId = '';
  DateTime? _backgroundAt;
  bool _inBackground = true;
  SharedPreferences? _prefs;
  Timer? _timer;
  final List<Map<String, dynamic>> _queue = [];
  bool _flushing = false;
  Duration _retryDelay = Duration.zero;
  DateTime _nextAttemptAt = DateTime.fromMillisecondsSinceEpoch(0);

  static Future<void> init({
    required String baseUrl,
    required String key,
    required String appVersion,
    bool debug = false,
  }) async {
    if (_i._enabled || baseUrl.isEmpty || key.isEmpty) return;

    final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    _i._endpoint = '$base/api/analytics/collect';
    _i._key = key;
    final version = debug ? '$appVersion-debug' : appVersion;
    _i._appVersion = version.length > 40 ? version.substring(0, 40) : version;

    final prefs = await SharedPreferences.getInstance();
    _i._prefs = prefs;
    _i._installId = prefs.getString('analytics_install') ?? _uuid();
    await prefs.setString('analytics_install', _i._installId);

    try {
      final saved = jsonDecode(prefs.getString('analytics_queue') ?? '[]');
      if (saved is List) {
        _i._queue.addAll(saved.whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
        _trim();
      }
    } catch (_) {}

    _i._enabled = true;
    WidgetsBinding.instance.addObserver(_i);
    _i._onForeground();
  }

  /// 허용된 이름(session_start, screen_view, ad_*, feature_use)만 서버가 받는다.
  static void track(String name, [Map<String, Object?>? params]) {
    if (!_i._enabled) return;

    final event = <String, dynamic>{
      'id': _uuid(),
      'name': name,
      'ts': DateTime.now().millisecondsSinceEpoch,
    };
    if (_i._sessionId.isNotEmpty) event['sessionId'] = _i._sessionId;
    final clean = _cleanParams(params);
    if (clean != null) event['params'] = clean;

    _i._queue.add(event);
    _trim();
    if (_i._queue.length >= _flushThreshold) flush();
  }

  /// 화면 하나 열었을 때 (go_router 등의 observer 에서 부르면 된다)
  static void screen(String name) => track('screen_view', {'screen': name});

  /// 게임·기능 이벤트. 예: Analytics.feature('picture_complete', {'picture': 'cat', 'score': 87})
  static void feature(String feature, [Map<String, Object?> params = const {}]) =>
      track('feature_use', {'feature': feature, ...params});

  /// 광고 이벤트. format 은 'rewarded', 'interstitial', 'banner' 처럼 자유롭게.
  static void adLoaded(String format) => track('ad_load', {'format': format});
  static void adLoadFailed(String format, [int? code]) => track('ad_load_failed', {'format': format, 'code': code});
  static void adImpression(String format) => track('ad_impression', {'format': format});
  static void adClick(String format) => track('ad_click', {'format': format});
  static void adRewardEarned([String format = 'rewarded']) => track('ad_reward_earned', {'format': format});

  /// AdMob onPaidEvent 에서 호출. valueMicros 는 AdValue.valueMicros 그대로.
  static void adPaid(String format, int valueMicros, String currency) =>
      track('ad_paid', {'format': format, 'valueMicros': valueMicros, 'currency': currency});

  /// 지금 바로 보내기 (보통은 직접 부를 필요 없음)
  static Future<void> flush() async {
    final s = _i;
    if (!s._enabled || s._flushing || s._queue.isEmpty) return;

    s._flushing = true;
    try {
      while (s._queue.isNotEmpty && !DateTime.now().isBefore(s._nextAttemptAt)) {
        final count = min(_maxBatch, s._queue.length);
        final batch = List<Map<String, dynamic>>.from(s._queue.take(count));
        final result = await s._post(batch);

        if (result == _SendResult.retry) {
          s._retryDelay = s._retryDelay == Duration.zero
              ? _retryFirst
              : (s._retryDelay * 2 > _retryMax ? _retryMax : s._retryDelay * 2);
          s._nextAttemptAt = DateTime.now().add(s._retryDelay);
          break;
        }

        // ok / drop: 서버가 형식 오류나 잘못된 키로 답한 묶음은 재시도해도 소용없어 버린다.
        s._queue.removeRange(0, count);
        s._retryDelay = Duration.zero;
        s._nextAttemptAt = DateTime.fromMillisecondsSinceEpoch(0);
      }
    } finally {
      s._flushing = false;
      await s._persist();
    }
  }

  // ───────────────────────── 세션 ─────────────────────────

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_enabled) return;
    if (state == AppLifecycleState.resumed) {
      _onForeground();
    } else if (state == AppLifecycleState.paused) {
      _onBackground();
    }
  }

  void _onForeground() {
    if (!_inBackground && _sessionId.isNotEmpty) return;
    _inBackground = false;

    final now = DateTime.now();
    final last = _backgroundAt;
    if (_sessionId.isEmpty || last == null || now.difference(last) > _sessionGap) {
      _sessionId = _uuid();
      track('session_start');
    }
    _timer?.cancel();
    _timer = Timer.periodic(_flushInterval, (_) => flush());
  }

  void _onBackground() {
    _inBackground = true;
    _backgroundAt = DateTime.now();
    _timer?.cancel();
    flush();
  }

  // ───────────────────────── 내부 ─────────────────────────

  Future<_SendResult> _post(List<Map<String, dynamic>> events) async {
    try {
      final res = await http
          .post(
            Uri.parse(_endpoint),
            headers: {'content-type': 'application/json', 'x-analytics-key': _key},
            body: jsonEncode({
              'installId': _installId,
              'appVersion': _appVersion,
              'platform': kIsWeb
                  ? 'web'
                  : (defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android'),
              'events': events,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (res.statusCode >= 200 && res.statusCode < 300) return _SendResult.ok;
      if (res.statusCode == 429 || res.statusCode >= 500) return _SendResult.retry;
      return _SendResult.drop;
    } catch (_) {
      return _SendResult.retry; // 네트워크 없음 등
    }
  }

  Future<void> _persist() async {
    try {
      await _prefs?.setString('analytics_queue', jsonEncode(_queue));
    } catch (_) {}
  }

  static void _trim() {
    if (_i._queue.length > _maxQueue) _i._queue.removeRange(0, _i._queue.length - _maxQueue);
  }

  /// 서버 규칙에 맞게 정리: 문자열·숫자·불리언만, 최대 10개, 키 40자, 값 200자
  static Map<String, Object>? _cleanParams(Map<String, Object?>? params) {
    if (params == null || params.isEmpty) return null;
    final out = <String, Object>{};
    for (final e in params.entries) {
      if (out.length >= _maxParams) break;
      if (e.key.isEmpty || e.key.length > 40) continue;
      final v = e.value;
      if (v is String) {
        out[e.key] = v.length > 200 ? v.substring(0, 200) : v;
      } else if (v is bool) {
        out[e.key] = v;
      } else if (v is num && v.isFinite) {
        out[e.key] = v;
      } // null·객체·배열은 보내지 않는다
    }
    return out.isEmpty ? null : out;
  }

  static final _rng = Random.secure();
  static String _uuid() {
    final b = List<int>.generate(16, (_) => _rng.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
    return '${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}';
  }
}
