package com.buyoungsil.analytics // ← 새 앱에 넣을 때 앱 패키지 안으로 바꾸세요

import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * 앱 분석 SDK (Android). 외부 라이브러리 없이 동작한다. 파일 하나만 복사하면 끝.
 *
 * 사용법 (Application.onCreate):
 *   Analytics.init(this, BuildConfig.ANALYTICS_URL, BuildConfig.ANALYTICS_KEY,
 *                  BuildConfig.VERSION_NAME, BuildConfig.DEBUG)
 *
 *  - 주소나 키가 비어 있으면 아무것도 하지 않는다 (키를 넣기 전에도 앱이 정상 동작).
 *  - 앱이 앞으로 올 때 session_start 를 자동으로 보낸다 (백그라운드 30분 넘으면 새 세션).
 *  - 이벤트는 모아서 보낸다 (20건 또는 30초, 앱이 백그라운드로 갈 때). 실패하면 저장해 두었다 다시 보낸다.
 *  - 디버그 빌드는 appVersion 끝에 "-debug" 가 붙어서 관리자 화면에서 제외할 수 있다.
 *
 * 서버 규칙: README.md 의 "프로토콜" 참고 (허용 이벤트 9종, 파라미터 10개·키 40자·값 200자 등)
 */
object Analytics {
    private const val SESSION_GAP_MS = 30 * 60 * 1000L
    private const val FLUSH_INTERVAL_MS = 30_000L
    private const val FLUSH_THRESHOLD = 20
    private const val MAX_BATCH = 50
    private const val MAX_QUEUE = 500
    private const val MAX_PARAMS = 10
    private const val RETRY_FIRST_MS = 15_000L
    private const val RETRY_MAX_MS = 15 * 60_000L

    @Volatile private var enabled = false
    @Volatile private var sessionId = ""
    private var endpoint = ""
    private var key = ""
    private var appVersion = ""
    private var installId = ""
    private var queueFile: File? = null

    // 화면(메인 스레드)에서만 쓰는 값
    private var startedActivities = 0
    private var inBackground = true
    private var lastBackgroundAt = 0L

    // io 스레드에서만 쓰는 값
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "analytics").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<JSONObject>()
    private var flushing = false
    private var retryDelayMs = 0L
    private var nextAttemptAt = 0L

    private enum class SendResult { OK, DROP, RETRY }

    fun init(
        application: Application,
        baseUrl: String,
        ingestKey: String,
        versionName: String,
        isDebug: Boolean,
    ) {
        if (enabled || baseUrl.isBlank() || ingestKey.isBlank()) return

        endpoint = baseUrl.trimEnd('/') + "/api/analytics/collect"
        key = ingestKey
        appVersion = (if (isDebug) "$versionName-debug" else versionName).take(40)

        val prefs = application.getSharedPreferences("app_analytics", 0)
        installId = prefs.getString("installId", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("installId", it).apply() }

        queueFile = File(application.filesDir, "analytics_queue.jsonl")
        enabled = true
        io.execute { loadQueue() }
        application.registerActivityLifecycleCallbacks(lifecycle)
    }

    // ───────────────────────── 이벤트 보내기 ─────────────────────────

    /** 허용된 이름(session_start, screen_view, ad_*, feature_use)만 서버가 받는다. */
    fun track(name: String, params: Map<String, Any?>? = null) {
        if (!enabled) return

        val event = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("name", name)
            .put("ts", System.currentTimeMillis())
        sessionId.takeIf { it.isNotEmpty() }?.let { event.put("sessionId", it) }
        cleanParams(params)?.let { event.put("params", it) }

        io.execute {
            queue.addLast(event)
            while (queue.size > MAX_QUEUE) queue.removeFirst()
            if (queue.size >= FLUSH_THRESHOLD) flush()
        }
    }

    /** 화면 하나 열었을 때 */
    fun screen(name: String) = track("screen_view", mapOf("screen" to name))

    /** 게임·기능 이벤트. 예: Analytics.feature("picture_complete", mapOf("picture" to "cat", "score" to 87)) */
    fun feature(feature: String, params: Map<String, Any?> = emptyMap()) {
        val merged = HashMap<String, Any?>()
        merged["feature"] = feature
        merged.putAll(params)
        track("feature_use", merged)
    }

    /** 광고 이벤트. format 은 "rewarded", "interstitial", "banner" 처럼 자유롭게. */
    object Ads {
        fun loaded(format: String) = Analytics.track("ad_load", mapOf("format" to format))
        fun loadFailed(format: String, code: Int? = null) =
            Analytics.track("ad_load_failed", mapOf("format" to format, "code" to code))
        fun impression(format: String) = Analytics.track("ad_impression", mapOf("format" to format))
        fun click(format: String) = Analytics.track("ad_click", mapOf("format" to format))
        fun rewardEarned(format: String = "rewarded") = Analytics.track("ad_reward_earned", mapOf("format" to format))

        /** AdMob OnPaidEventListener 에서 호출. valueMicros 는 AdValue.valueMicros 그대로. */
        fun paid(format: String, valueMicros: Long, currency: String) =
            Analytics.track("ad_paid", mapOf("format" to format, "valueMicros" to valueMicros, "currency" to currency))
    }

    /** 바로 보내기 (보통은 직접 부를 필요 없음) */
    fun flushNow() {
        if (enabled) io.execute { flush() }
    }

    // ───────────────────────── 세션 (화면 쪽) ─────────────────────────

    private val tick = object : Runnable {
        override fun run() {
            flushNow()
            main.postDelayed(this, FLUSH_INTERVAL_MS)
        }
    }

    private val lifecycle = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityStarted(activity: Activity) {
            if (startedActivities++ == 0) onForeground()
        }

        override fun onActivityStopped(activity: Activity) {
            // 화면 회전처럼 Activity 만 다시 만들어지는 경우는 백그라운드로 보지 않는다
            if (--startedActivities == 0 && !activity.isChangingConfigurations) onBackground()
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityResumed(activity: Activity) {}
        override fun onActivityPaused(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
    }

    private fun onForeground() {
        if (!inBackground) return
        inBackground = false

        val now = System.currentTimeMillis()
        if (sessionId.isEmpty() || now - lastBackgroundAt > SESSION_GAP_MS) {
            sessionId = UUID.randomUUID().toString()
            track("session_start")
        }
        main.removeCallbacks(tick)
        main.postDelayed(tick, FLUSH_INTERVAL_MS)
    }

    private fun onBackground() {
        inBackground = true
        lastBackgroundAt = System.currentTimeMillis()
        main.removeCallbacks(tick)
        flushNow()
    }

    // ───────────────────────── 보내기 (io 스레드) ─────────────────────────

    private fun flush() {
        if (flushing) return
        flushing = true
        try {
            while (queue.isNotEmpty() && System.currentTimeMillis() >= nextAttemptAt) {
                val batch = queue.take(MAX_BATCH)

                when (post(batch)) {
                    SendResult.OK, SendResult.DROP -> {
                        // DROP: 서버가 이 묶음을 영영 못 받는다고 답한 경우(형식 오류, 잘못된 키). 재시도해도 소용없어 버린다.
                        repeat(batch.size) { queue.removeFirst() }
                        retryDelayMs = 0L
                        nextAttemptAt = 0L
                    }
                    SendResult.RETRY -> {
                        retryDelayMs = if (retryDelayMs == 0L) RETRY_FIRST_MS else minOf(retryDelayMs * 2, RETRY_MAX_MS)
                        nextAttemptAt = System.currentTimeMillis() + retryDelayMs
                        break
                    }
                }
            }
        } finally {
            flushing = false
            persist()
        }
    }

    private fun post(events: List<JSONObject>): SendResult {
        var conn: HttpURLConnection? = null
        return try {
            val body = JSONObject()
                .put("installId", installId)
                .put("appVersion", appVersion)
                .put("platform", "android")
                .put("osVersion", (Build.VERSION.RELEASE ?: "").take(40))
                .put("events", JSONArray(events))

            conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 10_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("x-analytics-key", key)
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            when {
                code in 200..299 -> SendResult.OK
                code == 429 || code >= 500 -> SendResult.RETRY
                else -> SendResult.DROP
            }
        } catch (e: Exception) {
            SendResult.RETRY // 네트워크 없음 등
        } finally {
            conn?.disconnect()
        }
    }

    // ───────────────────────── 저장 / 정리 ─────────────────────────

    private fun persist() {
        try {
            queueFile?.writeText(queue.joinToString("\n") { it.toString() })
        } catch (_: Exception) {
        }
    }

    private fun loadQueue() {
        try {
            val file = queueFile ?: return
            if (!file.exists()) return
            val restored = file.readLines().filter { it.isNotBlank() }.mapNotNull {
                try { JSONObject(it) } catch (_: Exception) { null }
            }
            // 시작 직후 쌓인 새 이벤트보다 앞에 둔다
            queue.addAll(0, restored)
            while (queue.size > MAX_QUEUE) queue.removeFirst()
        } catch (_: Exception) {
        }
    }

    /** 서버 규칙에 맞게 정리: 문자열·숫자·불리언만, 최대 10개, 키 40자, 값 200자 */
    private fun cleanParams(params: Map<String, Any?>?): JSONObject? {
        if (params.isNullOrEmpty()) return null
        val out = JSONObject()
        for ((k, v) in params) {
            if (out.length() >= MAX_PARAMS) break
            if (k.isEmpty() || k.length > 40) continue
            when (v) {
                is String -> out.put(k, v.take(200))
                is Boolean -> out.put(k, v)
                is Int -> out.put(k, v.toLong())
                is Long -> out.put(k, v)
                is Float -> if (v.isFinite()) out.put(k, v.toDouble())
                is Double -> if (v.isFinite()) out.put(k, v)
                else -> {} // null·객체·배열은 보내지 않는다
            }
        }
        return if (out.length() == 0) null else out
    }
}
